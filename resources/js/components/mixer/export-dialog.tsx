import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ExportFormat } from '@/lib/mixer/export';
import { fmt, fmtR, parseTime } from '@/lib/mixer/time';
import { cn } from '@/lib/utils';
import { Download, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ExportRequest {
    format: ExportFormat;
    range: { start: number; end: number } | null;
    name: string;
}

export interface ExportProgress {
    phase: 'render' | 'upload' | 'encode';
    pct: number;
}

interface Props {
    open: boolean;
    onClose: () => void;
    duration: number;
    /** Momento actual de la reproducción (para los botones "Ahora"). */
    now: () => number;
    /** Nombre propuesto según lo que suena y el tramo. */
    suggest: (range: { start: number; end: number } | null) => string;
    initialRange: { start: number; end: number } | null;
    format: ExportFormat;
    onFormatChange: (f: ExportFormat) => void;
    onExport: (req: ExportRequest) => void;
    progress: ExportProgress | null;
    onCancel: () => void;
    /** Mezclas rápidas ("Sin batería"…): solo si la canción está separada. */
    quick: { label: string; onClick: () => void }[];
}

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
    { value: 'mp3', label: 'MP3', hint: '320 kbps · ocupa poco' },
    { value: 'flac', label: 'FLAC', hint: 'sin pérdida · comprimido' },
    { value: 'wav', label: 'WAV', hint: 'sin pérdida · el más grande' },
];

const PHASE: Record<ExportProgress['phase'], string> = {
    render: 'Mezclando en el navegador…',
    upload: 'Enviando la mezcla…',
    encode: 'Codificando el archivo…',
};

/** Panel "Exportar mezcla": formato, canción completa o un tramo, nombre y mezclas rápidas. */
export function ExportDialog({
    open,
    onClose,
    duration,
    now,
    suggest,
    initialRange,
    format,
    onFormatChange,
    onExport,
    progress,
    onCancel,
    quick,
}: Props) {
    const [whole, setWhole] = useState(true);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [name, setName] = useState('');
    const [nameEdited, setNameEdited] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        setWhole(!initialRange);
        setFrom(initialRange ? fmtR(initialRange.start) : '');
        setTo(initialRange ? fmtR(initialRange.end) : '');
        setNameEdited(false);
        setError('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    /** Tramo elegido (o null si es la canción completa); string = error. */
    const range = (): { start: number; end: number } | null | string => {
        if (whole) return null;
        const s = parseTime(from);
        const e = parseTime(to);
        if (isNaN(s) || isNaN(e)) return 'Escribe el tramo como minutos:segundos, por ejemplo 1:30.';
        if (e <= s) return 'El final del tramo tiene que ser posterior al inicio.';
        if (s >= duration) return `La canción dura ${fmt(duration)}.`;
        return { start: s, end: Math.min(e, duration) };
    };

    // El nombre propuesto se actualiza con el tramo, salvo que el usuario lo haya cambiado.
    useEffect(() => {
        if (!open || nameEdited) return;
        const r = range();
        setName(suggest(typeof r === 'string' ? null : r));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, whole, from, to, nameEdited]);

    const submit = () => {
        const r = range();
        if (typeof r === 'string') return setError(r);
        if (!name.trim()) return setError('Escribe un nombre para el archivo.');
        setError('');
        onExport({ format, range: r, name: name.trim() });
    };

    const busy = progress !== null;
    const totalPct = progress ? (progress.phase === 'render' ? progress.pct * 0.6 : progress.phase === 'upload' ? 60 + progress.pct * 0.3 : 92) : 0;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Exportar mezcla</DialogTitle>
                    <DialogDescription>Un solo archivo con exactamente lo que estás escuchando: mute, solo, volúmenes y silencios.</DialogDescription>
                </DialogHeader>

                <fieldset disabled={busy} className="space-y-4">
                    <div className="grid gap-1.5">
                        <span className="text-sm font-medium">Formato</span>
                        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Formato">
                            {FORMATS.map((f) => (
                                <button
                                    key={f.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={format === f.value}
                                    onClick={() => onFormatChange(f.value)}
                                    className={cn(
                                        'focus-visible:ring-ring rounded-lg border-2 px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none',
                                        format === f.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                                    )}
                                >
                                    <span className="block font-semibold">{f.label}</span>
                                    <span className="text-muted-foreground block text-xs">{f.hint}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-1.5">
                        <span className="text-sm font-medium">Rango</span>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="rango"
                                    checked={whole}
                                    onChange={() => setWhole(true)}
                                    className="accent-[var(--mx-accent)]"
                                />
                                Canción completa ({fmt(duration)})
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="rango"
                                    checked={!whole}
                                    onChange={() => setWhole(false)}
                                    className="accent-[var(--mx-accent)]"
                                />
                                Un tramo
                            </label>
                        </div>
                        {!whole && (
                            <div className="flex flex-wrap gap-3">
                                {(
                                    [
                                        ['Desde', from, setFrom, 'exp-from'],
                                        ['Hasta', to, setTo, 'exp-to'],
                                    ] as const
                                ).map(([label, value, set, id]) => (
                                    <div key={id} className="grid gap-1">
                                        <Label htmlFor={id} className="text-muted-foreground text-xs">
                                            {label}
                                        </Label>
                                        <div className="flex gap-1">
                                            <Input
                                                id={id}
                                                value={value}
                                                onChange={(e) => set(e.target.value)}
                                                placeholder="0:00"
                                                className="w-24 tabular-nums"
                                                inputMode="decimal"
                                            />
                                            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => set(fmtR(now()))}>
                                                Ahora
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid gap-1.5">
                        <Label htmlFor="exp-name">Nombre del archivo</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="exp-name"
                                value={name}
                                maxLength={200}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    setNameEdited(true);
                                }}
                            />
                            <span className="text-muted-foreground text-sm">.{format}</span>
                        </div>
                    </div>

                    {quick.length > 0 && (
                        <div className="grid gap-1.5">
                            <span className="text-sm font-medium">Mezclas rápidas (ajustan mute/solo y exportan)</span>
                            <div className="flex flex-wrap gap-2">
                                {quick.map((q) => (
                                    <Button key={q.label} type="button" variant="secondary" size="sm" onClick={q.onClick}>
                                        {q.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </fieldset>

                {error && (
                    <p className="text-sm text-red-700 dark:text-red-400" role="alert">
                        {error}
                    </p>
                )}

                {busy && (
                    <div className="space-y-1" role="status" aria-live="polite">
                        <p className="text-sm">
                            {PHASE[progress.phase]} {progress.phase !== 'encode' && `${progress.pct}%`}
                        </p>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                            <div className="h-full bg-[var(--mx-accent)] transition-[width]" style={{ width: `${totalPct}%` }} />
                        </div>
                    </div>
                )}

                <DialogFooter className="gap-2">
                    {busy ? (
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancelar
                        </Button>
                    ) : (
                        <>
                            <Button type="button" variant="ghost" onClick={onClose}>
                                Cerrar
                            </Button>
                            <Button
                                type="button"
                                onClick={submit}
                                className="bg-[var(--mx-accent)] text-[var(--mx-accent-ink)] hover:bg-[var(--mx-accent)]/90"
                            >
                                <Download /> Exportar
                            </Button>
                        </>
                    )}
                    {busy && <LoaderCircle className="text-muted-foreground size-5 animate-spin self-center" aria-hidden />}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
