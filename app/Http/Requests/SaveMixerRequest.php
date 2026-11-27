<?php

namespace App\Http\Requests;

use App\Models\Song;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Estado completo del mezclador que envía el guardado automático:
 * volumen general, ajustes de cada pista y silencios programados.
 */
class SaveMixerRequest extends FormRequest
{
    public const MAX_SILENCES = 500;

    public function authorize(): bool
    {
        /** @var Song $song */
        $song = $this->route('song');

        return $this->user()?->can('update', $song) ?? false;
    }

    public function rules(): array
    {
        /** @var Song $song */
        $song = $this->route('song');
        $trackIds = $song->tracks()->pluck('id')->all();
        // Margen de 1 s sobre la duración por redondeos del navegador.
        $maxTime = $song->duration ? $song->duration + 1 : 86400;

        return [
            'master_volume' => ['sometimes', 'numeric', 'between:0,1'],
            'tracks' => ['present', 'array', 'max:'.max(1, count($trackIds))],
            'tracks.*.id' => ['required', 'integer', 'distinct', Rule::in($trackIds)],
            'tracks.*.volume' => ['required', 'numeric', 'between:0,1'],
            'tracks.*.muted' => ['required', 'boolean'],
            'tracks.*.solo' => ['required', 'boolean'],
            'silences' => ['present', 'array', 'max:'.self::MAX_SILENCES],
            'silences.*.track_id' => ['required', 'integer', Rule::in($trackIds)],
            'silences.*.start' => ['required', 'numeric', 'min:0', "max:{$maxTime}"],
            'silences.*.end' => ['required', 'numeric', 'min:0', "max:{$maxTime}"],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                foreach ((array) $this->input('silences', []) as $i => $s) {
                    if (is_numeric($s['start'] ?? null) && is_numeric($s['end'] ?? null) && $s['end'] - $s['start'] < 0.05) {
                        $validator->errors()->add("silences.{$i}.end", 'El final de un silencio debe ser posterior al inicio.');
                    }
                }
            },
        ];
    }
}
