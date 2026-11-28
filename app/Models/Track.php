<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Pista separada de una canción (voz, batería, bajo...).
 */
class Track extends Model
{
    protected $fillable = [
        'stem',
        'label',
        'file_name',
        'size',
        'position',
        'peaks',
    ];

    /** La forma de onda solo se envía al mezclador. */
    protected $hidden = ['peaks'];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'position' => 'integer',
        ];
    }

    public function song(): BelongsTo
    {
        // También si la canción está en la papelera (sus archivos siguen ahí).
        return $this->belongsTo(Song::class)->withTrashed();
    }

    /** Volumen, mute y solo. Si aún no existe, devuelve los valores por defecto. */
    public function setting(): HasOne
    {
        return $this->hasOne(TrackSetting::class)->withDefault([
            'volume' => 1.0,
            'muted' => false,
            'solo' => false,
        ]);
    }

    public function silences(): HasMany
    {
        return $this->hasMany(ScheduledSilence::class)->orderBy('start_seconds');
    }

    /** Nombre de la pista que representa el archivo original de la canción. */
    public const ORIGINAL = 'original';

    public function isOriginal(): bool
    {
        return $this->stem === self::ORIGINAL;
    }

    /** Ruta relativa al disco "audio". La pista "original" apunta al archivo subido. */
    public function path(): string
    {
        return $this->isOriginal()
            ? $this->song->originalPath()
            : $this->song->stemsDirectory().'/'.$this->file_name;
    }

    /** Nombre visible: el que puso el usuario o, si no, el de su tipo ("Guitarra"). */
    public function label(): string
    {
        // Columna "label" leída directamente: $this->label chocaría con este método.
        return ($this->getAttributes()['label'] ?? null) ?: $this->defaultLabel();
    }

    /** Nombre según el tipo de pista (no cambia aunque el usuario la renombre). */
    public function defaultLabel(): string
    {
        return config("audio.stems.{$this->stem}.label", ucfirst($this->stem));
    }

    public function color(): string
    {
        return config("audio.stems.{$this->stem}.color", '#C9A227');
    }
}
