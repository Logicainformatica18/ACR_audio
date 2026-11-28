import { UploadChoiceDialog, type UploadChoice } from '@/components/songs/upload-choice-dialog';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Song, type UploadLimits, type UploadMode, type UploadPrefs } from '@/types';
import { Link } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import { CheckCircle2, Copy, LoaderCircle, Upload, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type UploadState = 'waiting' | 'uploading' | 'done' | 'error' | 'duplicate' | 'skipped';

interface UploadItem {
    key: number;
    file: File;
    state: UploadState;
    progress: number; // 0 a 100
    error?: string;
    /** El usuario confirmó que quiere subirla aunque ya exista una igual. */
    allowDuplicate?: boolean;
    /** Elegido en el modal (o recordado): separar o solo subir, y si detectar acordes. */
    mode: UploadMode;
    chords: boolean;
}

interface Props {
    limits: UploadLimits;
    prefs: UploadPrefs;
    /** Se llama si el usuario marcó "Recordar y no volver a preguntar". */
    onRemember: (prefs: UploadPrefs) => void;
    onUploaded: (song: Song) => void;
}

const MODE_LABEL: Record<UploadMode, string> = { separate: 'Separar pistas', upload: 'Solo subir' };

let nextKey = 1;

/** Mensaje de error comprensible a partir de la respuesta del servidor. */
function uploadErrorMessage(err: unknown): string {
    const e = err as AxiosError<{ message?: string; errors?: Record<string, string[]> }>;
    if (!e.response) return 'No hay conexión con el servidor.';
    const { status, data } = e.response;
    if (status === 413) return 'El servidor rechazó el archivo por su tamaño (revisa post_max_size en php.ini).';
    if (status === 419) return 'La sesión caducó. Recarga la página.';
    if (status === 422) return data?.errors?.file?.[0] ?? data?.message ?? 'El archivo no es válido.';
    return data?.message || `Error del servidor (${status}).`;
}

export function UploadDropzone({ limits, prefs, onRemember, onUploaded }: Props) {
    const [items, setItems] = useState<UploadItem[]>([]);
    // Archivos válidos esperando la elección del modal.
    const [asking, setAsking] = useState<File[] | null>(null);
    const [lastMode, setLastMode] = useState<UploadMode>('separate');
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const busy = useRef(false);
    const dragDepth = useRef(0);

    const accept = limits.extensions.map((e) => '.' + e).join(',');
    const maxBytes = limits.max_mb * 1024 * 1024;

    const update = (key: number, patch: Partial<UploadItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

    const enqueue = (files: File[], mode: UploadMode, chords: boolean) =>
        setItems((list) => [...list, ...files.map((file) => ({ key: nextKey++, file, state: 'waiting' as const, progress: 0, mode, chords }))]);

    /**
     * Revisa extensión y tamaño en el navegador (el servidor vuelve a validar).
     * Los válidos se suben con la elección recordada o, si no hay, se pregunta con el modal.
     */
    const addFiles = useCallback(
        (files: FileList | File[]) => {
            const valid: File[] = [];
            const rejected: UploadItem[] = [];
            for (const file of [...files]) {
                const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                let error: string | undefined;
                if (!limits.extensions.includes(ext)) error = `Formato no permitido. Usa ${limits.extensions.join(', ').toUpperCase()}.`;
                else if (file.size > maxBytes) error = `Pesa ${formatBytes(file.size)}; el máximo es ${limits.max_mb} MB.`;
                else if (file.size === 0) error = 'El archivo está vacío.';
                if (error) rejected.push({ key: nextKey++, file, state: 'error', progress: 0, error, mode: 'separate', chords: false });
                else valid.push(file);
            }
            if (rejected.length) setItems((list) => [...list, ...rejected]);
            if (!valid.length) return;
            if (prefs.upload_mode) enqueue(valid, prefs.upload_mode, prefs.chords_auto);
            else setAsking((prev) => [...(prev ?? []), ...valid]);
        },
        [limits.extensions, limits.max_mb, maxBytes, prefs.upload_mode, prefs.chords_auto],
    );

    const choose = (choice: UploadChoice) => {
        if (!asking) return;
        enqueue(asking, choice.mode, choice.chords);
        setLastMode(choice.mode);
        setAsking(null);
        if (choice.remember) onRemember({ upload_mode: choice.mode, chords_auto: choice.chords });
    };

    // Sube los archivos de uno en uno, en el orden en que se añadieron.
    useEffect(() => {
        if (busy.current) return;
        const next = items.find((it) => it.state === 'waiting');
        if (!next) return;

        busy.current = true;
        update(next.key, { state: 'uploading', progress: 0 });

        const form = new FormData();
        form.append('file', next.file);
        form.append('mode', next.mode);
        form.append('chords', next.chords ? '1' : '0');
        if (next.allowDuplicate) form.append('allow_duplicate', '1');

        axios
            .post<{ song: Song }>(route('songs.store'), form, {
                headers: { Accept: 'application/json' },
                onUploadProgress: (ev) => {
                    if (ev.total) update(next.key, { progress: Math.round((ev.loaded / ev.total) * 100) });
                },
            })
            .then((res) => {
                update(next.key, { state: 'done', progress: 100 });
                onUploaded(res.data.song);
            })
            .catch((err) => {
                const res = (err as AxiosError<{ code?: string; message?: string }>).response;
                // Ya existe una canción con el mismo nombre y tamaño: se pregunta (y se sigue con las demás).
                if (res?.status === 409 && res.data?.code === 'duplicate') update(next.key, { state: 'duplicate', error: res.data.message });
                else update(next.key, { state: 'error', error: uploadErrorMessage(err) });
            })
            .finally(() => {
                busy.current = false;
                setItems((list) => [...list]); // vuelve a ejecutar el efecto para el siguiente
            });
    }, [items, onUploaded]);

    // Evita que el navegador abra el archivo si se suelta fuera de la zona.
    useEffect(() => {
        const prevent = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
        };
        window.addEventListener('dragover', prevent);
        window.addEventListener('drop', prevent);
        return () => {
            window.removeEventListener('dragover', prevent);
            window.removeEventListener('drop', prevent);
        };
    }, []);

    const pending = items.filter((it) => it.state === 'waiting' || it.state === 'uploading').length;
    const finished = items.filter((it) => it.state === 'done' || it.state === 'error' || it.state === 'skipped').length;

    return (
        <section aria-label="Subir canciones" className="space-y-3">
            <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        inputRef.current?.click();
                    }
                }}
                onDragEnter={(e) => {
                    if (!e.dataTransfer.types.includes('Files')) return;
                    dragDepth.current++;
                    setDragging(true);
                }}
                onDragLeave={() => {
                    dragDepth.current = Math.max(0, dragDepth.current - 1);
                    if (!dragDepth.current) setDragging(false);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    dragDepth.current = 0;
                    setDragging(false);
                    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                    'border-border bg-muted/30 hover:border-primary/60 focus-visible:ring-ring flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    dragging && 'border-primary bg-primary/5',
                )}
            >
                <Upload className="text-muted-foreground size-8" aria-hidden />
                <p className="text-lg font-medium">{dragging ? 'Suelta para subir' : 'Arrastra aquí tus canciones'}</p>
                <p className="text-muted-foreground text-sm">
                    o haz clic para elegirlas. {limits.extensions.join(', ').toUpperCase()} · hasta {limits.max_mb} MB cada una
                </p>
                <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    multiple
                    hidden
                    onChange={(e) => {
                        if (e.target.files?.length) addFiles(e.target.files);
                        e.target.value = '';
                    }}
                />
            </div>

            {prefs.upload_mode && (
                <p className="text-muted-foreground text-sm">
                    Las subidas usan <strong className="text-foreground">{MODE_LABEL[prefs.upload_mode]}</strong>
                    {prefs.chords_auto ? ' y detectan acordes' : ', sin detectar acordes'}, sin preguntar.{' '}
                    <Link href={route('preferences.edit')} className="text-foreground underline underline-offset-4">
                        Cambiar en Configuración
                    </Link>
                </p>
            )}

            <UploadChoiceDialog
                files={asking}
                defaultChords={prefs.chords_auto}
                defaultMode={lastMode}
                onChoose={choose}
                onCancel={() => setAsking(null)}
            />

            {items.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground" aria-live="polite">
                            {pending > 0 ? `Subiendo… quedan ${pending}` : 'Subidas terminadas'}
                        </span>
                        {finished > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setItems((l) => l.filter((it) => it.state === 'waiting' || it.state === 'uploading'))}
                            >
                                Limpiar lista
                            </Button>
                        )}
                    </div>
                    <ul className="space-y-2">
                        {items.map((it) => (
                            <li key={it.key} className="bg-card rounded-lg border px-3 py-2">
                                <div className="flex items-center gap-2 text-sm">
                                    {it.state === 'uploading' && <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />}
                                    {it.state === 'done' && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />}
                                    {it.state === 'error' && <XCircle className="size-4 shrink-0 text-red-600" aria-hidden />}
                                    {(it.state === 'duplicate' || it.state === 'skipped') && (
                                        <Copy className="size-4 shrink-0 text-amber-600" aria-hidden />
                                    )}
                                    <span className="min-w-0 flex-1 truncate" title={it.file.name}>
                                        {it.file.name}
                                    </span>
                                    <span className="text-muted-foreground shrink-0 tabular-nums">
                                        {it.state === 'uploading'
                                            ? `${it.progress}%`
                                            : it.state === 'waiting'
                                              ? 'En espera'
                                              : it.state === 'skipped'
                                                ? 'Omitida'
                                                : formatBytes(it.file.size)}
                                    </span>
                                </div>
                                {(it.state === 'uploading' || it.state === 'waiting') && (
                                    <div
                                        className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
                                        role="progressbar"
                                        aria-label={`Progreso de ${it.file.name}`}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={it.progress}
                                    >
                                        <div className="bg-primary h-full transition-[width] duration-150" style={{ width: `${it.progress}%` }} />
                                    </div>
                                )}
                                {it.state === 'error' && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{it.error}</p>}
                                {it.state === 'duplicate' && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2" role="alert">
                                        <p className="flex-1 basis-60 text-sm text-amber-800 dark:text-amber-300">
                                            {it.error} ¿La subes de todos modos?
                                        </p>
                                        <Button size="sm" variant="outline" onClick={() => update(it.key, { state: 'skipped', error: undefined })}>
                                            Omitir
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => update(it.key, { state: 'waiting', allowDuplicate: true, error: undefined })}
                                        >
                                            Subir de todos modos
                                        </Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
