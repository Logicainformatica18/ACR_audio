import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Song, type UploadLimits } from '@/types';
import axios, { AxiosError } from 'axios';
import { CheckCircle2, LoaderCircle, Upload, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type UploadState = 'waiting' | 'uploading' | 'done' | 'error';

interface UploadItem {
    key: number;
    file: File;
    state: UploadState;
    progress: number; // 0 a 100
    error?: string;
}

interface Props {
    limits: UploadLimits;
    onUploaded: (song: Song) => void;
}

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

export function UploadDropzone({ limits, onUploaded }: Props) {
    const [items, setItems] = useState<UploadItem[]>([]);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const busy = useRef(false);
    const dragDepth = useRef(0);

    const accept = limits.extensions.map((e) => '.' + e).join(',');
    const maxBytes = limits.max_mb * 1024 * 1024;

    const update = (key: number, patch: Partial<UploadItem>) =>
        setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

    /** Revisa extensión y tamaño en el navegador antes de subir (el servidor vuelve a validar). */
    const addFiles = useCallback(
        (files: FileList | File[]) => {
            const added: UploadItem[] = [...files].map((file) => {
                const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                let error: string | undefined;
                if (!limits.extensions.includes(ext)) error = `Formato no permitido. Usa ${limits.extensions.join(', ').toUpperCase()}.`;
                else if (file.size > maxBytes) error = `Pesa ${formatBytes(file.size)}; el máximo es ${limits.max_mb} MB.`;
                else if (file.size === 0) error = 'El archivo está vacío.';
                return { key: nextKey++, file, state: error ? 'error' : 'waiting', progress: 0, error };
            });
            setItems((list) => [...list, ...added]);
        },
        [limits.extensions, limits.max_mb, maxBytes],
    );

    // Sube los archivos de uno en uno, en el orden en que se añadieron.
    useEffect(() => {
        if (busy.current) return;
        const next = items.find((it) => it.state === 'waiting');
        if (!next) return;

        busy.current = true;
        update(next.key, { state: 'uploading', progress: 0 });

        const form = new FormData();
        form.append('file', next.file);

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
            .catch((err) => update(next.key, { state: 'error', error: uploadErrorMessage(err) }))
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
    const finished = items.filter((it) => it.state === 'done' || it.state === 'error').length;

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

            {items.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground" aria-live="polite">
                            {pending > 0 ? `Subiendo… quedan ${pending}` : 'Subidas terminadas'}
                        </span>
                        {finished > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setItems((l) => l.filter((it) => it.state === 'waiting' || it.state === 'uploading'))}>
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
                                    <span className="min-w-0 flex-1 truncate" title={it.file.name}>
                                        {it.file.name}
                                    </span>
                                    <span className="text-muted-foreground shrink-0 tabular-nums">
                                        {it.state === 'uploading' ? `${it.progress}%` : it.state === 'waiting' ? 'En espera' : formatBytes(it.file.size)}
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
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
