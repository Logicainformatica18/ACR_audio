/** 1536 -> "1,5 KB"; 5_000_000 -> "4,8 MB" */
export function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return value.toLocaleString('es', { maximumFractionDigits: i === 0 ? 0 : 1 }) + ' ' + units[i];
}

/** 185.4 -> "3:05" */
export function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null || !isFinite(seconds)) return '—';
    const s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Fecha ISO -> "26 nov 2026, 14:05" */
export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Segundos transcurridos entre dos fechas ISO (o hasta ahora). */
export function elapsedSeconds(fromIso: string | null, toIso?: string | null): number | null {
    if (!fromIso) return null;
    const to = toIso ? new Date(toIso).getTime() : Date.now();
    return Math.max(0, (to - new Date(fromIso).getTime()) / 1000);
}
