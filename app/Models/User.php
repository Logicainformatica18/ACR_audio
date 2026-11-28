<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    /**
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Al borrar la cuenta, la base de datos borra en cascada canciones,
     * pistas, ajustes y silencios; aquí se borran también los archivos.
     */
    protected static function booted(): void
    {
        static::deleting(function (User $user) {
            Storage::disk('audio')->deleteDirectory((string) (int) $user->id);
        });
    }

    public function songs(): HasMany
    {
        return $this->hasMany(Song::class);
    }

    public function folders(): HasMany
    {
        return $this->hasMany(Folder::class);
    }

    public function preference(): HasOne
    {
        return $this->hasOne(UserPreference::class);
    }

    /** Devuelve las preferencias del usuario, creándolas con valores por defecto si no existen. */
    public function preferences(): UserPreference
    {
        if (! $this->preference) {
            $this->setRelation('preference', $this->preference()->firstOrCreate([]));
        }

        return $this->preference;
    }
}
