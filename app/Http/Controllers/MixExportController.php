<?php

namespace App\Http\Controllers;

use App\Models\Mix;
use App\Models\MixExport;
use App\Models\Song;
use App\Services\Separator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\Process\Process;

/**
 * Exportar mezcla y mezclas guardadas.
 *
 * La mezcla se calcula en el NAVEGADOR (OfflineAudioContext, con el mismo
 * grafo de audio que se escucha) y llega aquí como WAV de 16 bits. El servidor
 * solo la codifica con FFmpeg (MP3 320 kbps o FLAC; WAV se re-escribe limpio) y
 * guarda el archivo en {usuario}/{canción}/exports/ para descargarlo de nuevo.
 */
class MixExportController extends Controller
{
    /** Codifica la mezcla subida y devuelve el archivo listo para descargar. */
    public function store(Request $request, Song $song): JsonResponse
    {
        $this->authorize('update', $song);
        $maxKb = (int) config('audio.max_upload_mb') * 1024;
        $data = $request->validate([
            'file' => ['required', 'file', 'mimetypes:audio/wav,audio/x-wav,audio/wave,audio/vnd.wave', "max:{$maxKb}"],
            'format' => ['required', 'in:'.implode(',', MixExport::FORMATS)],
            'name' => ['required', 'string', 'max:200'],
            'mix_id' => ['nullable', 'integer'],
            'range_start' => ['nullable', 'numeric', 'min:0'],
            'range_end' => ['nullable', 'numeric', 'min:0'],
            'gain_applied' => ['nullable', 'numeric', 'between:0,1'],
        ], [
            'file.mimetypes' => 'La mezcla no llegó como un WAV válido.',
            'file.max' => 'La mezcla es demasiado grande para subirla (máximo '.config('audio.max_upload_mb').' MB). Exporta un tramo más corto.',
        ]);
        // Cabecera WAV real (RIFF....WAVE), no solo la extensión.
        $head = (string) file_get_contents($request->file('file')->getRealPath(), false, null, 0, 12);
        if (strlen($head) < 12 || ! str_starts_with($head, 'RIFF') || substr($head, 8, 4) !== 'WAVE') {
            return response()->json(['message' => 'La mezcla no llegó como un WAV válido.', 'errors' => ['file' => ['La mezcla no llegó como un WAV válido.']]], 422);
        }
        $mixId = isset($data['mix_id']) && $song->mixes()->whereKey($data['mix_id'])->exists() ? (int) $data['mix_id'] : null;

        $export = $song->exports()->create([
            'mix_id' => $mixId,
            'name' => self::cleanName($data['name']) ?: $song->title,
            'format' => $data['format'],
            'file_name' => 'tmp',
            'range_start' => $data['range_start'] ?? null,
            'range_end' => $data['range_end'] ?? null,
            'gain_applied' => $data['gain_applied'] ?? null,
        ]);
        $export->update(['file_name' => $export->id.'.'.$data['format']]); // nombre fijo del servidor

        $disk = Storage::disk('audio');
        $disk->makeDirectory($song->directory().'/exports');
        $out = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $disk->path($export->path()));

        $codec = match ($data['format']) {
            'mp3' => ['-c:a', 'libmp3lame', '-b:a', '320k'],
            'flac' => ['-c:a', 'flac', '-compression_level', '5'],
            default => ['-c:a', 'pcm_s16le'],
        };
        $process = new Process(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', $request->file('file')->getRealPath(),
            ...$codec, '-metadata', 'title='.Str::limit($export->name, 150, ''), $out]);
        $process->setTimeout(300);
        try {
            $process->run();
        } catch (\Throwable) {
            // se informa abajo
        }
        if (! $process->isSuccessful() || ! is_file($out)) {
            $export->delete();
            @unlink($out);

            return response()->json(['message' => 'FFmpeg no pudo codificar la mezcla: '.Str::limit(trim($process->getErrorOutput()) ?: 'error desconocido', 300)], 500);
        }

        $export->update(['size' => filesize($out), 'duration' => Separator::probeDuration($out)]);

        return response()->json(['export' => $export->fresh()->toClient()], 201);
    }

    /** Descarga un archivo exportado con su nombre legible ("Crush of Love - sin batería.mp3"). */
    public function download(Song $song, MixExport $export): BinaryFileResponse
    {
        $this->authorize('view', $song);
        abort_unless($export->song_id === $song->id, 404);
        $disk = Storage::disk('audio');
        abort_unless($disk->exists($export->path()), 404);

        return response()->download($disk->path($export->path()), MixerController::downloadName($export->name, '', $export->format), [
            'Content-Type' => match ($export->format) {
                'mp3' => 'audio/mpeg', 'flac' => 'audio/flac', default => 'audio/wav'
            },
        ]);
    }

    /** Borra un archivo exportado para liberar espacio. */
    public function destroy(Song $song, MixExport $export): JsonResponse
    {
        $this->authorize('update', $song);
        abort_unless($export->song_id === $song->id, 404);
        Storage::disk('audio')->delete($export->path());
        $export->delete();

        return response()->json(['deleted' => true]);
    }

    // ----- Mezclas guardadas -----

    public function storeMix(Request $request, Song $song): JsonResponse
    {
        $this->authorize('update', $song);
        $data = $this->validateMix($request, $song, true);
        $mix = $song->mixes()->create(['name' => $data['name'], 'settings' => $data['settings']]);

        return response()->json(['mix' => $mix->toClient()], 201);
    }

    public function updateMix(Request $request, Song $song, Mix $mix): JsonResponse
    {
        $this->authorize('update', $song);
        abort_unless($mix->song_id === $song->id, 404);
        $data = $this->validateMix($request, $song, false);
        $mix->update(array_filter($data, fn ($v) => $v !== null));

        return response()->json(['mix' => $mix->fresh()->toClient()]);
    }

    public function destroyMix(Song $song, Mix $mix): JsonResponse
    {
        $this->authorize('update', $song);
        abort_unless($mix->song_id === $song->id, 404);
        $mix->delete(); // los archivos exportados se conservan (mix_id pasa a null)

        return response()->json(['deleted' => true]);
    }

    /**
     * Valida los ajustes de una mezcla: solo pistas de esta canción, volúmenes
     * 0–1, silencios y rango dentro de la canción.
     *
     * @return array{name: ?string, settings: ?array}
     */
    private function validateMix(Request $request, Song $song, bool $creating): array
    {
        $trackIds = $song->tracks()->pluck('id')->all();
        $max = (float) ($song->duration ?? 7200) + 1;
        $req = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'name' => [$req, 'string', 'max:120'],
            'settings' => [$req, 'array'],
            'settings.master' => ['required_with:settings', 'numeric', 'between:0,1'],
            'settings.tracks' => ['required_with:settings', 'array', 'max:20'],
            'settings.tracks.*.id' => ['required', 'integer', 'in:'.implode(',', $trackIds ?: [0])],
            'settings.tracks.*.volume' => ['required', 'numeric', 'between:0,1'],
            'settings.tracks.*.muted' => ['required', 'boolean'],
            'settings.tracks.*.solo' => ['required', 'boolean'],
            'settings.silences' => ['present_with:settings', 'array', 'max:500'],
            'settings.silences.*.track_id' => ['required', 'integer', 'in:'.implode(',', $trackIds ?: [0])],
            'settings.silences.*.start' => ['required', 'numeric', 'min:0', "max:{$max}"],
            'settings.silences.*.end' => ['required', 'numeric', 'gt:settings.silences.*.start', "max:{$max}"],
            'settings.show_original' => ['sometimes', 'boolean'],
            'settings.range' => ['nullable', 'array'],
            'settings.range.start' => ['required_with:settings.range', 'numeric', 'min:0', "max:{$max}"],
            'settings.range.end' => ['required_with:settings.range', 'numeric', 'gt:settings.range.start', "max:{$max}"],
        ], [
            'settings.tracks.*.id.in' => 'La mezcla tiene una pista que no es de esta canción.',
            'settings.silences.*.track_id.in' => 'Un silencio es de una pista que no es de esta canción.',
        ]);

        $name = isset($data['name']) ? (self::cleanName($data['name']) ?: 'Mezcla') : null;
        $settings = null;
        if (isset($data['settings'])) {
            $s = $data['settings'];
            $settings = [
                'master' => round((float) $s['master'], 3),
                'tracks' => array_map(fn ($t) => ['id' => (int) $t['id'], 'volume' => round((float) $t['volume'], 3), 'muted' => (bool) $t['muted'], 'solo' => (bool) $t['solo']], $s['tracks']),
                'silences' => array_map(fn ($x) => ['track_id' => (int) $x['track_id'], 'start' => round((float) $x['start'], 3), 'end' => round((float) $x['end'], 3)], $s['silences'] ?? []),
                'show_original' => (bool) ($s['show_original'] ?? false),
                'range' => isset($s['range']) ? ['start' => round((float) $s['range']['start'], 3), 'end' => round((float) $s['range']['end'], 3)] : null,
            ];
        }

        return ['name' => $name, 'settings' => $settings];
    }

    private static function cleanName(string $name): string
    {
        return trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F]+/u', '', $name) ?? '') ?? '');
    }
}
