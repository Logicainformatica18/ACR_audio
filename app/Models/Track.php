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
        return $this->belongsTo(Song::class);
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

    /** Ruta relativa al disco "audio". */
    public function path(): string
    {
        return $this->song->stemsDirectory().'/'.$this->file_name;
    }

    public function label(): string
    {
        return config("audio.stems.{$this->stem}.label", ucfirst($this->stem));
    }

    public function color(): string
    {
        return config("audio.stems.{$this->stem}.color", '#C9A227');
    }
}
