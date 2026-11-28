import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type UploadMode } from '@/types';
import { FileAudio, Layers, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface UploadChoice {
    mode: UploadMode;
    chords: boolean;
    remember: boolean;
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
}

/**
 * Pregunta qué hacer con los archivos que se acaban de arrastrar o elegir:
 * "Separar pistas" o "Solo subir", con o sin acordes. Un solo clic decide.
 * Teclado: Tab recorre las opciones, Enter elige la marcada por defecto (tiene
 * el foco al abrir) y Esc cancela la subida.
 */
export function UploadChoiceDialog({ files, defaultChords, defaultMode, onChoose, onCancel }: Props) {
    const [chords, setChords] = useState(defaultChords);
    const [remember, setRemember] = useState(false);

    useEffect(() => {
        if (files) {
            setChords(defaultChords);
            setRemember(false);
        }
    }, [files, defaultChords]);

    const options: { mode: UploadMode; title: string; text: string; Icon: typeof Layers }[] = [
        { mode: 'separate', title: 'Separar pistas', text: 'Sube y separa voz, batería, bajo, guitarra, piano y otros con la GPU.', Icon: Layers },
        { mode: 'upload', title: 'Solo subir', text: 'Guarda la canción tal cual, sin separar. Útil para backing tracks.', Icon: Upload },
    ];
    const total = files?.reduce((a, f) => a + f.size, 0) ?? 0;

    return (
        <Dialog open={files !== null} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {files?.length === 1 ? '¿Qué hacemos con esta canción?' : `¿Qué hacemos con estas ${files?.length ?? 0} canciones?`}
                    </DialogTitle>
                    <DialogDescription>La elección se aplica a todos los archivos de esta subida.</DialogDescription>
                </DialogHeader>

                <ul className="bg-muted/40 max-h-36 space-y-1 overflow-y-auto rounded-md border p-2 text-sm" aria-label="Archivos que se van a subir">
                    {files?.map((f, i) => (
                        <li key={i} className="flex items-center gap-2">
                            <FileAudio className="text-muted-foreground size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 truncate" title={f.name}>
                                {f.name}
                            </span>
                            <span className="text-muted-foreground shrink-0 tabular-nums">{formatBytes(f.size)}</span>
                        </li>
                    ))}
                    {files && files.length > 1 && <li className="text-muted-foreground pt-1 text-right text-xs">Total: {formatBytes(total)}</li>}
                </ul>

                <div className="grid gap-2 sm:grid-cols-2">
                    {options.map(({ mode, title, text, Icon }) => (
                        <button
                            key={mode}
                            type="button"
                            autoFocus={mode === defaultMode}
                            onClick={() => onChoose({ mode, chords, remember })}
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
