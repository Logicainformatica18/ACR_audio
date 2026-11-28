<?php

namespace App\Http\Controllers;

use App\Jobs\AnalyzeChords;
use App\Models\Chord;
use App\Models\Song;
use App\Services\QueueWatchdog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Acordes de una canción: consultar el avance del análisis, corregir un
 * acorde a mano y volver a analizar.
 */
class ChordController extends Controller
{
    /** Estado del análisis y todos los acordes guardados (el mezclador lo consulta cada 2 s). */
    public function index(Song $song): JsonResponse
    {
        $this->authorize('view', $song);
        QueueWatchdog::checkThrottled(5);

        return response()->json(self::payload($song->fresh()));
    }

    /** Corrige un acorde: queda marcado como editado y se conserva al volver a analizar. */
    public function update(Request $request, Song $song, Chord $chord): JsonResponse
    {
        $this->authorize('update', $song);
        abort_unless($chord->song_id === $song->id, 404);

        $data = $request->validate([
            'chord' => ['required', 'string', 'max:16', 'regex:'.Chord::PATTERN],
        ], [
            'chord.regex' => 'Escribe el acorde en notación de guitarrista, por ejemplo Bm, F#m7, Dmaj7, Bsus4, C/G o N (sin acorde).',
        ]);

        $chord->update([
            'chord' => $data['chord'],
            'edited' => true,
            'confidence' => null,
        ]);

        return response()->json(['chord' => $chord->toClient()]);
    }

    /**
     * Detecta (o vuelve a detectar) los acordes de una canción. Usa las pistas
     * separadas si las tiene y, si no, el original; si se está separando,
     * espera a que termine. Los acordes corregidos a mano se conservan, por eso
     * sirve también para "Mejorar acordes con pistas separadas".
     */
    public function analyze(Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if ($song->chordsBusy()) {
            return response()->json(['message' => 'El análisis de acordes ya está en cola o en marcha.'], 409);
        }

        $song->queueChordAnalysis();

        return response()->json(self::payload($song->fresh()));
    }

    /** Cancela el análisis de acordes: detiene el proceso real si está en marcha. */
    public function cancel(Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if (! $song->chordsBusy()) {
            return response()->json(['message' => 'Los acordes no se están analizando.'], 422);
        }

        $wasProcessing = $song->chords_status === Song::STATUS_PROCESSING;
        $error = 'Cancelado por ti.';
        $changed = Song::whereKey($song->id)
            ->whereIn('chords_status', [Song::CHORDS_WAITING, Song::STATUS_PENDING, Song::STATUS_PROCESSING])
            ->update(['chords_status' => Song::STATUS_CANCELED, 'chords_error' => $error, 'chords_finished_at' => now()]);

        if ($changed && ! $wasProcessing) {
            QueueWatchdog::forgetJobs(AnalyzeChords::class, $song->id);
        } elseif ($changed) {
            // El job lo nota en 1 s, detiene el motor y lo confirma (chords_pid = null).
            $deadline = microtime(true) + (float) config('audio.chords.cancel_wait', 6);
            while (microtime(true) < $deadline && Song::whereKey($song->id)->whereNotNull('chords_pid')->exists()) {
                usleep(200_000);
            }
            $fresh = $song->fresh();
            if ($fresh && $fresh->chords_pid !== null) {
                QueueWatchdog::abortChords($fresh, $error, Song::STATUS_CANCELED);
            }
        }

        return response()->json(self::payload($song->fresh()));
    }

    public static function payload(Song $song): array
    {
        return [
            'analysis' => $song->chordAnalysis(),
            'chords' => $song->chords()->get()->map(fn (Chord $c) => $c->toClient())->values(),
        ];
    }
}
