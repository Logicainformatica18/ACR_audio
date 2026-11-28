<?php

namespace App\Http\Controllers;

use App\Models\Folder;
use App\Models\Song;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Carpetas del usuario: crear, renombrar/colorear/anotar, mover (reordenar o
 * meter dentro de otra), borrar sin perder canciones y deshacer el borrado.
 */
class FolderController extends Controller
{
    /** Árbol completo del usuario con el número de canciones de cada carpeta. */
    public static function tree($user): array
    {
        $counts = Song::ownedBy($user)->whereNotNull('folder_id')
            ->selectRaw('folder_id, count(*) as total')->groupBy('folder_id')->pluck('total', 'folder_id');

        return Folder::ownedBy($user)->orderBy('parent_id')->orderBy('position')->get()
            ->map(fn (Folder $f) => $f->toClient((int) ($counts[$f->id] ?? 0)))->values()->all();
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['folders' => self::tree($request->user())]);
    }

    /** Crea una carpeta (por defecto "Nueva carpeta", al final de su nivel). */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:100'],
            'parent_id' => ['nullable', 'integer', Rule::exists('folders', 'id')->where('user_id', $user->id)->whereNull('deleted_at')],
            'color' => ['nullable', Rule::in(Folder::COLORS)],
            'note' => ['nullable', 'string', 'max:255'],
        ], [
            'parent_id.exists' => 'Esa carpeta no existe.',
        ]);

        $parent = isset($data['parent_id']) ? Folder::find($data['parent_id']) : null;
        if ($parent && $parent->depth() >= Folder::MAX_DEPTH) {
            return $this->tooDeep();
        }

        $folder = $user->folders()->create([
            'parent_id' => $parent?->id,
            'name' => self::cleanName($data['name'] ?? '') ?: Folder::DEFAULT_NAME,
            'color' => $data['color'] ?? null,
            'note' => self::cleanNote($data['note'] ?? null),
            'position' => (int) Folder::ownedBy($user)->where('parent_id', $parent?->id)->max('position') + 1,
        ]);

        return response()->json(['folder' => $folder->toClient(), 'folders' => self::tree($user)], 201);
    }

    /** Renombrar, cambiar color o nota. */
    public function update(Request $request, Folder $folder): JsonResponse
    {
        $this->authorize('update', $folder);
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'color' => ['sometimes', 'nullable', Rule::in(Folder::COLORS)],
            'note' => ['sometimes', 'nullable', 'string', 'max:255'],
        ], [
            'name.required' => 'El nombre no puede quedar vacío.',
        ]);

        if (array_key_exists('name', $data)) {
            $data['name'] = self::cleanName($data['name']);
            if ($data['name'] === '') {
                return response()->json(['message' => 'El nombre no puede quedar vacío.', 'errors' => ['name' => ['El nombre no puede quedar vacío.']]], 422);
            }
        }
        if (array_key_exists('note', $data)) {
            $data['note'] = self::cleanNote($data['note']);
        }
        $folder->update($data);

        return response()->json(['folder' => $folder->toClient()]);
    }

    /**
     * Mueve una carpeta: dentro de otra (parent_id) y/o a una posición entre
     * sus hermanas. Nunca dentro de sí misma ni de una subcarpeta suya, nunca a
     * una carpeta ajena y nunca más de 3 niveles.
     */
    public function move(Request $request, Folder $folder): JsonResponse
    {
        $this->authorize('update', $folder);
        $user = $request->user();
        $data = $request->validate([
            'parent_id' => ['nullable', 'integer'],
            'position' => ['nullable', 'integer', 'min:0'],
        ]);

        $parentId = $data['parent_id'] ?? null;
        $parent = null;
        if ($parentId !== null) {
            $parent = Folder::ownedBy($user)->find($parentId);
            if (! $parent) {
                return response()->json(['message' => 'Esa carpeta no existe.'], 422);
            }
            if (in_array($parent->id, $folder->subtreeIds(), true)) {
                return response()->json(['message' => 'Una carpeta no puede ir dentro de sí misma ni de una de sus subcarpetas.'], 422);
            }
            if ($parent->depth() + $folder->height() > Folder::MAX_DEPTH) {
                return $this->tooDeep();
            }
        }

        DB::transaction(function () use ($user, $folder, $parent, $data) {
            $siblings = Folder::ownedBy($user)->where('parent_id', $parent?->id)
                ->whereKeyNot($folder->id)->orderBy('position')->get();
            $index = min($data['position'] ?? $siblings->count(), $siblings->count());
            $ordered = $siblings->values()->all();
            array_splice($ordered, $index, 0, [$folder]);
            foreach ($ordered as $i => $f) {
                $f->forceFill(['position' => $i, 'parent_id' => $parent?->id])->save();
            }
        });

        return response()->json(['folders' => self::tree($user)]);
    }

    /**
     * Borra la carpeta SIN borrar canciones: sus canciones y subcarpetas pasan
     * a la carpeta superior (o a "Sin carpeta"). Queda en la papelera unos
     * segundos para poder deshacer.
     */
    public function destroy(Request $request, Folder $folder): JsonResponse
    {
        $this->authorize('delete', $folder);
        $user = $request->user();

        $songIds = Song::ownedBy($user)->where('folder_id', $folder->id)->pluck('id')->all();
        $childIds = Folder::ownedBy($user)->where('parent_id', $folder->id)->pluck('id')->all();

        DB::transaction(function () use ($user, $folder, $songIds, $childIds) {
            Song::ownedBy($user)->whereIn('id', $songIds)->update(['folder_id' => $folder->parent_id]);
            $next = (int) Folder::ownedBy($user)->where('parent_id', $folder->parent_id)->max('position') + 1;
            foreach (Folder::whereIn('id', $childIds)->orderBy('position')->get() as $child) {
                $child->forceFill(['parent_id' => $folder->parent_id, 'position' => $next++])->save();
            }
            $folder->delete();
        });

        return response()->json([
            'moved_songs' => $songIds,
            'moved_folders' => $childIds,
            'folders' => self::tree($user),
        ]);
    }

    /** Deshacer el borrado: recupera la carpeta y le devuelve sus canciones y subcarpetas. */
    public function restore(Request $request, int $folder): JsonResponse
    {
        $user = $request->user();
        $model = Folder::onlyTrashed()->ownedBy($user)->findOrFail($folder);
        $data = $request->validate([
            'song_ids' => ['array'],
            'song_ids.*' => ['integer'],
            'folder_ids' => ['array'],
            'folder_ids.*' => ['integer'],
        ]);

        DB::transaction(function () use ($user, $model, $data) {
            $model->restore();
            Song::ownedBy($user)->whereIn('id', $data['song_ids'] ?? [])->update(['folder_id' => $model->id]);
            Folder::ownedBy($user)->whereIn('id', $data['folder_ids'] ?? [])->update(['parent_id' => $model->id]);
        });

        return response()->json(['folders' => self::tree($user)]);
    }

    private function tooDeep(): JsonResponse
    {
        return response()->json(['message' => 'Las carpetas pueden tener como máximo '.Folder::MAX_DEPTH.' niveles.'], 422);
    }

    public static function cleanName(string $name): string
    {
        return trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F]+/u', '', $name) ?? '') ?? '');
    }

    private static function cleanNote(?string $note): ?string
    {
        $note = $note === null ? '' : trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $note) ?? '');

        return $note === '' ? null : $note;
    }
}
