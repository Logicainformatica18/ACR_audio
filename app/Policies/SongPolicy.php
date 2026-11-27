<?php

namespace App\Policies;

use App\Models\Song;
use App\Models\User;

/**
 * Cada usuario solo puede ver, escuchar, modificar o borrar SUS canciones.
 * Laravel la detecta sola por el nombre (App\Models\Song -> App\Policies\SongPolicy).
 */
class SongPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // la lista siempre se filtra por el usuario
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function view(User $user, Song $song): bool
    {
        return $this->owns($user, $song);
    }

    public function update(User $user, Song $song): bool
    {
        return $this->owns($user, $song);
    }

    public function delete(User $user, Song $song): bool
    {
        return $this->owns($user, $song);
    }

    private function owns(User $user, Song $song): bool
    {
        return (int) $song->user_id === (int) $user->id;
    }
}
