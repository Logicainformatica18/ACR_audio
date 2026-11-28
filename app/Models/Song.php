<?php

namespace App\Models;

use App\Jobs\AnalyzeChords;
use Database\Factories\SongFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

/**
 * Canción subida por un usuario.
 *
 * Archivos en el disco "audio" (rutas construidas SOLO con ids numéricos y
 * nombres generados por el servidor, nunca con texto escrito por el usuario):
 *   {user_id}/{song_id}/original.{ext}
 *   {user_id}/{song_id}/stems/{stem}.flac
 */
class Song extends Model
{
    /** @use HasFactory<SongFactory> */
    use HasFactory;

    /**
     * Borrar = papelera unos segundos (para "Deshacer"); después
     * purgeTrashed() borra filas y archivos definitivamente.
     */
    use SoftDeletes;

    /** Segundos que una canción borrada se puede recuperar antes de borrarla del todo. */
    public const UNDO_SECONDS = 60;

    public const STATUS_PENDING = 'pending';

    public const STATUS_PROCESSING = 'processing';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    /** Cancelada por el usuario (en cola o a mitad de la separación). */
    public const STATUS_CANCELED = 'canceled';

    /** Separación no solicitada: se subió con "Solo subir" (solo tiene el original). */
    public const STATUS_NONE = 'none';

    /** Acordes pedidos que esperan a que termine la separación (solo en chords_status). */
    public const CHORDS_WAITING = 'waiting';

    public const STATUSES = [
        self::STATUS_NONE,
        self::STATUS_PENDING,
        self::STATUS_PROCESSING,
        self::STATUS_READY,
        self::STATUS_FAILED,
        self::STATUS_CANCELED,
    ];

    protected $fillable = [
        'title',
        'folder_id',
        'original_name',
        'original_ext',
        'original_size',
        'duration',
        'status',
        'model',
        'log',
        'error',
        'queued_at',
        'started_at',
        'finished_at',
        'chords_status',
        'chords_progress',
        'chords_model',
        'chords_source',
        'chords_key',
        'chords_error',
        'chords_started_at',
        'chords_finished_at',
        'process_pid',
        'heartbeat_at',
        'chords_pid',
        'chords_heartbeat_at',
        'youtube_id',
        'source_url',
        'channel',
        'thumbnail_url',
        'download_status',
        'download_progress',
        'download_error',
        'download_pid',
        'download_heartbeat_at',
        'download_then_separate',
        'download_then_chords',
    ];

    /** El log puede ser largo: solo se envía cuando se pide expresamente. */
    protected $hidden = ['log'];

    protected function casts(): array
    {
        return [
            'original_size' => 'integer',
            'duration' => 'float',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'chords_progress' => 'integer',
            'chords_started_at' => 'datetime',
            'chords_finished_at' => 'datetime',
            'process_pid' => 'integer',
            'heartbeat_at' => 'datetime',
            'chords_pid' => 'integer',
            'chords_heartbeat_at' => 'datetime',
            'download_progress' => 'integer',
            'download_pid' => 'integer',
            'download_heartbeat_at' => 'datetime',
            'download_then_separate' => 'boolean',
            'download_then_chords' => 'boolean',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /**
     * Borra del todo (filas y archivos) las canciones que llevan más de
     * UNDO_SECONDS en la papelera, y las carpetas borradas hace lo mismo.
     */
    public static function purgeTrashed(): int
    {
        $limit = now()->subSeconds(self::UNDO_SECONDS);
        $songs = self::onlyTrashed()->where('deleted_at', '<', $limit)->get();
        foreach ($songs as $song) {
            Storage::disk('audio')->deleteDirectory($song->directory());
            $song->forceDelete();
        }
        Folder::onlyTrashed()->where('deleted_at', '<', $limit)->forceDelete();

        return $songs->count();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function tracks(): HasMany
    {
        return $this->hasMany(Track::class)->orderBy('position');
    }

    public function chords(): HasMany
    {
        return $this->hasMany(Chord::class)->orderBy('start_seconds');
    }

    /** ¿El análisis de acordes está esperando, en cola o en marcha? */
    public function chordsBusy(): bool
    {
        return in_array($this->chords_status, [self::CHORDS_WAITING, self::STATUS_PENDING, self::STATUS_PROCESSING], true);
    }

    /** ¿Tiene pistas separadas listas? */
    public function isSeparated(): bool
    {
        return $this->status === self::STATUS_READY;
    }

    /** ¿La separación está en cola o en marcha? */
    public function isSeparating(): bool
    {
        return in_array($this->status, [self::STATUS_PENDING, self::STATUS_PROCESSING], true);
    }

    /**
     * Pide el análisis de acordes (cola "acordes", en paralelo a la de
     * separación). Si la canción se está separando, espera a que termine
     * ("waiting") para analizar con las pistas separadas; si no, entra ya en la
     * cola y usa las pistas (si las tiene) o el original. Las correcciones
     * hechas a mano se conservan.
     */
    public function queueChordAnalysis(): void
    {
        $waiting = $this->isSeparating();

        $this->update([
            'chords_status' => $waiting ? self::CHORDS_WAITING : self::STATUS_PENDING,
            'chords_progress' => 0,
            'chords_error' => null,
            'chords_started_at' => null,
            'chords_finished_at' => null,
        ]);

        if (! $waiting) {
            AnalyzeChords::dispatch($this);
        }
    }

    /** Estado del análisis de acordes para la interfaz. */
    public function chordAnalysis(): array
    {
        return [
            'status' => $this->chords_status,
            'progress' => (int) $this->chords_progress,
            'key' => $this->chords_key,
            'model' => $this->chords_model,
            'source' => $this->chords_source,
            'error' => $this->chords_error,
        ];
    }

    /**
     * La separación terminó (bien, mal o cancelada): si los acordes esperaban
     * por ella, se lanzan ahora (con las pistas si salió bien o con el original
     * si falló). Si el usuario canceló la separación, los acordes que esperaban
     * también se cancelan.
     */
    public function releaseWaitingChords(bool $separationCanceled = false): void
    {
        $this->refresh();
        if ($this->chords_status !== self::CHORDS_WAITING) {
            return;
        }
        if ($separationCanceled) {
            $this->update([
                'chords_status' => self::STATUS_CANCELED,
                'chords_error' => 'Se canceló la separación de la que dependían.',
                'chords_finished_at' => now(),
            ]);

            return;
        }
        $this->queueChordAnalysis();
    }

    /** Acordes detectados sobre el original en una canción que ya está separada. */
    public function canImproveChords(): bool
    {
        return $this->isSeparated() && $this->chords_status === self::STATUS_READY && $this->chords_source === 'original';
    }

    public function scopeOwnedBy(Builder $query, User $user): Builder
    {
        return $query->where('user_id', $user->id);
    }

    // ----- Rutas de archivos (relativas al disco "audio") -----

    public function directory(): string
    {
        return (int) $this->user_id.'/'.(int) $this->id;
    }

    public function originalPath(): string
    {
        return $this->directory().'/original.'.$this->original_ext;
    }

    public function stemsDirectory(): string
    {
        return $this->directory().'/stems';
    }

    public function isFinished(): bool
    {
        return in_array($this->status, [self::STATUS_READY, self::STATUS_FAILED, self::STATUS_CANCELED], true);
    }

    /** ¿Se puede cancelar? (en cola o separándose) */
    /** ¿Se está descargando de YouTube (en cola o en marcha)? Aún no tiene audio. */
    public function isDownloading(): bool
    {
        return in_array($this->download_status, [self::STATUS_PENDING, self::STATUS_PROCESSING], true);
    }

    /** ¿Tiene ya su audio original? (las de YouTube, solo cuando terminó la descarga) */
    public function hasAudio(): bool
    {
        return $this->download_status === null || $this->download_status === self::STATUS_READY;
    }

    public function isCancelable(): bool
    {
        return in_array($this->status, [self::STATUS_PENDING, self::STATUS_PROCESSING], true);
    }
}
