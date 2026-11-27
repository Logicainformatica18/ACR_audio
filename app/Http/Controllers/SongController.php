<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSongRequest;
use App\Http\Resources\SongResource;
use App\Models\Song;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class SongController extends Controller
{
    /** Lista de canciones del usuario + zona para subir. */
    public function index(Request $request): Response
    {
        $this->authorize('viewAny', Song::class);
        $user = $request->user();

        return Inertia::render('songs/index', [
            'songs' => SongResource::collection($this->userSongs($user))->resolve(),
            'limits' => [
                'max_mb' => config('audio.max_upload_mb'),
                'extensions' => config('audio.allowed_extensions'),
            ],
        ]);
    }

    /**
     * Recibe UN archivo (la interfaz sube los archivos de uno en uno para
     * poder mostrar el progreso de cada uno) y crea la canción.
     */
    public function store(StoreSongRequest $request): JsonResponse
    {
        $this->authorize('create', Song::class);

        $user = $request->user();
        $file = $request->file('file');
        // Extensión ya validada contra la lista permitida (mp3, wav, flac, m4a, ogg).
        $ext = strtolower($file->getClientOriginalExtension());

        $song = DB::transaction(function () use ($user, $file, $ext) {
            $song = $user->songs()->create([
                'title' => self::titleFromFileName($file->getClientOriginalName()),
                'original_name' => Str::limit($file->getClientOriginalName(), 250, ''),
                'original_ext' => $ext,
                'original_size' => $file->getSize(),
                'status' => Song::STATUS_PENDING,
                'model' => $user->preferences()->effectiveModel(),
                'queued_at' => now(),
            ]);

            // Ruta construida solo con ids y un nombre fijo: {user}/{song}/original.{ext}
            Storage::disk('audio')->putFileAs($song->directory(), $file, 'original.'.$ext);

            return $song;
        });

        return response()->json(['song' => SongResource::make($song)->resolve()], 201);
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, Song> */
    private function userSongs(User $user)
    {
        $query = Song::ownedBy($user)->withCount('tracks');

        match ($user->preferences()->songs_sort) {
            'title' => $query->orderBy('title'),
            'status' => $query->orderByRaw("CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END")->latest(),
            default => $query->latest(),
        };

        return $query->get();
    }

    /** "01 - Mi canción (remix).mp3" -> "01 - Mi canción (remix)". Solo para mostrar. */
    public static function titleFromFileName(string $name): string
    {
        $title = pathinfo($name, PATHINFO_FILENAME);
        $title = preg_replace('/[\x00-\x1F\x7F]+/u', '', $title) ?? '';
        $title = trim(preg_replace('/\s+/u', ' ', str_replace('_', ' ', $title)) ?? '');

        return $title === '' ? 'Canción sin título' : Str::limit($title, 200, '');
    }
}
