import { cn } from '@/lib/utils';
import { type ChordsStatus, type SongStatus } from '@/types';
import { AlertCircle, Ban, CheckCircle2, Clock, FileAudio, LoaderCircle, Music2 } from 'lucide-react';

type Tone = 'neutral' | 'amber' | 'sky' | 'emerald' | 'red' | 'violet';

const TONES: Record<Tone, string> = {
    neutral: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-300',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
    sky: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
    red: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
    violet: 'bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300',
};

/** Estado de la separación, como lo ve el usuario. */
const SEPARATION: Record<SongStatus, { label: string; tone: Tone; Icon: typeof Clock }> = {
    none: { label: 'Original', tone: 'neutral', Icon: FileAudio },
    pending: { label: 'En cola para separar', tone: 'amber', Icon: Clock },
    processing: { label: 'Separando', tone: 'sky', Icon: LoaderCircle },
    ready: { label: 'Separada', tone: 'emerald', Icon: CheckCircle2 },
    failed: { label: 'Error al separar', tone: 'red', Icon: AlertCircle },
    canceled: { label: 'Separación cancelada', tone: 'neutral', Icon: Ban },
};

export function statusLabel(status: SongStatus): string {
    return SEPARATION[status].label;
}

function Pill({ tone, Icon, spin, children, title }: { tone: Tone; Icon: typeof Clock; spin?: boolean; children: React.ReactNode; title?: string }) {
    return (
        <span
            className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone])}
            title={title}
        >
            <Icon className={cn('size-3.5', spin && 'animate-spin')} aria-hidden />
            {children}
        </span>
    );
}

/** Etiqueta de la separación: "Separada", "Original" o el estado en curso (con %). */
export function StatusBadge({ status, progress }: { status: SongStatus; progress?: number | null }) {
    const { label, tone, Icon } = SEPARATION[status];
    return (
        <Pill tone={tone} Icon={Icon} spin={status === 'processing'}>
            {label}
            {status === 'processing' && progress != null ? ` ${progress}%` : ''}
        </Pill>
    );
}

/** Texto del estado de los acordes (también para buscar). */
export function chordsLabel(status: ChordsStatus, key?: string | null, progress?: number): string | null {
    switch (status) {
        case 'ready':
            return key ? `Acordes · ${key}` : 'Acordes';
        case 'waiting':
            return 'Acordes tras separar';
        case 'pending':
            return 'Acordes en cola';
        case 'processing':
            return `Acordes ${progress ?? 0}%`;
        case 'failed':
            return 'Error en acordes';
        case 'canceled':
            return 'Acordes cancelados';
        default:
            return null;
    }
}

/** Etiqueta de los acordes: "Acordes · B menor" o el estado del análisis. Nada si no se pidieron. */
export function ChordsBadge({ status, chordKey, progress }: { status: ChordsStatus; chordKey: string | null; progress: number }) {
    const label = chordsLabel(status, chordKey, progress);
    if (!label) return null;
    const look: Record<Exclude<ChordsStatus, null>, [Tone, typeof Clock]> = {
        ready: ['violet', Music2],
        waiting: ['amber', Clock],
        pending: ['amber', Clock],
        processing: ['sky', LoaderCircle],
        failed: ['red', AlertCircle],
        canceled: ['neutral', Ban],
    };
    const [tone, Icon] = look[status!];
    return (
        <Pill
            tone={tone}
            Icon={Icon}
            spin={status === 'processing'}
            title={status === 'waiting' ? 'Se analizarán al terminar la separación' : undefined}
        >
            {label}
        </Pill>
    );
}
