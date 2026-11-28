<?php

namespace App\Services;

use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Song;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * Vigila los trabajos de separación y de acordes.
 *
 * Mientras un job trabaja, escribe un "latido" (heartbeat_at) cada 2 s. Si el
 * latido se detiene, el worker murió (por ejemplo, se cerró la ventana de
 * iniciar.bat) y la canción se quedaría "Procesando" para siempre, con el job
 * reservado y el bloqueo de la GPU tomado durante una hora. Este vigilante lo
 * detecta y lo arregla: termina el proceso si aún vive, marca el error, borra
 * los archivos a medias, libera el bloqueo y quita el job de la cola.
 *
 * Se ejecuta desde los workers (en cada vuelta, como mucho cada 10 s) y desde
 * las consultas de estado de la interfaz.
 */
class QueueWatchdog
{
    /** Segundos sin latido para dar un trabajo por muerto. */
    public const STALE_AFTER = 30;

    public const SEPARATION_LOCK = 'audio-separator';

    public const CHORDS_LOCK = 'chord-engine';

    /** Revisa todo, como mucho una vez cada $every segundos. */
    public static function checkThrottled(int $every = 10): void
    {
        if (Cache::add('queue-watchdog', true, $every)) {
            self::check();
        }
    }

    public static function check(): void
    {
        $limit = now()->subSeconds(self::STALE_AFTER);

        $deadSeparations = Song::where('status', Song::STATUS_PROCESSING)
            ->where(fn ($q) => $q->where('heartbeat_at', '<', $limit)
                ->orWhere(fn ($q) => $q->whereNull('heartbeat_at')->where('started_at', '<', $limit)))
            ->get();
        foreach ($deadSeparations as $song) {
            Log::warning("Vigilante: la separación de la canción {$song->id} dejó de responder; se marca como error.");
            self::abortSeparation($song, Song::STATUS_FAILED,
                'La separación se interrumpió: el proceso dejó de responder (¿se cerró la ventana «1 SEPARACION» de iniciar.bat?). Pulsa Reintentar.');
        }

        $deadChords = Song::where('chords_status', Song::STATUS_PROCESSING)
            ->where(fn ($q) => $q->where('chords_heartbeat_at', '<', $limit)
                ->orWhere(fn ($q) => $q->whereNull('chords_heartbeat_at')->where('chords_started_at', '<', $limit)))
            ->get();
        foreach ($deadChords as $song) {
            Log::warning("Vigilante: el análisis de acordes de la canción {$song->id} dejó de responder; se marca como error.");
            self::abortChords($song, 'El análisis se interrumpió: el proceso dejó de responder (¿se cerró la ventana «2 ACORDES»?). Pulsa «Volver a analizar».');
        }
    }

    /**
     * Detiene de verdad una separación (si el proceso sigue vivo) y deja todo
     * limpio: estado final, archivos a medias, bloqueo y job de la cola.
     */
    public static function abortSeparation(Song $song, string $status, string $error): void
    {
        if ($song->process_pid) {
            self::killTree($song->process_pid, self::pathNeedle($song));
        }

        self::deleteDirectory($song->directory().'/work');

        Song::whereKey($song->id)->update([
            'status' => $status,
            'error' => $error,
            'finished_at' => now(),
            'process_pid' => null,
            'heartbeat_at' => null,
        ]);
        Cache::forget(SeparateSong::progressKey($song->id));
        self::forgetJobs(SeparateSong::class, $song->id);
        self::releaseLock(self::SEPARATION_LOCK);

        // Acordes que esperaban por esta separación.
        $song->releaseWaitingChords($status === Song::STATUS_CANCELED);
    }

    public static function abortChords(Song $song, string $error, string $status = Song::STATUS_FAILED): void
    {
        if ($song->chords_pid) {
            self::killTree($song->chords_pid, self::pathNeedle($song));
        }
        if ($status === Song::STATUS_CANCELED) {
            // Los acordes a medias de un análisis cancelado se descartan (los editados a mano no).
            $song->chords()->where('edited', false)->delete();
        }
        Song::whereKey($song->id)->update([
            'chords_status' => $status,
            'chords_error' => $error,
            'chords_finished_at' => now(),
            'chords_pid' => null,
            'chords_heartbeat_at' => null,
        ]);
        self::forgetJobs(AnalyzeChords::class, $song->id);
        self::releaseLock(self::CHORDS_LOCK);
    }

    /**
     * Borra una carpeta del disco "audio" reintentando unos segundos: en
     * Windows, un proceso recién terminado tarda un momento en soltar sus
     * archivos y el primer intento puede fallar sin avisar.
     */
    public static function deleteDirectory(string $path, float $seconds = 5): bool
    {
        $disk = Storage::disk('audio');
        $deadline = microtime(true) + $seconds;
        do {
            $disk->deleteDirectory($path);
            if (! $disk->exists($path)) {
                return true;
            }
            usleep(250_000);
        } while (microtime(true) < $deadline);

        Log::warning("No se pudo borrar la carpeta {$path} (algún archivo sigue en uso).");

        return false;
    }

    /** Texto que debe aparecer en la línea de comandos del proceso: la carpeta de la canción. */
    public static function pathNeedle(Song $song): string
    {
        return str_replace('/', DIRECTORY_SEPARATOR, $song->directory()).DIRECTORY_SEPARATOR;
    }

    /**
     * Termina un proceso y todos sus hijos, SOLO si su línea de comandos
     * contiene $needle (la carpeta de la canción). Así nunca se mata otro
     * programa que haya reutilizado ese PID.
     */
    public static function killTree(int $pid, string $needle): bool
    {
        if ($pid <= 0) {
            return false;
        }

        try {
            if (DIRECTORY_SEPARATOR === '\\') {
                $query = new Process(['powershell', '-NoProfile', '-NonInteractive', '-Command',
                    "(Get-CimInstance Win32_Process -Filter 'ProcessId={$pid}').CommandLine"]);
                $query->setTimeout(20)->run();
                $commandLine = $query->getOutput();
            } else {
                $commandLine = @file_get_contents("/proc/{$pid}/cmdline") ?: '';
                $commandLine = str_replace("\0", ' ', $commandLine);
            }

            if ($commandLine === '' || ! str_contains($commandLine, $needle)) {
                return false; // ya no existe, o es otro programa
            }

            $kill = DIRECTORY_SEPARATOR === '\\'
                ? new Process(['taskkill', '/F', '/T', '/PID', (string) $pid])
                : new Process(['kill', '-9', (string) $pid]);
            $kill->setTimeout(20)->run();

            return $kill->isSuccessful();
        } catch (Throwable $e) {
            Log::warning("No se pudo terminar el proceso {$pid}: {$e->getMessage()}");

            return false;
        }
    }

    /** Libera el bloqueo de WithoutOverlapping que dejó un trabajo muerto. */
    public static function releaseLock(string $key): void
    {
        Cache::lock('laravel-queue-overlap:'.$key)->forceRelease();
    }

    /** Quita de la cola los trabajos de esa clase para esa canción. */
    public static function forgetJobs(string $jobClass, int $songId): void
    {
        if (config('queue.default') !== 'database') {
            return;
        }

        $table = config('queue.connections.database.table', 'jobs');
        foreach (DB::table($table)->get(['id', 'payload']) as $row) {
            $payload = json_decode($row->payload, true);
            if (($payload['displayName'] ?? null) !== $jobClass) {
                continue;
            }
            // El modelo va serializado como ModelIdentifier: ...App\Models\Song";s:2:"id";i:12;
            $command = (string) ($payload['data']['command'] ?? '');
            if (preg_match('/App\\\\Models\\\\Song";s:2:"id";i:(\d+);/', $command, $m) && (int) $m[1] === $songId) {
                DB::table($table)->where('id', $row->id)->delete();
            }
        }
    }
}
