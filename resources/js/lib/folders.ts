/** Carpeta tal como llega del servidor (lista plana; el árbol se arma aquí). */
export interface Folder {
    id: number;
    parent_id: number | null;
    name: string;
    color: FolderColor | null;
    note: string | null;
    position: number;
    songs_count: number;
}

export type FolderColor = 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'violet' | 'pink';

/** Carpeta abierta: todas las canciones, las que no tienen carpeta, o una carpeta. */
export type FolderView = 'all' | 'none' | number;

export const MAX_DEPTH = 3;

/** Paleta de 8 colores (punto de color legible en tema claro y oscuro). */
export const FOLDER_COLORS: { value: FolderColor; label: string; dot: string }[] = [
    { value: 'red', label: 'Rojo', dot: 'bg-red-500' },
    { value: 'orange', label: 'Naranja', dot: 'bg-orange-500' },
    { value: 'amber', label: 'Ámbar', dot: 'bg-amber-400' },
    { value: 'green', label: 'Verde', dot: 'bg-green-500' },
    { value: 'teal', label: 'Turquesa', dot: 'bg-teal-500' },
    { value: 'blue', label: 'Azul', dot: 'bg-blue-500' },
    { value: 'violet', label: 'Violeta', dot: 'bg-violet-500' },
    { value: 'pink', label: 'Rosa', dot: 'bg-pink-500' },
];

export const colorDot = (c: FolderColor | null) => FOLDER_COLORS.find((x) => x.value === c)?.dot ?? null;

/** Hijas directas de una carpeta (o de la raíz con null), en orden. */
export function childrenOf(folders: Folder[], parentId: number | null): Folder[] {
    return folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.position - b.position || a.id - b.id);
}

/** Ruta desde la raíz: [Metal, Satriani, Surfing]. */
export function pathOf(folders: Folder[], id: number | null): Folder[] {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const out: Folder[] = [];
    let cur = id !== null ? byId.get(id) : undefined;
    for (let i = 0; cur && i < 10; i++) {
        out.unshift(cur);
        cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined;
    }
    return out;
}

export const pathLabel = (folders: Folder[], id: number | null) =>
    id === null
        ? 'Sin carpeta'
        : pathOf(folders, id)
              .map((f) => f.name)
              .join(' › ') || 'Sin carpeta';

/** Nivel de una carpeta: 1 = en la raíz. */
export const depthOf = (folders: Folder[], id: number) => pathOf(folders, id).length;

/** Ids de la carpeta y de todas sus subcarpetas. */
export function subtreeIds(folders: Folder[], id: number): Set<number> {
    const ids = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
        frontier = folders.filter((f) => f.parent_id !== null && frontier.includes(f.parent_id)).map((f) => f.id);
        frontier.forEach((x) => ids.add(x));
    }
    return ids;
}

/** Niveles que ocupa el subárbol de una carpeta (1 = sin subcarpetas). */
export function heightOf(folders: Folder[], id: number): number {
    const kids = folders.filter((f) => f.parent_id === id);
    return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(folders, k.id))) : 0);
}

/** ¿Se puede meter la carpeta "id" dentro de "target"? (sin ciclos y sin pasar de 3 niveles) */
export function canNest(folders: Folder[], id: number, target: number | null): boolean {
    if (target === null) return true;
    if (subtreeIds(folders, id).has(target)) return false;
    return depthOf(folders, target) + heightOf(folders, id) <= MAX_DEPTH;
}

/** Lista plana en orden de árbol (para el buscador de "Mover a…"). */
export function flatTree(folders: Folder[]): { folder: Folder; depth: number; path: string }[] {
    const out: { folder: Folder; depth: number; path: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
        for (const f of childrenOf(folders, parent)) {
            out.push({ folder: f, depth, path: pathLabel(folders, f.id) });
            walk(f.id, depth + 1);
        }
    };
    walk(null, 1);
    return out;
}
