"""
BTC: Bi-directional Transformer for Chord recognition (ISMIR 2019).

Código original: https://github.com/jayg996/BTC-ISMIR19 (licencia MIT, ver
LICENSE en esta carpeta). Copyright (c) 2019 Jonggwon Park.

Adaptación para ACR Audio (solo inferencia):
- une btc_model.py y utils/transformer_modules.py en un archivo;
- quita lo que solo sirve para entrenar (pérdidas, CRF, mapas de atención);
- compatible con Python 3.12, numpy 2 y torch 2.11 (np.float ya no existe);
- devuelve probabilidades en lugar de solo el índice ganador, para poder
  promediar ventanas solapadas y calcular la confianza.

Los nombres de las capas son los mismos que en el original, así los pesos
oficiales (btc_model.pt / btc_model_large_voca.pt) cargan sin cambios.
"""

import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# Hiperparámetros del modelo publicado (run_config.yaml del repositorio).
CONFIG = {
    "song_hz": 22050,
    "inst_len": 10.0,
    "n_bins": 144,
    "bins_per_octave": 24,
    "hop_length": 2048,
    "feature_size": 144,
    "timestep": 108,
    "num_layers": 8,
    "num_heads": 4,
    "hidden_size": 128,
    "total_key_depth": 128,
    "total_value_depth": 128,
    "filter_size": 128,
}

ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
QUALITIES = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7",
             "maj7", "7", "dim7", "hdim7", "sus2", "sus4"]


def etiquetas(large_voca):
    """Índice de clase -> etiqueta estilo Harte ('A:min', 'C', 'N', 'X')."""
    if not large_voca:
        out = []
        for r in ROOTS:
            out += [r, r + ":min"]
        return out + ["N"]
    out = {}
    for i in range(168):
        root = ROOTS[i // 14]
        q = QUALITIES[i % 14]
        out[i] = root if q == "maj" else root + ":" + q
    out[168] = "X"
    out[169] = "N"
    return [out[i] for i in range(170)]


def _gen_bias_mask(max_length):
    np_mask = np.triu(np.full([max_length, max_length], -np.inf), 1)
    return torch.from_numpy(np_mask).float().unsqueeze(0).unsqueeze(1)


def _gen_timing_signal(length, channels, min_timescale=1.0, max_timescale=1.0e4):
    position = np.arange(length)
    num_timescales = channels // 2
    log_inc = math.log(float(max_timescale) / float(min_timescale)) / (float(num_timescales) - 1)
    inv = min_timescale * np.exp(np.arange(num_timescales).astype(np.float64) * -log_inc)
    scaled = np.expand_dims(position, 1) * np.expand_dims(inv, 0)
    signal = np.concatenate([np.sin(scaled), np.cos(scaled)], axis=1)
    signal = np.pad(signal, [[0, 0], [0, channels % 2]], "constant")
    return torch.from_numpy(signal.reshape([1, length, channels])).float()


class LayerNorm(nn.Module):
    def __init__(self, features, eps=1e-6):
        super().__init__()
        self.gamma = nn.Parameter(torch.ones(features))
        self.beta = nn.Parameter(torch.zeros(features))
        self.eps = eps

    def forward(self, x):
        mean = x.mean(-1, keepdim=True)
        std = x.std(-1, keepdim=True)
        return self.gamma * (x - mean) / (std + self.eps) + self.beta


class MultiHeadAttention(nn.Module):
    def __init__(self, input_depth, total_key_depth, total_value_depth, output_depth,
                 num_heads, bias_mask=None):
        super().__init__()
        self.num_heads = num_heads
        self.query_scale = (total_key_depth // num_heads) ** -0.5
        # buffer: se mueve a la GPU junto con el modelo
        self.register_buffer("bias_mask", bias_mask, persistent=False)
        self.query_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.key_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.value_linear = nn.Linear(input_depth, total_value_depth, bias=False)
        self.output_linear = nn.Linear(total_value_depth, output_depth, bias=False)

    def _split(self, x):
        s = x.shape
        return x.view(s[0], s[1], self.num_heads, s[2] // self.num_heads).permute(0, 2, 1, 3)

    def _merge(self, x):
        s = x.shape
        return x.permute(0, 2, 1, 3).contiguous().view(s[0], s[2], s[3] * self.num_heads)

    def forward(self, q, k, v):
        q = self._split(self.query_linear(q)) * self.query_scale
        k = self._split(self.key_linear(k))
        v = self._split(self.value_linear(v))
        logits = torch.matmul(q, k.permute(0, 1, 3, 2))
        if self.bias_mask is not None:
            logits = logits + self.bias_mask[:, :, :logits.shape[-2], :logits.shape[-1]]
        weights = F.softmax(logits, dim=-1)
        return self.output_linear(self._merge(torch.matmul(weights, v)))


class Conv(nn.Module):
    def __init__(self, input_size, output_size, kernel_size):
        super().__init__()
        self.pad = nn.ConstantPad1d((kernel_size // 2, (kernel_size - 1) // 2), 0)
        self.conv = nn.Conv1d(input_size, output_size, kernel_size=kernel_size, padding=0)

    def forward(self, x):
        return self.conv(self.pad(x.permute(0, 2, 1))).permute(0, 2, 1)


class PositionwiseFeedForward(nn.Module):
    def __init__(self, input_depth, filter_size, output_depth):
        super().__init__()
        self.layers = nn.ModuleList([
            Conv(input_depth, filter_size, 3),
            Conv(filter_size, output_depth, 3),
        ])
        self.relu = nn.ReLU()

    def forward(self, x):
        # Igual que el original: ReLU después de cada capa (también la última).
        for layer in self.layers:
            x = self.relu(layer(x))
        return x


class SelfAttentionBlock(nn.Module):
    def __init__(self, hidden, key_depth, value_depth, filter_size, num_heads, bias_mask):
        super().__init__()
        self.multi_head_attention = MultiHeadAttention(hidden, key_depth, value_depth, hidden,
                                                       num_heads, bias_mask)
        self.positionwise_convolution = PositionwiseFeedForward(hidden, filter_size, hidden)
        self.layer_norm_mha = LayerNorm(hidden)
        self.layer_norm_ffn = LayerNorm(hidden)

    def forward(self, x):
        n = self.layer_norm_mha(x)
        x = x + self.multi_head_attention(n, n, n)
        n = self.layer_norm_ffn(x)
        return x + self.positionwise_convolution(n)


class BiDirectionalSelfAttention(nn.Module):
    def __init__(self, hidden, key_depth, value_depth, filter_size, num_heads, max_length):
        super().__init__()
        mask = _gen_bias_mask(max_length)
        self.attn_block = SelfAttentionBlock(hidden, key_depth, value_depth, filter_size,
                                             num_heads, mask)
        self.backward_attn_block = SelfAttentionBlock(hidden, key_depth, value_depth, filter_size,
                                                      num_heads, torch.transpose(mask, 2, 3))
        self.linear = nn.Linear(hidden * 2, hidden)

    def forward(self, x):
        return self.linear(torch.cat((self.attn_block(x), self.backward_attn_block(x)), dim=2))


class BiDirectionalSelfAttentionLayers(nn.Module):
    def __init__(self, c):
        super().__init__()
        h = c["hidden_size"]
        self.register_buffer("timing_signal", _gen_timing_signal(c["timestep"], h), persistent=False)
        self.embedding_proj = nn.Linear(c["feature_size"], h, bias=False)
        self.self_attn_layers = nn.Sequential(*[
            BiDirectionalSelfAttention(h, c["total_key_depth"], c["total_value_depth"],
                                       c["filter_size"], c["num_heads"], c["timestep"])
            for _ in range(c["num_layers"])
        ])
        self.layer_norm = LayerNorm(h)

    def forward(self, inputs):
        x = self.embedding_proj(inputs)
        x = x + self.timing_signal[:, :inputs.shape[1], :]
        return self.layer_norm(self.self_attn_layers(x))


class OutputLayer(nn.Module):
    def __init__(self, hidden, num_chords):
        super().__init__()
        self.output_projection = nn.Linear(hidden, num_chords)
        # No se usa en inferencia, pero está en los pesos publicados.
        self.lstm = nn.LSTM(input_size=hidden, hidden_size=hidden // 2, batch_first=True,
                            bidirectional=True)

    def forward(self, hidden):
        return F.softmax(self.output_projection(hidden), -1)


class BTC(nn.Module):
    def __init__(self, num_chords, c=CONFIG):
        super().__init__()
        self.self_attn_layers = BiDirectionalSelfAttentionLayers(c)
        self.output_layer = OutputLayer(c["hidden_size"], num_chords)

    def forward(self, x):
        """x: (lote, 108, 144) -> probabilidades (lote, 108, num_chords)."""
        return self.output_layer(self.self_attn_layers(x))


def cargar(ruta_pesos, large_voca, device):
    """Carga el modelo y la media/desviación de normalización del checkpoint."""
    # weights_only=True: solo tensores y números, nunca código ejecutable.
    # El checkpoint guarda mean/std como escalares de numpy: se permiten solo esos tipos.
    seguros = [(np._core.multiarray.scalar, "numpy.core.multiarray.scalar"), np.dtype,
               type(np.dtype("float64"))]
    with torch.serialization.safe_globals(seguros):
        ckpt = torch.load(ruta_pesos, map_location="cpu", weights_only=True)
    model = BTC(170 if large_voca else 25)
    model.load_state_dict(ckpt["model"])
    model.to(device).eval()
    return model, float(ckpt["mean"]), float(ckpt["std"])
