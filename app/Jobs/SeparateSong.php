<?php

namespace App\Jobs;

use App\Models\Song;
use App\Models\Track;
use App\Services\QueueWatchdog;
use App\Services\Separator;
use App\Services\Waveform;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Throwable;

/**
 * Separa una canción en pistas con audio-separator (GPU).
 *
 * - Cola "separation" con un solo worker (iniciar.bat) => una separación a la vez.
 * - WithoutOverlapping es una segunda barrera por si se abren dos workers.
 * - La salida del proceso se guarda en songs.log y el progreso (%) en caché
 *   para que la interfaz lo muestre en vivo.
 */
class SeparateSong implements ShouldQueue
{
    use Queueable;

    public const QUEUE = 'separation';

    /** Si la canción se borra antes de procesarse, el trabajo se descarta. */
    public bool $deleteWhenMissingModels = true;

    /** Reintentos ilimitados solo para esperar el turno (WithoutOverlapping)... */
    public int $tries = 0;

    /** ...pero un error real no se reintenta: se marca como fallida. */
    public int $maxExceptions = 1;

    public bool $failOnTimeout = true;

    public int $timeout;

    public function __construct(public Song $song)
    {
        $this->onQueue(self::QUEUE);
        // Un poco más que el límite del proceso, para poder registrar el error con calma.
        $this->timeout = config('audio.separator.timeout') + 120;
    }

    public function middleware(): array
    {
        return [
            (new WithoutOverlapping('audio-separator'))
                ->shared()
                ->releaseAfter(15)
                ->expireAfter(config('audio.separator.timeout') + 300),
        ];
    }

    public static function progressKey(int $songId): string
    {
        return "song-progress:{$songId}";
    }

    public function handle(Separator $separator): void
    {
        $song = $this->song->fresh();
        if (! $song || $song->status !== Song::STATUS_PENDING) {
            return; // borrada o ya procesada
        }

        $disk = Storage::disk('audio');
        $model = $song->model ?: config('audio.separator.model');

        if ($problem = $separator->problemWith($model)) {
            $this->markFailed($song, $problem);

            return;
        }

        $input = $disk->path($song->originalPath());
        if (! is_file($input)) {
            $this->markFailed($song, 'No se encuentra el archivo original de la canción.');

            return;
        }

        $work = $song->directory().'/work';
        QueueWatchdog::deleteDirectory($work);
        $disk->makeDirectory($work);

        // Solo si sigue "en cola": si el usuario la canceló en este instante, no se empieza.
        $started = Song::whereKey($song->id)->where('status', Song::STATUS_PENDING)->update([
            'status' => Song::STATUS_PROCESSING,
            'model' => $model,
            'started_at' => now(),
            'finished_at' => null,
            'error' => null,
            'log' => null,
            'heartbeat_at' => now(),
        ]);
        if ($started === 0) {
            QueueWatchdog::deleteDirectory($work);

            return;
        }
        $song->refresh();
        Cache::put(self::progressKey($song->id), 0, now()->addHours(2));

        $timeout = (int) config('audio.separator.timeout');
        $stallAfter = (int) config('audio.separator.stall_timeout', 180);
        $process = $separator->process($input, $disk->path($work), $model, $timeout);

        $log = '';
        $shown = 0; // demucs hace varias pasadas con su propia barra: el % mostrado solo avanza
        $lastProgressCheck = 0.0;
        $lastActivity = microtime(true);
        $lastBeat = 0.0;
        $lastStatusCheck = 0.0;

        // En vez de esperar a ciegas (run), se vigila el proceso: latido para el
        // vigilante, cancelación del usuario y proceso colgado (sin salida nueva).
        try {
            $process->start();
            Song::whereKey($song->id)->update(['process_pid' => $process->getPid()]);

            while ($process->isRunning()) {
                $out = $process->getIncrementalOutput().$process->getIncrementalErrorOutput();
                $now = microtime(true);
                if ($out !== '') {
                    $log .= $out;
                    $lastActivity = $now;
                    if (strlen($log) > 500_000) {
                        $log = substr($log, -400_000);
                    }
                }
                if ($now - $lastProgressCheck > 1.5) {
                    $lastProgressCheck = $now;
                    $percent = Separator::progressFromOutput(substr($log, -4000));
                    if ($percent !== null && $percent > $shown) {
                        $shown = $percent;
                        Cache::put(self::progressKey($song->id), $shown, now()->addHours(2));
                    }
                }
                if ($now - $lastBeat >= 2) {
                    $lastBeat = $now;
                    Song::whereKey($song->id)->update(['heartbeat_at' => now()]);
                }
                if ($now - $lastStatusCheck >= 1) {
                    $lastStatusCheck = $now;
                    $status = Song::whereKey($song->id)->value('status');
                    if ($status !== Song::STATUS_PROCESSING) {
                        // Cancelada (o borrada): se detiene el proceso real y se limpia.
                        $process->stop(3);
                        QueueWatchdog::deleteDirectory($work);
                        Song::whereKey($song->id)->update(['process_pid' => null, 'heartbeat_at' => null]);
                        Cache::forget(self::progressKey($song->id));

                        return;
                    }
                }
                if ($now - $lastActivity > $stallAfter) {
                    $process->stop(3);
                    QueueWatchdog::deleteDirectory($work);
                    $this->markFailed($song, "La separación se colgó: no avanzó en {$stallAfter} s (se quedó en {$shown} %). Se detuvo el proceso. Pulsa Reintentar.", $log);

                    return;
                }
                $process->checkTimeout();
                usleep(250_000);
            }
            $log .= $process->getIncrementalOutput().$process->getIncrementalErrorOutput();
        } catch (ProcessTimedOutException) {
            QueueWatchdog::deleteDirectory($work);
            $this->markFailed($song, 'La separación superó el tiempo máximo ('.round($timeout / 60).' min). Puedes subir SEPARATOR_TIMEOUT en el .env.', $log);

            return;
        }
        Song::whereKey($song->id)->update(['process_pid' => null]);

        // Cancelada justo cuando el proceso terminaba.
        if (Song::whereKey($song->id)->value('status') !== Song::STATUS_PROCESSING) {
            QueueWatchdog::deleteDirectory($work);
            Song::whereKey($song->id)->update(['heartbeat_at' => null]);
            Cache::forget(self::progressKey($song->id));

            return;
        }

        if (! $process->isSuccessful()) {
            QueueWatchdog::deleteDirectory($work);
            $this->markFailed($song, self::errorSummary($log, $process->getExitCode()), $log);

            return;
        }

        // Reconocer las pistas generadas: vocals.flac, drums.flac...
        $found = [];
        foreach ($disk->files($work) as $file) {
            $stem = Separator::stemFromFileName(basename($file));
            if ($stem && ! isset($found[$stem])) {
                $found[$stem] = $file;
            }
        }

        if ($found === []) {
            QueueWatchdog::deleteDirectory($work);
            $this->markFailed($song, 'audio-separator terminó, pero no generó ninguna pista reconocible.', $log);

            return;
        }

        $order = array_keys(config('audio.stems'));
        uksort($found, fn ($a, $b) => array_search($a, $order) <=> array_search($b, $order));

        DB::transaction(function () use ($song, $disk, $found, $order) {
            // Se reemplazan las pistas separadas; la pista "Original" se conserva.
            $song->tracks()->where('stem', '!=', Track::ORIGINAL)->delete();
            $disk->deleteDirectory($song->stemsDirectory());
            $disk->makeDirectory($song->stemsDirectory());

            foreach ($found as $stem => $file) {
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                $fileName = $stem.'.'.$ext; // nombre fijo generado por el servidor
                $disk->move($file, $song->stemsDirectory().'/'.$fileName);

                $song->tracks()->create([
                    'stem' => $stem,
                    'file_name' => $fileName,
                    'size' => $disk->size($song->stemsDirectory().'/'.$fileName),
                    'position' => (int) array_search($stem, $order),
                ]);
            }
        });

        QueueWatchdog::deleteDirectory($work);

        // Forma de onda de cada pista, para que el mezclador no la calcule cada vez.
        // Si falla no pasa nada: el mezclador la calcula como antes.
        foreach ($song->tracks()->get() as $track) {
            if ($track->isOriginal() && $track->peaks) {
                continue; // la del original se calculó al subir
            }
            Song::whereKey($song->id)->update(['heartbeat_at' => now()]);
            $track->update(['peaks' => Waveform::compute($disk->path($track->path()))]);
        }

        // Solo si nadie la canceló mientras se guardaban las pistas.
        $finished = Song::whereKey($song->id)->where('status', Song::STATUS_PROCESSING)->update([
            'status' => Song::STATUS_READY,
            'duration' => Separator::probeDuration($input),
            'finished_at' => now(),
            'log' => self::cleanLog($log),
            'heartbeat_at' => null,
        ]);
        Cache::forget(self::progressKey($song->id));
        if ($finished === 0) {
            return;
        }
        $song->refresh();

        // Acordes: solo si se pidieron (esperaban a que terminara la separación).
        // Van a su propia cola ("acordes"), que avanza en paralelo.
        $song->releaseWaitingChords();
    }

    /** Se llama si el trabajo lanza una excepción no controlada o supera el tiempo. */
    public function failed(?Throwable $e): void
    {
        $song = $this->song->fresh();
        if ($song && ! $song->isFinished()) {
            $this->markFailed($song, 'Error inesperado: '.Str::limit($e?->getMessage() ?? 'desconocido', 400));
        }
    }

    private function markFailed(Song $song, string $error, string $log = ''): void
    {
        // Consulta directa: process_pid y heartbeat_at se escriben fuera del modelo.
        Song::whereKey($song->id)->update([
            'status' => Song::STATUS_FAILED,
            'error' => Str::limit($error, 490),
            'log' => $log !== '' ? self::cleanLog($log) : $error,
            'finished_at' => now(),
            'process_pid' => null,
            'heartbeat_at' => null,
        ]);
        $song->refresh();
        Cache::forget(self::progressKey($song->id));

        // Si los acordes esperaban por esta separación, se analizan con el original.
        $song->releaseWaitingChords();
    }

    /** Quita colores de consola, repintados de las barras de progreso (\r) y bytes inválidos. */
    public static function cleanLog(string $log): string
    {
        $log = preg_replace('/\x1B\[[0-9;]*[A-Za-z]/', '', $log) ?? $log;
        $log = str_replace("\r\n", "\n", $log);
        $log = preg_replace('/[^\n]*\r(?!\n)/', '', $log) ?? $log;
        $log = mb_convert_encoding($log, 'UTF-8', 'UTF-8');

        return trim($log);
    }

    /** Línea más útil del log para mostrar como resumen del error. */
    public static function errorSummary(string $log, ?int $exitCode): string
    {
        $lines = array_values(array_filter(array_map('trim', explode("\n", self::cleanLog($log)))));

        for ($i = count($lines) - 1; $i >= 0; $i--) {
            if (preg_match('/(error|exception|not found|no such file|out of memory)/i', $lines[$i])) {
                return $lines[$i];
            }
        }

        return $lines !== [] ? end($lines) : "audio-separator terminó con el código {$exitCode}.";
    }
}
