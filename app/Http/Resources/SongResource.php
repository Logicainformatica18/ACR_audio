<?php

namespace App\Http\Resources;

use App\Models\Song;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Datos de una canción que se envían a la interfaz.
 * No incluye rutas de archivos ni el log completo.
 *
 * "status" es el estado de la SEPARACIÓN (none = no solicitada) y
 * "chords_status" el de los ACORDES (null = no solicitados): son independientes.
 *
 * @mixin Song
 */
class SongResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'status' => $this->status,
            'error' => $this->error,
            'original_name' => $this->original_name,
            'original_ext' => $this->original_ext,
            'original_size' => $this->original_size,
            'duration' => $this->duration,
            'model' => $this->model,
            'tracks_count' => $this->whenCounted('tracks'),
            'created_at' => $this->created_at?->toIso8601String(),
            'queued_at' => $this->queued_at?->toIso8601String(),
            'started_at' => $this->started_at?->toIso8601String(),
            'finished_at' => $this->finished_at?->toIso8601String(),
            'chords_status' => $this->chords_status,
            'chords_progress' => (int) $this->chords_progress,
            'chords_key' => $this->chords_key,
            'chords_source' => $this->chords_source,
            'chords_error' => $this->chords_error,
            'can_improve_chords' => $this->canImproveChords(),
        ];
    }
}
