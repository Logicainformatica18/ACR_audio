import { antiClipGain, buildMixPlan, describeMix, encodeWav, peakOf, suggestName, type PlanInput } from '@/lib/mixer/export';
import { describe, expect, it } from 'vitest';

/** Canción separada: Voz(1), Batería(2), Bajo(3), Guitarra(4) y la Original(9) oculta. */
function input(over: Partial<PlanInput> = {}): PlanInput {
    return {
        tracks: [
            { id: 1, label: 'Voz', stem: 'vocals', original: false },
            { id: 2, label: 'Batería', stem: 'drums', original: false },
            { id: 3, label: 'Bajo', stem: 'bass', original: false },
            { id: 4, label: 'Guitarra', stem: 'guitar', original: false },
            { id: 9, label: 'Original', stem: 'original', original: true },
        ],
        mix: [1, 2, 3, 4, 9].map((id) => ({ id, volume: 1, muted: false, solo: false })),
        silences: [],
        visibleIds: new Set([1, 2, 3, 4]),
        master: 0.9,
        duration: 200,
        range: null,
        ...over,
    };
}
const ids = (i: PlanInput) => buildMixPlan(i).tracks.map((t) => t.id);

describe('qué pistas entran en la mezcla', () => {
    it('todas las visibles; la Original oculta no', () => {
        expect(ids(input())).toEqual([1, 2, 3, 4]);
    });

    it('la Original entra si está visible', () => {
        expect(ids(input({ visibleIds: new Set([1, 2, 3, 4, 9]) }))).toEqual([1, 2, 3, 4, 9]);
    });

    it('mute quita la pista', () => {
        const i = input();
        i.mix[1].muted = true; // batería
        expect(ids(i)).toEqual([1, 3, 4]);
    });

    it('solo deja solo las pistas en solo (y un mute gana al solo)', () => {
        const i = input();
        i.mix[0].solo = true;
        i.mix[3].solo = true;
        expect(ids(i)).toEqual([1, 4]);
        i.mix[3].muted = true;
        expect(ids(i)).toEqual([1]);
    });

    it('un solo en la Original oculta no cuenta', () => {
        const i = input();
        i.mix[4].solo = true; // Original, oculta
        expect(ids(i)).toEqual([1, 2, 3, 4]);
    });

    it('una pista con volumen 0 no entra', () => {
        const i = input();
        i.mix[2].volume = 0;
        expect(ids(i)).toEqual([1, 2, 4]);
    });
});

describe('volúmenes', () => {
    it('cada pista conserva su volumen y el general va aparte', () => {
        const i = input();
        i.mix[0].volume = 0.4;
        const plan = buildMixPlan(i);
        expect(plan.tracks.find((t) => t.id === 1)?.volume).toBe(0.4);
        expect(plan.tracks.find((t) => t.id === 2)?.volume).toBe(1);
        expect(plan.master).toBe(0.9);
    });
});

describe('silencios programados', () => {
    it('se unen los solapados y se respetan por pista', () => {
        const plan = buildMixPlan(
            input({
                silences: [
                    { trackId: 2, start: 10, end: 20 },
                    { trackId: 2, start: 15, end: 25 },
                    { trackId: 4, start: 50, end: 60 },
                ],
            }),
        );
        expect(plan.tracks.find((t) => t.id === 2)?.regions).toEqual([{ start: 10, end: 25 }]);
        expect(plan.tracks.find((t) => t.id === 4)?.regions).toEqual([{ start: 50, end: 60 }]);
        expect(plan.tracks.find((t) => t.id === 1)?.regions).toEqual([]);
    });

    it('con un tramo, se recortan y quedan relativos a su inicio', () => {
        const plan = buildMixPlan(
            input({
                range: { start: 30, end: 90 },
                silences: [
                    { trackId: 1, start: 20, end: 40 }, // empieza antes del tramo
                    { trackId: 1, start: 60, end: 70 }, // dentro
                    { trackId: 1, start: 85, end: 120 }, // termina después
                    { trackId: 1, start: 100, end: 110 }, // fuera
                ],
            }),
        );
        expect(plan.start).toBe(30);
        expect(plan.end).toBe(90);
        expect(plan.tracks.find((t) => t.id === 1)?.regions).toEqual([
            { start: 0, end: 10 },
            { start: 30, end: 40 },
            { start: 55, end: 60 },
        ]);
    });

    it('el tramo se limita a la duración de la canción', () => {
        const plan = buildMixPlan(input({ range: { start: 150, end: 999 } }));
        expect(plan.start).toBe(150);
        expect(plan.end).toBe(200);
    });
});

describe('nombre propuesto', () => {
    it('describe lo que suena', () => {
        expect(describeMix(input())).toBe('mezcla completa');
        const sinBat = input();
        sinBat.mix[1].muted = true;
        expect(describeMix(sinBat)).toBe('sin batería');
        sinBat.mix[0].muted = true;
        expect(describeMix(sinBat)).toBe('sin voz y batería');
        const solo = input();
        solo.mix[3].solo = true;
        expect(describeMix(solo)).toBe('solo guitarra');
        expect(describeMix(input({ tracks: [{ id: 9, label: 'Original', stem: 'original', original: true }], visibleIds: new Set([9]) }))).toBe(
            'original',
        );
    });

    it('incluye el tramo sin ":" (válido en Windows)', () => {
        const i = input({ range: { start: 60, end: 150.5 } });
        i.mix[1].muted = true;
        expect(suggestName('Crush of Love', i)).toBe('Crush of Love - sin batería (1.00-2.30)');
        expect(suggestName('Crush of Love', input({ range: { start: 0, end: 200 } }))).toBe('Crush of Love - mezcla completa');
    });
});

describe('sin saturación y WAV', () => {
    it('solo baja el volumen si el pico se pasa, y por igual para todo', () => {
        expect(antiClipGain(0.5)).toBe(1);
        expect(antiClipGain(1.94)).toBeCloseTo(0.5, 2);
        expect(peakOf([new Float32Array([0.1, -0.8]), new Float32Array([0.3, 0.2])])).toBeCloseTo(0.8);
    });

    it('escribe un WAV PCM de 16 bits correcto, con la ganancia aplicada', () => {
        const left = new Float32Array([0, 0.5, -1, 2]);
        const right = new Float32Array([0, -0.5, 1, -2]);
        const wav = new DataView(encodeWav([left, right], 44100, 0.5));
        expect(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4))).toBe('RIFF');
        expect(wav.getUint16(22, true)).toBe(2); // canales
        expect(wav.getUint32(24, true)).toBe(44100);
        expect(wav.getUint32(40, true)).toBe(4 * 2 * 2); // datos
        expect(wav.getInt16(44 + 4 * 1, true)).toBe(Math.round(0.25 * 0x7fff - 0.5)); // 0,5 · 0,5
        expect(wav.getInt16(44 + 4 * 3, true)).toBe(0x7fff); // 2 · 0,5 = 1 (recortado a 1)
    });
});
