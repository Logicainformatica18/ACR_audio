<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Archivo exportado de una mezcla. Vive en {usuario}/{canción}/exports/{file_name}
 * (dentro de la carpeta de audios, ignorada por git). El nombre que ve el
 * usuario solo se usa en la cabecera de descarga, nunca en la ruta.
 */
class MixExport extends Model
{
    public const FORMATS = ['wav', 'flac', 'mp3'];

    protected $fillable = ['mix_id', 'name', 'format', 'file_name', 'size', 'duration', 'range_start', 'range_end', 'gain_applied'];

    protected function casts(): array
    {
        return ['size' => 'integer', 'duration' => 'float', 'range_start' => 'float', 'range_end' => 'float', 'gain_applied' => 'float'];
    }

    public function song(): BelongsTo
    {
        return $this->belongsTo(Song::class);
    }

    public function path(): string
    {
        return $this->song->directory().'/exports/'.$this->file_name;
    }

    public function toClient(): array
    {
        return [
            'id' => $this->id,
            'mix_id' => $this->mix_id,
            'name' => $this->name,
            'format' => $this->format,
            'size' => $this->size,
            'duration' => $this->duration,
            'range_start' => $this->range_start,
            'range_end' => $this->range_end,
            'gain_applied' => $this->gain_applied,
            'created_at' => $this->created_at?->toIso8601String(),
            'download_url' => route('songs.exports.download', [$this->song_id, $this->id]),
        ];
    }
}
