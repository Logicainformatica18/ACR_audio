import { chordLabel, type ChordItem } from '@/lib/mixer/chords';
import { fmt } from '@/lib/mixer/time';
import { cn } from '@/lib/utils';

interface Props {
    chords: ChordItem[];
    analyzing: boolean;
    onSeek: (t: number) => void;
    onEdit: (chord: ChordItem) => void;
    chipRef: (id: number, el: HTMLButtonElement | null) => void;
    containerRef: (el: HTMLDivElement | null) => void;
}

/**
 * Hoja de acordes: todos los acordes en orden, como los leería un guitarrista.
 * El actual se resalta mientras suena (desde fuera de React, por rendimiento).
 */
export function ChordSheet({ chords, analyzing, onSeek, onEdit, chipRef, containerRef }: Props) {
    const list = chords.filter((c) => c.chord !== 'N');

    return (
        <div ref={containerRef} className="bg-card relative max-h-80 overflow-y-auto rounded-lg border p-3">
            {list.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    {analyzing ? 'Los acordes aparecerán aquí a medida que se detecten…' : 'No hay acordes.'}
                </p>
            ) : (
                <ol className="flex flex-wrap gap-1.5">
                    {list.map((c) => (
                        <li key={c.id}>
                            <button
                                type="button"
                                ref={(el) => chipRef(c.id, el)}
                                data-current="false"
                                onClick={() => onSeek(c.start)}
                                onDoubleClick={() => onEdit(c)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    onEdit(c);
                                }}
                                className={cn(
                                    'bg-background relative flex min-w-[3.75rem] flex-col items-center rounded-md border px-2 py-1 leading-tight',
                                    'data-[current=true]:border-[var(--mx-accent)] data-[current=true]:bg-[var(--mx-accent)] data-[current=true]:text-[var(--mx-accent-ink)]',
                                )}
                                title={`Ir a ${fmt(c.start)} · doble clic o clic derecho para corregir`}
                            >
                                <span className="text-lg font-semibold">{chordLabel(c.chord)}</span>
                                <span className="text-xs tabular-nums opacity-70">{fmt(c.start)}</span>
                                {c.edited && (
                                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-sky-500" aria-label="corregido a mano" />
                                )}
                            </button>
                        </li>
                    ))}
                    {analyzing && <li className="text-muted-foreground self-center px-2 text-sm">analizando…</li>}
                </ol>
            )}
        </div>
    );
}
