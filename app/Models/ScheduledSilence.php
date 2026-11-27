<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Silencio programado: la pista no suena entre start_seconds y end_seconds.
 */
class ScheduledSilence extends Model
{
    protected $fillable = [
        'start_seconds',
        'end_seconds',
    ];

    protected function casts(): array
    {
        return [
            'start_seconds' => 'float',
            'end_seconds' => 'float',
        ];
    }

    public function track(): BelongsTo
    {
        return $this->belongsTo(Track::class);
    }
}
