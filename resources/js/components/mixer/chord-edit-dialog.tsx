import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ChordItem } from '@/lib/mixer/chords';
import { fmtR } from '@/lib/mixer/time';
import { LoaderCircle } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

interface Props {
    chord: ChordItem | null;
    onClose: () => void;
    onSave: (id: number, name: string) => Promise<string | null>;
}

/** Ventana para corregir un acorde a mano. */
export function ChordEditDialog({ chord, onClose, onSave }: Props) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setName(chord?.chord ?? '');
        setError('');
    }, [chord]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!chord) return;
        // Acepta "bm" o "f#m7" escritos en minúscula: la raíz va en mayúscula.
        const value = name.trim().replace(/^([a-g])/, (m) => m.toUpperCase());
        setSaving(true);
        const err = await onSave(chord.id, value);
        setSaving(false);
        if (err) setError(err);
        else onClose();
    };

    return (
        <Dialog open={chord !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <form onSubmit={submit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>Corregir acorde</DialogTitle>
                        <DialogDescription>
                            {chord && `De ${fmtR(chord.start)} a ${fmtR(chord.end)}. `}
                            Tu corrección se guarda y se conserva aunque vuelvas a analizar la canción.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Label htmlFor="chord-name">Acorde</Label>
                        <Input
                            id="chord-name"
                            value={name}
                            maxLength={16}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => setName(e.target.value)}
                            className="text-lg font-semibold"
                        />
                        <p className="text-muted-foreground text-sm">
                            Ejemplos: Bm, F#m7, Dmaj7, A7, Bsus4, Bdim, C/G. Escribe N si no suena ningún acorde.
                        </p>
                        <InputError message={error} />
                    </div>
                    <DialogFooter className="gap-2">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving || name.trim() === ''}>
                            {saving && <LoaderCircle className="animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
