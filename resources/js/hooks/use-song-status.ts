import { type LiveSong, type Song } from '@/types';
import { router } from '@inertiajs/react';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';

const POLL_MS = 2500;

/** ¿Hay algo en marcha en esta canción (separación o acordes)? */
export const isBusy = (s: Song) =>
    s.status === 'pending' ||
    s.status === 'processing' ||
    s.chords_status === 'waiting' ||
    s.chords_status === 'pending' ||
    s.chords_status === 'processing';

/** Firma del estado de los dos procesos, para saber cuándo uno terminó. */
const signature = (s: Song) => `${s.status}|${s.chords_status}`;

/**
 * Mezcla la lista de canciones con su estado en vivo.
 * Mientras alguna esté separándose o analizando acordes, consulta /songs/status cada 2,5 s.
 * Cuando un proceso termina, recarga la lista desde el servidor.
 */
export function useSongStatus(songs: Song[]): LiveSong[] {
    const [live, setLive] = useState<Record<number, LiveSong>>({});
    const previous = useRef<Record<number, string>>({});

    const merged = useMemo<LiveSong[]>(() => songs.map((s) => live[s.id] ?? { ...s, progress: null, queue_position: null }), [songs, live]);
    const active = merged.some(isBusy);

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
                    // Un proceso salió de "en marcha" (terminó, falló o se canceló).
                    if (before && before !== signature(s) && !isBusy(s)) finishedOne = true;
                    if (before && before.split('|')[0] !== s.status && s.status === 'ready') finishedOne = true;
                    previous.current[s.id] = signature(s);
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
        for (const s of songs) previous.current[s.id] = signature(s);
    }, [songs]);

    return merged;
}
