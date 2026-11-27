import { cn } from '@/lib/utils';
import { type SongStatus } from '@/types';
import { AlertCircle, Ban, CheckCircle2, Clock, LoaderCircle } from 'lucide-react';

const STATUS: Record<SongStatus, { label: string; className: string; Icon: typeof Clock }> = {
    pending: { label: 'En cola', className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300', Icon: Clock },
    processing: { label: 'Procesando', className: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300', Icon: LoaderCircle },
    ready: { label: 'Lista', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300', Icon: CheckCircle2 },
    failed: { label: 'Error', className: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300', Icon: AlertCircle },
    canceled: { label: 'Cancelada', className: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-300', Icon: Ban },
};

export function statusLabel(status: SongStatus): string {
    return STATUS[status].label;
}

export function StatusBadge({ status }: { status: SongStatus }) {
    const { label, className, Icon } = STATUS[status];
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', className)}>
            <Icon className={cn('size-3.5', status === 'processing' && 'animate-spin')} aria-hidden />
            {label}
        </span>
    );
}
