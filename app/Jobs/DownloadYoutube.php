<?php

namespace App\Jobs;

use App\Models\Song;
use App\Models\Track;
use App\Services\Separator;
use App\Services\Waveform;
use App\Services\YoutubeEngine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Throwable;

/**
 * Descarga el audio de un video de YouTube (cola "descargas", con su propio
 * worker) en FLAC como "original.flac" de la canción. Al terminar, la canción
 * sigue el flujo elegido en el modal: separar y/o detectar acordes.
 *
 * Como los otros jobs: lee la salida en vivo, escribe un latido para el
 * vigilante, se puede cancelar y detecta si se cuelga.
 */
class DownloadYoutube implements ShouldQueue
{
    use Queueable;

    public const QUEUE = 'descargas';

    public const LOCK = 'youtube-download';

    public bool $deleteWhenMissingModels = true;

    public int $tries = 0;

    public int $maxExceptions = 1;

    public bool $failOnTimeout = true;

    public int $timeout;

    public function __construct(public Song $song)
    {
        $this->onQueue(self::QUEUE);
        $this->timeout = config('audio.youtube.timeout') + 60;
    }

    public function middleware(): array
    {
        // Una descarga a la vez: YouTube limita a quien descarga mucho en paralelo.
        return [(new WithoutOverlapping(self::LOCK))->shared()->releaseAfter(5)->expireAfter(config('audio.youtube.timeout') + 120)];
    }

    public function handle(YoutubeEngine $engine): void
    {
        $song = $this->song->fresh();
        if (! $song || $song->download_status !== Song::STATUS_PENDING || ! preg_match(YoutubeEngine::VIDEO_ID, (string) $song->youtube_id)) {
            return; // borrada, cancelada o ya descargada
        }
        if ($problem = $engine->problem()) {
            $this->markFailed($song, $problem);

            return;
        }

        $disk = Storage::disk('audio');
        $dir = $song->directory(); // {usuario}/{canción}: solo ids
        $disk->makeDirectory($dir);
        $absDir = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $disk->path($dir));

        $started = Song::whereKey($song->id)->where('download_status', Song::STATUS_PENDING)->update([
            'download_status' => Song::STATUS_PROCESSING, 'download_progress' => 0, 'download_error' => null, 'download_heartbeat_at' => now(),
        ]);
        if ($started === 0) {
            return;
        }

        $timeout = (int) config('audio.youtube.timeout');
        $stallAfter = (int) config('audio.youtube.stall_timeout', 180);
        $process = $engine->process(['descargar', $song->youtube_id, $absDir], $timeout);

        $buffer = '';
        $stderr = '';
        $result = null;
        $error = null;
        $shown = 0;
        $lastWrite = 0.0;

        try {
            $process->start();
            Song::whereKey($song->id)->update(['download_pid' => $process->getPid()]);
            $lastActivity = microtime(true);
            $lastBeat = microtime(true);

            while (true) {
                $running = $process->isRunning();
                $stderr = substr($stderr.$process->getIncrementalErrorOutput(), -8000);
                $out = $process->getIncrementalOutput();
                $now = microtime(true);
                if ($out !== '') {
                    $lastActivity = $now;
                }
                $buffer .= $out;
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $event = json_decode(trim(substr($buffer, 0, $pos)), true);
                    $buffer = substr($buffer, $pos + 1);
                    if (! is_array($event)) {
                        continue;
                    }
                    match ($event['tipo'] ?? null) {
                        'progreso' => $shown = max($shown, min(99, (int) ($event['pct'] ?? 0))),
                        'fin' => $result = $event,
                        'error' => $error = (string) ($event['mensaje'] ?? 'Error desconocido.'),
                        default => null,
                    };
                }
                if ($shown && $now - $lastWrite >= 0.5) {
                    $lastWrite = $now;
                    Song::whereKey($song->id)->update(['download_progress' => $shown]);
                }
                if (! $running) {
                    break;
                }
                if ($now - $lastBeat >= 1) {
                    $lastBeat = $now;
                    $beat = Song::whereKey($song->id)->where('download_status', Song::STATUS_PROCESSING)->update(['download_heartbeat_at' => now()]);
                    if ($beat === 0) {
                        // Cancelada o borrada: se detiene el proceso real y se limpia lo descargado a medias.
                        $process->stop(2);
                        $this->cleanPartial($dir);
                        Song::withTrashed()->whereKey($song->id)->update(['download_pid' => null, 'download_heartbeat_at' => null]);

                        return;
                    }
                }
                if ($now - $lastActivity > $stallAfter) {
                    $process->stop(2);
                    $this->cleanPartial($dir);
                    $this->markFailed($song, "La descarga se colgó: no avanzó en {$stallAfter} s. Pulsa Reintentar.");

                    return;
                }
                $process->checkTimeout();
                usleep(200_000);
            }
        } catch (ProcessTimedOutException) {
            $this->cleanPartial($dir);
            $this->markFailed($song, 'La descarga superó el tiempo máximo. Puedes subir YOUTUBE_TIMEOUT en el .env.');

            return;
        }

        $path = $dir.'/original.flac';
        if (! $process->isSuccessful() || ! $result || ! $disk->exists($path)) {
            $this->cleanPartial($dir);
            $this->markFailed($song, $error ?? (trim($stderr) !== '' ? Str::limit(trim(last(explode("\n", trim($stderr)))), 300) : 'yt-dlp terminó sin descargar el audio.'));

            return;
        }

        // Audio listo: datos del archivo, pista "Original" y forma de onda.
        $abs = $disk->path($path);
        $song->update([
            'original_ext' => 'flac',
            'original_name' => Str::limit($song->title, 240, '').'.flac',
            'original_size' => $disk->size($path),
            'duration' => Separator::probeDuration($abs) ?? ($result['duracion'] ?? null),
            'channel' => Str::limit((string) ($result['canal'] ?? $song->channel), 200, '') ?: null,
            'thumbnail_url' => self::safeThumb($result['miniatura'] ?? null) ?? $song->thumbnail_url,
        ]);
        $track = $song->tracks()->firstOrCreate(['stem' => Track::ORIGINAL], ['file_name' => 'original.flac', 'size' => $disk->size($path), 'position' => 100]);
        $track->update(['file_name' => 'original.flac', 'size' => $disk->size($path), 'peaks' => Waveform::compute($abs)]);

        $done = Song::whereKey($song->id)->where('download_status', Song::STATUS_PROCESSING)->update([
            'download_status' => Song::STATUS_READY, 'download_progress' => 100, 'download_pid' => null, 'download_heartbeat_at' => null,
        ]);
        if ($done === 0) {
            return; // cancelada justo al terminar
        }

        // Sigue el flujo elegido al importarla.
        $song->refresh();
        if ($song->download_then_separate) {
            $song->update(['status' => Song::STATUS_PENDING, 'queued_at' => now()]);
            SeparateSong::dispatch($song);
        }
        if ($song->download_then_chords) {
            $song->queueChordAnalysis(); // si se va a separar, espera a la separación
        }
    }

    /** Solo se guardan miniaturas de YouTube (https, dominios de imágenes de YouTube). */
    public static function safeThumb(?string $url): ?string
    {
        if (! $url || strlen($url) > 500) {
            return null;
        }
        $host = parse_url($url, PHP_URL_HOST);

        return str_starts_with($url, 'https://') && is_string($host) && preg_match('/(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/', $host) ? $url : null;
    }

    /** Borra lo que yt-dlp dejó a medias en la carpeta de la canción (nunca otras carpetas). */
    private function cleanPartial(string $dir): void
    {
        $disk = Storage::disk('audio');
        foreach ($disk->files($dir) as $file) {
            if (str_starts_with(basename($file), 'original.')) {
                $disk->delete($file);
            }
        }
    }

    public function failed(?Throwable $e): void
    {
        $song = $this->song->fresh();
        if ($song && $song->isDownloading()) {
            $this->markFailed($song, 'Error inesperado: '.Str::limit($e?->getMessage() ?? 'desconocido', 400));
        }
    }

    private function markFailed(Song $song, string $error): void
    {
        Song::whereKey($song->id)->update([
            'download_status' => Song::STATUS_FAILED,
            'download_error' => Str::limit($error, 490),
            'download_pid' => null,
            'download_heartbeat_at' => null,
        ]);
    }
}
