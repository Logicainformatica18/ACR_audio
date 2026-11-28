<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Mezcla guardada: los ajustes del mezclador con un nombre (mute, solo, volúmenes, silencios y rango). */
class Mix extends Model
{
    protected $fillable = ['name', 'settings'];

    protected function casts(): array
    {
        return ['settings' => 'array'];
    }

    public function song(): BelongsTo
    {
        return $this->belongsTo(Song::class);
    }

    public function toClient(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'settings' => $this->settings,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
