import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { colorDot, flatTree, type Folder } from '@/lib/folders';
import { cn } from '@/lib/utils';
import { FolderIcon, Inbox, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
    open: boolean;
    title: string;
    folders: Folder[];
    /** Carpetas que no se pueden elegir (la propia y sus subcarpetas, al mover una carpeta). */
    disabledIds?: Set<number>;
    /** Ofrecer "Sin carpeta" (canciones) o "Raíz" (carpetas). */
    rootLabel: string;
    onChoose: (folderId: number | null) => void;
    onClose: () => void;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * "Mover a…": la alternativa a arrastrar, para teclado y móvil. Buscador de
 * carpetas; flechas para recorrer la lista y Enter para elegir.
 */
export function MoveDialog({ open, title, folders, disabledIds, rootLabel, onChoose, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
            // Por si un menú que se acaba de cerrar se llevó el foco.
            const t = window.setTimeout(() => inputRef.current?.focus(), 60);
            return () => window.clearTimeout(t);
        }
    }, [open]);

    const options = useMemo(() => {
        const q = normalize(query.trim());
        const all: { id: number | null; label: string; path: string; depth: number; color: Folder['color'] }[] = [
            { id: null, label: rootLabel, path: rootLabel, depth: 0, color: null },
            ...flatTree(folders).map(({ folder, depth, path }) => ({ id: folder.id, label: folder.name, path, depth, color: folder.color })),
        ];
        return all.filter((o) => (o.id === null || !disabledIds?.has(o.id)) && (!q || normalize(o.path).includes(q)));
    }, [folders, query, disabledIds, rootLabel]);

    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>Busca una carpeta y pulsa Enter, o haz clic en ella.</DialogDescription>
                </DialogHeader>
                <div className="relative">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
                    <Input
                        ref={inputRef}
                        autoFocus
                        value={query}
                        placeholder="Buscar carpeta…"
                        aria-label="Buscar carpeta"
                        className="pl-8"
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActive(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setActive((a) => Math.min(options.length - 1, a + 1));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setActive((a) => Math.max(0, a - 1));
                            } else if (e.key === 'Enter' && options[active]) {
                                e.preventDefault();
                                onChoose(options[active].id);
                            }
                        }}
                    />
                </div>
                <ul ref={listRef} role="listbox" aria-label="Carpetas" className="max-h-72 overflow-y-auto rounded-md border p-1">
                    {options.length === 0 && <li className="text-muted-foreground p-2 text-sm">Ninguna carpeta coincide.</li>}
                    {options.map((o, i) => {
                        const dot = colorDot(o.color);
                        return (
                            <li
                                key={o.id ?? 'root'}
                                data-index={i}
                                role="option"
                                aria-selected={i === active}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => onChoose(o.id)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                                    i === active && 'bg-accent text-accent-foreground',
                                )}
                                style={{ paddingLeft: query ? undefined : `${0.5 + o.depth * 0.9}rem` }}
                            >
                                {o.id === null ? <Inbox className="size-4 shrink-0" /> : <FolderIcon className="size-4 shrink-0" />}
                                {dot && <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />}
                                <span className="truncate">{query && o.id !== null ? o.path : o.label}</span>
                            </li>
                        );
                    })}
                </ul>
            </DialogContent>
        </Dialog>
    );
}
