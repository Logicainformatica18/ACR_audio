"""
Motor de acordes de ACR Audio.

Recibe las rutas de las pistas separadas (por ejemplo guitarra, bajo, piano y
otros), las mezcla, reconoce los acordes con BTC (Bi-directional Transformer
for Chord recognition) y escribe por la salida estándar una línea JSON por
evento, a medida que avanza:

  {"tipo":"progreso","pct":35}
  {"tipo":"acorde","inicio":12.4,"fin":14.1,"acorde":"Bm","confianza":0.87}
  {"tipo":"tonalidad","valor":"B menor"}
  {"tipo":"fin"}
  {"tipo":"error","mensaje":"..."}        (y código de salida 1)

Uso:
  python acordes.py pista1.flac pista2.flac ... [--modelo btc-large]

Cómo trabaja (por bloques, con solapamiento):
  1. Mezcla las pistas en mono a 22 050 Hz (lo que espera BTC).
  2. Recorre la canción en ventanas de 10 s (108 cuadros CQT, igual que en el
     entrenamiento) que avanzan de 2,5 s en 2,5 s: cada instante lo ven 4
     ventanas y se promedian sus probabilidades, dando más peso al centro de
     cada ventana. Así no se cortan acordes en los bordes.
  3. Cada BLOQUE (4 ventanas nuevas, unos 10 s de canción) se procesa junto en
     la GPU. Los instantes que ya no van a recibir más ventanas quedan
     definitivos y sus acordes se entregan enseguida.
  4. Suaviza (promedio de ±2 cuadros), une acordes iguales seguidos y absorbe
     los de menos de MIN_DUR segundos.
"""

import argparse
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

AQUI = os.path.dirname(os.path.abspath(__file__))

MODELOS = {
    # nombre: (archivo de pesos, vocabulario grande)
    "btc-large": ("btc_model_large_voca.pt", True),
    "btc-majmin": ("btc_model.pt", False),
}

HOP_VENTANA = 27            # cuadros entre ventanas (27 * 10/108 s = 2,5 s)
VENTANAS_POR_BLOQUE = 4     # ~10 s nuevos por bloque
SUAVIZADO = 2               # promedio de ±2 cuadros
MIN_DUR = 0.45              # s; acordes más cortos se absorben
MARGEN = 2.0                # s; no se entrega lo que está a menos de esto del frente

NOTAS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
INDICE_RAIZ = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7,
               "G#": 8, "A": 9, "A#": 10, "B": 11}

# Calidad Harte -> sufijo de guitarrista e intervalos (para la tonalidad)
CALIDADES = {
    "maj": ("", (0, 4, 7)),
    "min": ("m", (0, 3, 7)),
    "dim": ("dim", (0, 3, 6)),
    "aug": ("aug", (0, 4, 8)),
    "min6": ("m6", (0, 3, 7, 9)),
    "maj6": ("6", (0, 4, 7, 9)),
    "min7": ("m7", (0, 3, 7, 10)),
    "minmaj7": ("m(maj7)", (0, 3, 7, 11)),
    "maj7": ("maj7", (0, 4, 7, 11)),
    "7": ("7", (0, 4, 7, 10)),
    "dim7": ("dim7", (0, 3, 6, 9)),
    "hdim7": ("m7b5", (0, 3, 6, 10)),
    "sus2": ("sus2", (0, 2, 7)),
    "sus4": ("sus4", (0, 5, 7)),
}

# Perfiles de Krumhansl-Kessler (mayor y menor) para estimar la tonalidad.
KK_MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def emitir(**evento):
    sys.stdout.write(json.dumps(evento, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def a_guitarrista(harte):
    """'F#:min7' -> ('F#m7', 6, (0,3,7,10)).  'N'/'X' -> ('N', None, ())."""
    if harte in ("N", "X"):
        return "N", None, ()
    raiz, _, calidad = harte.partition(":")
    calidad = calidad or "maj"
    pc = INDICE_RAIZ[raiz]
    sufijo, intervalos = CALIDADES[calidad]
    return NOTAS[pc] + sufijo, pc, intervalos


def segmentar(nombres, conf, dt, t0=0.0):
    """Une cuadros iguales seguidos y absorbe los tramos demasiado cortos."""
    segs = []  # [inicio_cuadro, fin_cuadro, nombre]
    for i, n in enumerate(nombres):
        if segs and segs[-1][2] == n:
            segs[-1][1] = i + 1
        else:
            segs.append([i, i + 1, n])

    min_cuadros = max(1, int(round(MIN_DUR / dt)))
    cambiado = True
    while cambiado and len(segs) > 1:
        cambiado = False
        for k, (a, b, n) in enumerate(segs):
            if b - a >= min_cuadros:
                continue
            prev = segs[k - 1] if k > 0 else None
            nxt = segs[k + 1] if k + 1 < len(segs) else None
            # Se lo queda el vecino más largo (o el anterior si empatan).
            dest = prev if (nxt is None or (prev is not None and prev[1] - prev[0] >= nxt[1] - nxt[0])) else nxt
            if dest is prev:
                prev[1] = b
            else:
                nxt[0] = a
            del segs[k]
            # Volver a unir vecinos iguales que hayan quedado juntos.
            fusion = []
            for s in segs:
                if fusion and fusion[-1][2] == s[2]:
                    fusion[-1][1] = s[1]
                else:
                    fusion.append(s)
            segs = fusion
            cambiado = True
            break

    out = []
    for a, b, n in segs:
        out.append({
            "inicio": round(t0 + a * dt, 3),
            "fin": round(t0 + b * dt, 3),
            "acorde": n,
            "confianza": round(float(sum(conf[a:b]) / (b - a)), 3),
        })
    return out


# Acordes diatónicos (raíz relativa a la tónica, tipo de tríada) de cada modo.
# En menor se aceptan v y V (menor armónica) y VII.
DIATONICOS = {
    "mayor": {(0, "M"), (2, "m"), (4, "m"), (5, "M"), (7, "M"), (9, "m"), (11, "d")},
    "menor": {(0, "m"), (2, "d"), (3, "M"), (5, "m"), (7, "m"), (7, "M"), (8, "M"), (10, "M")},
}


def _triada(intervalos):
    """Reduce un acorde a su tríada: M (mayor), m (menor), d (disminuida) o None."""
    if 3 in intervalos and 6 in intervalos:
        return "d"
    if 3 in intervalos:
        return "m"
    if 4 in intervalos:
        return "M"
    return None  # sus2 / sus4: solo cuenta la raíz


def estimar_tonalidad(croma, acordes):
    """
    Tonalidad a partir de los acordes detectados (duración de los que encajan en
    cada escala), con el croma de la mezcla (perfiles de Krumhansl-Kessler) como
    desempate. Entre relativas (C mayor / A menor) decide cuál de las dos
    tónicas suena más tiempo y con cuál empieza y termina la canción.
    """
    import numpy as np

    utiles = [a for a in acordes if a["pc"] is not None]
    total = sum(a["fin"] - a["inicio"] for a in utiles)
    if total <= 0:
        return None

    kk = np.zeros((12, 2))
    if croma is not None and croma.sum() > 0:
        for t in range(12):
            kk[t, 0] = np.corrcoef(croma, np.roll(KK_MAYOR, t))[0, 1]
            kk[t, 1] = np.corrcoef(croma, np.roll(KK_MENOR, t))[0, 1]

    def tonica(t, modo):
        tipo = "M" if modo == "mayor" else "m"
        dur = sum(a["fin"] - a["inicio"] for a in utiles
                  if a["pc"] == t and _triada(a["intervalos"]) == tipo)
        extremos = sum(1 for a in (utiles[0], utiles[-1])
                       if a["pc"] == t and _triada(a["intervalos"]) == tipo)
        return dur / total + 0.15 * extremos

    puntos = {}
    for t in range(12):
        for j, modo in enumerate(("mayor", "menor")):
            encaja = 0.0
            for a in utiles:
                rel = (a["pc"] - t) % 12
                tri = _triada(a["intervalos"])
                d = a["fin"] - a["inicio"]
                if tri is None:
                    encaja += d * 0.5 if any(r == rel for r, _ in DIATONICOS[modo]) else 0
                elif (rel, tri) in DIATONICOS[modo]:
                    encaja += d
            puntos[(t, modo)] = encaja / total + 0.1 * kk[t, j] + 0.3 * tonica(t, modo)

    t, modo = max(puntos, key=puntos.get)
    return f"{NOTAS[t]} {modo}"


def cargar_mezcla(rutas, sr_destino):
    import numpy as np
    import soundfile as sf
    import soxr

    mezcla, sr = None, None
    for ruta in rutas:
        datos, sr_i = sf.read(ruta, dtype="float32", always_2d=True)
        mono = datos.mean(axis=1)
        if sr is None:
            sr = sr_i
        elif sr_i != sr:
            mono = soxr.resample(mono, sr_i, sr)
        if mezcla is None:
            mezcla = mono
        else:
            n = max(len(mezcla), len(mono))
            mezcla = np.pad(mezcla, (0, n - len(mezcla))) + np.pad(mono, (0, n - len(mono)))
    pico = float(np.max(np.abs(mezcla))) if len(mezcla) else 0.0
    if pico > 0:
        mezcla = mezcla / pico * 0.9
    if sr != sr_destino:
        mezcla = soxr.resample(mezcla, sr, sr_destino)
    return mezcla.astype("float32")


def main():
    ap = argparse.ArgumentParser(description="Reconocedor de acordes (BTC) para ACR Audio")
    ap.add_argument("pistas", nargs="+", help="Archivos de audio a mezclar y analizar")
    ap.add_argument("--modelo", default="btc-large", choices=sorted(MODELOS))
    ap.add_argument("--modelos-dir", default=os.path.join(AQUI, "modelos"))
    ap.add_argument("--cpu", action="store_true", help="No usar la GPU")
    args = ap.parse_args()

    for p in args.pistas:
        if not os.path.isfile(p):
            raise FileNotFoundError(f"No existe la pista: {p}")

    archivo, large = MODELOS[args.modelo]
    pesos = os.path.join(args.modelos_dir, archivo)
    if not os.path.isfile(pesos):
        raise FileNotFoundError(
            f"Falta el modelo {archivo} en {args.modelos_dir}. Ejecuta descargar_modelos.py")

    emitir(tipo="progreso", pct=1)

    # Cargar estas librerías puede tardar bastante la primera vez tras encender
    # el PC (torch son ~3 GB que Windows lee del disco). Se avisa del avance
    # entre paso y paso para que Laravel no lo confunda con un proceso colgado.
    import numpy as np
    import torch
    emitir(tipo="progreso", pct=3)
    import librosa
    emitir(tipo="progreso", pct=5)

    sys.path.insert(0, AQUI)
    from btc.modelo import CONFIG, cargar, etiquetas

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    modelo, media, desv = cargar(pesos, large, device)
    nombres_harte = etiquetas(large)
    tabla = [a_guitarrista(h) for h in nombres_harte]
    print(f"[acordes] modelo={args.modelo} dispositivo={device}", file=sys.stderr, flush=True)
    emitir(tipo="progreso", pct=6)

    sr = CONFIG["song_hz"]
    audio = cargar_mezcla(args.pistas, sr)
    emitir(tipo="progreso", pct=8)

    T = CONFIG["timestep"]                 # 108 cuadros por ventana
    dt = CONFIG["inst_len"] / T            # 0,0926 s por cuadro
    largo_ventana = int(sr * CONFIG["inst_len"])
    duracion = len(audio) / sr
    total_cuadros = max(1, int(np.ceil(duracion / dt)))
    inicios = list(range(-(T - HOP_VENTANA), total_cuadros, HOP_VENTANA))
    n_clases = len(nombres_harte)

    acum = np.zeros((total_cuadros + T, n_clases), dtype=np.float64)
    peso = np.zeros(total_cuadros + T, dtype=np.float64)
    croma = np.zeros(12)
    ventana_peso = np.hanning(T + 2)[1:-1]  # más peso al centro, nunca 0
    pc_bin = (np.arange(CONFIG["n_bins"]) // 2) % 12   # CQT desde C1, 24 bins/octava

    entregado_hasta = 0.0      # s
    entregados = []            # acordes ya enviados (para la tonalidad)
    ultima_tonalidad = None

    def features(bloque):
        """CQT de varias ventanas de 10 s a la vez (c0 = cuadro inicial, puede ser negativo)."""
        trozos = np.zeros((len(bloque), largo_ventana), dtype=np.float32)
        for j, c0 in enumerate(bloque):
            s0 = int(round(c0 * dt * sr))
            a, b = max(0, s0), min(len(audio), s0 + largo_ventana)
            if b > a:
                trozos[j, a - s0:b - s0] = audio[a:b]
        mag = np.abs(librosa.cqt(trozos, sr=sr, n_bins=CONFIG["n_bins"],
                                 bins_per_octave=CONFIG["bins_per_octave"],
                                 hop_length=CONFIG["hop_length"]))[:, :, :T]
        return mag, np.log(mag + 1e-6)

    def entregar(hasta_cuadro, final):
        nonlocal entregado_hasta
        n = min(hasta_cuadro, total_cuadros)
        if n <= 0:
            return
        prob = acum[:n] / np.maximum(peso[:n, None], 1e-9)
        if SUAVIZADO > 0:
            k = np.ones(2 * SUAVIZADO + 1) / (2 * SUAVIZADO + 1)
            prob = np.apply_along_axis(lambda c: np.convolve(c, k, mode="same"), 0, prob)
        idx = prob.argmax(axis=1)
        conf_cuadro = prob[np.arange(n), idx]
        nombres = [tabla[i][0] for i in idx]
        segs = segmentar(nombres, conf_cuadro, dt)
        if segs:
            segs[-1]["fin"] = round(min(segs[-1]["fin"], duracion), 3)
        frente = n * dt - (0 if final else MARGEN)
        for s in segs:
            if s["fin"] <= entregado_hasta + 1e-6:
                continue
            if not final and s["fin"] > frente - 1e-6:
                break  # puede seguir creciendo con el próximo bloque
            s["inicio"] = round(max(s["inicio"], entregado_hasta), 3)
            if s["fin"] - s["inicio"] < 1e-3:
                continue
            emitir(tipo="acorde", **s)
            pc, intervalos = None, ()
            for i, (nom, p, iv) in enumerate(tabla):
                if nom == s["acorde"]:
                    pc, intervalos = p, iv
                    break
            entregados.append({**s, "pc": pc, "intervalos": intervalos})
            entregado_hasta = s["fin"]

    def tonalidad():
        nonlocal ultima_tonalidad
        if entregado_hasta < 20 and ultima_tonalidad is not None:
            return
        valor = estimar_tonalidad(croma, entregados)
        if valor and valor != ultima_tonalidad:
            ultima_tonalidad = valor
            emitir(tipo="tonalidad", valor=valor)

    inicio_reloj = time.time()
    for b0 in range(0, len(inicios), VENTANAS_POR_BLOQUE):
        bloque = inicios[b0:b0 + VENTANAS_POR_BLOQUE]
        mag, logf = features(bloque)
        # croma: solo la parte de cada ventana que no se solapa con la siguiente
        croma += (mag[:, :, T - HOP_VENTANA:] ** 2).sum(axis=(0, 2)) @ np.eye(12)[pc_bin]
        x = torch.tensor(((logf - media) / desv).transpose(0, 2, 1), dtype=torch.float32,
                         device=device)
        with torch.no_grad():
            probs = modelo(x).float().cpu().numpy()
        for c0, p in zip(bloque, probs):
            a, b = max(0, c0), min(total_cuadros + T, c0 + T)
            if b <= a:
                continue
            acum[a:b] += p[a - c0:b - c0] * ventana_peso[a - c0:b - c0, None]
            peso[a:b] += ventana_peso[a - c0:b - c0]

        siguiente = inicios[b0 + VENTANAS_POR_BLOQUE] if b0 + VENTANAS_POR_BLOQUE < len(inicios) else None
        if siguiente is None:
            break
        # Los cuadros anteriores a la próxima ventana ya son definitivos.
        entregar(siguiente - SUAVIZADO, final=False)
        tonalidad()
        pct = 8 + int(91 * min(1.0, (siguiente * dt) / max(duracion, 1e-6)))
        emitir(tipo="progreso", pct=min(pct, 99))

    entregar(total_cuadros, final=True)
    tonalidad()
    print(f"[acordes] {len(entregados)} acordes en {time.time() - inicio_reloj:.1f} s "
          f"({duracion:.0f} s de audio)", file=sys.stderr, flush=True)
    emitir(tipo="progreso", pct=100)
    emitir(tipo="fin")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - se informa a Laravel y se sale con 1
        emitir(tipo="error", mensaje=f"{type(e).__name__}: {e}")
        sys.exit(1)
