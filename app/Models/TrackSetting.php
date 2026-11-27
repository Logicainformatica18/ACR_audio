<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ajustes de una pista en el mezclador.
 */
class TrackSetting extends Model
{
    protected $fillable = [
        'volume',
        'muted',
        'solo',
    ];

    protected function casts(): array
    {
        return [
            'volume' => 'float',
            'muted' => 'boolean',
            'solo' => 'boolean',
        ];
    }

    public function track(): BelongsTo
    {
        return $this->belongsTo(Track::class);
    }
}
