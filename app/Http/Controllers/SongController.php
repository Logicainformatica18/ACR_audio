<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSongRequest;
use App\Http\Resources\SongResource;
use App\Jobs\SeparateSong;
use App\Models\Song;
use App\Models\User;
use App\Services\QueueWatchdog;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
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
        QueueWatchdog::checkThrottled(5);

        return Inertia::render('songs/index', [
            'songs' => SongResource::collection($this->userSongs($user))->resolve(),
            'sort' => $user->preferences()->songs_sort,
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

        // ¿Ya subió este mismo archivo (mismo nombre y tamaño)? Se avisa antes de duplicarlo.
        if (! $request->boolean('allow_duplicate')) {
            $existing = Song::ownedBy($user)
                ->where('original_name', Str::limit($file->getClientOriginalName(), 250, ''))
                ->where('original_size', $file->getSize())
                ->first();
            if ($existing) {
                return response()->json([
                    'code' => 'duplicate',
                    'message' => "Ya tienes «{$existing->title}» (mismo nombre y tamaño).",
                    'existing' => ['id' => $existing->id, 'title' => $existing->title, 'status' => $existing->status],
                ], 409);
            }
        }

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

        SeparateSong::dispatch($song);

        return response()->json(['song' => SongResource::make($song)->resolve()], 201);
    }

    /**
     * Estado en vivo de las canciones del usuario (la lista lo consulta cada
     * 2,5 s mientras haya canciones en cola o procesándose).
     */
    public function status(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Song::class);
        $user = $request->user();

        // Detecta trabajos con el worker muerto aunque las ventanas estén cerradas.
        QueueWatchdog::checkThrottled(5);

        $songs = Song::ownedBy($user)->withCount('tracks')->get();

        // Canciones de todos los usuarios que esperan turno (la cola es una sola).
        $queue = Song::where('status', Song::STATUS_PENDING)->orderBy('queued_at')->orderBy('id')->pluck('id')->all();
        $processingAny = Song::where('status', Song::STATUS_PROCESSING)->exists();

        return response()->json([
            'songs' => $songs->map(fn (Song $song) => [
                ...SongResource::make($song)->resolve(),
                'progress' => $song->status === Song::STATUS_PROCESSING
                    ? Cache::get(SeparateSong::progressKey($song->id))
                    : null,
                'queue_position' => $song->status === Song::STATUS_PENDING
                    ? array_search($song->id, $queue, true) + 1 + ($processingAny ? 1 : 0)
                    : null,
            ])->values(),
        ]);
    }

    /** Salida completa de audio-separator (para ver por qué falló). */
    public function log(Song $song): JsonResponse
    {
        $this->authorize('view', $song);

        return response()->json(['log' => $song->log ?? '']);
    }

    /** Vuelve a poner en cola una canción que falló o se canceló. */
    public function retry(Request $request, Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if (! in_array($song->status, [Song::STATUS_FAILED, Song::STATUS_CANCELED], true)) {
            return response()->json(['message' => 'Solo se pueden reintentar canciones con error o canceladas.'], 422);
        }

        // Por si quedó un trabajo viejo de esta canción en la cola.
        QueueWatchdog::forgetJobs(SeparateSong::class, $song->id);

        $song->update([
            'status' => Song::STATUS_PENDING,
            'model' => $request->user()->preferences()->effectiveModel(),
            'error' => null,
            'log' => null,
            'queued_at' => now(),
            'started_at' => null,
            'finished_at' => null,
            'process_pid' => null,
            'heartbeat_at' => null,
        ]);

        SeparateSong::dispatch($song);

        return response()->json(['song' => SongResource::make($song)->resolve()]);
    }

    /**
     * Cancela una canción en cola o separándose. Detiene el proceso REAL:
     * el job lo ve en menos de 1 s, termina audio-separator y borra lo que
     * llevaba hecho. Si el worker no responde (por ejemplo, se cerró su
     * ventana), lo hace esta misma petición. El archivo original se conserva
     * para poder reintentar.
     */
    public function cancel(Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if (! $song->isCancelable()) {
            return response()->json(['message' => 'Solo se pueden cancelar canciones en cola o procesándose.'], 422);
        }

        $wasProcessing = $song->status === Song::STATUS_PROCESSING;
        $error = 'Cancelada por ti.';
        $changed = Song::whereKey($song->id)->whereIn('status', [Song::STATUS_PENDING, Song::STATUS_PROCESSING])
            ->update(['status' => Song::STATUS_CANCELED, 'error' => $error, 'finished_at' => now()]);

        if ($changed && ! $wasProcessing) {
            QueueWatchdog::forgetJobs(SeparateSong::class, $song->id);
        } elseif ($changed) {
            // Esperar a que el job detenga el proceso y lo confirme (máximo 8 s).
            $deadline = microtime(true) + (float) config('audio.separator.cancel_wait', 8);
            while (microtime(true) < $deadline
                && Song::whereKey($song->id)->where(fn ($q) => $q->whereNotNull('process_pid')->orWhereNotNull('heartbeat_at'))->exists()) {
                usleep(250_000);
            }
            // El job confirma la parada dejando process_pid y heartbeat_at en null.
            $fresh = $song->fresh();
            if ($fresh && ($fresh->process_pid !== null || $fresh->heartbeat_at !== null)) {
                // El worker no respondió: se detiene el proceso y se limpia desde aquí.
                QueueWatchdog::abortSeparation($fresh, Song::STATUS_CANCELED, $error);
            }
        }

        return response()->json(['song' => SongResource::make($song->fresh())->resolve()]);
    }

    /** Renombrar: solo cambia el título visible (nunca afecta a rutas de archivo). */
    public function update(Request $request, Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
        ]);
        $title = trim(preg_replace('/[\x00-\x1F\x7F]+/u', '', $data['title']) ?? '');

        if ($title === '') {
            return response()->json(['message' => 'El título no puede quedar vacío.', 'errors' => ['title' => ['El título no puede quedar vacío.']]], 422);
        }

        $song->update(['title' => $title]);

        return response()->json(['song' => SongResource::make($song)->resolve()]);
    }

    /** Borra la canción, sus pistas, ajustes y silencios, y todos sus archivos. */
    public function destroy(Song $song): JsonResponse
    {
        $this->authorize('delete', $song);

        if ($song->status === Song::STATUS_PROCESSING) {
            return response()->json(['message' => 'No se puede borrar mientras se está separando. Pulsa «Cancelar» primero.'], 409);
        }
        if ($song->chords_status === Song::STATUS_PROCESSING) {
            return response()->json(['message' => 'No se puede borrar mientras se analizan sus acordes. Espera unos segundos.'], 409);
        }

        $directory = $song->directory(); // {user_id}/{song_id}: solo ids
        $song->delete(); // cascada en BD: tracks, track_settings, scheduled_silences
        Storage::disk('audio')->deleteDirectory($directory);
        Cache::forget(SeparateSong::progressKey($song->id));

        return response()->json(['deleted' => true]);
    }

    /** @return Collection<int, Song> */
    private function userSongs(User $user)
    {
        $query = Song::ownedBy($user)->withCount('tracks');

        match ($user->preferences()->songs_sort) {
            'title' => $query->orderBy('title'),
            'status' => $query->orderByRaw("CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 WHEN 'canceled' THEN 2 ELSE 3 END")->latest(),
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
