<?php

namespace App\Models;

use App\Jobs\AnalyzeChords;
use Database\Factories\SongFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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

    public const STATUS_PENDING = 'pending';

    public const STATUS_PROCESSING = 'processing';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_PROCESSING,
        self::STATUS_READY,
        self::STATUS_FAILED,
    ];

    protected $fillable = [
        'title',
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
        'chords_key',
        'chords_error',
        'chords_started_at',
        'chords_finished_at',
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
        ];
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

    /** ¿El análisis de acordes está en cola o en marcha? */
    public function chordsBusy(): bool
    {
        return in_array($this->chords_status, [self::STATUS_PENDING, self::STATUS_PROCESSING], true);
    }

    /**
     * Pone la canción en la cola de acordes (cola "acordes", en paralelo a la
     * de separación). Las correcciones hechas a mano se conservan.
     */
    public function queueChordAnalysis(): void
    {
        $this->update([
            'chords_status' => self::STATUS_PENDING,
            'chords_progress' => 0,
            'chords_error' => null,
            'chords_started_at' => null,
            'chords_finished_at' => null,
        ]);

        AnalyzeChords::dispatch($this);
    }

    /** Estado del análisis de acordes para la interfaz. */
    public function chordAnalysis(): array
    {
        return [
            'status' => $this->chords_status,
            'progress' => (int) $this->chords_progress,
            'key' => $this->chords_key,
            'model' => $this->chords_model,
            'error' => $this->chords_error,
        ];
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
        return in_array($this->status, [self::STATUS_READY, self::STATUS_FAILED], true);
    }
}
