import { InlineEdit } from '@/components/inline-edit';
import { ChordsBadge, StatusBadge } from '@/components/songs/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type LiveSong } from '@/types';
import { useDraggable } from '@dnd-kit/core';
import { Link } from '@inertiajs/react';
import { FolderIcon, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { type ReactNode } from 'react';

/** Una acción del menú de la canción (se usa igual en el menú ⋯ y en el clic derecho). */
export interface RowAction {
    key: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
    shortcut?: string;
    /** Línea separadora antes de esta acción. */
    separated?: boolean;
}

interface Props {
    song: LiveSong;
    selected: boolean;
    focused: boolean;
    editing: boolean;
    setEditing: (editing: boolean) => void;
    onRename: (title: string) => void;
    /** Clic en la fila (con Ctrl/Shift para selección múltiple). */
    onRowClick: (e: React.MouseEvent) => void;
    onToggle: () => void;
    /** Clic derecho: si la fila no estaba seleccionada, se selecciona sola. */
    onContext: () => void;
    actions: RowAction[];
    /** Carpeta donde está (se muestra al buscar en todas o fuera de su carpeta). */
    folderLabel: string | null;
    details?: ReactNode;
}

function renderItems(
    actions: RowAction[],
    Item: typeof ContextMenuItem | typeof DropdownMenuItem,
    Sep: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
) {
    return actions.map((a) => (
        <span key={a.key} className="contents">
            {a.separated && <Sep />}
            <Item onSelect={a.onSelect} disabled={a.disabled} className={a.danger ? 'text-red-700 focus:text-red-700 dark:text-red-400' : undefined}>
                {a.icon} {a.label}
                {a.shortcut && <span className="text-muted-foreground ml-auto pl-4 text-xs">{a.shortcut}</span>}
            </Item>
        </span>
    ));
}

/** Fila de la lista de canciones: seleccionable, arrastrable y renombrable en línea. */
export function SongRow({
    song,
    selected,
    focused,
    editing,
    setEditing,
    onRename,
    onRowClick,
    onToggle,
    onContext,
    actions,
    folderLabel,
    details,
}: Props) {
    const drag = useDraggable({ id: `song:${song.id}`, data: { kind: 'song', id: song.id } });

    return (
        // modal={false}: si una acción abre una ventana (Borrar, Mover a…), la página no queda bloqueada al cerrarla.
        <ContextMenu modal={false} onOpenChange={(open) => open && onContext()}>
            <ContextMenuTrigger asChild>
                <li
                    ref={drag.setNodeRef}
                    {...drag.attributes}
                    {...drag.listeners}
                    data-song-id={song.id}
                    aria-selected={selected}
                    tabIndex={-1}
                    onClick={onRowClick}
                    onDoubleClick={(e) => {
                        // Doble clic en la fila (fuera del nombre) no hace nada especial; en el nombre, renombra.
                        if ((e.target as HTMLElement).closest('[data-title]')) setEditing(true);
                    }}
                    className={cn(
                        'cursor-default px-3 py-3 outline-none select-none sm:px-4',
                        selected ? 'bg-primary/10' : 'hover:bg-muted/50',
                        focused && 'ring-ring ring-2 ring-inset',
                        drag.isDragging && 'opacity-40',
                    )}
                >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Checkbox
                            checked={selected}
                            onCheckedChange={onToggle}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            aria-label={`Seleccionar ${song.title}`}
                            className="size-5"
                        />
                        <div className="min-w-0 flex-1 basis-52">
                            <p className="truncate font-medium" data-title>
                                <InlineEdit
                                    value={song.title}
                                    editing={editing}
                                    onEditingChange={setEditing}
                                    onSave={onRename}
                                    ariaLabel="Nombre de la canción"
                                    className="truncate"
                                    inputClassName="w-full max-w-md text-base font-medium"
                                />
                            </p>
                            <p className="text-muted-foreground flex flex-wrap items-center gap-x-1 truncate text-xs">
                                {folderLabel && (
                                    <span className="text-foreground/80 inline-flex max-w-[16rem] items-center gap-1 truncate">
                                        <FolderIcon className="size-3 shrink-0" aria-hidden /> {folderLabel} ·
                                    </span>
                                )}
                                {song.original_ext.toUpperCase()} · {formatBytes(song.original_size)} · {formatDuration(song.duration)} ·{' '}
                                {formatDate(song.created_at)}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={song.status} progress={song.progress} />
                            <ChordsBadge status={song.chords_status} chordKey={song.chords_key} progress={song.chords_progress} />
                        </div>
                        <div
                            className="flex shrink-0 items-center gap-1"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Button size="sm" asChild>
                                <Link href={route('songs.show', song.id)} draggable={false}>
                                    <SlidersHorizontal /> <span className="hidden sm:inline">Abrir mezclador</span>
                                    <span className="sm:hidden">Abrir</span>
                                </Link>
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" aria-label={`Más acciones para ${song.title}`}>
                                        <MoreHorizontal />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">{renderItems(actions, DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    {details}
                </li>
            </ContextMenuTrigger>
            <ContextMenuContent>{renderItems(actions, ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
        </ContextMenu>
    );
}
