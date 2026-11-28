/**
 * Motor de audio del mezclador (Web Audio API).
 * Basado en referencias/mezclador.html: todas las pistas suenan sincronizadas
 * desde un mismo AudioContext; cada una tiene su GainNode, y los silencios
 * programados se aplican con rampas de ganancia agendadas en el tiempo.
 */

export interface MixTrackState {
    id: number;
    volume: number; // 0 a 1
    muted: boolean;
    solo: boolean;
}

export interface Silence {
    key: number; // identificador local (no viene de la BD)
    trackId: number;
    start: number; // segundos
    end: number;
}

interface EngineTrack {
    id: number;
    buffer: AudioBuffer;
    gain: GainNode;
    src: AudioBufferSourceNode | null;
}

/**
 * Constante de tiempo (s) de los fundidos de los silencios programados: la
 * ganancia llega al ~95 % en 3·τ ≈ 18 ms. La usan el reproductor y la
 * exportación, para que la mezcla exportada suene igual (sin chasquidos).
 */
export const SILENCE_TAU = 0.006;

/** ¿Suena esta pista según mute/solo? */
export function isAudible(t: MixTrackState, anySolo: boolean): boolean {
    return anySolo ? t.solo && !t.muted : !t.muted;
}

/** Une silencios solapados de una pista: [[1,3],[2,5]] -> [[1,5]] */
export function mergedSilences(silences: Silence[], trackId: number): { start: number; end: number }[] {
    const list = silences
        .filter((s) => s.trackId === trackId)
        .map((s) => ({ start: s.start, end: s.end }))
        .sort((a, b) => a.start - b.start);
    const out: { start: number; end: number }[] = [];
    for (const r of list) {
        const last = out[out.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else out.push({ ...r });
    }
    return out;
}

/** Envolvente de amplitud (máximos por columna) para dibujar la onda. */
export function computeEnvelope(buf: AudioBuffer, total: number, columns = 4000): Float32Array {
    const env = new Float32Array(columns);
    const chs: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
    const perCol = (total * buf.sampleRate) / columns;
    for (let i = 0; i < columns; i++) {
        const a = Math.floor(i * perCol);
        const b = Math.min(buf.length, Math.floor((i + 1) * perCol));
        if (a >= buf.length) break;
        const stride = Math.max(1, Math.floor((b - a) / 256));
        let m = 0;
        for (const d of chs)
            for (let j = a; j < b; j += stride) {
                const v = Math.abs(d[j]);
                if (v > m) m = v;
            }
        env[i] = m;
    }
    return env;
}

export class MixerEngine {
    readonly ctx: AudioContext;
    private master: GainNode;
    private tracks = new Map<number, EngineTrack>();
    duration = 0;
    playing = false;
    private offset = 0; // posición (s) cuando está pausado
    private startAt = 0; // ctx.currentTime en que empezó a sonar desde "offset"
    private state: MixTrackState[] = [];
    private silences: Silence[] = [];
    /** Se llama cuando la reproducción llega al final. */
    onEnded: (() => void) | null = null;
    private endTimer = 0;

    constructor(masterVolume: number) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = masterVolume;
        this.master.connect(this.ctx.destination);
    }

    addTrack(id: number, buffer: AudioBuffer): void {
        const gain = this.ctx.createGain();
        gain.connect(this.master);
        this.tracks.set(id, { id, buffer, gain, src: null });
        this.duration = Math.max(this.duration, buffer.duration);
    }

    /** Posición actual en segundos. */
    now(): number {
        if (!this.playing) return this.offset;
        return Math.min(this.duration, Math.max(0, this.offset + Math.max(0, this.ctx.currentTime - this.startAt)));
    }

    setMaster(v: number): void {
        this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }

    /** Actualiza mute/solo/volumen y silencios y reprograma las ganancias. */
    setMix(state: MixTrackState[], silences: Silence[]): void {
        this.state = state;
        this.silences = silences;
        this.scheduleGains();
    }

    async play(): Promise<void> {
        if (!this.tracks.size) return;
        await this.ctx.resume();
        if (this.offset >= this.duration - 0.05) this.offset = 0;
        const when = this.ctx.currentTime + 0.06;
        for (const t of this.tracks.values()) {
            if (this.offset < t.buffer.duration) {
                const src = this.ctx.createBufferSource();
                src.buffer = t.buffer;
                src.connect(t.gain);
                src.start(when, this.offset);
                t.src = src;
            }
        }
        this.startAt = when;
        this.playing = true;
        this.scheduleGains();
        window.clearTimeout(this.endTimer);
        this.endTimer = window.setTimeout(() => this.handleEnd(), (this.duration - this.offset + 0.1) * 1000);
    }

    pause(): void {
        this.offset = this.now();
        this.stopSources();
        this.playing = false;
        window.clearTimeout(this.endTimer);
        this.scheduleGains();
    }

    seek(t: number): void {
        t = Math.min(this.duration, Math.max(0, t));
        if (this.playing) {
            this.stopSources();
            this.playing = false;
            this.offset = t;
            void this.play();
        } else {
            this.offset = t;
            this.scheduleGains();
        }
    }

    /** Audio decodificado de una pista (para exportar la mezcla). */
    buffer(id: number): AudioBuffer | undefined {
        return this.tracks.get(id)?.buffer;
    }

    destroy(): void {
        window.clearTimeout(this.endTimer);
        this.stopSources();
        void this.ctx.close();
    }

    private handleEnd(): void {
        if (!this.playing) return;
        if (this.now() >= this.duration - 0.05) {
            this.pause();
            this.offset = this.duration;
            this.onEnded?.();
        }
    }

    private stopSources(): void {
        for (const t of this.tracks.values()) {
            if (t.src) {
                try {
                    t.src.stop();
                } catch {
                    /* ya detenida */
                }
                t.src.disconnect();
                t.src = null;
            }
        }
    }

    /** Programa la ganancia de cada pista: volumen base y silencios por venir. */
    private scheduleGains(): void {
        const n = this.ctx.currentTime;
        const anySolo = this.state.some((t) => t.solo);
        const t0 = this.playing ? Math.max(n, this.startAt) : n;
        const p0 = this.playing ? this.offset + (t0 - this.startAt) : this.offset;

        for (const st of this.state) {
            const tr = this.tracks.get(st.id);
            if (!tr) continue;
            const g = tr.gain.gain;
            g.cancelScheduledValues(n);
            g.setValueAtTime(g.value, n);
            const base = isAudible(st, anySolo) ? st.volume : 0;
            const regs = mergedSilences(this.silences, st.id);
            const inside = regs.some((r) => p0 >= r.start && p0 < r.end);
            g.setTargetAtTime(inside ? 0 : base, n, 0.012);
            if (this.playing && base > 0) {
                for (const r of regs) {
                    if (r.end <= p0) continue;
                    if (r.start > p0) g.setTargetAtTime(0, t0 + (r.start - p0), SILENCE_TAU);
                    g.setTargetAtTime(base, t0 + (r.end - p0), SILENCE_TAU);
                }
            }
        }
    }
}

/**
 * Descarga una pista con progreso y la decodifica.
 * onProgress recibe bytes descargados y total (si el servidor lo indica).
 */
export async function loadTrack(
    ctx: AudioContext,
    url: string,
    onProgress: (loaded: number, total: number | null) => void,
    signal: AbortSignal,
): Promise<AudioBuffer> {
    const res = await fetch(url, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || null;

    let data: ArrayBuffer;
    if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            onProgress(loaded, total);
        }
        const all = new Uint8Array(loaded);
        let pos = 0;
        for (const c of chunks) {
            all.set(c, pos);
            pos += c.length;
        }
        data = all.buffer;
    } else {
        data = await res.arrayBuffer();
        onProgress(data.byteLength, data.byteLength);
    }
    return ctx.decodeAudioData(data);
}
