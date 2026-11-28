import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { elapsedSeconds, formatDuration } from '@/lib/format';
import { type LiveSong } from '@/types';
import axios, { AxiosError } from 'axios';
import { Ban, FileText, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/** Segundos en cola sin que nada se procese para sospechar que el worker está cerrado. */
const WORKER_HINT_AFTER = 20;

interface Props {
    song: LiveSong;
    anyProcessing: boolean;
    /** Se llama tras reintentar o cancelar, para recargar la lista. */
    onRetried: () => void;
}

/** Botón "Cancelar" (con confirmación): detiene la separación real y borra lo que llevaba hecho. */
function CancelButton({ song, onDone }: { song: LiveSong; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const cancel = async () => {
        setBusy(true);
        try {
            await axios.post(route('songs.cancel', song.id), {}, { headers: { Accept: 'application/json' } });
            toast.success(`Se canceló la separación de «${song.title}».`);
            setOpen(false);
            onDone();
        } catch (err) {
            toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo cancelar.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Ban /> Cancelar
            </Button>
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title="¿Cancelar la separación?"
                description={
                    song.status === 'processing'
                        ? `Se detendrá la separación de «${song.title}» y se borrará lo que llevaba hecho. El archivo original se conserva: podrás reintentar o borrarla.`
                        : `«${song.title}» saldrá de la cola. El archivo original se conserva: podrás reintentar o borrarla.`
                }
                confirmLabel="Cancelar separación"
                cancelLabel="Seguir"
                destructive
                processing={busy}
                onConfirm={cancel}
            />
        </>
    );
}

/** Detalles de la SEPARACIÓN: progreso, cola, error o cancelada. */
function SeparationDetails({ song, anyProcessing, onRetried }: Props) {
    const [log, setLog] = useState<string | null>(null);
    const [loadingLog, setLoadingLog] = useState(false);
    const [retrying, setRetrying] = useState(false);

    if (song.status === 'processing') {
        const pct = song.progress ?? 0;
        return (
            <div className="mt-2 space-y-1">
                <div
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label={`Separando ${song.title}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                >
                    <div className="h-full bg-sky-500 transition-[width] duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                        Separando con la GPU… {song.progress != null ? `${pct}% · ` : ''}
                        {formatDuration(elapsedSeconds(song.started_at))} transcurridos
                    </p>
                    <CancelButton song={song} onDone={onRetried} />
                </div>
            </div>
        );
    }

    if (song.status === 'pending') {
        const waited = elapsedSeconds(song.queued_at ?? song.created_at) ?? 0;
        return (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                    {song.queue_position ? `Posición en la cola: ${song.queue_position}. ` : ''}
                    {!anyProcessing && waited > WORKER_HINT_AFTER && (
                        <span className="text-amber-700 dark:text-amber-400">
                            Lleva {formatDuration(waited)} esperando. ¿Está abierta la ventana de <strong>iniciar.bat</strong>?
                        </span>
                    )}
                </p>
                <CancelButton song={song} onDone={onRetried} />
            </div>
        );
    }

    if (song.status === 'failed' || song.status === 'canceled') {
        const toggleLog = async () => {
            if (log !== null) return setLog(null);
            setLoadingLog(true);
            try {
                const { data } = await axios.get<{ log: string }>(route('songs.log', song.id));
                setLog(data.log || '(sin salida)');
            } finally {
                setLoadingLog(false);
            }
        };
        const retry = async () => {
            setRetrying(true);
            try {
                await axios.post(route('songs.retry', song.id));
                onRetried();
            } catch (err) {
                toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo reintentar.');
            } finally {
                setRetrying(false);
            }
        };

        return (
            <div className="mt-2 space-y-2">
                {song.error && (
                    <p className={song.status === 'failed' ? 'text-sm break-words text-red-700 dark:text-red-400' : 'text-muted-foreground text-sm'}>
                        {song.error}
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    {song.status === 'failed' && (
                        <Button variant="outline" size="sm" onClick={toggleLog} disabled={loadingLog} aria-expanded={log !== null}>
                            <FileText /> {log !== null ? 'Ocultar log' : 'Ver log'}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={retry} disabled={retrying}>
                        <RotateCcw /> Reintentar separación
                    </Button>
                </div>
                {log !== null && (
                    <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap">{log}</pre>
                )}
            </div>
        );
    }

    return null;
}

/** Detalles de los ACORDES: esperando, en cola, analizando (con Cancelar) o error/cancelado (con Reintentar). */
function ChordsDetails({ song, onChanged }: { song: LiveSong; onChanged: () => void }) {
    const [busy, setBusy] = useState(false);
    const status = song.chords_status;
    if (!status || status === 'ready') return null;

    const post = async (name: 'songs.chords.cancel' | 'songs.chords.analyze', ok: string) => {
        setBusy(true);
        try {
            await axios.post(route(name, song.id), {}, { headers: { Accept: 'application/json' } });
            toast.success(ok);
            onChanged();
        } catch (err) {
            toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo completar la acción.');
        } finally {
            setBusy(false);
        }
    };

    if (status === 'failed' || status === 'canceled') {
        return (
            <div className="mt-2 flex flex-wrap items-center gap-2">
                {song.chords_error && (
                    <p className={status === 'failed' ? 'text-sm text-red-700 dark:text-red-400' : 'text-muted-foreground text-sm'}>
                        Acordes: {song.chords_error}
                    </p>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => post('songs.chords.analyze', 'Acordes en cola.')}>
                    <RotateCcw /> Reintentar acordes
                </Button>
            </div>
        );
    }

    const text =
        status === 'waiting'
            ? 'Los acordes se detectarán al terminar la separación.'
            : status === 'pending'
              ? 'Acordes en cola…'
              : `Detectando acordes… ${song.chords_progress}%`;
    return (
        <div className="mt-2 space-y-1">
            {status === 'processing' && (
                <div
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label={`Acordes de ${song.title}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={song.chords_progress}
                >
                    <div
                        className="h-full bg-violet-500 transition-[width] duration-500"
                        style={{ width: `${Math.max(3, song.chords_progress)}%` }}
                    />
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">{text}</p>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => post('songs.chords.cancel', 'Se canceló la detección de acordes.')}>
                    <Ban /> Cancelar acordes
                </Button>
            </div>
        </div>
    );
}

/** Información extra bajo cada canción: estado de la separación y de los acordes. */
export function SongStatusDetails({ song, anyProcessing, onRetried }: Props) {
    return (
        <>
            <DownloadDetails song={song} onChanged={onRetried} />
            <SeparationDetails song={song} anyProcessing={anyProcessing} onRetried={onRetried} />
            <ChordsDetails song={song} onChanged={onRetried} />
        </>
    );
}

/** Detalles de la DESCARGA de YouTube: progreso (con Cancelar) o error/cancelada (con Reintentar). */
function DownloadDetails({ song, onChanged }: { song: LiveSong; onChanged: () => void }) {
    const [busy, setBusy] = useState(false);
    const status = song.download_status;
    if (!status || status === 'ready') return null;

    const post = async (name: 'songs.download.cancel' | 'songs.download.retry', ok: string) => {
        setBusy(true);
        try {
            await axios.post(route(name, song.id), {}, { headers: { Accept: 'application/json' } });
            toast.success(ok);
            onChanged();
        } catch (err) {
            toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo completar la acción.');
        } finally {
            setBusy(false);
        }
    };

    if (status === 'failed' || status === 'canceled') {
        return (
            <div className="mt-2 flex flex-wrap items-center gap-2">
                {song.download_error && (
                    <p className={status === 'failed' ? 'text-sm text-red-700 dark:text-red-400' : 'text-muted-foreground text-sm'}>
                        {song.download_error}
                    </p>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => post('songs.download.retry', 'Descarga en cola.')}>
                    <RotateCcw /> Reintentar descarga
                </Button>
            </div>
        );
    }

    return (
        <div className="mt-2 space-y-1">
            {status === 'processing' && (
                <div
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-label={`Descargando ${song.title}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={song.download_progress}
                >
                    <div className="h-full bg-red-500 transition-[width] duration-500" style={{ width: `${Math.max(3, song.download_progress)}%` }} />
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                    {status === 'pending' ? 'En cola para descargar de YouTube…' : `Descargando de YouTube en FLAC… ${song.download_progress}%`}
                </p>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => post('songs.download.cancel', 'Se canceló la descarga.')}>
                    <Ban /> Cancelar descarga
                </Button>
            </div>
        </div>
    );
}
