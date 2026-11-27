import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChordItem {
    id: number;
    start: number; // segundos
    end: number;
    chord: string; // notación de guitarrista: Bm, F#m7... "N" = sin acorde
    confidence: number | null;
    edited: boolean; // corregido a mano
}

export type AnalysisStatus = 'pending' | 'processing' | 'ready' | 'failed' | null;

export interface ChordAnalysis {
    status: AnalysisStatus;
    progress: number;
    key: string | null;
    model: string | null;
    error: string | null;
}

const POLL_MS = 2000;

export const isAnalyzing = (a: ChordAnalysis) => a.status === 'pending' || a.status === 'processing';

/** "N" se muestra como un guion: no suena ningún acorde. */
export const chordLabel = (c: string) => (c === 'N' ? '—' : c);

/** Índice del acorde que suena en el instante t (búsqueda binaria), o -1. */
export function chordIndexAt(chords: ChordItem[], t: number): number {
    let lo = 0;
    let hi = chords.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t < chords[mid].start) hi = mid - 1;
        else if (t >= chords[mid].end) lo = mid + 1;
        else return mid;
    }
    return -1;
}

/** Siguiente acorde "real" (no N) después del índice i, o -1. */
export function nextChordIndex(chords: ChordItem[], i: number, t: number): number {
    let j = i >= 0 ? i + 1 : chords.findIndex((c) => c.start > t);
    if (j < 0) return -1;
    while (j < chords.length && chords[j].chord === 'N') j++;
    return j < chords.length ? j : -1;
}

/** Forma de onda precalculada en el servidor (base64 de bytes 0–255) -> 0..1 */
export function decodePeaks(b64: string | null | undefined): Float32Array | null {
    if (!b64) return null;
    try {
        const bin = atob(b64);
        const out = new Float32Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255;
        return out;
    } catch {
        return null;
    }
}

function errorMessage(e: unknown, fallback: string): string {
    if (axios.isAxiosError(e)) {
        const data = e.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
        const first = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
        return first ?? data?.message ?? fallback;
    }
    return fallback;
}

/**
 * Acordes de una canción. Empiezan con lo que vino de la BD (al instante) y,
 * SOLO mientras el análisis está en cola o en marcha, se consulta el avance
 * cada 2 s. Al terminar, deja de consultar.
 */
export function useChords(songId: number, initialChords: ChordItem[], initialAnalysis: ChordAnalysis) {
    const [chords, setChords] = useState<ChordItem[]>(initialChords);
    const [analysis, setAnalysis] = useState<ChordAnalysis>(initialAnalysis);
    const [pendingSince, setPendingSince] = useState<number | null>(initialAnalysis.status === 'pending' ? Date.now() : null);
    const busy = isAnalyzing(analysis);
    const editing = useRef(0); // no pisar una corrección en curso con una consulta vieja

    useEffect(() => {
        if (!busy) return;
        let stop = false;
        const tick = async () => {
            try {
                const started = editing.current;
                const { data } = await axios.get<{ analysis: ChordAnalysis; chords: ChordItem[] }>(route('songs.chords.index', songId));
                if (stop || started !== editing.current) return;
                setChords(data.chords);
                setAnalysis(data.analysis);
            } catch {
                /* se reintenta en la próxima vuelta */
            }
        };
        const id = window.setInterval(() => void tick(), POLL_MS);
        void tick();
        return () => {
            stop = true;
            window.clearInterval(id);
        };
    }, [busy, songId]);

    useEffect(() => {
        setPendingSince((p) => (analysis.status === 'pending' ? (p ?? Date.now()) : null));
    }, [analysis.status]);

    /** Corrige el nombre de un acorde. Devuelve un mensaje de error o null. */
    const editChord = useCallback(
        async (id: number, name: string): Promise<string | null> => {
            editing.current++;
            try {
                const { data } = await axios.patch<{ chord: ChordItem }>(route('songs.chords.update', [songId, id]), { chord: name });
                setChords((list) => list.map((c) => (c.id === id ? data.chord : c)));
                return null;
            } catch (e) {
                return errorMessage(e, 'No se pudo guardar el acorde.');
            } finally {
                editing.current++;
            }
        },
        [songId],
    );

    /** Vuelve a analizar (las correcciones a mano se conservan). */
    const reanalyze = useCallback(async (): Promise<string | null> => {
        try {
            const { data } = await axios.post<{ analysis: ChordAnalysis; chords: ChordItem[] }>(route('songs.chords.analyze', songId));
            setAnalysis(data.analysis);
            setChords(data.chords);
            return null;
        } catch (e) {
            return errorMessage(e, 'No se pudo volver a analizar.');
        }
    }, [songId]);

    return { chords, analysis, editChord, reanalyze, pendingSince };
}
