import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type Song } from '@/types';
import axios, { AxiosError } from 'axios';
import { LoaderCircle } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

interface Props {
    song: Song | null;
    onClose: () => void;
    onRenamed: () => void;
}

/** Ventana para cambiar el título visible de una canción. */
export function RenameSongDialog({ song, onClose, onRenamed }: Props) {
    const [title, setTitle] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setTitle(song?.title ?? '');
        setError('');
    }, [song]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!song) return;
        setSaving(true);
        setError('');
        try {
            await axios.patch(route('songs.update', song.id), { title }, { headers: { Accept: 'application/json' } });
            onRenamed();
            onClose();
        } catch (err) {
            const res = (err as AxiosError<{ message?: string; errors?: Record<string, string[]> }>).response;
            setError(res?.data?.errors?.title?.[0] ?? res?.data?.message ?? 'No se pudo renombrar.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={song !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <form onSubmit={submit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>Renombrar canción</DialogTitle>
                        <DialogDescription>Solo cambia el nombre que ves en ACR Audio; los archivos no se tocan.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Label htmlFor="song-title">Título</Label>
                        <Input id="song-title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
                        <InputError message={error} />
                    </div>
                    <DialogFooter className="gap-2">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving || title.trim() === ''}>
                            {saving && <LoaderCircle className="animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
