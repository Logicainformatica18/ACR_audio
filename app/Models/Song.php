<?php

namespace App\Models;

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
    /** @use HasFactory<\Database\Factories\SongFactory> */
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
