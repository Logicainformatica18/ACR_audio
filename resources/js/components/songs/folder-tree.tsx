import { InlineEdit } from '@/components/inline-edit';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { childrenOf, colorDot, depthOf, FOLDER_COLORS, MAX_DEPTH, type Folder, type FolderColor, type FolderView } from '@/lib/folders';
import { cn } from '@/lib/utils';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight, FolderIcon, FolderInput, FolderPlus, Inbox, Library, Palette, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface FolderTreeActions {
    onSelect: (view: FolderView) => void;
    onRename: (id: number, name: string) => void;
    onNote: (id: number, note: string) => void;
    onColor: (id: number, color: FolderColor | null) => void;
    onCreate: (parentId: number | null) => void;
    onDelete: (folder: Folder) => void;
    onMove: (folder: Folder) => void;
}

interface Props extends FolderTreeActions {
    folders: Folder[];
    view: FolderView;
    allCount: number;
    noneCount: number;
    /** Carpeta con el nombre en edición (por ejemplo, recién creada). */
    editingId: number | null;
    setEditingId: (id: number | null) => void;
    /** Qué se está arrastrando: muestra los huecos para reordenar carpetas. */
    dragging: 'song' | 'folder' | null;
}

const COLLAPSED_KEY = 'acr.folders.collapsed';

function readCollapsed(): Set<number> {
    try {
        return new Set(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
    } catch {
        return new Set();
    }
}

/** Árbol de carpetas con contadores, plegable, con arrastrar y soltar y edición en línea. */
export function FolderTree(props: Props) {
    const { folders, view, allCount, noneCount, onSelect, onCreate, dragging } = props;
    const [collapsed, setCollapsed] = useState<Set<number>>(readCollapsed);

    useEffect(() => {
        try {
            window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
        } catch {
            /* sin almacenamiento: solo dura esta visita */
        }
    }, [collapsed]);

    const toggle = (id: number) =>
        setCollapsed((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    return (
        <nav aria-label="Carpetas" className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Carpetas</span>
                <button
                    type="button"
                    onClick={() => onCreate(typeof view === 'number' && depthOf(folders, view) < MAX_DEPTH ? view : null)}
                    className="hover:bg-muted focus-visible:ring-ring flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                    title={typeof view === 'number' ? 'Nueva subcarpeta dentro de la carpeta abierta' : 'Nueva carpeta'}
                >
                    <FolderPlus className="size-3.5" /> Carpeta
                </button>
            </div>

            <RootItem
                label="Todas las canciones"
                icon={<Library className="size-4" />}
                count={allCount}
                active={view === 'all'}
                onClick={() => onSelect('all')}
            />
            <RootItem
                label="Sin carpeta"
                icon={<Inbox className="size-4" />}
                count={noneCount}
                active={view === 'none'}
                onClick={() => onSelect('none')}
                dropId="into:none"
                dropHint={dragging === 'folder' ? 'Sacar a la raíz' : undefined}
            />

            <ul role="tree" aria-label="Árbol de carpetas" className="space-y-0.5">
                <Level {...props} parentId={null} depth={1} collapsed={collapsed} toggle={toggle} />
            </ul>
            {folders.length === 0 && (
                <p className="text-muted-foreground px-2 pt-1 text-xs">
                    Crea carpetas para ordenar por álbum, estilo o artista. Arrastra canciones encima para moverlas.
                </p>
            )}
        </nav>
    );
}

function RootItem({
    label,
    icon,
    count,
    active,
    onClick,
    dropId,
    dropHint,
}: {
    label: string;
    icon: React.ReactNode;
    count: number;
    active: boolean;
    onClick: () => void;
    dropId?: string;
    dropHint?: string;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `noop:${label}`, disabled: !dropId });
    return (
        <button
            ref={setNodeRef}
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none',
                active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted',
                isOver && 'bg-primary/15 ring-primary ring-2',
            )}
        >
            {icon}
            <span className="flex-1 truncate">{isOver && dropHint ? dropHint : label}</span>
            <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
        </button>
    );
}

interface LevelProps extends Props {
    parentId: number | null;
    depth: number;
    collapsed: Set<number>;
    toggle: (id: number) => void;
}

function Level(props: LevelProps) {
    const { folders, parentId, dragging } = props;
    const kids = childrenOf(folders, parentId);
    return (
        <>
            {kids.map((f, i) => (
                <li key={f.id} role="none">
                    {dragging === 'folder' && <Gap parentId={parentId} index={i} depth={props.depth} />}
                    <FolderItem {...props} folder={f} />
                </li>
            ))}
            {dragging === 'folder' && kids.length > 0 && <Gap parentId={parentId} index={kids.length} depth={props.depth} />}
        </>
    );
}

/** Hueco entre carpetas hermanas: soltar aquí reordena. */
function Gap({ parentId, index, depth }: { parentId: number | null; index: number; depth: number }) {
    const { setNodeRef, isOver } = useDroppable({ id: `gap:${parentId ?? 'root'}:${index}` });
    return (
        <div ref={setNodeRef} className="h-2" style={{ marginLeft: `${(depth - 1) * 0.9 + 0.5}rem` }} aria-hidden>
            <div className={cn('mt-0.5 h-0.5 rounded-full', isOver ? 'bg-primary' : 'bg-transparent')} />
        </div>
    );
}

function FolderItem(props: LevelProps & { folder: Folder }) {
    const {
        folder: f,
        folders,
        view,
        depth,
        collapsed,
        toggle,
        editingId,
        setEditingId,
        onSelect,
        onRename,
        onNote,
        onColor,
        onCreate,
        onDelete,
        onMove,
    } = props;
    const [editingNote, setEditingNote] = useState(false);
    const hasKids = folders.some((x) => x.parent_id === f.id);
    const open = !collapsed.has(f.id);
    const active = view === f.id;
    const dot = colorDot(f.color);

    const drag = useDraggable({ id: `folder:${f.id}`, data: { kind: 'folder', id: f.id } });
    const drop = useDroppable({ id: `into:${f.id}`, data: { kind: 'folder', id: f.id } });
    const isOver = drop.isOver && !drag.isDragging;

    return (
        <>
            {/* modal={false}: si un elemento abre una ventana (Borrar), la página no queda bloqueada al cerrarla */}
            <ContextMenu modal={false}>
                <ContextMenuTrigger asChild>
                    <div
                        ref={(el) => {
                            drag.setNodeRef(el);
                            drop.setNodeRef(el);
                        }}
                        {...drag.attributes}
                        {...drag.listeners}
                        role="treeitem"
                        aria-selected={active}
                        aria-expanded={hasKids ? open : undefined}
                        aria-level={depth}
                        tabIndex={0}
                        onClick={() => onSelect(f.id)}
                        onKeyDown={(e) => {
                            if (editingId === f.id) return;
                            if (e.key === 'Enter') onSelect(f.id);
                            else if (e.key === 'F2') {
                                e.preventDefault();
                                setEditingId(f.id);
                            } else if (e.key === 'Delete') onDelete(f);
                            else if (e.key === 'ArrowRight' && hasKids && !open) toggle(f.id);
                            else if (e.key === 'ArrowLeft' && hasKids && open) toggle(f.id);
                            else drag.listeners?.onKeyDown?.(e);
                        }}
                        className={cn(
                            'group focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 focus-visible:ring-2 focus-visible:outline-none',
                            active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted',
                            isOver && 'bg-primary/15 ring-primary ring-2',
                            drag.isDragging && 'opacity-40',
                        )}
                        style={{ paddingLeft: `${(depth - 1) * 0.9 + 0.25}rem` }}
                        title={f.note ? `${f.name} · ${f.note}` : f.name}
                    >
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label={open ? `Plegar ${f.name}` : `Desplegar ${f.name}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggle(f.id);
                            }}
                            className={cn('grid size-4 shrink-0 place-items-center rounded', !hasKids && 'invisible')}
                        >
                            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
                        </button>
                        <FolderIcon className="size-4 shrink-0" aria-hidden />
                        {dot && <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />}
                        <InlineEdit
                            value={f.name}
                            editing={editingId === f.id}
                            onEditingChange={(e) => setEditingId(e ? f.id : null)}
                            onSave={(name) => onRename(f.id, name)}
                            ariaLabel="Nombre de la carpeta"
                            maxLength={100}
                            className="min-w-0 flex-1 truncate"
                            inputClassName="w-full flex-1 text-sm"
                        />
                        <span className="text-muted-foreground text-xs tabular-nums">{f.songs_count}</span>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setEditingId(f.id)}>
                        <Pencil /> Renombrar <span className="text-muted-foreground ml-auto text-xs">F2</span>
                    </ContextMenuItem>
                    <ContextMenuItem disabled={depth >= MAX_DEPTH} onSelect={() => onCreate(f.id)}>
                        <FolderPlus /> Nueva subcarpeta
                    </ContextMenuItem>
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <Palette /> Color
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            {FOLDER_COLORS.map((c) => (
                                <ContextMenuItem key={c.value} onSelect={() => onColor(f.id, c.value)}>
                                    <span className={cn('size-3 rounded-full', c.dot)} aria-hidden /> {c.label}
                                    {f.color === c.value && <span className="ml-auto text-xs">✓</span>}
                                </ContextMenuItem>
                            ))}
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => onColor(f.id, null)}>Sin color</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onSelect={() => setEditingNote(true)}>
                        <StickyNote /> {f.note ? 'Editar nota' : 'Añadir nota'}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onMove(f)}>
                        <FolderInput /> Mover a…
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onDelete(f)} className="text-red-700 focus:text-red-700 dark:text-red-400">
                        <Trash2 /> Borrar carpeta <span className="ml-auto text-xs opacity-70">Supr</span>
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {(f.note || editingNote) && (
                <div className="text-muted-foreground truncate pr-2 pb-0.5 text-xs" style={{ paddingLeft: `${(depth - 1) * 0.9 + 2.6}rem` }}>
                    <InlineEdit
                        value={f.note ?? ''}
                        editing={editingNote}
                        onEditingChange={setEditingNote}
                        onSave={(note) => onNote(f.id, note)}
                        allowEmpty
                        ariaLabel="Nota de la carpeta"
                        maxLength={255}
                        className="block truncate italic"
                        inputClassName="w-full text-xs"
                    />
                </div>
            )}

            {hasKids && open && (
                <ul role="group" className="space-y-0.5">
                    <Level {...props} parentId={f.id} depth={depth + 1} />
                </ul>
            )}
        </>
    );
}
