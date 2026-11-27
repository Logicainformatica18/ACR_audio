<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Preferencias del usuario.
 */
class UserPreference extends Model
{
    public const SORTS = ['recent', 'title', 'status'];

    protected $fillable = [
        'master_volume',
        'separation_model',
        'songs_sort',
        'keyboard_shortcuts',
    ];

    protected $attributes = [
        'master_volume' => 0.9,
        'songs_sort' => 'recent',
        'keyboard_shortcuts' => true,
    ];

    protected function casts(): array
    {
        return [
            'master_volume' => 'float',
            'keyboard_shortcuts' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Modelo que se usará al separar: el elegido o, si no hay, el del .env. */
    public function effectiveModel(): string
    {
        $model = $this->separation_model;

        return $model && array_key_exists($model, config('audio.models'))
            ? $model
            : config('audio.separator.model');
    }
}
