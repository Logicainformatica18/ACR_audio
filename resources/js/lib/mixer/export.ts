/**
 * Exportar mezcla: construir exactamente lo que se oye y renderizarlo.
 *
 * Se renderiza en el navegador con OfflineAudioContext usando el MISMO grafo
 * que el reproductor (engine.ts): una ganancia por pista con su volumen, la
 * ganancia general, y los silencios programados con las mismas rampas
 * setTargetAtTime(constante SILENCE_TAU). Así suena igual que en el mezclador.
 */
import { isAudible, mergedSilences, SILENCE_TAU, type MixTrackState, type Silence } from '@/lib/mixer/engine';

export type ExportFormat = 'wav' | 'flac' | 'mp3';

export interface ExportTrackInfo {
    id: number;
    label: string;
    stem: string;
    original: boolean;
}

export interface PlanInput {
    tracks: ExportTrackInfo[];
    mix: MixTrackState[];
    silences: Pick<Silence, 'trackId' | 'start' | 'end'>[];
    /** Pistas visibles (la "Original" oculta no se exporta). */
    visibleIds: Set<number>;
    master: number;
    duration: number;
    /** Tramo a exportar; null = canción completa. */
    range: { start: number; end: number } | null;
}

export interface PlanTrack {
    id: number;
    volume: number;
    /** Silencios dentro del tramo, unidos y relativos al inicio del tramo (s). */
    regions: { start: number; end: number }[];
}

export interface MixPlan {
    tracks: PlanTrack[];
    master: number;
    start: number;
    end: number;
}

/**
 * Qué suena: las pistas visibles que mute/solo dejan sonar y con volumen > 0,
 * cada una con su volumen y sus silencios recortados al tramo elegido.
 */
export function buildMixPlan(input: PlanInput): MixPlan {
    const start = Math.max(0, Math.min(input.range?.start ?? 0, input.duration));
    const end = Math.max(start, Math.min(input.range?.end ?? input.duration, input.duration));
    const candidates = input.mix.filter((t) => input.visibleIds.has(t.id));
    const anySolo = candidates.some((t) => t.solo);

    const tracks = candidates
        .filter((t) => isAudible(t, anySolo) && t.volume > 0)
        .map((t) => ({
            id: t.id,
            volume: t.volume,
            regions: mergedSilences(input.silences as Silence[], t.id)
                .map((r) => ({ start: Math.max(r.start, start) - start, end: Math.min(r.end, end) - start }))
                .filter((r) => r.end - r.start > 0.001),
        }));

    return { tracks, master: input.master, start, end };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const joinEs = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** "sin batería", "solo voz y guitarra", "mezcla completa"… según lo que suena. */
export function describeMix(input: PlanInput): string {
    const plan = buildMixPlan(input);
    const byId = new Map(input.tracks.map((t) => [t.id, t]));
    const stems = input.tracks.filter((t) => !t.original && input.visibleIds.has(t.id));
    if (!stems.length) return 'original';
    const playing = new Set(plan.tracks.map((t) => t.id));
    const playingStems = stems.filter((t) => playing.has(t.id));
    const silenced = stems.filter((t) => !playing.has(t.id));
    const anySolo = input.mix.some((t) => t.solo && input.visibleIds.has(t.id));
    if (anySolo || (playingStems.length && playingStems.length < silenced.length)) {
        const names = plan.tracks.map((t) => lowerFirst(byId.get(t.id)!.label));
        return names.length ? `solo ${joinEs(names)}` : 'silencio';
    }
    if (!silenced.length) return 'mezcla completa';
    return `sin ${joinEs(silenced.map((t) => lowerFirst(t.label)))}`;
}

/** 75.4 -> "1.15" (sin ":" para que sirva como nombre de archivo en Windows). */
const fmtFile = (t: number) => `${Math.floor(t / 60)}.${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** "Crush of Love - sin batería" (+ " (1.00-2.30)" si es un tramo). Sin extensión. */
export function suggestName(title: string, input: PlanInput): string {
    const plan = buildMixPlan(input);
    const isRange = input.range && (plan.start > 0.05 || plan.end < input.duration - 0.05);
    return `${title} - ${describeMix(input)}${isRange ? ` (${fmtFile(plan.start)}-${fmtFile(plan.end)})` : ''}`;
}

/**
 * Ganancia para no saturar: si el pico de la mezcla pasa de 0,98, se baja TODO
 * por igual hasta 0,97 (normalizar), sin cambiar el balance entre pistas.
 */
export function antiClipGain(peak: number): number {
    return peak > 0.98 ? 0.97 / peak : 1;
}

export function peakOf(channels: Float32Array[]): number {
    let peak = 0;
    for (const ch of channels)
        for (let i = 0; i < ch.length; i++) {
            const v = Math.abs(ch[i]);
            if (v > peak) peak = v;
        }
    return peak;
}

/** WAV PCM de 16 bits (con la ganancia aplicada) a partir de canales en coma flotante. */
export function encodeWav(channels: Float32Array[], sampleRate: number, gain = 1): ArrayBuffer {
    const numCh = channels.length;
    const len = channels[0]?.length ?? 0;
    const dataBytes = len * numCh * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + dataBytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, numCh, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * numCh * 2, true);
    v.setUint16(32, numCh * 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, dataBytes, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < numCh; c++) {
            const s = Math.max(-1, Math.min(1, channels[c][i] * gain));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            o += 2;
        }
    }
    return buf;
}

/**
 * Renderiza la mezcla con OfflineAudioContext (más rápido que tiempo real),
 * informando del progreso. Se puede cancelar con signal.
 */
export async function renderMix(
    plan: MixPlan,
    buffers: Map<number, AudioBuffer>,
    onProgress: (pct: number) => void,
    signal: AbortSignal,
): Promise<AudioBuffer> {
    const first = buffers.get(plan.tracks[0]?.id);
    if (!first) throw new Error('No hay pistas que suenen en esta mezcla.');
    const sr = first.sampleRate;
    const seconds = plan.end - plan.start;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sr)), sr);
    const master = ctx.createGain();
    master.gain.value = plan.master;
    master.connect(ctx.destination);

    for (const t of plan.tracks) {
        const buffer = buffers.get(t.id);
        if (!buffer) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        src.connect(g).connect(master);
        // Igual que el reproductor: volumen base y, en cada silencio, rampa a 0 y de vuelta.
        const startsSilent = t.regions.some((r) => r.start <= 0 && r.end > 0);
        g.gain.setValueAtTime(startsSilent ? 0 : t.volume, 0);
        for (const r of t.regions) {
            if (r.start > 0) g.gain.setTargetAtTime(0, r.start, SILENCE_TAU);
            g.gain.setTargetAtTime(t.volume, r.end, SILENCE_TAU);
        }
        src.start(0, plan.start, seconds);
    }

    // Progreso: se suspende cada 5 % para informar (y para poder cancelar).
    const steps = 20;
    for (let i = 1; i < steps; i++) {
        const at = (seconds * i) / steps;
        ctx.suspend(at).then(() => {
            onProgress(Math.round((i / steps) * 100));
            if (!signal.aborted) void ctx.resume();
        });
    }
    // Si se cancela, el contexto queda suspendido (no se reanuda) y se rechaza al momento.
    const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(new DOMException('Cancelado', 'AbortError'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
    });
    const result = await Promise.race([ctx.startRendering(), aborted]);
    onProgress(100);
    return result;
}
