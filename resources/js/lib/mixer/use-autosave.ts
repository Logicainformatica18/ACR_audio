import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 700;

function xsrfToken(): string {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}

/**
 * Guardado automático: cada cambio programa un guardado 0,7 s después.
 * - Nunca hay dos peticiones a la vez; si hubo cambios durante una, se envía otra al terminar.
 * - Al salir de la página (o del mezclador) se envía lo pendiente con fetch keepalive.
 */
export function useAutosave<T>(url: string, payload: T, enabled: boolean) {
    const [status, setStatus] = useState<SaveStatus>('idle');
    const latest = useRef(payload);
    const dirty = useRef(false);
    const inFlight = useRef(false);
    const timer = useRef(0);
    const first = useRef(true);

    latest.current = payload;

    const flush = useCallback(async () => {
        window.clearTimeout(timer.current);
        if (!dirty.current || inFlight.current) return;
        dirty.current = false;
        inFlight.current = true;
        setStatus('saving');
        let failed = false;
        try {
            await axios.put(url, latest.current, { headers: { Accept: 'application/json' } });
            setStatus(dirty.current ? 'pending' : 'saved');
        } catch {
            failed = true;
            dirty.current = true; // se reintenta con el próximo cambio o con "Reintentar"
            setStatus('error');
        } finally {
            inFlight.current = false;
            // Hubo cambios mientras se guardaba: otro guardado.
            if (dirty.current && !failed) timer.current = window.setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
        }
    }, [url]);
    const flushRef = useRef(flush);
    flushRef.current = flush;

    // Cada cambio del estado programa un guardado.
    useEffect(() => {
        if (!enabled) return;
        if (first.current) {
            first.current = false; // el estado inicial viene de la BD: no hace falta guardarlo
            return;
        }
        dirty.current = true;
        setStatus('pending');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    }, [payload, enabled, flush]);

    // Envío de emergencia al cerrar la pestaña o salir del mezclador.
    useEffect(() => {
        const sendNow = () => {
            if (!dirty.current) return;
            dirty.current = false;
            void fetch(url, {
                method: 'PUT',
                keepalive: true,
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
                body: JSON.stringify(latest.current),
            });
        };
        window.addEventListener('pagehide', sendNow);
        return () => {
            window.removeEventListener('pagehide', sendNow);
            window.clearTimeout(timer.current);
            sendNow(); // navegación dentro de la app (Inertia)
        };
    }, [url]);

    const retry = useCallback(() => {
        dirty.current = true;
        void flush();
    }, [flush]);

    return { status, retry };
}
