import { ChordsBadge, StatusBadge } from '@/components/songs/status-badge';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { type Song } from '@/types';
import { Music } from 'lucide-react';
import { type ReactNode } from 'react';

interface Props<T extends Song> {
    songs: T[];
    /** Botones de cada fila (mezclador, renombrar, borrar...). */
    actions?: (song: T) => ReactNode;
    /** Contenido extra bajo la fila (por ejemplo, el error o el progreso). */
    details?: (song: T) => ReactNode;
    emptyMessage?: string;
}

export function SongList<T extends Song>({ songs, actions, details, emptyMessage = 'Aún no has subido canciones.' }: Props<T>) {
    if (songs.length === 0) {
        return (
            <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
                <Music className="size-8" aria-hidden />
                <p>{emptyMessage}</p>
            </div>
        );
    }

    return (
        <ul className="divide-border bg-card divide-y rounded-xl border">
            {songs.map((song) => (
                <li key={song.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1 basis-60">
                            <p className="truncate font-medium" title={song.title}>
                                {song.title}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                                {song.original_ext.toUpperCase()} · {formatBytes(song.original_size)} · {formatDuration(song.duration)} ·{' '}
                                {formatDate(song.created_at)}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={song.status} progress={'progress' in song ? (song.progress as number | null) : null} />
                            <ChordsBadge status={song.chords_status} chordKey={song.chords_key} progress={song.chords_progress} />
                        </div>
                        {actions && <div className="flex shrink-0 items-center gap-1">{actions(song)}</div>}
                    </div>
                    {details?.(song)}
                </li>
            ))}
        </ul>
    );
}
