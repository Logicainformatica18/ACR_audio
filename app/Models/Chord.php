<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Acorde de una canción, entre dos momentos (en segundos).
 * "edited" = corregido a mano: se conserva si se vuelve a analizar.
 */
class Chord extends Model
{
    /**
     * Notación de guitarrista aceptada al corregir un acorde: raíz (con # o b),
     * tipo opcional y bajo opcional (C/G). "N" = sin acorde.
     */
    public const PATTERN = '/^(N|[A-G](#|b)?(m|maj7|maj9|m7|m9|m6|m7b5|m\(maj7\)|7|9|11|13|6|dim|dim7|aug|sus2|sus4|7sus4|add9|madd9|5)?(\/[A-G](#|b)?)?)$/';

    protected $fillable = [
        'start_seconds',
        'end_seconds',
        'chord',
        'confidence',
        'edited',
    ];

    protected function casts(): array
    {
        return [
            'start_seconds' => 'float',
            'end_seconds' => 'float',
            'confidence' => 'float',
            'edited' => 'boolean',
        ];
    }

    public function song(): BelongsTo
    {
        return $this->belongsTo(Song::class);
    }

    /** Datos que se envían a la interfaz. */
    public function toClient(): array
    {
        return [
            'id' => $this->id,
            'start' => $this->start_seconds,
            'end' => $this->end_seconds,
            'chord' => $this->chord,
            'confidence' => $this->confidence,
            'edited' => $this->edited,
        ];
    }

    /**
     * Quita de [start, end] los tramos ocupados por acordes corregidos a mano.
     *
     * @param  array<int, array{0: float, 1: float}>  $edited  tramos [inicio, fin] ordenados
     * @return array<int, array{0: float, 1: float}> trozos libres (de al menos 0,05 s)
     */
    public static function freeRanges(float $start, float $end, array $edited): array
    {
        $pieces = [[$start, $end]];
        foreach ($edited as [$a, $b]) {
            $next = [];
            foreach ($pieces as [$s, $e]) {
                if ($b <= $s || $a >= $e) {
                    $next[] = [$s, $e];

                    continue;
                }
                if ($a > $s) {
                    $next[] = [$s, $a];
                }
                if ($b < $e) {
                    $next[] = [$b, $e];
                }
            }
            $pieces = $next;
        }

        return array_values(array_filter($pieces, fn ($p) => $p[1] - $p[0] >= 0.05));
    }
}
