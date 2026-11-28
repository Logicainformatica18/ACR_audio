<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreSongRequest;
use App\Http\Resources\SongResource;
use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Folder;
use App\Models\Song;
use App\Models\Track;
use App\Models\User;
use App\Services\QueueWatchdog;
use App\Services\Separator;
use App\Services\Waveform;
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

        $prefs = $user->preferences();

        Song::purgeTrashed(); // borra del todo lo que lleva más de un minuto en la papelera

        return Inertia::render('songs/index', [
            'songs' => SongResource::collection($this->userSongs($user))->resolve(),
            'folders' => FolderController::tree($user),
            'sort' => $prefs->songs_sort,
            'uploadPrefs' => [
                'chords_auto' => $prefs->chords_auto,
                'upload_mode' => $prefs->upload_mode, // null = preguntar con el modal
            ],
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

        // Qué hacer con ella: lo elegido en el modal o, si no viene, lo recordado.
        $prefs = $user->preferences();
        $separate = ($request->input('mode') ?? $prefs->upload_mode ?? 'separate') === 'separate';
        $chords = $request->has('chords') ? $request->boolean('chords') : $prefs->chords_auto;

        // Carpeta de destino (la abierta al subir o la elegida en el modal): solo propias.
        $folderId = $request->filled('folder_id') ? (int) $request->input('folder_id') : null;
        if ($folderId && ! Folder::ownedBy($user)->whereKey($folderId)->exists()) {
            return response()->json(['message' => 'Esa carpeta no existe.', 'errors' => ['folder_id' => ['Esa carpeta no existe.']]], 422);
        }

        $song = DB::transaction(function () use ($user, $file, $ext, $separate, $folderId) {
            $song = $user->songs()->create([
                'folder_id' => $folderId,
                'title' => self::titleFromFileName($file->getClientOriginalName()),
                'original_name' => Str::limit($file->getClientOriginalName(), 250, ''),
                'original_ext' => $ext,
                'original_size' => $file->getSize(),
                'status' => $separate ? Song::STATUS_PENDING : Song::STATUS_NONE,
                'model' => $user->preferences()->effectiveModel(),
                'queued_at' => $separate ? now() : null,
            ]);

            // Ruta construida solo con ids y un nombre fijo: {user}/{song}/original.{ext}
            Storage::disk('audio')->putFileAs($song->directory(), $file, 'original.'.$ext);

            // La pista "Original": la que se oye en el mezclador si no se separa.
            $song->tracks()->create([
                'stem' => Track::ORIGINAL,
                'file_name' => 'original.'.$ext,
                'size' => $file->getSize(),
                'position' => 100,
            ]);

            return $song;
        });

        // Forma de onda y duración del original (aunque no se separe).
        $original = $song->tracks()->where('stem', Track::ORIGINAL)->first();
        $path = Storage::disk('audio')->path($song->originalPath());
        $original?->update(['peaks' => Waveform::compute($path)]);
        if (! $separate) {
            $song->update(['duration' => Separator::probeDuration($path)]);
        }

        if ($separate) {
            SeparateSong::dispatch($song);
        }
        if ($chords) {
            // Si se separa, espera a que termine; si no, analiza el original ya.
            $song->queueChordAnalysis();
        }

        return response()->json(['song' => SongResource::make($song->fresh())->resolve()], 201);
    }

    /**
     * Pone en la cola de acordes todas las canciones del usuario que no tienen
     * acordes (nunca analizadas, con error o canceladas).
     */
    public function analyzeMissing(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Song::class);

        $songs = Song::ownedBy($request->user())
            ->where(fn ($q) => $q->whereNull('download_status')->orWhere('download_status', Song::STATUS_READY)) // con audio
            ->where(fn ($q) => $q->whereNull('chords_status')
                ->orWhereIn('chords_status', [Song::STATUS_FAILED, Song::STATUS_CANCELED]))
            ->get();
        foreach ($songs as $song) {
            $song->queueChordAnalysis();
        }

        return response()->json([
            'queued' => $songs->count(),
            'message' => $songs->isEmpty()
                ? 'Todas tus canciones ya tienen acordes (o se están analizando).'
                : ($songs->count() === 1 ? 'Se puso 1 canción en la cola de acordes.' : "Se pusieron {$songs->count()} canciones en la cola de acordes."),
        ]);
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

        $songs = Song::ownedBy($user)->withCount('tracks')->orderBy('id')->get();

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

    /**
     * Separa una canción que se subió con "Solo subir", o vuelve a intentarlo
     * si la separación falló o se canceló.
     */
    public function retry(Request $request, Song $song): JsonResponse
    {
        $this->authorize('update', $song);

        if (! $song->hasAudio()) {
            return response()->json(['message' => 'Espera a que termine la descarga de YouTube.'], 422);
        }
        if (! in_array($song->status, [Song::STATUS_NONE, Song::STATUS_FAILED, Song::STATUS_CANCELED], true)) {
            return response()->json(['message' => $song->isSeparated()
                ? 'Esta canción ya está separada.'
                : 'La separación ya está en cola o en marcha.'], 422);
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
        // Los acordes que esperaban por esta separación también se cancelan.
        $song->releaseWaitingChords(true);

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
            return response()->json(['message' => 'No se puede borrar mientras se analizan sus acordes. Cancela el análisis primero o espera unos segundos.'], 409);
        }
        if ($song->download_status === Song::STATUS_PROCESSING) {
            return response()->json(['message' => 'No se puede borrar mientras se descarga. Cancela la descarga primero.'], 409);
        }

        // A la papelera: se puede deshacer durante Song::UNDO_SECONDS. Después,
        // Song::purgeTrashed() borra filas (cascada) y archivos definitivamente.
        $song->delete();
        Cache::forget(SeparateSong::progressKey($song->id));

        return response()->json(['deleted' => true, 'undo_seconds' => Song::UNDO_SECONDS]);
    }

    /** Deshacer borrados: recupera canciones de la papelera (solo las propias). */
    public function restore(Request $request): JsonResponse
    {
        $data = $request->validate(['song_ids' => ['required', 'array'], 'song_ids.*' => ['integer']]);
        $songs = Song::onlyTrashed()->ownedBy($request->user())->whereIn('id', $data['song_ids'])->get();

        foreach ($songs as $song) {
            $song->restore();
            // Los trabajos de la cola se descartaron al borrarla: se vuelven a encolar.
            if ($song->status === Song::STATUS_PENDING) {
                SeparateSong::dispatch($song);
            }
            if ($song->chords_status === Song::STATUS_PENDING) {
                AnalyzeChords::dispatch($song);
            }
        }

        return response()->json(['restored' => $songs->pluck('id')]);
    }

    /** Mueve una o varias canciones a una carpeta (o a "Sin carpeta" con null). */
    public function move(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'song_ids' => ['required', 'array', 'min:1', 'max:1000'],
            'song_ids.*' => ['integer'],
            'folder_id' => ['nullable', 'integer'],
        ]);

        if (isset($data['folder_id']) && ! Folder::ownedBy($user)->whereKey($data['folder_id'])->exists()) {
            return response()->json(['message' => 'Esa carpeta no existe.'], 422);
        }
        $ids = Song::ownedBy($user)->whereIn('id', $data['song_ids'])->pluck('id');
        if ($ids->count() !== count(array_unique($data['song_ids']))) {
            return response()->json(['message' => 'Alguna de esas canciones no existe.'], 403);
        }
        Song::whereIn('id', $ids)->update(['folder_id' => $data['folder_id'] ?? null]);

        return response()->json(['moved' => $ids->count(), 'folders' => FolderController::tree($user)]);
    }

    /**
     * Acciones sobre varias canciones a la vez: separar, detectar acordes o
     * borrar. Las que no admiten la acción se saltan y se informa.
     */
    public function bulk(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'action' => ['required', 'in:separate,chords,delete'],
            'song_ids' => ['required', 'array', 'min:1', 'max:1000'],
            'song_ids.*' => ['integer'],
        ]);
        $songs = Song::ownedBy($user)->whereIn('id', $data['song_ids'])->get();
        if ($songs->count() !== count(array_unique($data['song_ids']))) {
            return response()->json(['message' => 'Alguna de esas canciones no existe.'], 403);
        }

        $done = [];
        $skipped = 0;
        foreach ($songs as $song) {
            $ok = match ($data['action']) {
                'separate' => $song->hasAudio() && in_array($song->status, [Song::STATUS_NONE, Song::STATUS_FAILED, Song::STATUS_CANCELED], true),
                'chords' => $song->hasAudio() && ! $song->chordsBusy(),
                'delete' => $song->status !== Song::STATUS_PROCESSING && $song->chords_status !== Song::STATUS_PROCESSING
                    && $song->download_status !== Song::STATUS_PROCESSING,
            };
            if (! $ok) {
                $skipped++;

                continue;
            }
            match ($data['action']) {
                'separate' => $this->queueSeparation($song, $user->preferences()->effectiveModel()),
                'chords' => $song->queueChordAnalysis(),
                'delete' => $song->delete(),
            };
            $done[] = $song->id;
        }

        $verb = ['separate' => 'en cola para separar', 'chords' => 'en cola de acordes', 'delete' => 'borradas'][$data['action']];
        $message = count($done).' '.(count($done) === 1 ? 'canción' : 'canciones')." {$verb}.";
        if ($skipped) {
            $message .= " {$skipped} no se pudieron (ya en marcha o no aplicable).";
        }

        return response()->json(['done' => $done, 'skipped' => $skipped, 'message' => $message, 'folders' => FolderController::tree($user)]);
    }

    private function queueSeparation(Song $song, string $model): void
    {
        QueueWatchdog::forgetJobs(SeparateSong::class, $song->id);
        $song->update([
            'status' => Song::STATUS_PENDING, 'model' => $model, 'error' => null, 'log' => null,
            'queued_at' => now(), 'started_at' => null, 'finished_at' => null, 'process_pid' => null, 'heartbeat_at' => null,
        ]);
        SeparateSong::dispatch($song);
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
