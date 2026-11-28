<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Carpeta de canciones de un usuario. Puede tener subcarpetas (hasta 3 niveles).
 */
class Folder extends Model
{
    use SoftDeletes;

    /** Niveles máximos: carpeta > subcarpeta > sub-subcarpeta. */
    public const MAX_DEPTH = 3;

    /** Paleta de colores permitidos (la interfaz los pinta con tonos claros y oscuros). */
    public const COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

    public const DEFAULT_NAME = 'Nueva carpeta';

    protected $fillable = ['parent_id', 'name', 'color', 'note', 'position'];

    protected function casts(): array
    {
        return ['position' => 'integer', 'parent_id' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('position');
    }

    public function songs(): HasMany
    {
        return $this->hasMany(Song::class);
    }

    public function scopeOwnedBy(Builder $query, User $user): Builder
    {
        return $query->where('user_id', $user->id);
    }

    /** Nivel de esta carpeta: 1 = en la raíz. */
    public function depth(): int
    {
        $depth = 1;
        $parentId = $this->parent_id;
        while ($parentId && $depth <= self::MAX_DEPTH + 1) {
            $parentId = self::whereKey($parentId)->value('parent_id');
            $depth++;
        }

        return $depth;
    }

    /** Ids de esta carpeta y de todas sus subcarpetas. */
    public function subtreeIds(): array
    {
        $ids = [$this->id];
        $frontier = [$this->id];
        while ($frontier) {
            $frontier = self::whereIn('parent_id', $frontier)->pluck('id')->all();
            $ids = array_merge($ids, $frontier);
        }

        return $ids;
    }

    /** Niveles que ocupa el subárbol: 1 = sin subcarpetas. */
    public function height(): int
    {
        $height = 1;
        $frontier = [$this->id];
        while ($frontier = self::whereIn('parent_id', $frontier)->pluck('id')->all()) {
            $height++;
        }

        return $height;
    }

    /** Datos que se envían a la interfaz. */
    public function toClient(int $songsCount = 0): array
    {
        return [
            'id' => $this->id,
            'parent_id' => $this->parent_id,
            'name' => $this->name,
            'color' => $this->color,
            'note' => $this->note,
            'position' => $this->position,
            'songs_count' => $songsCount,
        ];
    }
}
