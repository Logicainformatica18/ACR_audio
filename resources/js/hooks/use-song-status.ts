import { type LiveSong, type Song } from '@/types';
import { router } from '@inertiajs/react';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';

const POLL_MS = 2500;

/**
 * Mezcla la lista de canciones con su estado en vivo.
 * Mientras alguna esté "En cola" o "Procesando", consulta /songs/status cada 2,5 s.
 * Cuando una termina (Lista o Error), recarga la lista desde el servidor.
 */
export function useSongStatus(songs: Song[]): LiveSong[] {
    const [live, setLive] = useState<Record<number, LiveSong>>({});
    const previous = useRef<Record<number, string>>({});

    const merged = useMemo<LiveSong[]>(
        () => songs.map((s) => live[s.id] ?? { ...s, progress: null, queue_position: null }),
        [songs, live],
    );
    const active = merged.some((s) => s.status === 'pending' || s.status === 'processing');

    useEffect(() => {
        if (!active) return;
        let cancelled = false;

        const poll = async () => {
            try {
                const { data } = await axios.get<{ songs: LiveSong[] }>(route('songs.status'), { headers: { Accept: 'application/json' } });
                if (cancelled) return;

                const byId: Record<number, LiveSong> = {};
                let finishedOne = false;
                for (const s of data.songs) {
                    byId[s.id] = s;
                    const before = previous.current[s.id];
                    if (before && before !== s.status && (s.status === 'ready' || s.status === 'failed')) finishedOne = true;
                    previous.current[s.id] = s.status;
                }
                setLive(byId);
                if (finishedOne) router.reload({ only: ['songs'] });
            } catch {
                // Sin conexión momentánea: se reintenta en el siguiente ciclo.
            }
        };

        poll();
        const timer = window.setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [active]);

    // Lista nueva desde el servidor: manda sobre el estado en vivo anterior.
    useEffect(() => {
        setLive({});
        for (const s of songs) previous.current[s.id] = s.status;
    }, [songs]);

    return merged;
}
