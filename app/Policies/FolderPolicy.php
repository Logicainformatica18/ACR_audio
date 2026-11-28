<?php

namespace App\Policies;

use App\Models\Folder;
use App\Models\User;

/** Cada usuario solo ve y cambia sus propias carpetas. */
class FolderPolicy
{
    public function view(User $user, Folder $folder): bool
    {
        return $folder->user_id === $user->id;
    }

    public function update(User $user, Folder $folder): bool
    {
        return $folder->user_id === $user->id;
    }

    public function delete(User $user, Folder $folder): bool
    {
        return $folder->user_id === $user->id;
    }
}
