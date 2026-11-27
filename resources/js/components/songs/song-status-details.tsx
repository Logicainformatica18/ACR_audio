import { Button } from '@/components/ui/button';
import { elapsedSeconds, formatDuration } from '@/lib/format';
import { type LiveSong } from '@/types';
import axios from 'axios';
import { FileText, RotateCcw } from 'lucide-react';
import { useState } from 'react';

/** Segundos en cola sin que nada se procese para sospechar que el worker está cerrado. */
const WORKER_HINT_AFTER = 20;

interface Props {
    song: LiveSong;
    anyProcessing: boolean;
    onRetried: () => void;
}

/** Información extra bajo cada canción según su estado: progreso, cola o error. */
export function SongStatusDetails({ song, anyProcessing, onRetried }: Props) {
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
                <p className="text-muted-foreground text-xs">
                    Separando con la GPU… {song.progress != null ? `${pct}% · ` : ''}
                    {formatDuration(elapsedSeconds(song.started_at))} transcurridos
                </p>
            </div>
        );
    }

    if (song.status === 'pending') {
        const waited = elapsedSeconds(song.queued_at ?? song.created_at) ?? 0;
        return (
            <p className="text-muted-foreground mt-1 text-xs">
                {song.queue_position ? `Posición en la cola: ${song.queue_position}. ` : ''}
                {!anyProcessing && waited > WORKER_HINT_AFTER && (
                    <span className="text-amber-700 dark:text-amber-400">
                        Lleva {formatDuration(waited)} esperando. ¿Está abierta la ventana de <strong>iniciar.bat</strong>?
                    </span>
                )}
            </p>
        );
    }

    if (song.status === 'failed') {
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
            } finally {
                setRetrying(false);
            }
        };

        return (
            <div className="mt-2 space-y-2">
                {song.error && <p className="text-sm break-words text-red-700 dark:text-red-400">{song.error}</p>}
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={toggleLog} disabled={loadingLog} aria-expanded={log !== null}>
                        <FileText /> {log !== null ? 'Ocultar log' : 'Ver log'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={retry} disabled={retrying}>
                        <RotateCcw /> Reintentar
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
