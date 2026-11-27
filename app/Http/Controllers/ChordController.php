<?php

namespace App\Http\Controllers;

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

    /** Vuelve a analizar (los acordes editados a mano se conservan). */
    public function analyze(Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if ($song->status !== Song::STATUS_READY) {
            return response()->json(['message' => 'La canción todavía no tiene pistas separadas.'], 409);
        }
        if ($song->chordsBusy()) {
            return response()->json(['message' => 'El análisis de acordes ya está en marcha.'], 409);
        }

        $song->queueChordAnalysis();

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
