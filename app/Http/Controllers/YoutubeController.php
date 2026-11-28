<?php

namespace App\Http\Controllers;

use App\Http\Resources\SongResource;
use App\Jobs\DownloadYoutube;
use App\Models\Folder;
use App\Models\Song;
use App\Services\QueueWatchdog;
use App\Services\YoutubeEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Canciones desde YouTube: leer un enlace (video o lista, sin descargar),
 * importar los videos elegidos (cola "descargas"), cancelar, reintentar y
 * actualizar yt-dlp.
 */
class YoutubeController extends Controller
{
    /**
     * Lee un enlace SIN descargar nada: datos del video y/o de la lista
     * (título, duración y miniatura de cada video), marcando los que ya tienes.
     */
    public function inspect(Request $request, YoutubeEngine $engine): JsonResponse
    {
        $data = $request->validate(['url' => ['required', 'string', 'max:2000']], ['url.required' => 'Pega un enlace de YouTube.']);
        $ids = YoutubeEngine::parseUrl($data['url']);
        if (! $ids) {
            return response()->json(['message' => 'Ese enlace no es de YouTube (o no tiene un video ni una lista).', 'code' => 'enlace'], 422);
        }

        $out = ['video' => null, 'playlist' => null];
        if ($ids['video']) {
            $info = $engine->run(['info', 'video', $ids['video']], 90);
            if (($info['tipo'] ?? '') === 'error') {
                return $this->engineError($info);
            }
            $out['video'] = self::entry($info);
        }
        if ($ids['list']) {
            $info = $engine->run(['info', 'lista', $ids['list']], 180);
            if (($info['tipo'] ?? '') === 'error') {
                if (! $out['video']) {
                    return $this->engineError($info);
                }
            } else {
                $out['playlist'] = [
                    'id' => $ids['list'],
                    'title' => Str::limit((string) ($info['titulo'] ?? 'Lista de YouTube'), 100, ''),
                    'channel' => $info['canal'] ?? null,
                    'entries' => collect($info['entradas'] ?? [])->map(fn ($e) => self::entry($e))->filter()->values()->all(),
                ];
            }
        }

        // ¿Cuáles ya tienes? (mismo video de YouTube)
        $all = array_merge($out['video'] ? [$out['video']['id']] : [], array_column($out['playlist']['entries'] ?? [], 'id'));
        $existing = Song::ownedBy($request->user())->whereIn('youtube_id', $all)->pluck('title', 'youtube_id');
        $mark = fn (?array $e) => $e ? [...$e, 'existing' => $existing[$e['id']] ?? null] : null;
        $out['video'] = $mark($out['video']);
        if ($out['playlist']) {
            $out['playlist']['entries'] = array_map($mark, $out['playlist']['entries']);
        }

        return response()->json($out);
    }

    /**
     * Crea una canción por video elegido y los pone en la cola "descargas".
     * Al terminar cada descarga sigue el flujo elegido (separar / acordes).
     */
    public function import(Request $request): JsonResponse
    {
        $user = $request->user();
        $max = (int) config('audio.youtube.max_batch', 200);
        $data = $request->validate([
            'videos' => ['required', 'array', 'min:1', "max:{$max}"],
            'videos.*.id' => ['required', 'string', 'regex:'.YoutubeEngine::VIDEO_ID],
            'videos.*.title' => ['nullable', 'string', 'max:300'],
            'videos.*.channel' => ['nullable', 'string', 'max:300'],
            'videos.*.duration' => ['nullable', 'numeric', 'min:0'],
            'videos.*.thumbnail' => ['nullable', 'string', 'max:500'],
            'mode' => ['required', 'in:separate,upload'],
            'chords' => ['required', 'boolean'],
            'folder_id' => ['nullable', 'integer'],
            'allow_duplicates' => ['nullable', 'boolean'],
        ], [
            'videos.*.id.regex' => 'Hay un video con un identificador no válido.',
        ]);
        if (isset($data['folder_id']) && ! Folder::ownedBy($user)->whereKey($data['folder_id'])->exists()) {
            return response()->json(['message' => 'Esa carpeta no existe.'], 422);
        }

        $have = Song::ownedBy($user)->whereIn('youtube_id', array_column($data['videos'], 'id'))->pluck('youtube_id')->all();
        $created = [];
        $skipped = 0;
        DB::transaction(function () use ($user, $data, $have, &$created, &$skipped) {
            foreach (collect($data['videos'])->unique('id') as $v) {
                if (in_array($v['id'], $have, true) && empty($data['allow_duplicates'])) {
                    $skipped++;

                    continue;
                }
                $title = SongController::titleFromFileName((string) ($v['title'] ?? '').'.x');
                $created[] = $user->songs()->create([
                    'folder_id' => $data['folder_id'] ?? null,
                    'title' => $title === 'Canción sin título' ? 'Video de YouTube '.$v['id'] : $title,
                    'original_name' => Str::limit($title, 240, '').'.flac',
                    'original_ext' => 'flac',
                    'original_size' => 0,
                    'duration' => isset($v['duration']) ? (float) $v['duration'] : null,
                    'status' => Song::STATUS_NONE,
                    'model' => $user->preferences()->effectiveModel(),
                    'youtube_id' => $v['id'],
                    'source_url' => YoutubeEngine::watchUrl($v['id']),
                    'channel' => isset($v['channel']) ? Str::limit($v['channel'], 200, '') : null,
                    'thumbnail_url' => DownloadYoutube::safeThumb($v['thumbnail'] ?? null),
                    'download_status' => Song::STATUS_PENDING,
                    'download_then_separate' => $data['mode'] === 'separate',
                    'download_then_chords' => (bool) $data['chords'],
                ]);
            }
        });
        foreach ($created as $song) {
            DownloadYoutube::dispatch($song);
        }

        $n = count($created);

        return response()->json([
            'created' => $n,
            'skipped' => $skipped,
            'songs' => SongResource::collection(collect($created))->resolve(),
            'message' => ($n === 1 ? '1 canción en la cola de descargas.' : "{$n} canciones en la cola de descargas.")
                .($skipped ? " Se omitieron {$skipped} que ya tenías." : ''),
        ], 201);
    }

    /** Cancela una descarga en cola o en marcha (detiene el proceso real). */
    public function cancel(Song $song): JsonResponse
    {
        $this->authorize('update', $song);
        if (! $song->isDownloading()) {
            return response()->json(['message' => 'Esa canción no se está descargando.'], 422);
        }
        $wasProcessing = $song->download_status === Song::STATUS_PROCESSING;
        Song::whereKey($song->id)->whereIn('download_status', [Song::STATUS_PENDING, Song::STATUS_PROCESSING])
            ->update(['download_status' => Song::STATUS_CANCELED, 'download_error' => 'Descarga cancelada por ti.']);

        if (! $wasProcessing) {
            QueueWatchdog::forgetJobs(DownloadYoutube::class, $song->id);
        } else {
            $deadline = microtime(true) + 6;
            while (microtime(true) < $deadline && Song::whereKey($song->id)->whereNotNull('download_pid')->exists()) {
                usleep(200_000);
            }
            if (($fresh = $song->fresh()) && $fresh->download_pid) {
                QueueWatchdog::abortDownload($fresh, 'Descarga cancelada por ti.', Song::STATUS_CANCELED);
            }
        }

        return response()->json(['song' => SongResource::make($song->fresh())->resolve()]);
    }

    /** Vuelve a intentar una descarga que falló o se canceló. */
    public function retry(Song $song): JsonResponse
    {
        $this->authorize('update', $song);
        if (! in_array($song->download_status, [Song::STATUS_FAILED, Song::STATUS_CANCELED], true)) {
            return response()->json(['message' => 'Solo se pueden reintentar descargas con error o canceladas.'], 422);
        }
        QueueWatchdog::forgetJobs(DownloadYoutube::class, $song->id);
        $song->update(['download_status' => Song::STATUS_PENDING, 'download_progress' => 0, 'download_error' => null]);
        DownloadYoutube::dispatch($song);

        return response()->json(['song' => SongResource::make($song->fresh())->resolve()]);
    }

    /** Versión de yt-dlp y Deno (para Configuración). */
    public function version(YoutubeEngine $engine): JsonResponse
    {
        $v = $engine->run(['version'], 60);

        return response()->json([
            'ok' => ($v['tipo'] ?? '') === 'version',
            'yt_dlp' => $v['yt_dlp'] ?? null,
            'deno' => $v['deno'] ?? null,
            'message' => ($v['tipo'] ?? '') === 'error' ? ($v['mensaje'] ?? null) : null,
        ]);
    }

    /** Botón "Actualizar yt-dlp" de Configuración: ejecuta php artisan youtube:actualizar. */
    public function update(): JsonResponse
    {
        $code = Artisan::call('youtube:actualizar');
        $output = trim(Artisan::output());

        return response()->json(['ok' => $code === 0, 'output' => Str::limit($output, 3000)], $code === 0 ? 200 : 500);
    }

    /** Normaliza un video tal como lo devuelve el script. */
    private static function entry(array $e): ?array
    {
        $id = (string) ($e['id'] ?? '');
        if (! preg_match(YoutubeEngine::VIDEO_ID, $id)) {
            return null;
        }

        return [
            'id' => $id,
            'title' => Str::limit((string) ($e['titulo'] ?? '(sin título)'), 200, ''),
            'channel' => isset($e['canal']) ? Str::limit((string) $e['canal'], 200, '') : null,
            'duration' => isset($e['duracion']) && is_numeric($e['duracion']) ? (float) $e['duracion'] : null,
            'thumbnail' => DownloadYoutube::safeThumb($e['miniatura'] ?? null),
            'available' => (bool) ($e['disponible'] ?? true),
            'url' => YoutubeEngine::watchUrl($id),
        ];
    }

    private function engineError(array $info): JsonResponse
    {
        $code = (string) ($info['codigo'] ?? 'otro');

        return response()->json([
            'message' => (string) ($info['mensaje'] ?? 'No se pudo leer el enlace.'),
            'code' => $code,
        ], $code === 'motor' ? 503 : 422);
    }
}
