import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { flatTree, type Folder } from '@/lib/folders';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type UploadMode } from '@/types';
import { FileAudio, Layers, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface UploadChoice {
    mode: UploadMode;
    chords: boolean;
    remember: boolean;
    /** Carpeta de destino (null = Sin carpeta). */
    folderId: number | null;
}

interface Props {
    /** Archivos que se van a subir (null = cerrado). */
    files: File[] | null;
    /** Valor inicial del interruptor "Detectar acordes" (preferencia general). */
    defaultChords: boolean;
    /** Opción marcada por defecto (la que elige Enter). */
    defaultMode: UploadMode;
    onChoose: (choice: UploadChoice) => void;
    onCancel: () => void;
    folders: Folder[];
    /** Carpeta abierta al subir: destino propuesto. */
    defaultFolderId: number | null;
    /** Si viene de una lista de YouTube: propone crear una carpeta con este nombre. */
    suggestFolderName?: string | null;
    /** Crea esa carpeta y devuelve su id (o null si falla). */
    onCreateFolder?: (name: string) => Promise<number | null>;
    /** Título distinto ("¿Qué hacemos con estos videos?"). */
    title?: string;
    /** Mostrar la lista de archivos (no hace falta si ya se ven en otro sitio). */
    items?: { name: string; size?: number; detail?: string }[];
}

/**
 * Pregunta qué hacer con los archivos que se acaban de arrastrar o elegir:
 * "Separar pistas" o "Solo subir", con o sin acordes. Un solo clic decide.
 * Teclado: Tab recorre las opciones, Enter elige la marcada por defecto (tiene
 * el foco al abrir) y Esc cancela la subida.
 */
export function UploadChoiceDialog({
    files,
    defaultChords,
    defaultMode,
    onChoose,
    onCancel,
    folders,
    defaultFolderId,
    suggestFolderName,
    onCreateFolder,
    title,
    items,
}: Props) {
    const [chords, setChords] = useState(defaultChords);
    const [remember, setRemember] = useState(false);
    const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
    const [newFolder, setNewFolder] = useState(false);
    const [newName, setNewName] = useState('');
    const open = files !== null || items !== undefined;

    useEffect(() => {
        if (open) {
            setChords(defaultChords);
            setRemember(false);
            setFolderId(defaultFolderId);
            setNewFolder(!!suggestFolderName);
            setNewName(suggestFolderName ?? '');
        }
    }, [open, defaultChords, defaultFolderId, suggestFolderName]);

    const choose = async (mode: UploadMode) => {
        let target = folderId;
        if (newFolder && newName.trim() && onCreateFolder) {
            target = await onCreateFolder(newName.trim());
            if (target === null) return;
        }
        onChoose({ mode, chords, remember, folderId: target });
    };
    const list: { name: string; size?: number; detail?: string }[] = items ?? files?.map((f) => ({ name: f.name, size: f.size })) ?? [];

    const options: { mode: UploadMode; title: string; text: string; Icon: typeof Layers }[] = [
        { mode: 'separate', title: 'Separar pistas', text: 'Sube y separa voz, batería, bajo, guitarra, piano y otros con la GPU.', Icon: Layers },
        { mode: 'upload', title: 'Solo subir', text: 'Guarda la canción tal cual, sin separar. Útil para backing tracks.', Icon: Upload },
    ];
    const total = list.reduce((a, f) => a + (f.size ?? 0), 0);

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {title ?? (list.length === 1 ? '¿Qué hacemos con esta canción?' : `¿Qué hacemos con estas ${list.length} canciones?`)}
                    </DialogTitle>
                    <DialogDescription>La elección se aplica a todos los archivos de esta subida.</DialogDescription>
                </DialogHeader>

                <ul className="bg-muted/40 max-h-36 space-y-1 overflow-y-auto rounded-md border p-2 text-sm" aria-label="Archivos que se van a subir">
                    {list.map((f, i) => (
                        <li key={i} className="flex items-center gap-2">
                            <FileAudio className="text-muted-foreground size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 truncate" title={f.name}>
                                {f.name}
                            </span>
                            <span className="text-muted-foreground shrink-0 tabular-nums">{f.detail ?? (f.size ? formatBytes(f.size) : '')}</span>
                        </li>
                    ))}
                    {list.length > 1 && total > 0 && <li className="text-muted-foreground pt-1 text-right text-xs">Total: {formatBytes(total)}</li>}
                </ul>

                <div className="grid gap-2 sm:grid-cols-2">
                    {options.map(({ mode, title, text, Icon }) => (
                        <button
                            key={mode}
                            type="button"
                            autoFocus={mode === defaultMode}
                            onClick={() => void choose(mode)}
                            className={cn(
                                'hover:border-primary focus-visible:ring-ring flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
                                mode === defaultMode ? 'border-primary bg-primary/5' : 'border-border',
                            )}
                        >
                            <span className="flex items-center gap-2 text-lg font-semibold">
                                <Icon className="size-5" aria-hidden /> {title}
                            </span>
                            <span className="text-muted-foreground text-sm">{text}</span>
                            {mode === defaultMode && <span className="text-muted-foreground mt-1 text-xs">Pulsa Enter para elegir esta</span>}
                        </button>
                    ))}
                </div>

                <div className="grid gap-1.5">
                    <Label htmlFor="upload-folder">Carpeta de destino</Label>
                    {newFolder ? (
                        <div className="flex gap-2">
                            <Input
                                id="upload-folder"
                                value={newName}
                                maxLength={100}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Nombre de la carpeta nueva"
                                aria-label="Nombre de la carpeta nueva"
                            />
                            <Button type="button" variant="ghost" onClick={() => setNewFolder(false)}>
                                Elegir existente
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <select
                                id="upload-folder"
                                value={folderId ?? ''}
                                onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}
                                className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
                            >
                                <option value="">Sin carpeta</option>
                                {flatTree(folders).map(({ folder, depth }) => (
                                    <option key={folder.id} value={folder.id}>
                                        {'\u00a0\u00a0'.repeat(depth - 1)}
                                        {folder.name}
                                    </option>
                                ))}
                            </select>
                            {onCreateFolder && (
                                <Button type="button" variant="outline" onClick={() => setNewFolder(true)}>
                                    + Nueva
                                </Button>
                            )}
                        </div>
                    )}
                    {newFolder && suggestFolderName && (
                        <p className="text-muted-foreground text-xs">Se creará la carpeta «{newName || suggestFolderName}» con estas canciones.</p>
                    )}
                </div>

                <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="upload-chords" className="cursor-pointer leading-snug">
                            Detectar acordes
                            <span className="text-muted-foreground block text-xs font-normal">
                                Con las pistas separadas si eliges separar; si no, con el original.
                            </span>
                        </Label>
                        <Switch id="upload-chords" checked={chords} onCheckedChange={setChords} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox id="upload-remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                        <Label htmlFor="upload-remember" className="cursor-pointer font-normal">
                            Recordar y no volver a preguntar
                        </Label>
                    </div>
                    {remember && (
                        <p className="text-muted-foreground text-xs">
                            Las próximas subidas usarán esta elección sin preguntar. Puedes volver a activar esta ventana en Configuración →
                            Preferencias.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancelar subida (Esc)
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
