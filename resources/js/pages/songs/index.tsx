import { ConfirmDialog } from '@/components/confirm-dialog';
import { FolderTree } from '@/components/songs/folder-tree';
import { MoveDialog } from '@/components/songs/move-dialog';
import { SongRow, type RowAction } from '@/components/songs/song-row';
import { SongStatusDetails } from '@/components/songs/song-status-details';
import { chordsLabel, statusLabel } from '@/components/songs/status-badge';
import { UploadDropzone } from '@/components/songs/upload-dropzone';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSongStatus } from '@/hooks/use-song-status';
import AppLayout from '@/layouts/app-layout';
import { canNest, childrenOf, pathLabel, pathOf, subtreeIds, type Folder, type FolderColor, type FolderView } from '@/lib/folders';
import { cn } from '@/lib/utils';
import { type BreadcrumbItem, type LiveSong, type Song, type UploadLimits, type UploadPrefs } from '@/types';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MeasuringStrategy,
    PointerSensor,
    TouchSensor,
    pointerWithin,
    rectIntersection,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { Head, router } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import {
    ChevronRight,
    Download,
    FolderIcon,
    FolderInput,
    FolderTree as FolderTreeIcon,
    Keyboard,
    Layers,
    Music2,
    Pencil,
    Search,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Canciones', href: '/songs' }];

type Sort = 'recent' | 'title' | 'status';
type Filter = 'all' | 'separated' | 'original' | 'chords' | 'nochords';

const FILTERS: { value: Filter; label: string; test: (s: Song) => boolean }[] = [
    { value: 'all', label: 'Todas', test: () => true },
    { value: 'separated', label: 'Separadas', test: (s) => s.status === 'ready' },
    { value: 'original', label: 'Solo original', test: (s) => s.status !== 'ready' },
    { value: 'chords', label: 'Con acordes', test: (s) => s.chords_status === 'ready' },
    { value: 'nochords', label: 'Sin acordes', test: (s) => s.chords_status !== 'ready' },
];

interface Props {
    songs: Song[];
    folders: Folder[];
    sort: Sort;
    limits: UploadLimits;
    uploadPrefs: UploadPrefs;
}

/** Quita tildes y pasa a minúsculas para buscar "cancion" y encontrar "Canción". */
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const errorText = (err: unknown, fallback: string) => (err as AxiosError<{ message?: string }>).response?.data?.message ?? fallback;
const json = { headers: { Accept: 'application/json' } };

/** Carpeta abierta, guardada en la URL (?carpeta=12 o ?carpeta=sin) para no perderla al recargar. */
function readView(): FolderView {
    const v = new URLSearchParams(window.location.search).get('carpeta');
    if (v === 'sin') return 'none';
    return v && /^\d+$/.test(v) ? Number(v) : 'all';
}

const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

interface UndoEntry {
    id: number;
    label: string;
    run: () => Promise<void>;
}

const SHORTCUTS: [string, string][] = [
    ['F2', 'Renombrar la canción seleccionada (o la carpeta con el foco)'],
    ['Supr', 'Borrar lo seleccionado (pide confirmación)'],
    ['Ctrl + A', 'Seleccionar todas las canciones visibles'],
    ['Ctrl + clic / Mayús + clic', 'Seleccionar varias / un rango'],
    ['↑ / ↓', 'Moverse por la lista (con Mayús, ampliar la selección)'],
    ['Enter', 'Abrir en el mezclador'],
    ['Ctrl + Z', 'Deshacer lo último (mover, renombrar o borrar)'],
    ['Esc', 'Quitar la selección'],
    ['?', 'Mostrar esta ayuda'],
    ['Doble clic', 'Renombrar en el sitio (Enter guarda, Esc cancela)'],
    ['Clic derecho', 'Menú con todas las acciones'],
];

export default function SongsIndex({ songs, folders: initialFolders, sort, limits, uploadPrefs }: Props) {
    // ----- Datos locales (guardado optimista: se ve al instante y se guarda en segundo plano)
    const [items, setItems] = useState<Song[]>(songs);
    const [folders, setFolders] = useState<Folder[]>(initialFolders);
    useEffect(() => setItems(songs), [songs]);
    useEffect(() => setFolders(initialFolders), [initialFolders]);

    const liveSongs = useSongStatus(items);
    const anyProcessing = liveSongs.some((s) => s.status === 'processing');
    const [prefs, setPrefs] = useState<UploadPrefs>(uploadPrefs);

    // ----- Navegación
    const [view, setViewState] = useState<FolderView>(readView);
    const [treeOpen, setTreeOpen] = useState(false); // en móvil
    const setView = (v: FolderView) => {
        setViewState(v);
        setSelected(new Set());
        setTreeOpen(false);
        const url = new URL(window.location.href);
        if (v === 'all') url.searchParams.delete('carpeta');
        else url.searchParams.set('carpeta', v === 'none' ? 'sin' : String(v));
        window.history.replaceState(window.history.state, '', url);
    };
    useEffect(() => {
        if (typeof view === 'number' && !folders.some((f) => f.id === view)) setViewState('all');
    }, [folders, view]);

    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');

    // ----- Selección y edición
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [focusedId, setFocusedId] = useState<number | null>(null);
    const anchor = useRef<number | null>(null);
    const [editingSong, setEditingSong] = useState<number | null>(null);
    const [editingFolder, setEditingFolder] = useState<number | null>(null);
    const [moveTarget, setMoveTarget] = useState<{ kind: 'songs'; ids: number[] } | { kind: 'folder'; folder: Folder } | null>(null);
    const [confirm, setConfirm] = useState<{ kind: 'songs'; ids: number[] } | { kind: 'folder'; folder: Folder } | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);

    const reloadSongs = useCallback(() => router.reload({ only: ['songs', 'folders'] }), []);

    // ----- Deshacer
    const undoStack = useRef<UndoEntry[]>([]);
    const undoId = useRef(1);
    const runUndo = useCallback(
        async (entry?: UndoEntry) => {
            const e = entry ?? undoStack.current[undoStack.current.length - 1];
            if (!e) return void toast('No hay nada que deshacer.');
            undoStack.current = undoStack.current.filter((x) => x.id !== e.id);
            try {
                await e.run();
                toast.success(`Deshecho: ${e.label.charAt(0).toLowerCase()}${e.label.slice(1)}`);
            } catch (err) {
                toast.error(errorText(err, 'No se pudo deshacer.'));
                reloadSongs();
            }
        },
        [reloadSongs],
    );
    const pushUndo = (label: string, run: () => Promise<void>) => {
        const entry = { id: undoId.current++, label, run };
        undoStack.current = [...undoStack.current.slice(-19), entry];
        toast.success(label, { action: { label: 'Deshacer', onClick: () => void runUndo(entry) }, duration: 8000 });
    };

    // ----- Lista visible: búsqueda en TODAS las carpetas; si no, la carpeta abierta. Luego el filtro rápido.
    const searching = query.trim() !== '';
    const visible = useMemo(() => {
        const q = normalize(query.trim());
        const test = FILTERS.find((f) => f.value === filter)!.test;
        return liveSongs.filter((s) => {
            if (q) {
                const text = `${s.title} ${s.original_name} ${statusLabel(s.status)} ${chordsLabel(s.chords_status, s.chords_key) ?? ''} ${pathLabel(folders, s.folder_id)}`;
                if (!normalize(text).includes(q)) return false;
            } else if (view === 'none' && s.folder_id !== null) return false;
            else if (typeof view === 'number' && s.folder_id !== view) return false;
            return test(s);
        });
    }, [liveSongs, query, filter, view, folders]);
    const inView = useMemo(
        () => liveSongs.filter((s) => searching || view === 'all' || (view === 'none' ? s.folder_id === null : s.folder_id === view)),
        [liveSongs, view, searching],
    );

    useEffect(() => {
        const ids = new Set(items.map((s) => s.id));
        setSelected((sel) => ([...sel].every((id) => ids.has(id)) ? sel : new Set([...sel].filter((id) => ids.has(id)))));
    }, [items]);

    const withoutChords = liveSongs.filter((s) => !s.chords_status || s.chords_status === 'failed' || s.chords_status === 'canceled').length;

    // ====================== Acciones (optimistas, con Deshacer) ======================

    const savePrefs = async (patch: Partial<UploadPrefs>, okMessage?: string) => {
        const before = prefs;
        setPrefs({ ...prefs, ...patch });
        try {
            const { data } = await axios.patch<UploadPrefs>(route('preferences.upload'), patch, json);
            setPrefs(data);
            if (okMessage) toast.success(okMessage);
        } catch (err) {
            setPrefs(before);
            toast.error(errorText(err, 'No se pudo guardar la preferencia.'));
        }
    };

    const renameSong = async (song: Song, title: string, undoable = true) => {
        const before = song.title;
        setItems((list) => list.map((s) => (s.id === song.id ? { ...s, title } : s)));
        try {
            await axios.patch(route('songs.update', song.id), { title }, json);
            if (undoable) pushUndo(`Renombrada a «${title}»`, () => renameSong({ ...song, title }, before, false));
        } catch (err) {
            setItems((list) => list.map((s) => (s.id === song.id ? { ...s, title: before } : s)));
            toast.error(errorText(err, 'No se pudo renombrar.'));
            if (!undoable) throw err;
        }
    };

    const moveSongs = async (ids: number[], folderId: number | null, undoable = true) => {
        const prev = new Map(items.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.folder_id]));
        const moving = ids.filter((id) => prev.get(id) !== folderId);
        if (!moving.length) return;
        setItems((list) => list.map((s) => (moving.includes(s.id) ? { ...s, folder_id: folderId } : s)));
        try {
            const { data } = await axios.post<{ folders: Folder[] }>(route('songs.move'), { song_ids: moving, folder_id: folderId }, json);
            setFolders(data.folders);
            setSelected(new Set());
            if (undoable) {
                const dest = pathLabel(folders, folderId);
                pushUndo(moving.length === 1 ? `Movida a «${dest}»` : `${moving.length} canciones movidas a «${dest}»`, async () => {
                    const groups = new Map<number | null, number[]>();
                    for (const id of moving) groups.set(prev.get(id) ?? null, [...(groups.get(prev.get(id) ?? null) ?? []), id]);
                    for (const [fid, gids] of groups) await moveSongs(gids, fid, false);
                });
            }
        } catch (err) {
            setItems((list) => list.map((s) => (prev.has(s.id) ? { ...s, folder_id: prev.get(s.id) ?? null } : s)));
            toast.error(errorText(err, 'No se pudieron mover.'));
            if (!undoable) throw err;
        }
    };

    const deleteSongs = async (ids: number[]) => {
        const removed = items.filter((s) => ids.includes(s.id));
        setItems((list) => list.filter((s) => !ids.includes(s.id)));
        setSelected(new Set());
        try {
            let done = ids;
            let message = '';
            if (ids.length === 1) await axios.delete(route('songs.destroy', ids[0]), json);
            else {
                const { data } = await axios.post<{ done: number[]; skipped: number; message: string }>(
                    route('songs.bulk'),
                    { action: 'delete', song_ids: ids },
                    json,
                );
                done = data.done;
                if (data.skipped) message = data.message;
            }
            // Las que no se pudieron borrar (separándose) vuelven a la lista.
            const back = removed.filter((s) => !done.includes(s.id));
            if (back.length) setItems((list) => [...list, ...back]);
            if (message) toast.warning(message);
            if (!done.length) return;
            const title = removed.find((s) => s.id === done[0])?.title;
            pushUndo(done.length === 1 ? `Se borró «${title}»` : `Se borraron ${done.length} canciones`, async () => {
                await axios.post(route('songs.restore'), { song_ids: done }, json);
                setItems((list) => [...list, ...removed.filter((s) => done.includes(s.id))]);
                reloadSongs();
            });
        } catch (err) {
            setItems((list) => [...list, ...removed.filter((r) => !list.some((s) => s.id === r.id))]);
            toast.error(errorText(err, 'No se pudo borrar.'));
        }
    };

    const bulk = async (action: 'separate' | 'chords', ids: number[]) => {
        setBulkBusy(true);
        try {
            const { data } = await axios.post<{ message: string }>(route('songs.bulk'), { action, song_ids: ids }, json);
            toast.success(data.message);
            reloadSongs();
        } catch (err) {
            toast.error(errorText(err, 'No se pudo completar la acción.'));
        } finally {
            setBulkBusy(false);
        }
    };

    const analyzeMissing = async () => {
        setBulkBusy(true);
        try {
            const { data } = await axios.post<{ message: string }>(route('songs.chords.missing'), {}, json);
            toast.success(data.message);
            reloadSongs();
        } catch (err) {
            toast.error(errorText(err, 'No se pudo poner en cola.'));
        } finally {
            setBulkBusy(false);
        }
    };

    // ----- Carpetas
    const createFolder = async (parentId: number | null, name?: string): Promise<number | null> => {
        try {
            const { data } = await axios.post<{ folder: Folder; folders: Folder[] }>(route('folders.store'), { parent_id: parentId, name }, json);
            setFolders(data.folders);
            if (!name) setEditingFolder(data.folder.id); // "Nueva carpeta" con el nombre listo para escribir encima
            return data.folder.id;
        } catch (err) {
            toast.error(errorText(err, 'No se pudo crear la carpeta.'));
            return null;
        }
    };

    const patchFolder = async (id: number, patch: Partial<Pick<Folder, 'name' | 'color' | 'note'>>, undoLabel?: string) => {
        const before = folders.find((f) => f.id === id);
        if (!before) return;
        setFolders((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
        try {
            await axios.patch(route('folders.update', id), patch, json);
            if (undoLabel) {
                const old = { name: before.name, color: before.color, note: before.note };
                pushUndo(undoLabel, () => patchFolder(id, Object.fromEntries(Object.keys(patch).map((k) => [k, old[k as keyof typeof old]]))));
            }
        } catch (err) {
            setFolders((list) => list.map((f) => (f.id === id ? before : f)));
            toast.error(errorText(err, 'No se pudo guardar la carpeta.'));
        }
    };

    const moveFolder = async (id: number, parentId: number | null, position?: number, undoable = true) => {
        const folder = folders.find((f) => f.id === id);
        if (!folder) return;
        if (!canNest(folders, id, parentId)) {
            toast.error(
                subtreeIds(folders, id).has(parentId ?? -1)
                    ? 'Una carpeta no puede ir dentro de sí misma ni de una de sus subcarpetas.'
                    : 'Las carpetas pueden tener como máximo 3 niveles.',
            );
            return;
        }
        const oldIndex = childrenOf(folders, folder.parent_id).findIndex((f) => f.id === id);
        try {
            const { data } = await axios.post<{ folders: Folder[] }>(route('folders.move', id), { parent_id: parentId, position }, json);
            setFolders(data.folders);
            if (undoable && (folder.parent_id !== parentId || position !== oldIndex)) {
                pushUndo(`Carpeta «${folder.name}» movida`, () => moveFolder(id, folder.parent_id, oldIndex, false));
            }
        } catch (err) {
            toast.error(errorText(err, 'No se pudo mover la carpeta.'));
        }
    };

    const deleteFolder = async (folder: Folder) => {
        try {
            const { data } = await axios.delete<{ moved_songs: number[]; moved_folders: number[]; folders: Folder[] }>(
                route('folders.destroy', folder.id),
                json,
            );
            setFolders(data.folders);
            setItems((list) => list.map((s) => (data.moved_songs.includes(s.id) ? { ...s, folder_id: folder.parent_id } : s)));
            if (view === folder.id) setView(folder.parent_id ?? 'none');
            pushUndo(`Se borró la carpeta «${folder.name}» (sus canciones siguen)`, async () => {
                const { data: r } = await axios.post<{ folders: Folder[] }>(
                    route('folders.restore', folder.id),
                    { song_ids: data.moved_songs, folder_ids: data.moved_folders },
                    json,
                );
                setFolders(r.folders);
                setItems((list) => list.map((s) => (data.moved_songs.includes(s.id) ? { ...s, folder_id: folder.id } : s)));
            });
        } catch (err) {
            toast.error(errorText(err, 'No se pudo borrar la carpeta.'));
        }
    };

    // ====================== Selección ======================

    const onRowClick = (song: Song, e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, a, input, [role=checkbox]')) return;
        const idx = visible.findIndex((s) => s.id === song.id);
        setFocusedId(song.id);
        if (e.shiftKey && anchor.current !== null) {
            const a = visible.findIndex((s) => s.id === anchor.current);
            const [from, to] = a < idx ? [a, idx] : [idx, a];
            setSelected(new Set(visible.slice(from, to + 1).map((s) => s.id)));
        } else if (e.ctrlKey || e.metaKey) {
            setSelected((sel) => {
                const n = new Set(sel);
                if (n.has(song.id)) n.delete(song.id);
                else n.add(song.id);
                return n;
            });
            anchor.current = song.id;
        } else {
            setSelected(new Set([song.id]));
            anchor.current = song.id;
        }
    };
    const toggle = (id: number) => {
        anchor.current = id;
        setFocusedId(id);
        setSelected((sel) => {
            const n = new Set(sel);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    };
    /** Sobre qué canciones actúa un menú: la selección si la fila está en ella; si no, solo esa. */
    const targetIds = (song: Song) => (selected.has(song.id) && selected.size > 1 ? [...selected] : [song.id]);

    // ====================== Atajos de teclado ======================

    const stateRef = useRef({ visible, selected, focusedId, editingSong, editingFolder });
    stateRef.current = { visible, selected, focusedId, editingSong, editingFolder };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isTyping(e.target) || document.querySelector('[role=dialog], [role=menu]')) return;
            const { visible: vis, selected: sel, focusedId: foc } = stateRef.current;
            const single = sel.size === 1 ? [...sel][0] : foc;
            if (e.key === '?') {
                e.preventDefault();
                setHelpOpen(true);
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                void runUndo();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setSelected(new Set(vis.map((s) => s.id)));
            } else if ((e.target as HTMLElement).closest?.('[role=tree]')) {
                return; // el árbol de carpetas tiene sus propias teclas
            } else if (e.key === 'F2' && single) {
                e.preventDefault();
                setEditingSong(single);
            } else if (e.key === 'Delete' && sel.size) {
                e.preventDefault();
                setConfirm({ kind: 'songs', ids: [...sel] });
            } else if (e.key === 'Enter' && single) {
                e.preventDefault();
                router.visit(route('songs.show', single));
            } else if (e.key === 'Escape') {
                setSelected(new Set());
            } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && vis.length) {
                e.preventDefault();
                const cur = vis.findIndex((s) => s.id === foc);
                const next = vis[Math.max(0, Math.min(vis.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))] ?? vis[0];
                setFocusedId(next.id);
                if (e.shiftKey) setSelected((s) => new Set(s).add(next.id));
                else {
                    setSelected(new Set([next.id]));
                    anchor.current = next.id;
                }
                document.querySelector(`[data-song-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [runUndo]);

    // ====================== Arrastrar y soltar ======================

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
        useSensor(KeyboardSensor),
    );
    /**
     * Destino bajo el puntero, con la posición REAL de cada carpeta en este
     * momento (getBoundingClientRect). La detección estándar de dnd-kit corrige
     * el desplazamiento de la página y falla con la barra de carpetas "sticky"
     * (se soltaba en otra carpeta). Con teclado no hay puntero: la estándar.
     */
    const collision: CollisionDetection = (args) => {
        const p = args.pointerCoordinates;
        if (!p) return rectIntersection(args);
        const hits = args.droppableContainers
            .map((c) => ({ c, r: c.node.current?.getBoundingClientRect() }))
            .filter(({ r }) => r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom)
            .sort((a, b) => a.r!.width * a.r!.height - b.r!.width * b.r!.height) // la más concreta primero
            .map(({ c, r }) => ({ id: c.id, data: { droppableContainer: c, value: r!.width * r!.height } }));
        return hits.length ? hits : pointerWithin(args);
    };
    const [drag, setDrag] = useState<{ kind: 'song' | 'folder'; id: number; count: number; label: string } | null>(null);

    const onDragStart = (e: DragStartEvent) => {
        const data = e.active.data.current as { kind: 'song' | 'folder'; id: number };
        if (data.kind === 'song') {
            const ids = selected.has(data.id) ? [...selected] : [data.id];
            if (!selected.has(data.id)) setSelected(new Set([data.id]));
            setDrag({ kind: 'song', id: data.id, count: ids.length, label: items.find((s) => s.id === data.id)?.title ?? '' });
        } else {
            setDrag({ kind: 'folder', id: data.id, count: 1, label: folders.find((f) => f.id === data.id)?.name ?? '' });
        }
    };

    const onDragEnd = (e: DragEndEvent) => {
        const d = drag;
        setDrag(null);
        const overId = e.over?.id ? String(e.over.id) : null;
        if (!d || !overId) return;
        if (d.kind === 'song') {
            const ids = selected.has(d.id) ? [...selected] : [d.id];
            if (overId === 'into:none') void moveSongs(ids, null);
            else if (overId.startsWith('into:')) void moveSongs(ids, Number(overId.slice(5)));
        } else {
            if (overId === 'into:none') void moveFolder(d.id, null);
            else if (overId.startsWith('into:')) {
                const target = Number(overId.slice(5));
                if (target !== d.id) void moveFolder(d.id, target);
            } else if (overId.startsWith('gap:')) {
                const [, p, i] = overId.split(':');
                const parent = p === 'root' ? null : Number(p);
                let index = Number(i);
                const folder = folders.find((f) => f.id === d.id)!;
                if (folder.parent_id === parent) {
                    const old = childrenOf(folders, parent).findIndex((f) => f.id === d.id);
                    if (old < index) index--;
                }
                void moveFolder(d.id, parent, index);
            }
        }
    };

    // ====================== Menús ======================

    const songActions = (song: LiveSong): RowAction[] => {
        const ids = targetIds(song);
        const many = ids.length > 1;
        const chordsMissing = !song.chords_status || song.chords_status === 'failed' || song.chords_status === 'canceled';
        const list: RowAction[] = [];
        if (!many)
            list.push({
                key: 'open',
                label: 'Abrir en el mezclador',
                icon: <SlidersHorizontal />,
                shortcut: 'Enter',
                onSelect: () => router.visit(route('songs.show', song.id)),
            });
        if (!many) list.push({ key: 'rename', label: 'Renombrar', icon: <Pencil />, shortcut: 'F2', onSelect: () => setEditingSong(song.id) });
        list.push({
            key: 'move',
            label: many ? `Mover ${ids.length} canciones a…` : 'Mover a…',
            icon: <FolderInput />,
            onSelect: () => setMoveTarget({ kind: 'songs', ids }),
        });
        if (many || song.status === 'none' || song.status === 'failed' || song.status === 'canceled')
            list.push({
                key: 'sep',
                label: many ? 'Separar pistas' : song.status === 'none' ? 'Separar pistas' : 'Reintentar separación',
                icon: <Layers />,
                separated: true,
                onSelect: () => void bulk('separate', ids),
            });
        if (many || chordsMissing)
            list.push({
                key: 'chords',
                label: 'Detectar acordes',
                icon: <Music2 />,
                separated: !list.some((a) => a.key === 'sep'),
                onSelect: () => void bulk('chords', ids),
            });
        if (!many && song.can_improve_chords)
            list.push({
                key: 'improve',
                label: 'Mejorar acordes con pistas separadas',
                icon: <Sparkles />,
                onSelect: () => void bulk('chords', ids),
            });
        if (!many)
            list.push({
                key: 'download',
                label: 'Descargar original',
                icon: <Download />,
                separated: true,
                onSelect: () => (window.location.href = route('songs.download', song.id)),
            });
        list.push({
            key: 'delete',
            label: many ? `Borrar ${ids.length} canciones` : 'Borrar',
            icon: <Trash2 />,
            danger: true,
            shortcut: 'Supr',
            separated: many,
            disabled: !many && (song.status === 'processing' || song.chords_status === 'processing'),
            onSelect: () => setConfirm({ kind: 'songs', ids }),
        });
        return list;
    };

    // ====================== Vista ======================

    const currentFolder = typeof view === 'number' ? folders.find((f) => f.id === view) : undefined;
    const allCount = items.length;
    const noneCount = items.filter((s) => s.folder_id === null).length;

    const tree = (
        <FolderTree
            folders={folders}
            view={view}
            allCount={allCount}
            noneCount={noneCount}
            editingId={editingFolder}
            setEditingId={setEditingFolder}
            dragging={drag?.kind ?? null}
            onSelect={setView}
            onRename={(id, name) => {
                // Poner nombre a una carpeta recién creada no es "renombrar": sin aviso de deshacer.
                const isNew = folders.find((f) => f.id === id)?.name === 'Nueva carpeta';
                void patchFolder(id, { name }, isNew ? undefined : `Carpeta renombrada a «${name}»`);
            }}
            onNote={(id, note) => patchFolder(id, { note: note || null })}
            onColor={(id, color: FolderColor | null) => patchFolder(id, { color })}
            onCreate={(parentId) => void createFolder(parentId)}
            onDelete={(folder) => setConfirm({ kind: 'folder', folder })}
            onMove={(folder) => setMoveTarget({ kind: 'folder', folder })}
        />
    );

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Canciones" />
            <DndContext
                sensors={sensors}
                collisionDetection={collision}
                /* La barra de carpetas es "sticky": si la página se desplaza durante el arrastre,
                   hay que volver a medir los destinos en cada movimiento (si no, se suelta en la carpeta equivocada). */
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setDrag(null)}
            >
                <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 p-4">
                    {/* Árbol de carpetas (barra lateral en pantallas medianas y grandes) */}
                    <aside className="hidden w-60 shrink-0 md:block">
                        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">{tree}</div>
                    </aside>

                    <div className="flex min-w-0 flex-1 flex-col gap-5">
                        <header className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-2xl font-semibold">Canciones</h1>
                                    <p className="text-muted-foreground mt-1">
                                        Para cada subida eliges si <strong className="text-foreground">separar las pistas</strong> o{' '}
                                        <strong className="text-foreground">solo subirla</strong>. Ordénalas en carpetas arrastrándolas.
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setHelpOpen(true)}
                                    title="Atajos de teclado (?)"
                                    className="shrink-0"
                                >
                                    <Keyboard /> <span className="hidden sm:inline">Atajos</span>
                                </Button>
                            </div>
                            <div className="bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                                <Label htmlFor="chords-auto" className="cursor-pointer leading-snug">
                                    Detectar acordes automáticamente en canciones nuevas
                                    <span className="text-muted-foreground block text-xs font-normal">
                                        Si está desactivado, puedes activarlo en cada subida o detectarlos después en cada canción.
                                    </span>
                                </Label>
                                <Switch
                                    id="chords-auto"
                                    checked={prefs.chords_auto}
                                    onCheckedChange={(v) =>
                                        savePrefs(
                                            { chords_auto: v },
                                            v ? 'Las canciones nuevas detectarán sus acordes.' : 'Las canciones nuevas no detectarán acordes.',
                                        )
                                    }
                                />
                            </div>
                        </header>

                        <UploadDropzone
                            limits={limits}
                            prefs={prefs}
                            onRemember={(p) => savePrefs(p, 'Elección recordada. Puedes cambiarla en Configuración.')}
                            onUploaded={reloadSongs}
                            folders={folders}
                            currentFolderId={typeof view === 'number' ? view : null}
                            onCreateFolder={(name) => createFolder(typeof view === 'number' ? view : null, name)}
                        />

                        <section aria-labelledby="mis-canciones" className="space-y-3">
                            {/* Carpetas en móvil */}
                            <div className="md:hidden">
                                <Button variant="outline" size="sm" onClick={() => setTreeOpen((o) => !o)} aria-expanded={treeOpen}>
                                    <FolderTreeIcon /> Carpetas
                                </Button>
                                {treeOpen && <div className="bg-card mt-2 rounded-lg border p-2">{tree}</div>}
                            </div>

                            {/* Ruta: Metal › Satriani › Surfing */}
                            <nav aria-label="Ruta de la carpeta" className="flex flex-wrap items-center gap-1 text-sm">
                                <button type="button" onClick={() => setView('all')} className="text-muted-foreground hover:text-foreground">
                                    Canciones
                                </button>
                                {view === 'none' && (
                                    <>
                                        <ChevronRight className="text-muted-foreground size-3.5" />
                                        <span className="font-medium">Sin carpeta</span>
                                    </>
                                )}
                                {typeof view === 'number' &&
                                    pathOf(folders, view).map((f, i, arr) => (
                                        <span key={f.id} className="flex items-center gap-1">
                                            <ChevronRight className="text-muted-foreground size-3.5" />
                                            {i === arr.length - 1 ? (
                                                <span className="font-medium">{f.name}</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setView(f.id)}
                                                    className="text-muted-foreground hover:text-foreground"
                                                >
                                                    {f.name}
                                                </button>
                                            )}
                                        </span>
                                    ))}
                            </nav>
                            {currentFolder?.note && <p className="text-muted-foreground -mt-2 text-sm italic">{currentFolder.note}</p>}

                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <h2 id="mis-canciones" className="flex items-center gap-2 text-lg font-semibold">
                                    {searching
                                        ? 'Resultados en todas las carpetas'
                                        : view === 'all'
                                          ? 'Todas las canciones'
                                          : view === 'none'
                                            ? 'Sin carpeta'
                                            : currentFolder?.name}
                                    <span className="text-muted-foreground font-normal">({searching ? visible.length : inView.length})</span>
                                </h2>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={analyzeMissing} disabled={bulkBusy || withoutChords === 0}>
                                        <Music2 /> Detectar acordes en las que no tienen{withoutChords ? ` (${withoutChords})` : ''}
                                    </Button>
                                    <div className="relative">
                                        <Search
                                            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                                            aria-hidden
                                        />
                                        <Input
                                            type="search"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="Buscar en todas las carpetas…"
                                            aria-label="Buscar canción en todas las carpetas"
                                            className="w-56 pl-8 sm:w-64"
                                        />
                                    </div>
                                    <label className="text-muted-foreground flex items-center gap-2 text-sm">
                                        Ordenar
                                        <select
                                            value={sort}
                                            onChange={(e) =>
                                                router.patch(
                                                    route('preferences.sort'),
                                                    { songs_sort: e.target.value },
                                                    { preserveScroll: true, only: ['songs', 'sort'] },
                                                )
                                            }
                                            className="border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm"
                                        >
                                            <option value="recent">Más recientes</option>
                                            <option value="title">Por título</option>
                                            <option value="status">Por estado</option>
                                        </select>
                                    </label>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar canciones">
                                {FILTERS.map((f) => (
                                    <button
                                        key={f.value}
                                        type="button"
                                        aria-pressed={filter === f.value}
                                        onClick={() => setFilter(f.value)}
                                        className={cn(
                                            'focus-visible:ring-ring rounded-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none',
                                            filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
                                        )}
                                    >
                                        {f.label} <span className="opacity-70">{inView.filter(f.test).length}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Barra de acciones con selección */}
                            {selected.size > 0 && (
                                <div
                                    className="bg-primary text-primary-foreground sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-md"
                                    role="toolbar"
                                    aria-label="Acciones con la selección"
                                >
                                    <span className="font-medium">
                                        {selected.size} {selected.size === 1 ? 'seleccionada' : 'seleccionadas'}
                                    </span>
                                    <Button size="sm" variant="secondary" onClick={() => setMoveTarget({ kind: 'songs', ids: [...selected] })}>
                                        <FolderInput /> Mover a…
                                    </Button>
                                    <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulk('separate', [...selected])}>
                                        <Layers /> Separar
                                    </Button>
                                    <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulk('chords', [...selected])}>
                                        <Music2 /> Detectar acordes
                                    </Button>
                                    <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'songs', ids: [...selected] })}>
                                        <Trash2 /> Borrar
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="hover:bg-primary-foreground/15 ml-auto"
                                        onClick={() => setSelected(new Set())}
                                    >
                                        <X /> Quitar selección
                                    </Button>
                                </div>
                            )}

                            {visible.length === 0 ? (
                                <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
                                    <FolderIcon className="size-8" aria-hidden />
                                    <p>
                                        {searching
                                            ? `Ninguna canción coincide con «${query}».`
                                            : filter !== 'all'
                                              ? 'Ninguna canción en este filtro.'
                                              : typeof view === 'number'
                                                ? 'Esta carpeta está vacía. Arrastra canciones hasta ella en el árbol o sube nuevas aquí.'
                                                : 'Aún no hay canciones aquí.'}
                                    </p>
                                </div>
                            ) : (
                                <ul
                                    className="divide-border bg-card divide-y overflow-hidden rounded-xl border"
                                    aria-multiselectable
                                    aria-label="Canciones"
                                >
                                    {visible.map((song) => (
                                        <SongRow
                                            key={song.id}
                                            song={song}
                                            selected={selected.has(song.id)}
                                            focused={focusedId === song.id}
                                            editing={editingSong === song.id}
                                            setEditing={(e) => setEditingSong(e ? song.id : null)}
                                            onRename={(title) => void renameSong(song, title)}
                                            onRowClick={(e) => onRowClick(song, e)}
                                            onToggle={() => toggle(song.id)}
                                            onContext={() => {
                                                if (!selected.has(song.id)) setSelected(new Set([song.id]));
                                                setFocusedId(song.id);
                                            }}
                                            actions={songActions(song)}
                                            folderLabel={
                                                (searching || view === 'all') && song.folder_id !== null ? pathLabel(folders, song.folder_id) : null
                                            }
                                            details={<SongStatusDetails song={song} anyProcessing={anyProcessing} onRetried={reloadSongs} />}
                                        />
                                    ))}
                                </ul>
                            )}
                            <p className="text-muted-foreground text-xs">
                                Consejo: arrastra canciones (o varias, con Ctrl + clic) hasta una carpeta del árbol. Pulsa{' '}
                                <kbd className="rounded border px-1">?</kbd> para ver todos los atajos.
                            </p>
                        </section>
                    </div>
                </div>

                <DragOverlay dropAnimation={null}>
                    {drag && (
                        <div className="bg-primary text-primary-foreground flex max-w-xs items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium shadow-lg">
                            {drag.kind === 'folder' ? <FolderIcon className="size-4" /> : <Music2 className="size-4" />}
                            <span className="truncate">{drag.kind === 'song' && drag.count > 1 ? `${drag.count} canciones` : drag.label}</span>
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            <MoveDialog
                open={moveTarget !== null}
                title={
                    moveTarget?.kind === 'folder'
                        ? `Mover la carpeta «${moveTarget.folder.name}» a…`
                        : moveTarget && moveTarget.ids.length > 1
                          ? `Mover ${moveTarget.ids.length} canciones a…`
                          : 'Mover la canción a…'
                }
                folders={folders}
                disabledIds={moveTarget?.kind === 'folder' ? subtreeIds(folders, moveTarget.folder.id) : undefined}
                rootLabel={moveTarget?.kind === 'folder' ? 'Raíz (sin carpeta superior)' : 'Sin carpeta'}
                onClose={() => setMoveTarget(null)}
                onChoose={(folderId) => {
                    const t = moveTarget;
                    setMoveTarget(null);
                    if (t?.kind === 'songs') void moveSongs(t.ids, folderId);
                    else if (t?.kind === 'folder') void moveFolder(t.folder.id, folderId);
                }}
            />

            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={(open) => !open && setConfirm(null)}
                title={
                    confirm?.kind === 'folder'
                        ? '¿Borrar esta carpeta?'
                        : confirm && confirm.ids.length > 1
                          ? `¿Borrar ${confirm.ids.length} canciones?`
                          : '¿Borrar esta canción?'
                }
                description={
                    confirm?.kind === 'folder' ? (
                        <>
                            Se borrará la carpeta <strong>«{confirm.folder.name}»</strong>, pero <strong>no sus canciones</strong>: ellas y sus
                            subcarpetas pasarán a {confirm.folder.parent_id ? `«${pathLabel(folders, confirm.folder.parent_id)}»` : '«Sin carpeta»'}.
                            Podrás deshacerlo.
                        </>
                    ) : confirm ? (
                        <>
                            Se borrará{confirm.ids.length > 1 ? 'n' : ''}{' '}
                            <strong>
                                {confirm.ids.length > 1
                                    ? `${confirm.ids.length} canciones`
                                    : `«${items.find((s) => s.id === confirm.ids[0])?.title}»`}
                            </strong>{' '}
                            con su original, pistas, acordes y ajustes. Durante un minuto podrás deshacerlo.
                        </>
                    ) : null
                }
                confirmLabel={confirm?.kind === 'folder' ? 'Borrar carpeta' : 'Borrar'}
                destructive
                onConfirm={() => {
                    const c = confirm;
                    setConfirm(null);
                    if (c?.kind === 'folder') void deleteFolder(c.folder);
                    else if (c) void deleteSongs(c.ids);
                }}
            />

            <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Atajos de teclado</DialogTitle>
                        <DialogDescription>En la lista de canciones (fuera de los campos de texto).</DialogDescription>
                    </DialogHeader>
                    <table className="w-full text-sm">
                        <tbody>
                            {SHORTCUTS.map(([k, v]) => (
                                <tr key={k} className="border-b last:border-0">
                                    <td className="py-1.5 pr-3 whitespace-nowrap">
                                        <kbd className="bg-muted rounded border px-1.5 py-0.5 font-sans text-xs">{k}</kbd>
                                    </td>
                                    <td className="text-muted-foreground py-1.5">{v}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-muted-foreground text-xs">
                        En el árbol de carpetas: Enter abre, F2 renombra, Supr borra y ← → pliegan o despliegan.
                    </p>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
