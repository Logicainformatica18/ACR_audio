import { chordLabel, type ChordAnalysis, type ChordItem } from '@/lib/mixer/chords';
import { clamp, fmtR } from '@/lib/mixer/time';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface Props {
    chords: ChordItem[];
    analysis: ChordAnalysis;
    duration: number;
    /** Hasta dónde llegó el análisis en curso (s); null si no se está analizando. */
    frontier: number | null;
    onSeek: (t: number) => void;
    onEdit: (chord: ChordItem) => void;
    headRef: (el: HTMLDivElement | null) => void;
    /** Para resaltar el acorde actual sin re-renderizar React. */
    blockRef: (id: number, el: HTMLButtonElement | null) => void;
}

const pct = (t: number, d: number) => (d ? clamp(t / d, 0, 1) * 100 : 0) + '%';

/**
 * Fila de acordes alineada con la línea de tiempo de las pistas: cada acorde
 * ocupa su tramo. Clic = saltar a ese momento; doble clic o clic derecho = corregir.
 */
export function ChordLane({ chords, analysis, duration, frontier, onSeek, onEdit, headRef, blockRef }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const pxPerSec = duration ? width / duration : 0;

    return (
        <div
            ref={ref}
            className="relative h-12 overflow-hidden rounded-md bg-[var(--mx-lane)] select-none"
            aria-label="Acordes de la canción: haz clic en un acorde para saltar a ese momento; doble clic o clic derecho para corregirlo"
        >
            {chords.map((c, i) => {
                const w = (c.end - c.start) * pxPerSec;
                const isN = c.chord === 'N';
                return (
                    <button
                        key={c.id}
                        type="button"
                        ref={(el) => blockRef(c.id, el)}
                        data-current="false"
                        onClick={() => onSeek(c.start)}
                        onDoubleClick={() => onEdit(c)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            onEdit(c);
                        }}
                        className={cn(
                            'absolute inset-y-1 overflow-hidden rounded-[4px] border text-center font-semibold whitespace-nowrap transition-colors',
                            'data-[current=true]:border-[var(--mx-accent)] data-[current=true]:bg-[var(--mx-accent)] data-[current=true]:text-[var(--mx-accent-ink)]',
                            isN
                                ? 'border-transparent bg-transparent text-[var(--mx-muted)]'
                                : i % 2
                                  ? 'bg-card border-border'
                                  : 'bg-background border-border',
                            c.confidence !== null && c.confidence < 0.5 && !c.edited && 'opacity-70',
                        )}
                        style={{ left: pct(c.start, duration), width: `max(2px, ${((c.end - c.start) / (duration || 1)) * 100}%)` }}
                        title={`${chordLabel(c.chord)} · ${fmtR(c.start)} a ${fmtR(c.end)}${c.edited ? ' · corregido a mano' : c.confidence !== null ? ` · confianza ${Math.round(c.confidence * 100)}%` : ''}\nClic: ir aquí · Doble clic o clic derecho: corregir`}
                        aria-label={`${isN ? 'Sin acorde' : c.chord} de ${fmtR(c.start)} a ${fmtR(c.end)}${c.edited ? ', corregido a mano' : ''}`}
                    >
                        {w >= 22 && <span className={cn('px-0.5', w >= 44 ? 'text-base' : 'text-xs')}>{chordLabel(c.chord)}</span>}
                        {c.edited && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500" aria-hidden />}
                    </button>
                );
            })}

            {frontier !== null && frontier < duration && (
                <div
                    className="text-muted-foreground absolute inset-y-0 right-0 grid place-items-center bg-[repeating-linear-gradient(135deg,var(--mx-hatch)_0_5px,transparent_5px_11px)] text-sm"
                    style={{ left: pct(frontier, duration) }}
                    role="status"
                >
                    <span className="bg-background/80 rounded px-2 py-0.5 whitespace-nowrap">
                        {analysis.status === 'pending' ? 'En cola…' : `Analizando… ${analysis.progress}%`}
                    </span>
                </div>
            )}

            <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 z-10 -ml-px w-0.5 bg-[var(--mx-accent)]" />
        </div>
    );
}

/** Píxeles por segundo de la vista ampliada (unos 20 s visibles en pantalla ancha). */
const ZOOM_PX = 48;

interface ZoomProps {
    chords: ChordItem[];
    duration: number;
    frontier: number | null;
    onSeek: (t: number) => void;
    onEdit: (chord: ChordItem) => void;
    blockRef: (id: number, el: HTMLButtonElement | null) => void;
    /** Recibe la función que mueve la tira al instante t (se llama en cada fotograma). */
    controlRef: (fn: ((t: number) => void) | null) => void;
}

/**
 * Vista ampliada: los acordes alrededor del momento actual, con el nombre
 * grande, desplazándose mientras suena. El cabezal queda fijo en el centro.
 */
export function ChordZoom({ chords, duration, frontier, onSeek, onEdit, blockRef, controlRef }: ZoomProps) {
    const box = useRef<HTMLDivElement>(null);
    const strip = useRef<HTMLDivElement>(null);
    const width = useRef(0);
    const last = useRef(0);

    useEffect(() => {
        const move = (t: number) => {
            last.current = t;
            if (strip.current) strip.current.style.transform = `translateX(${width.current / 2 - t * ZOOM_PX}px)`;
        };
        controlRef(move);
        const el = box.current;
        const ro = el
            ? new ResizeObserver(() => {
                  width.current = el.clientWidth;
                  move(last.current);
              })
            : null;
        if (el && ro) ro.observe(el);
        return () => {
            ro?.disconnect();
            controlRef(null);
        };
    }, [controlRef]);

    return (
        <div
            ref={box}
            className="relative h-14 overflow-hidden rounded-md border bg-[var(--mx-lane)] select-none"
            aria-label="Vista ampliada de los acordes alrededor del momento actual"
        >
            <div ref={strip} className="absolute inset-y-0 left-0 will-change-transform" style={{ width: duration * ZOOM_PX }}>
                {chords.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        ref={(el) => blockRef(c.id, el)}
                        data-current="false"
                        onClick={() => onSeek(c.start)}
                        onDoubleClick={() => onEdit(c)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            onEdit(c);
                        }}
                        className={cn(
                            'absolute inset-y-1 overflow-hidden rounded-[5px] border px-2 text-left text-xl font-bold whitespace-nowrap',
                            'data-[current=true]:border-[var(--mx-accent)] data-[current=true]:bg-[var(--mx-accent)] data-[current=true]:text-[var(--mx-accent-ink)]',
                            c.chord === 'N' ? 'border-transparent text-[var(--mx-muted)]' : 'bg-background border-border',
                        )}
                        style={{ left: c.start * ZOOM_PX + 1, width: Math.max(3, (c.end - c.start) * ZOOM_PX - 2) }}
                        title={`${chordLabel(c.chord)} · ${fmtR(c.start)} a ${fmtR(c.end)} · doble clic o clic derecho para corregir`}
                        tabIndex={-1}
                    >
                        {chordLabel(c.chord)}
                        {c.edited && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-sky-500" aria-hidden />}
                    </button>
                ))}
                {frontier !== null && frontier < duration && (
                    <div
                        className="text-muted-foreground absolute inset-y-0 right-0 flex items-center bg-[repeating-linear-gradient(135deg,var(--mx-hatch)_0_5px,transparent_5px_11px)] pl-3 text-sm"
                        style={{ left: frontier * ZOOM_PX }}
                    >
                        analizando…
                    </div>
                )}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 -ml-px w-0.5 bg-[var(--mx-accent)]" />
        </div>
    );
}
