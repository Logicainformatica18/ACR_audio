<?php

namespace App\Http\Controllers;

use App\Http\Resources\SongResource;
use App\Models\Song;
use App\Models\Track;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Panel: resumen de las canciones del usuario. */
class DashboardController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $user = $request->user();

        $byStatus = Song::ownedBy($user)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $originals = (int) Song::ownedBy($user)->sum('original_size');
        // La pista "original" es el mismo archivo que el original: no se cuenta dos veces.
        $stems = (int) Track::whereIn('song_id', Song::ownedBy($user)->select('id'))->where('stem', '!=', Track::ORIGINAL)->sum('size');

        return Inertia::render('dashboard', [
            'stats' => [
                'total' => (int) $byStatus->sum(),
                'pending' => (int) ($byStatus[Song::STATUS_PENDING] ?? 0),
                'processing' => (int) ($byStatus[Song::STATUS_PROCESSING] ?? 0),
                'ready' => (int) ($byStatus[Song::STATUS_READY] ?? 0),
                'failed' => (int) ($byStatus[Song::STATUS_FAILED] ?? 0),
                'chords' => Song::ownedBy($user)->where('chords_status', Song::STATUS_READY)->count(),
                'bytes' => $originals + $stems,
                'minutes' => round((float) Song::ownedBy($user)->sum('duration') / 60, 1),
            ],
            'recent' => SongResource::collection(Song::ownedBy($user)->latest()->limit(5)->get())->resolve(),
        ]);
    }
}
