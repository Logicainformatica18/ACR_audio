/** 75.4 -> "1:15" */
export function fmt(t: number): string {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
}

/** 75.43 -> "1:15.4" (con décimas) */
export function fmtR(t: number): string {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

/** "1:30", "1:30.5", "90" o "90,5" -> segundos; NaN si no es válido. */
export function parseTime(str: string): number {
    str = String(str).trim().replace(',', '.');
    if (!str) return NaN;
    const p = str.split(':');
    if (p.length > 2) return NaN;
    let sec: number;
    if (p.length === 2) {
        const m = parseInt(p[0], 10);
        const s = parseFloat(p[1]);
        if (isNaN(m) || isNaN(s) || s >= 60 || s < 0) return NaN;
        sec = m * 60 + s;
    } else sec = parseFloat(p[0]);
    return isNaN(sec) || sec < 0 ? NaN : sec;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
