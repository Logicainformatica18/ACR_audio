<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveMixerRequest;
use App\Http\Resources\SongResource;
use App\Models\ScheduledSilence;
use App\Models\Song;
use App\Models\Track;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class MixerController extends Controller
{
    /** Página del mezclador con las pistas, sus ajustes y silencios guardados. */
    public function show(Request $request, Song $song): Response|RedirectResponse
    {
        $this->authorize('view', $song);

        if ($song->status !== Song::STATUS_READY) {
            return to_route('songs.index')->with('error', 'Esa canción todavía no tiene pistas separadas.');
        }

        $song->load(['tracks.setting', 'tracks.silences']);
        $prefs = $request->user()->preferences();

        return Inertia::render('songs/mixer', [
            'song' => SongResource::make($song)->resolve(),
            'tracks' => $song->tracks->map(fn (Track $track) => [
                'id' => $track->id,
                'stem' => $track->stem,
                'label' => $track->label(),
                'color' => $track->color(),
                'size' => $track->size,
                'url' => route('songs.tracks.audio', [$song, $track]),
                'volume' => $track->setting->volume,
                'muted' => $track->setting->muted,
                'solo' => $track->setting->solo,
                'silences' => $track->silences->map(fn ($s) => [
                    'start' => $s->start_seconds,
                    'end' => $s->end_seconds,
                ])->values(),
            ])->values(),
            'preferences' => [
                'master_volume' => $prefs->master_volume,
                'keyboard_shortcuts' => $prefs->keyboard_shortcuts,
            ],
        ]);
    }

    /**
     * Sirve el archivo de una pista. BinaryFileResponse atiende peticiones
     * parciales (cabecera Range -> 206 Partial Content) y nunca carga el
     * archivo entero en memoria.
     */
    public function audio(Request $request, Song $song, Track $track): BinaryFileResponse
    {
        $this->authorize('view', $song);
        abort_unless($track->song_id === $song->id, 404);

        $disk = Storage::disk('audio');
        $path = $track->path(); // {user}/{song}/stems/{stem}.flac (solo ids y nombres del servidor)
        abort_unless($disk->exists($path), 404);

        $mime = match (strtolower(pathinfo($track->file_name, PATHINFO_EXTENSION))) {
            'flac' => 'audio/flac',
            'wav' => 'audio/wav',
            'mp3' => 'audio/mpeg',
            'ogg' => 'audio/ogg',
            'm4a' => 'audio/mp4',
            default => 'application/octet-stream',
        };

        $headers = [
            'Content-Type' => $mime,
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ];

        // ?download=1 -> descarga con un nombre legible: "Mi canción - Voz.flac".
        // El título solo se usa en la cabecera (saneado por Symfony), nunca en la ruta del archivo.
        if ($request->boolean('download')) {
            $ext = pathinfo($track->file_name, PATHINFO_EXTENSION);
            $name = self::downloadName($song->title, $track->label(), $ext);

            return response()->download($disk->path($path), $name, $headers);
        }

        return response()->file($disk->path($path), $headers);
    }

    /** Nombre de descarga sin caracteres prohibidos en Windows. */
    public static function downloadName(string $title, string $label, string $ext): string
    {
        $base = preg_replace('/[\\\\\/:*?"<>|\x00-\x1F]+/u', '', "{$title} - {$label}") ?? 'pista';
        $base = trim(preg_replace('/\s+/u', ' ', $base) ?? '', ' .');

        return ($base === '' ? 'pista' : Str::limit($base, 150, '')).'.'.$ext;
    }

    /** Guardado automático: reemplaza ajustes de pista, silencios y volumen general. */
    public function save(SaveMixerRequest $request, Song $song): JsonResponse
    {
        $data = $request->validated();

        DB::transaction(function () use ($request, $song, $data) {
            $tracks = $song->tracks()->get()->keyBy('id');

            foreach ($data['tracks'] as $t) {
                $tracks[$t['id']]->setting()->updateOrCreate([], [
                    'volume' => round((float) $t['volume'], 3),
                    'muted' => (bool) $t['muted'],
                    'solo' => (bool) $t['solo'],
                ]);
            }

            // Los silencios se reemplazan completos: es el estado que ve el usuario.
            ScheduledSilence::whereIn('track_id', $tracks->keys())->delete();
            foreach ($data['silences'] as $s) {
                $tracks[$s['track_id']]->silences()->create([
                    'start_seconds' => round((float) $s['start'], 3),
                    'end_seconds' => round((float) $s['end'], 3),
                ]);
            }

            if (array_key_exists('master_volume', $data)) {
                $request->user()->preferences()->update(['master_volume' => round((float) $data['master_volume'], 3)]);
            }
        });

        return response()->json(['saved_at' => now()->toIso8601String()]);
    }
}
