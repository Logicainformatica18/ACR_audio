<?php

namespace App\Jobs;

use App\Models\Chord;
use App\Models\Song;
use App\Services\ChordEngine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Str;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * Reconoce los acordes de una canción ya separada (cola "acordes").
 *
 * - Va en su propia cola y con su propio worker (iniciar.bat), así avanza en
 *   paralelo a la separación de otras canciones.
 * - Lee la salida del motor EN VIVO (callback de Symfony Process) y guarda
 *   cada acorde en la base de datos apenas llega: el mezclador los muestra
 *   mientras el análisis sigue.
 * - Al volver a analizar se borran los acordes automáticos, pero NO los
 *   corregidos a mano: los nuevos se recortan para no pisarlos.
 */
class AnalyzeChords implements ShouldQueue
{
    use Queueable;

    public const QUEUE = 'acordes';

    public bool $deleteWhenMissingModels = true;

    /** Reintentos ilimitados solo para esperar el turno (WithoutOverlapping)... */
    public int $tries = 0;

    /** ...pero un error real no se reintenta. */
    public int $maxExceptions = 1;

    public bool $failOnTimeout = true;

    public int $timeout;

    public function __construct(public Song $song)
    {
        $this->onQueue(self::QUEUE);
        $this->timeout = config('audio.chords.timeout') + 60;
    }

    public function middleware(): array
    {
        return [
            (new WithoutOverlapping('chord-engine'))
                ->shared()
                ->releaseAfter(5)
                ->expireAfter(config('audio.chords.timeout') + 120),
        ];
    }

    public function handle(ChordEngine $engine): void
    {
        $song = $this->song->fresh();
        if (! $song || $song->status !== Song::STATUS_READY || $song->chords_status !== Song::STATUS_PENDING) {
            return; // borrada, sin pistas o ya analizada
        }

        if ($problem = $engine->problem()) {
            $this->markFailed($song, $problem);

            return;
        }

        $files = $engine->inputFiles($song);
        if ($files === []) {
            $this->markFailed($song, 'No se encuentran las pistas de la canción.');

            return;
        }

        // Volver a analizar: fuera los acordes automáticos; los editados se quedan.
        $song->chords()->where('edited', false)->delete();
        $edited = $song->chords()->where('edited', true)->get()
            ->map(fn (Chord $c) => [$c->start_seconds, $c->end_seconds])->all();

        // Si hay una separación en marcha, los acordes van por el PROCESADOR para
        // no quitarle GPU (en CPU tardan ~5 s en vez de ~3 s para 5 minutos).
        $useCpu = Song::where('status', Song::STATUS_PROCESSING)->exists();

        $song->update([
            'chords_status' => Song::STATUS_PROCESSING,
            'chords_progress' => 0,
            'chords_model' => $engine->model().($useCpu ? ' (CPU)' : ' (GPU)'),
            'chords_key' => null,
            'chords_error' => null,
            'chords_started_at' => now(),
            'chords_finished_at' => null,
            'chords_heartbeat_at' => now(),
        ]);

        $timeout = (int) config('audio.chords.timeout');
        $stallAfter = (int) config('audio.chords.stall_timeout', 120);
        $process = $engine->process($files, $timeout, $useCpu);

        $state = [
            'buffer' => '',      // trozo de línea aún incompleto
            'stderr' => '',
            'progress' => 0,
            'progressAt' => 0.0,
            'key' => null,
            'error' => null,
            'finished' => false,
            'gone' => false,     // la canción se borró durante el análisis
        ];

        // Se vigila el proceso: cada línea se guarda al llegar, hay latido para el
        // vigilante y se detiene si se cuelga (sin salida nueva).
        try {
            $process->start();
            Song::whereKey($song->id)->update(['chords_pid' => $process->getPid()]);
            $lastActivity = microtime(true);
            $lastBeat = microtime(true);

            while (true) {
                $running = $process->isRunning();
                $state['stderr'] = substr($state['stderr'].$process->getIncrementalErrorOutput(), -8000);
                $out = $process->getIncrementalOutput();
                $now = microtime(true);
                if ($out !== '') {
                    $lastActivity = $now;
                    $state['buffer'] .= $out;
                    while (($pos = strpos($state['buffer'], "\n")) !== false) {
                        $line = trim(substr($state['buffer'], 0, $pos));
                        $state['buffer'] = substr($state['buffer'], $pos + 1);
                        if ($line !== '' && ! $this->handleLine($line, $song, $edited, $state)) {
                            $state['gone'] = true;
                            $process->stop(2);
                            break 2;
                        }
                    }
                }
                if (! $running) {
                    break;
                }
                if ($now - $lastBeat >= 2) {
                    $lastBeat = $now;
                    if (Song::whereKey($song->id)->update(['chords_heartbeat_at' => now()]) === 0) {
                        $state['gone'] = true; // la canción se borró
                        $process->stop(2);
                        break;
                    }
                }
                if ($now - $lastActivity > $stallAfter) {
                    $process->stop(2);
                    $this->markFailed($song, "El análisis de acordes se colgó: no avanzó en {$stallAfter} s. Pulsa «Volver a analizar».");

                    return;
                }
                $process->checkTimeout();
                usleep(150_000);
            }
        } catch (ProcessTimedOutException) {
            $this->markFailed($song, 'El análisis de acordes superó el tiempo máximo ('.round($timeout / 60).' min). Puedes subir CHORDS_TIMEOUT en el .env.');

            return;
        }
        Song::whereKey($song->id)->update(['chords_pid' => null, 'chords_heartbeat_at' => null]);

        if ($state['gone']) {
            return;
        }
        if (trim($state['buffer']) !== '') {
            $this->handleLine(trim($state['buffer']), $song, $edited, $state);
        }

        if (! $process->isSuccessful() || ! $state['finished']) {
            $message = $state['error']
                ?? self::lastLine($state['stderr'])
                ?? 'El motor de acordes terminó con el código '.$process->getExitCode().'.';
            $this->markFailed($song, $message);

            return;
        }

        $song->update([
            'chords_status' => Song::STATUS_READY,
            'chords_progress' => 100,
            'chords_finished_at' => now(),
        ]);
    }

    /**
     * Procesa un evento del motor. Devuelve false si la canción ya no existe.
     *
     * @param  array<int, array{0: float, 1: float}>  $edited
     */
    private function handleLine(string $line, Song $song, array $edited, array &$state): bool
    {
        $event = json_decode($line, true);
        if (! is_array($event) || ! isset($event['tipo'])) {
            return true; // línea que no es un evento: se ignora
        }

        try {
            switch ($event['tipo']) {
                case 'acorde':
                    $start = (float) ($event['inicio'] ?? 0);
                    $end = (float) ($event['fin'] ?? 0);
                    $name = (string) ($event['acorde'] ?? '');
                    if ($end <= $start || $name === '' || strlen($name) > 16) {
                        break;
                    }
                    $confidence = isset($event['confianza']) ? max(0, min(1, (float) $event['confianza'])) : null;
                    foreach (Chord::freeRanges($start, $end, $edited) as [$a, $b]) {
                        $song->chords()->create([
                            'start_seconds' => round($a, 3),
                            'end_seconds' => round($b, 3),
                            'chord' => $name,
                            'confidence' => $confidence !== null ? round($confidence, 3) : null,
                            'edited' => false,
                        ]);
                    }
                    break;

                case 'progreso':
                    $pct = max(0, min(100, (int) ($event['pct'] ?? 0)));
                    // A la BD como mucho 2 veces por segundo (la interfaz consulta cada 2 s).
                    if ($pct > $state['progress'] && ($pct === 100 || microtime(true) - $state['progressAt'] >= 0.5)) {
                        $state['progress'] = $pct;
                        $state['progressAt'] = microtime(true);
                        if (Song::whereKey($song->id)->update(['chords_progress' => min($pct, 99)]) === 0) {
                            return false;
                        }
                    }
                    break;

                case 'tonalidad':
                    $value = Str::limit((string) ($event['valor'] ?? ''), 30, '');
                    if ($value !== '' && $value !== $state['key']) {
                        $state['key'] = $value;
                        if (Song::whereKey($song->id)->update(['chords_key' => $value]) === 0) {
                            return false;
                        }
                    }
                    break;

                case 'error':
                    $state['error'] = Str::limit((string) ($event['mensaje'] ?? 'Error desconocido'), 480);
                    break;

                case 'fin':
                    $state['finished'] = true;
                    break;
            }
        } catch (QueryException $e) {
            // La canción se borró mientras se analizaba (falla la clave foránea).
            if (! Song::whereKey($song->id)->exists()) {
                return false;
            }
            throw $e;
        }

        return true;
    }

    public function failed(?Throwable $e): void
    {
        $song = $this->song->fresh();
        if ($song && $song->chordsBusy()) {
            $this->markFailed($song, 'Error inesperado: '.Str::limit($e?->getMessage() ?? 'desconocido', 400));
        }
    }

    private function markFailed(Song $song, string $error): void
    {
        Song::whereKey($song->id)->update([
            'chords_status' => Song::STATUS_FAILED,
            'chords_error' => Str::limit($error, 490),
            'chords_finished_at' => now(),
            'chords_pid' => null,
            'chords_heartbeat_at' => null,
        ]);
    }

    private static function lastLine(string $text): ?string
    {
        $lines = array_values(array_filter(array_map('trim', explode("\n", $text))));

        return $lines !== [] ? Str::limit(end($lines), 480) : null;
    }
}
