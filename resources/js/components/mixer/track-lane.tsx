import { type Silence } from '@/lib/mixer/engine';
import { clamp, fmtR } from '@/lib/mixer/time';
import { useEffect, useRef, useState } from 'react';

interface Props {
    label: string;
    color: string;
    duration: number;
    envelope: Float32Array | null;
    silences: Silence[];
    dimmed: boolean;
    onSeek: (t: number) => void;
    onAddSilence: (start: number, end: number) => void;
    onRemoveSilence: (key: number) => void;
    headRef: (el: HTMLDivElement | null) => void;
    /** % de descarga mientras el audio aún no está listo (la onda ya se ve); null = listo. */
    loading?: number | null;
}

const pct = (t: number, d: number) => (d ? clamp(t / d, 0, 1) * 100 : 0) + '%';

/** Carril de una pista: onda, silencios (rayados) y cabezal. Clic = saltar; arrastrar = programar silencio. */
export function TrackLane({
    label,
    color,
    duration,
    envelope,
    silences,
    dimmed,
    onSeek,
    onAddSilence,
    onRemoveSilence,
    headRef,
    loading = null,
}: Props) {
    const laneRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [ghost, setGhost] = useState<{ a: number; b: number } | null>(null);

    // Dibuja la onda (y la redibuja si cambia el tamaño).
    useEffect(() => {
        const c = canvasRef.current;
        if (!c || !envelope) return;
        const draw = () => {
            const w = c.clientWidth;
            const h = c.clientHeight;
            if (!w || !h) return;
            const dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
            const g = c.getContext('2d');
            if (!g) return;
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, w, h);
            g.fillStyle = color;
            const N = envelope.length;
            const mid = h / 2;
            for (let x = 0; x < w; x++) {
                const a = Math.floor((x / w) * N);
                const b = Math.max(a + 1, Math.floor(((x + 1) / w) * N));
                let m = 0;
                for (let i = a; i < b && i < N; i++) if (envelope[i] > m) m = envelope[i];
                const bh = Math.max(1, Math.min(1, m * 1.1) * h * 0.86);
                g.fillRect(x, mid - bh / 2, 1, bh);
            }
        };
        draw();
        const ro = new ResizeObserver(draw);
        ro.observe(c);
        return () => ro.disconnect();
    }, [envelope, color]);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (loading !== null || e.button !== 0 || (e.target as HTMLElement).closest('[data-silence]')) return;
        const lane = laneRef.current!;
        const rect = lane.getBoundingClientRect();
        const tAt = (x: number) => clamp((x - rect.left) / rect.width, 0, 1) * duration;
        const x0 = e.clientX;
        let x1 = x0;
        let dragging = false;
        lane.setPointerCapture(e.pointerId);

        const move = (ev: PointerEvent) => {
            x1 = ev.clientX;
            if (!dragging && Math.abs(x1 - x0) > 5) dragging = true;
            if (dragging) setGhost({ a: tAt(Math.min(x0, x1)), b: tAt(Math.max(x0, x1)) });
        };
        const up = () => {
            lane.removeEventListener('pointermove', move);
            lane.removeEventListener('pointerup', up);
            lane.removeEventListener('pointercancel', up);
            setGhost(null);
            if (dragging) {
                const a = tAt(Math.min(x0, x1));
                const b = tAt(Math.max(x0, x1));
                if (b - a >= 0.2) onAddSilence(a, b);
            } else onSeek(tAt(x0));
        };
        lane.addEventListener('pointermove', move);
        lane.addEventListener('pointerup', up);
        lane.addEventListener('pointercancel', up);
    };

    return (
        <div
            ref={laneRef}
            onPointerDown={onPointerDown}
            className="relative min-h-[76px] cursor-crosshair touch-pan-y overflow-hidden rounded-md bg-[var(--mx-lane)] select-none"
            aria-label={`Pista ${label}: haz clic para saltar, arrastra para programar un silencio`}
        >
            <canvas ref={canvasRef} className={'absolute inset-0 size-full transition-opacity ' + (dimmed || loading !== null ? 'opacity-25' : '')} />
            {loading !== null && (
                <div className="text-muted-foreground absolute inset-0 grid cursor-wait place-items-center text-sm">
                    <span className="bg-background/80 rounded px-2 py-0.5">Cargando audio… {loading}%</span>
                </div>
            )}
            {silences.map((s) => (
                <div
                    key={s.key}
                    data-silence
                    className="absolute inset-y-0 cursor-default border-x-2 border-[var(--mx-muted)] bg-[repeating-linear-gradient(135deg,var(--mx-hatch)_0_5px,transparent_5px_11px)]"
                    style={{ left: pct(s.start, duration), width: ((s.end - s.start) / duration) * 100 + '%' }}
                    title={`${label} en silencio de ${fmtR(s.start)} a ${fmtR(s.end)}`}
                >
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemoveSilence(s.key);
                        }}
                        className="bg-background text-foreground ring-border absolute top-1 right-1 grid size-[22px] place-items-center rounded-full text-sm leading-none ring-1"
                        aria-label={`Quitar silencio de ${label} de ${fmtR(s.start)} a ${fmtR(s.end)}`}
                    >
                        ×
                    </button>
                </div>
            ))}
            {ghost && (
                <div
                    className="pointer-events-none absolute inset-y-0 border-x-2 border-dashed border-[var(--mx-accent)] bg-[repeating-linear-gradient(135deg,var(--mx-hatch)_0_5px,transparent_5px_11px)]"
                    style={{ left: pct(ghost.a, duration), width: ((ghost.b - ghost.a) / duration) * 100 + '%' }}
                />
            )}
            <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 -ml-px w-0.5 bg-[var(--mx-accent)]" />
        </div>
    );
}
