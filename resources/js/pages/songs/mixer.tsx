import { ConfirmDialog } from '@/components/confirm-dialog';
import { InlineEdit } from '@/components/inline-edit';
import { ChordEditDialog } from '@/components/mixer/chord-edit-dialog';
import { ChordLane, ChordZoom } from '@/components/mixer/chord-lane';
import { ChordSheet } from '@/components/mixer/chord-sheet';
import { TrackLane } from '@/components/mixer/track-lane';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import {
    chordIndexAt,
    chordLabel,
    decodePeaks,
    isAnalyzing,
    nextChordIndex,
    useChords,
    type ChordAnalysis,
    type ChordItem,
} from '@/lib/mixer/chords';
import { computeEnvelope, isAudible, loadTrack, mergedSilences, MixerEngine, type MixTrackState, type Silence } from '@/lib/mixer/engine';
import { clamp, fmt, fmtR, parseTime } from '@/lib/mixer/time';
import { useAutosave, type SaveStatus } from '@/lib/mixer/use-autosave';
import { cn } from '@/lib/utils';
import { type BreadcrumbItem, type Song } from '@/types';
import { Head, Link, router } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import {
    AlertCircle,
    ArrowLeft,
    Ban,
    Check,
    Download,
    Eye,
    EyeOff,
    Layers,
    ListMusic,
    LoaderCircle,
    Music2,
    Pause,
    Play,
    RefreshCw,
    SkipBack,
    Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface MixerTrack {
    id: number;
    stem: string;
    label: string;
    default_label: string; // nombre de su tipo ("Guitarra"), aunque el usuario la renombre
    color: string;
    size: number;
    url: string;
    peaks: string | null; // forma de onda precalculada (base64) o null
    original: boolean; // la pista "Original" (el archivo subido tal cual)
    volume: number;
    muted: boolean;
    solo: boolean;
    silences: { start: number; end: number }[];
}

interface Props {
    song: Song;
    tracks: MixerTrack[];
    preferences: { master_volume: number; keyboard_shortcuts: boolean };
    analysis: ChordAnalysis;
    chords: ChordItem[];
}

let nextKey = 1;

const SHEET_KEY = 'acr.mixer.chordSheet';

function readSheetPref(): boolean {
    try {
        return window.localStorage.getItem(SHEET_KEY) === '1';
    } catch {
        return false;
    }
}

export default function Mixer({ song, tracks, preferences, analysis: initialAnalysis, chords: initialChords }: Props) {
    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Canciones', href: '/songs' },
        { title: song.title, href: `/songs/${song.id}` },
    ];

    // ----- Estado que se guarda en la BD -----
    const [mix, setMix] = useState<MixTrackState[]>(() => tracks.map((t) => ({ id: t.id, volume: t.volume, muted: t.muted, solo: t.solo })));
    const [silences, setSilences] = useState<Silence[]>(() =>
        tracks.flatMap((t) => t.silences.map((s) => ({ key: nextKey++, trackId: t.id, start: s.start, end: s.end }))),
    );
    const [master, setMaster] = useState(preferences.master_volume);

    // ----- Carga y reproducción -----
    const engineRef = useRef<MixerEngine | null>(null);
    const [loadProgress, setLoadProgress] = useState<Record<number, number>>({});
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Formas de onda precalculadas en el servidor: se dibujan antes de descargar el audio.
    const [envelopes, setEnvelopes] = useState<Record<number, Float32Array>>(() => {
        const env: Record<number, Float32Array> = {};
        for (const t of tracks) {
            const peaks = decodePeaks(t.peaks);
            if (peaks) env[t.id] = peaks;
        }
        return env;
    });
    const [duration, setDuration] = useState(song.duration ?? 0);
    const [playing, setPlaying] = useState(false);
    const [message, setMessage] = useState('');

    // Elementos que se actualizan en cada fotograma sin re-renderizar React.
    const heads = useRef(new Map<string, HTMLDivElement>());
    const rows = useRef(new Map<number, HTMLDivElement>());
    const timeRef = useRef<HTMLSpanElement>(null);
    const raf = useRef(0);

    const setHead = (key: string, el: HTMLDivElement | null) => {
        if (el) heads.current.set(key, el);
        else heads.current.delete(key);
    };

    // ----- Acordes -----
    const { chords, analysis, editChord, reanalyze, cancel: cancelChords, pendingSince } = useChords(song.id, initialChords, initialAnalysis);

    /** Detecta acordes sin pedir confirmación (no hay nada que reemplazar). */
    const detectChords = async (ok = 'Detectando acordes. Aparecerán a medida que se detecten.') => {
        const err = await reanalyze();
        setMessage(err ?? ok);
    };
    const analyzing = isAnalyzing(analysis);
    const [editingChord, setEditingChord] = useState<ChordItem | null>(null);
    const [confirmReanalyze, setConfirmReanalyze] = useState(false);
    const [showSheet, setShowSheet] = useState(readSheetPref);
    const [clock, setClock] = useState(() => Date.now());
    const chordsRef = useRef(chords);
    chordsRef.current = chords;
    const chordUI = useRef({
        lastId: -2,
        blocks: new Map<number, HTMLButtonElement>(),
        zoom: new Map<number, HTMLButtonElement>(),
        chips: new Map<number, HTMLButtonElement>(),
        sheet: null as HTMLDivElement | null,
    });
    const chordNowRef = useRef<HTMLSpanElement>(null);
    const zoomMove = useRef<((t: number) => void) | null>(null);
    const setZoomControl = useCallback((fn: ((t: number) => void) | null) => {
        zoomMove.current = fn;
        if (fn) fn(engineRef.current?.now() ?? 0);
    }, []);
    const chordNextRef = useRef<HTMLSpanElement>(null);

    // Hasta dónde llegó el análisis en curso (los editados a mano no cuentan).
    const frontier = analyzing ? chords.reduce((m, c) => (c.edited ? m : Math.max(m, c.end)), 0) : null;

    /** Resalta el acorde que suena en t (fila, hoja e indicador grande). */
    const updateChordUI = useCallback((t: number, force = false) => {
        const ui = chordUI.current;
        const list = chordsRef.current;
        const i = chordIndexAt(list, t);
        const id = i >= 0 ? list[i].id : -1;
        if (id === ui.lastId && !force) return;
        for (const map of [ui.blocks, ui.zoom, ui.chips]) for (const el of map.values()) el.dataset.current = 'false';
        ui.lastId = id;
        const block = ui.blocks.get(id);
        const zoomBlock = ui.zoom.get(id);
        const chip = ui.chips.get(id);
        if (block) block.dataset.current = 'true';
        if (zoomBlock) zoomBlock.dataset.current = 'true';
        if (chip) {
            chip.dataset.current = 'true';
            // Mantiene visible el acorde actual dentro de la hoja (sin mover la página).
            const box = ui.sheet;
            if (box && (chip.offsetTop < box.scrollTop || chip.offsetTop + chip.offsetHeight > box.scrollTop + box.clientHeight)) {
                box.scrollTop = chip.offsetTop - box.clientHeight / 3;
            }
        }
        const j = nextChordIndex(list, i, t);
        if (chordNowRef.current) chordNowRef.current.textContent = i >= 0 ? chordLabel(list[i].chord) : '—';
        if (chordNextRef.current) chordNextRef.current.textContent = j >= 0 ? list[j].chord : '';
    }, []);

    useEffect(() => {
        updateChordUI(engineRef.current?.now() ?? 0, true);
    }, [chords, showSheet, updateChordUI]);

    // Para el aviso "¿está abierta la ventana ACORDES?" mientras sigue en cola.
    useEffect(() => {
        if (analysis.status !== 'pending') return;
        const id = window.setInterval(() => setClock(Date.now()), 2000);
        return () => window.clearInterval(id);
    }, [analysis.status]);

    const toggleSheet = () => {
        setShowSheet((v) => {
            try {
                window.localStorage.setItem(SHEET_KEY, v ? '0' : '1');
            } catch {
                /* sin almacenamiento: solo dura esta visita */
            }
            return !v;
        });
    };

    const meta = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
    const anySolo = mix.some((t) => t.solo);

    const payload = useMemo(
        () => ({
            master_volume: master,
            tracks: mix.map((t) => ({ id: t.id, volume: t.volume, muted: t.muted, solo: t.solo })),
            silences: silences.map((s) => ({ track_id: s.trackId, start: +s.start.toFixed(3), end: +s.end.toFixed(3) })),
        }),
        [mix, silences, master],
    );
    const { status: saveStatus, retry: retrySave } = useAutosave(route('songs.mixer.save', song.id), payload, true);

    // ----- Nombres de las pistas (renombrar en línea, con guardado optimista) -----
    const [labels, setLabels] = useState<Record<number, string>>(() => Object.fromEntries(tracks.map((t) => [t.id, t.label])));
    const [editingTrack, setEditingTrack] = useState<number | null>(null);
    const renameTrack = async (id: number, label: string) => {
        const before = labels[id];
        const fallback = tracks.find((t) => t.id === id)?.default_label ?? before;
        setLabels((l) => ({ ...l, [id]: label || fallback }));
        try {
            const { data } = await axios.patch<{ label: string }>(
                route('songs.tracks.rename', [song.id, id]),
                { label },
                { headers: { Accept: 'application/json' } },
            );
            setLabels((l) => ({ ...l, [id]: data.label }));
        } catch (e) {
            setLabels((l) => ({ ...l, [id]: before }));
            toast.error((e as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo renombrar la pista.');
        }
    };

    // ----- Pista "Original" -----
    // En una canción separada va oculta (y sin descargar) hasta que se pide para comparar.
    const hasStems = tracks.some((t) => !t.original);
    const originalTrack = tracks.find((t) => t.original) ?? null;
    const [showOriginal, setShowOriginal] = useState(!hasStems);
    const [loadedIds, setLoadedIds] = useState<Set<number>>(new Set());
    const visibleIds = useMemo(() => new Set(tracks.filter((t) => !t.original || showOriginal).map((t) => t.id)), [tracks, showOriginal]);

    const toggleOriginal = async () => {
        const show = !showOriginal;
        setShowOriginal(show);
        const engine = engineRef.current;
        if (!show || !originalTrack || !engine || loadedIds.has(originalTrack.id)) return;
        try {
            const buf = await loadTrack(
                engine.ctx,
                originalTrack.url,
                (loaded, total) =>
                    setLoadProgress((p) => ({ ...p, [originalTrack.id]: Math.round((loaded / (total ?? originalTrack.size ?? loaded)) * 100) })),
                new AbortController().signal,
            );
            if (engineRef.current !== engine) return;
            engine.addTrack(originalTrack.id, buf);
            if (!originalTrack.peaks) setEnvelopes((prev) => ({ ...prev, [originalTrack.id]: computeEnvelope(buf, engine.duration) }));
            setLoadedIds((prev) => new Set(prev).add(originalTrack.id));
            // Si está sonando, se reanuda en el mismo punto para que la nueva pista entre sincronizada.
            if (engine.playing) engine.seek(engine.now());
        } catch (e) {
            setMessage('No se pudo cargar la pista original: ' + (e instanceof Error ? e.message : String(e)));
        }
    };

    // ----- Separación -----
    const [separating, setSeparating] = useState(false);
    const requestSeparation = async () => {
        setSeparating(true);
        try {
            await axios.post(route('songs.separate', song.id), {}, { headers: { Accept: 'application/json' } });
            router.reload({ only: ['song'] });
            setMessage('Separación en cola. Las pistas aparecerán aquí cuando termine (recarga la página).');
        } catch (e) {
            setMessage((e as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo poner en cola la separación.');
        } finally {
            setSeparating(false);
        }
    };

    // Descarga y decodifica las pistas visibles (2 a la vez).
    useEffect(() => {
        const engine = new MixerEngine(preferences.master_volume);
        engineRef.current = engine;
        const abort = new AbortController();
        let cancelled = false;

        (async () => {
            try {
                const buffers = new Map<number, AudioBuffer>();
                const initial = tracks.filter((t) => !(t.original && tracks.some((x) => !x.original)));
                const queue = [...initial];
                const worker = async () => {
                    for (let t = queue.shift(); t; t = queue.shift()) {
                        const track = t;
                        const buf = await loadTrack(
                            engine.ctx,
                            track.url,
                            (loaded, total) =>
                                setLoadProgress((p) => ({ ...p, [track.id]: Math.round((loaded / (total ?? track.size ?? loaded)) * 100) })),
                            abort.signal,
                        );
                        buffers.set(track.id, buf);
                        setLoadProgress((p) => ({ ...p, [track.id]: 100 }));
                    }
                };
                await Promise.all([worker(), worker()]);
                if (cancelled) return;

                for (const t of initial) engine.addTrack(t.id, buffers.get(t.id)!);
                setLoadedIds(new Set(initial.map((t) => t.id)));
                // Solo se calcula la onda de las pistas que no la traen precalculada.
                const missing = initial.filter((t) => !t.peaks);
                if (missing.length) {
                    const env: Record<number, Float32Array> = {};
                    for (const t of missing) env[t.id] = computeEnvelope(buffers.get(t.id)!, engine.duration);
                    setEnvelopes((prev) => ({ ...prev, ...env }));
                }
                setDuration(engine.duration);
                engine.onEnded = () => setPlaying(false);
                setReady(true);
            } catch (e) {
                if (!cancelled) setLoadError('No se pudieron cargar las pistas: ' + (e instanceof Error ? e.message : String(e)));
            }
        })();

        return () => {
            cancelled = true;
            abort.abort();
            cancelAnimationFrame(raf.current);
            engine.destroy();
            engineRef.current = null;
        };
        // Solo al abrir la canción.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [song.id]);

    // ----- Interfaz por fotograma: cabezales, reloj y "en silencio" -----
    const updateTimeUI = useCallback(
        (t: number) => {
            if (timeRef.current) timeRef.current.textContent = fmt(t);
            const left = (duration ? clamp(t / duration, 0, 1) * 100 : 0) + '%';
            for (const el of heads.current.values()) el.style.left = left;
            for (const [id, row] of rows.current) {
                const sil = mergedSilences(silences, id).some((r) => t >= r.start && t < r.end);
                row.dataset.silenced = sil ? 'true' : 'false';
            }
            updateChordUI(t);
            zoomMove.current?.(t);
        },
        [duration, silences, updateChordUI],
    );

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !ready) return;
        const heard = mix.filter((t) => loadedIds.has(t.id)).map((t) => (visibleIds.has(t.id) ? t : { ...t, muted: true, solo: false }));
        engine.setMix(heard, silences);
        updateTimeUI(engine.now());
    }, [mix, silences, ready, updateTimeUI, loadedIds, visibleIds]);

    const shownMix = mix.filter((t) => visibleIds.has(t.id));

    useEffect(() => {
        engineRef.current?.setMaster(master);
    }, [master]);

    useEffect(() => {
        if (!playing) return;
        const tick = () => {
            const engine = engineRef.current;
            if (!engine) return;
            updateTimeUI(engine.now());
            raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf.current);
    }, [playing, updateTimeUI]);

    // ----- Acciones -----
    const togglePlay = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine || !ready) return;
        if (engine.playing) {
            engine.pause();
            setPlaying(false);
            updateTimeUI(engine.now());
        } else {
            await engine.play();
            setPlaying(true);
        }
    }, [ready, updateTimeUI]);

    const seek = useCallback(
        (t: number) => {
            const engine = engineRef.current;
            if (!engine) return;
            engine.seek(t);
            updateTimeUI(engine.now());
        },
        [updateTimeUI],
    );

    const updateTrack = (id: number, patch: Partial<MixTrackState>) => setMix((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

    const addSilence = useCallback(
        (trackId: number, start: number, end: number): boolean => {
            start = clamp(start, 0, duration);
            end = clamp(end, 0, duration);
            if (end - start < 0.1) return false;
            setSilences((list) => [...list, { key: nextKey++, trackId, start, end }]);
            setMessage(`Silencio agregado en ${meta.get(trackId)?.label} de ${fmtR(start)} a ${fmtR(end)}.`);
            return true;
        },
        [duration, meta],
    );
    const removeSilence = (key: number) => setSilences((list) => list.filter((s) => s.key !== key));

    // ----- Atajos de teclado -----
    useEffect(() => {
        if (!preferences.keyboard_shortcuts || !ready) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = (e.target as HTMLElement).tagName?.toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea' || (e.target as HTMLElement).isContentEditable) return;
            if (e.code === 'Space') {
                if (tag === 'button') return;
                e.preventDefault();
                void togglePlay();
            } else if (/^(Digit|Numpad)[1-9]$/.test(e.code)) {
                const t = shownMix[+e.code.slice(-1) - 1];
                if (t) updateTrack(t.id, { muted: !t.muted });
            } else if (e.code === 'Home') {
                e.preventDefault();
                seek(0);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [preferences.keyboard_shortcuts, ready, togglePlay, seek, shownMix]);

    const initialTracks = tracks.filter((t) => !(t.original && hasStems));
    const totalProgress = initialTracks.length
        ? Math.round(initialTracks.reduce((a, t) => a + (loadProgress[t.id] ?? 0), 0) / initialTracks.length)
        : 0;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`Mezclador · ${song.title}`} />
            <div className="mixer flex flex-1 flex-col">
                {/* Barra de transporte fija arriba */}
                <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                        <Button
                            variant="outline"
                            size="icon"
                            className="rounded-full"
                            onClick={() => seek(0)}
                            disabled={!ready}
                            aria-label="Volver al inicio"
                            title="Volver al inicio (Inicio)"
                        >
                            <SkipBack />
                        </Button>
                        <button
                            type="button"
                            onClick={() => void togglePlay()}
                            disabled={!ready}
                            className="grid size-12 place-items-center rounded-full bg-[var(--mx-accent)] text-[var(--mx-accent-ink)] disabled:opacity-50"
                            aria-label={playing ? 'Pausar' : 'Reproducir'}
                            title="Reproducir o pausar (barra espaciadora)"
                        >
                            {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
                        </button>
                        <div className="text-2xl font-semibold tabular-nums">
                            <span ref={timeRef}>0:00</span> <span className="text-muted-foreground text-lg font-medium">/ {fmt(duration)}</span>
                        </div>
                        {(chords.length > 0 || analyzing) && (
                            <div className="flex min-w-[9rem] items-baseline gap-2" title="Acorde que suena ahora y el siguiente">
                                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Acorde</span>
                                <span ref={chordNowRef} className="text-4xl leading-none font-bold text-[var(--mx-accent)]">
                                    —
                                </span>
                                <span className="text-muted-foreground text-lg font-semibold">
                                    → <span ref={chordNextRef} />
                                </span>
                            </div>
                        )}
                        <label className="text-muted-foreground ml-auto flex items-center gap-2 text-sm">
                            Volumen general
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={master}
                                onChange={(e) => setMaster(+e.target.value)}
                                className="w-36 accent-[var(--mx-accent)]"
                            />
                        </label>
                        <SaveIndicator status={saveStatus} onRetry={retrySave} />
                    </div>
                </div>

                <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h1 className="truncate text-2xl font-semibold" title={song.title}>
                                {song.title}
                            </h1>
                            <p className="text-muted-foreground text-sm">
                                Clic en una pista para saltar a ese momento. Arrastra sobre una pista para programar un silencio. <strong>M</strong>{' '}
                                silencia la pista y <strong>S</strong> deja sonar solo esa.
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href={route('songs.index')}>
                                <ArrowLeft /> Canciones
                            </Link>
                        </Button>
                    </div>

                    <p className="text-muted-foreground min-h-5 text-sm" role="status" aria-live="polite">
                        {message}
                    </p>

                    <SeparationNotice status={song.status} busy={separating} onSeparate={requestSeparation} />

                    {loadError && (
                        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                            <AlertCircle className="size-4 shrink-0" /> {loadError}
                        </div>
                    )}

                    {!ready && !loadError && (
                        <div className="space-y-2">
                            <p className="text-sm">Cargando pistas… {totalProgress}%</p>
                            <div
                                className="bg-muted h-2 overflow-hidden rounded-full"
                                role="progressbar"
                                aria-valuenow={totalProgress}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="Cargando pistas"
                            >
                                <div className="h-full bg-[var(--mx-accent)] transition-[width]" style={{ width: `${totalProgress}%` }} />
                            </div>
                        </div>
                    )}

                    {/* Mezclador */}
                    <div className="grid gap-1.5" aria-busy={!ready}>
                        {/* Regla de tiempo */}
                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[230px_1fr]">
                            <div className="hidden md:block" />
                            <Ruler duration={duration} onSeek={seek} headRef={(el) => setHead('ruler', el)} />
                        </div>

                        {/* Acordes, alineados con la línea de tiempo */}
                        <div className="grid grid-cols-1 gap-1 md:grid-cols-[230px_1fr] md:gap-2.5">
                            <ChordInfo
                                analysis={analysis}
                                hasChords={chords.length > 0}
                                canImprove={song.status === 'ready' && analysis.status === 'ready' && analysis.source === 'original'}
                                waitingWorker={analysis.status === 'pending' && pendingSince !== null && clock - pendingSince > 8000}
                                onReanalyze={() => setConfirmReanalyze(true)}
                                onDetect={() => void detectChords()}
                                onImprove={() => void detectChords('Mejorando los acordes con las pistas separadas. Tus correcciones se conservan.')}
                                onCancel={async () => setMessage((await cancelChords()) ?? 'Se canceló la detección de acordes.')}
                            />
                            <div className="grid min-w-0 gap-1">
                                <ChordLane
                                    onDetect={() => void detectChords()}
                                    chords={chords}
                                    analysis={analysis}
                                    duration={duration}
                                    frontier={frontier}
                                    onSeek={seek}
                                    onEdit={setEditingChord}
                                    headRef={(el) => setHead('chords', el)}
                                    blockRef={(id, el) => {
                                        if (el) chordUI.current.blocks.set(id, el);
                                        else chordUI.current.blocks.delete(id);
                                    }}
                                />
                                {(chords.length > 0 || analyzing) && (
                                    <ChordZoom
                                        chords={chords}
                                        duration={duration}
                                        frontier={frontier}
                                        onSeek={seek}
                                        onEdit={setEditingChord}
                                        controlRef={setZoomControl}
                                        blockRef={(id, el) => {
                                            if (el) chordUI.current.zoom.set(id, el);
                                            else chordUI.current.zoom.delete(id);
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        {hasStems && originalTrack && (
                            <div className="flex justify-end">
                                <Button variant="ghost" size="sm" onClick={() => void toggleOriginal()} aria-pressed={showOriginal}>
                                    {showOriginal ? <EyeOff /> : <Eye />}{' '}
                                    {showOriginal ? 'Ocultar la pista original' : 'Mostrar la pista original para comparar'}
                                </Button>
                            </div>
                        )}

                        {shownMix.map((t, i) => {
                            const m = meta.get(t.id)!;
                            const audible = isAudible(t, anySolo);
                            return (
                                <div
                                    key={t.id}
                                    ref={(el) => {
                                        if (el) rows.current.set(t.id, el);
                                        else rows.current.delete(t.id);
                                    }}
                                    className="group grid grid-cols-1 gap-1 md:grid-cols-[230px_1fr] md:gap-2.5"
                                    data-silenced="false"
                                >
                                    <div
                                        className="bg-card grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 rounded-md border border-l-[5px] px-2.5 py-2"
                                        style={{ borderLeftColor: m.color }}
                                    >
                                        <span
                                            className={cn(
                                                'min-w-0 truncate text-xl leading-tight font-semibold',
                                                !audible && 'text-muted-foreground',
                                            )}
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === 'F2' && editingTrack !== t.id) {
                                                    e.preventDefault();
                                                    setEditingTrack(t.id);
                                                }
                                            }}
                                            aria-label={`Pista ${labels[t.id] ?? m.label}: doble clic o F2 para renombrar`}
                                        >
                                            <InlineEdit
                                                value={labels[t.id] ?? m.label}
                                                editing={editingTrack === t.id}
                                                onEditingChange={(e) => setEditingTrack(e ? t.id : null)}
                                                onSave={(label) => void renameTrack(t.id, label)}
                                                allowEmpty
                                                maxLength={100}
                                                ariaLabel={`Nombre de la pista (vacío = ${m.default_label})`}
                                                className="truncate"
                                                inputClassName="w-full text-lg font-semibold"
                                            />
                                            <span className="text-muted-foreground ml-1.5 hidden align-middle text-xs font-normal group-data-[silenced=true]:inline">
                                                en silencio
                                            </span>
                                        </span>
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                aria-pressed={t.muted}
                                                onClick={() => updateTrack(t.id, { muted: !t.muted })}
                                                className="h-[30px] w-8 rounded-[5px] border text-sm font-semibold aria-pressed:border-[var(--mx-accent)] aria-pressed:bg-[var(--mx-accent)] aria-pressed:text-[var(--mx-accent-ink)]"
                                                aria-label={`Silenciar ${m.label}`}
                                                title={`Silenciar ${m.label}${i < 9 ? ` (tecla ${i + 1})` : ''}`}
                                            >
                                                M
                                            </button>
                                            <button
                                                type="button"
                                                aria-pressed={t.solo}
                                                onClick={() => updateTrack(t.id, { solo: !t.solo })}
                                                className="h-[30px] w-8 rounded-[5px] border text-sm font-semibold aria-pressed:text-[#14171C]"
                                                style={t.solo ? { background: m.color, borderColor: m.color } : undefined}
                                                aria-label={`Solo ${m.label}`}
                                                title={`Escuchar solo ${m.label}`}
                                            >
                                                S
                                            </button>
                                            <a
                                                href={`${m.url}?download=1`}
                                                className="grid h-[30px] w-8 place-items-center rounded-[5px] border"
                                                aria-label={`Descargar pista ${m.label}`}
                                                title={`Descargar ${m.label} (FLAC)`}
                                            >
                                                <Download className="size-4" />
                                            </a>
                                        </div>
                                        <label className="col-span-2 flex items-center gap-2">
                                            <span className="sr-only">Volumen de {m.label}</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                value={t.volume}
                                                onChange={(e) => updateTrack(t.id, { volume: +e.target.value })}
                                                className="w-full accent-[var(--mx-accent)]"
                                            />
                                            <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">
                                                {Math.round(t.volume * 100)}%
                                            </span>
                                        </label>
                                    </div>
                                    {ready || envelopes[t.id] ? (
                                        <TrackLane
                                            loading={ready && loadedIds.has(t.id) ? null : (loadProgress[t.id] ?? 0)}
                                            label={m.label}
                                            color={m.color}
                                            duration={duration}
                                            envelope={envelopes[t.id] ?? null}
                                            silences={silences.filter((s) => s.trackId === t.id)}
                                            dimmed={!audible}
                                            onSeek={seek}
                                            onAddSilence={(a, b) => addSilence(t.id, a, b)}
                                            onRemoveSilence={removeSilence}
                                            headRef={(el) => setHead(`t${t.id}`, el)}
                                        />
                                    ) : (
                                        <div className="text-muted-foreground grid min-h-[76px] place-items-center rounded-md bg-[var(--mx-lane)] text-sm">
                                            {loadProgress[t.id] != null ? `${loadProgress[t.id]}%` : 'En espera…'}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {(chords.length > 0 || analyzing) && (
                        <section className="space-y-3" aria-labelledby="hoja">
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 id="hoja" className="text-xl font-semibold">
                                    Hoja de acordes
                                </h2>
                                {analysis.key && <span className="text-muted-foreground text-sm">Tonalidad: {analysis.key}</span>}
                                <Button variant="outline" size="sm" onClick={toggleSheet} aria-expanded={showSheet} className="ml-auto">
                                    <ListMusic /> {showSheet ? 'Ocultar hoja' : 'Mostrar hoja'}
                                </Button>
                            </div>
                            {showSheet && (
                                <ChordSheet
                                    chords={chords}
                                    analyzing={analyzing}
                                    onSeek={seek}
                                    onEdit={setEditingChord}
                                    chipRef={(id, el) => {
                                        if (el) chordUI.current.chips.set(id, el);
                                        else chordUI.current.chips.delete(id);
                                    }}
                                    containerRef={(el) => {
                                        chordUI.current.sheet = el;
                                    }}
                                />
                            )}
                        </section>
                    )}

                    <ChordEditDialog chord={editingChord} onClose={() => setEditingChord(null)} onSave={editChord} />
                    <ConfirmDialog
                        open={confirmReanalyze}
                        onOpenChange={setConfirmReanalyze}
                        title="¿Volver a analizar los acordes?"
                        description="Se reemplazarán los acordes detectados automáticamente. Los que corregiste a mano se conservan."
                        confirmLabel="Volver a analizar"
                        onConfirm={async () => {
                            setConfirmReanalyze(false);
                            const err = await reanalyze();
                            setMessage(err ?? 'Análisis de acordes en cola. Los acordes nuevos aparecerán a medida que se detecten.');
                        }}
                    />

                    <SilencesPanel
                        tracks={tracks}
                        silences={silences}
                        duration={duration}
                        disabled={!ready}
                        now={() => engineRef.current?.now() ?? 0}
                        onAdd={addSilence}
                        onRemove={removeSilence}
                        onClear={() => {
                            setSilences([]);
                            setMessage('Se quitaron todos los silencios.');
                        }}
                        onGo={(t) => seek(Math.max(0, t - 2))}
                    />

                    {preferences.keyboard_shortcuts && (
                        <p className="text-muted-foreground pb-8 text-sm">
                            Atajos: <Kbd>Espacio</Kbd> reproduce o pausa, <Kbd>1</Kbd> a <Kbd>9</Kbd> silencian cada pista, <Kbd>Inicio</Kbd> vuelve
                            al principio.
                        </p>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

function ChordInfo({
    analysis,
    hasChords,
    canImprove,
    waitingWorker,
    onReanalyze,
    onDetect,
    onImprove,
    onCancel,
}: {
    analysis: ChordAnalysis;
    hasChords: boolean;
    canImprove: boolean;
    waitingWorker: boolean;
    onReanalyze: () => void;
    onDetect: () => void;
    onImprove: () => void;
    onCancel: () => void;
}) {
    const busy = isAnalyzing(analysis);
    const statusText =
        analysis.status === 'waiting'
            ? 'Esperando a que termine la separación…'
            : analysis.status === 'pending'
              ? 'En cola…'
              : `Analizando… ${analysis.progress}%`;
    return (
        <div className="bg-card flex min-w-0 flex-col justify-center gap-0.5 rounded-md border border-l-[5px] border-l-[var(--mx-accent)] px-2.5 py-1.5 text-sm">
            <span className="text-xl leading-tight font-semibold">Acordes</span>
            {busy ? (
                <span className="text-muted-foreground flex items-center gap-1.5" role="status">
                    <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                    {statusText}
                </span>
            ) : analysis.status === 'failed' ? (
                <span className="text-red-700 dark:text-red-400" role="alert" title={analysis.error ?? ''}>
                    Error: {analysis.error}
                </span>
            ) : analysis.status === 'canceled' ? (
                <span className="text-muted-foreground">Detección cancelada.</span>
            ) : null}
            {waitingWorker && <span className="text-muted-foreground text-xs">¿Está abierta la ventana «ACORDES» de iniciar.bat?</span>}
            {analysis.key && (
                <span className="text-muted-foreground">
                    {busy ? 'Tonalidad (provisional)' : 'Tonalidad'}: <strong className="text-foreground font-semibold">{analysis.key}</strong>
                </span>
            )}
            {analysis.status === 'ready' && analysis.source === 'original' && !busy && (
                <span className="text-muted-foreground text-xs">Detectados sobre el audio original.</span>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
                {busy ? (
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={onCancel}>
                        <Ban /> Cancelar
                    </Button>
                ) : hasChords ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={onReanalyze}
                        title="Volver a analizar (tus correcciones se conservan)"
                    >
                        <RefreshCw /> Volver a analizar
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={onDetect}>
                        <Music2 /> Detectar acordes
                    </Button>
                )}
                {canImprove && !busy && (
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={onImprove} title="Tus correcciones a mano se conservan">
                        <Sparkles /> Mejorar con pistas separadas
                    </Button>
                )}
            </div>
            {hasChords && (
                <span className="text-muted-foreground mt-1 hidden text-xs md:block">Doble clic o clic derecho en un acorde para corregirlo.</span>
            )}
        </div>
    );
}

/** Aviso sobre la separación: no separada, separándose, o con error / cancelada. */
function SeparationNotice({ status, busy, onSeparate }: { status: Song['status']; busy: boolean; onSeparate: () => void }) {
    if (status === 'ready') return null;
    const box = 'bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm';
    if (status === 'pending' || status === 'processing') {
        return (
            <div className={box} role="status">
                <span className="text-muted-foreground flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    {status === 'pending' ? 'En cola para separar.' : 'Separando las pistas…'} Mientras tanto suena el original; recarga cuando
                    termine.
                </span>
            </div>
        );
    }
    const text =
        status === 'none'
            ? 'Esta canción no está separada: suena el audio original.'
            : status === 'failed'
              ? 'La separación falló: suena el audio original.'
              : 'La separación se canceló: suena el audio original.';
    return (
        <div className={box}>
            <span className="text-muted-foreground">{text}</span>
            <Button size="sm" variant="outline" onClick={onSeparate} disabled={busy}>
                <Layers /> {status === 'none' ? 'Separar pistas' : 'Reintentar separación'}
            </Button>
        </div>
    );
}

function Kbd({ children }: { children: React.ReactNode }) {
    return <kbd className="bg-card rounded border border-b-2 px-1.5 font-sans">{children}</kbd>;
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
    if (status === 'error') {
        return (
            <span className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400" role="status">
                <AlertCircle className="size-4" /> No se pudo guardar
                <Button variant="outline" size="sm" onClick={onRetry}>
                    Reintentar
                </Button>
            </span>
        );
    }
    const text = { idle: 'Los cambios se guardan solos', pending: 'Cambios sin guardar…', saving: 'Guardando…', saved: 'Guardado' }[status];
    return (
        <span className="text-muted-foreground flex items-center gap-1.5 text-sm" role="status" aria-live="polite">
            {status === 'saving' && <LoaderCircle className="size-4 animate-spin" />}
            {status === 'saved' && <Check className="size-4 text-emerald-600" />}
            {text}
        </span>
    );
}

function Ruler({ duration, onSeek, headRef }: { duration: number; onSeek: (t: number) => void; headRef: (el: HTMLDivElement | null) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = duration && width ? (steps.find((s) => (s / duration) * width >= 64) ?? 900) : 0;
    const ticks: number[] = [];
    if (step) for (let t = 0; t < duration; t += step) ticks.push(t);

    return (
        <div
            ref={ref}
            className="relative h-[26px] cursor-pointer border-b"
            onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek(clamp((e.clientX - r.left) / r.width, 0, 1) * duration);
            }}
            aria-hidden
        >
            {ticks.map((t) => (
                <span
                    key={t}
                    className="text-muted-foreground absolute bottom-0.5 h-[18px] translate-x-[3px] border-l pl-1 text-xs leading-tight whitespace-nowrap"
                    style={{ left: (t / duration) * 100 + '%' }}
                >
                    {fmt(t)}
                </span>
            ))}
            <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 -ml-px w-0.5 bg-[var(--mx-accent)]" />
        </div>
    );
}

interface SilencesPanelProps {
    tracks: MixerTrack[];
    silences: Silence[];
    duration: number;
    disabled: boolean;
    now: () => number;
    onAdd: (trackId: number, start: number, end: number) => boolean;
    onRemove: (key: number) => void;
    onClear: () => void;
    onGo: (t: number) => void;
}

function SilencesPanel({ tracks, silences, duration, disabled, now, onAdd, onRemove, onClear, onGo }: SilencesPanelProps) {
    const [trackId, setTrackId] = useState(tracks[0]?.id ?? 0);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [error, setError] = useState('');
    const [confirmClear, setConfirmClear] = useState(false);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const sorted = [...silences].sort((a, b) => a.start - b.start);

    const add = () => {
        setError('');
        const s = parseTime(from);
        const e = parseTime(to);
        if (isNaN(s) || isNaN(e)) return setError('Escribe los tiempos como minutos:segundos, por ejemplo 1:30.');
        if (e <= s) return setError('El final tiene que ser posterior al inicio.');
        if (s >= duration) return setError(`La canción dura ${fmt(duration)}; el inicio queda fuera.`);
        if (onAdd(trackId, s, e)) {
            setFrom('');
            setTo('');
        }
    };

    return (
        <section className="space-y-4 border-t pt-6" aria-labelledby="silencios">
            <div>
                <h2 id="silencios" className="text-xl font-semibold">
                    Silencios programados
                </h2>
                <p className="text-muted-foreground max-w-prose text-sm">
                    Cada silencio apaga una pista entre dos momentos de la canción. Se guardan automáticamente y vuelven la próxima vez que abras esta
                    canción.
                </p>
            </div>

            <fieldset disabled={disabled} className="bg-card flex flex-wrap items-end gap-x-3.5 gap-y-2.5 rounded-lg border p-3.5">
                <label className="text-muted-foreground flex flex-col gap-1 text-sm">
                    Pista
                    <select
                        value={trackId}
                        onChange={(e) => setTrackId(+e.target.value)}
                        className="bg-background text-foreground min-w-40 rounded-md border px-2 py-1.5"
                    >
                        {tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </label>
                <TimeField id="fFrom" label="Desde" value={from} onChange={setFrom} placeholder="0:00" onNow={() => setFrom(fmtR(now()))} />
                <TimeField id="fTo" label="Hasta" value={to} onChange={setTo} placeholder="0:30" onNow={() => setTo(fmtR(now()))} />
                <Button type="button" onClick={add} className="bg-[var(--mx-accent)] text-[var(--mx-accent-ink)] hover:bg-[var(--mx-accent)]/90">
                    Agregar silencio
                </Button>
                {error && (
                    <p className="w-full text-sm text-red-700 dark:text-red-400" role="alert">
                        {error}
                    </p>
                )}
            </fieldset>

            {sorted.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aún no hay silencios. Arrastra sobre una pista o usa el formulario.</p>
            ) : (
                <>
                    <ul className="grid gap-1.5">
                        {sorted.map((s) => {
                            const t = byId.get(s.trackId);
                            if (!t) return null;
                            return (
                                <li
                                    key={s.key}
                                    className="bg-card grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-md border px-3 py-2 text-sm"
                                >
                                    <span className="size-3 rounded-full" style={{ background: t.color }} aria-hidden />
                                    <span className="truncate">{t.label}</span>
                                    <span className="text-muted-foreground tabular-nums">
                                        {fmtR(s.start)} a {fmtR(s.end)}
                                    </span>
                                    <Button variant="outline" size="sm" onClick={() => onGo(s.start)} aria-label={`Ir a ${fmtR(s.start)}`}>
                                        Ir
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => onRemove(s.key)}>
                                        Quitar
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                    <Button variant="outline" onClick={() => setConfirmClear(true)}>
                        Quitar todos los silencios
                    </Button>
                    <ConfirmDialog
                        open={confirmClear}
                        onOpenChange={setConfirmClear}
                        title="¿Quitar todos los silencios?"
                        description={`Se quitarán los ${sorted.length} silencios programados de esta canción.`}
                        confirmLabel="Quitar todos"
                        destructive
                        onConfirm={() => {
                            onClear();
                            setConfirmClear(false);
                        }}
                    />
                </>
            )}
        </section>
    );
}

function TimeField({
    id,
    label,
    value,
    onChange,
    placeholder,
    onNow,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    onNow: () => void;
}) {
    return (
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
            <label htmlFor={id}>{label}</label>
            <div className="flex gap-1">
                <input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    inputMode="decimal"
                    className="bg-background text-foreground w-[6.5em] rounded-md border px-2 py-1.5 tabular-nums"
                />
                <Button type="button" variant="outline" size="sm" onClick={onNow} title="Usar el momento actual">
                    Ahora
                </Button>
            </div>
        </div>
    );
}
