import { ConfirmDialog } from '@/components/confirm-dialog';
import { RenameSongDialog } from '@/components/songs/rename-song-dialog';
import { SongList } from '@/components/songs/song-list';
import { SongStatusDetails } from '@/components/songs/song-status-details';
import { chordsLabel, statusLabel } from '@/components/songs/status-badge';
import { UploadDropzone } from '@/components/songs/upload-dropzone';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSongStatus } from '@/hooks/use-song-status';
import AppLayout from '@/layouts/app-layout';
import { cn } from '@/lib/utils';
import { type BreadcrumbItem, type LiveSong, type Song, type UploadLimits, type UploadPrefs } from '@/types';
import { Head, Link, router } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import { Layers, MoreHorizontal, Music2, Pencil, Search, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Canciones', href: '/songs' }];

type Sort = 'recent' | 'title' | 'status';
type Filter = 'all' | 'separated' | 'original' | 'chords' | 'nochords';

const FILTERS: { value: Filter; label: string; test: (s: Song) => boolean }[] = [
    { value: 'all', label: 'Todas', test: () => true },
    { value: 'separated', label: 'Separadas', test: (s) => s.status === 'ready' },
    { value: 'original', label: 'Solo original', test: (s) => s.status !== 'ready' },
    { value: 'chords', label: 'Con acordes', test: (s) => s.chords_status === 'ready' },
    { value: 'nochords', label: 'Sin acordes', test: (s) => s.chords_status !== 'ready' },
];

interface Props {
    songs: Song[];
    sort: Sort;
    limits: UploadLimits;
    uploadPrefs: UploadPrefs;
}

/** Quita tildes y pasa a minúsculas para buscar "cancion" y encontrar "Canción". */
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const errorText = (err: unknown, fallback: string) => (err as AxiosError<{ message?: string }>).response?.data?.message ?? fallback;

export default function SongsIndex({ songs, sort, limits, uploadPrefs }: Props) {
    const liveSongs = useSongStatus(songs);
    const anyProcessing = liveSongs.some((s) => s.status === 'processing');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [prefs, setPrefs] = useState<UploadPrefs>(uploadPrefs);
    const [renaming, setRenaming] = useState<Song | null>(null);
    const [deleting, setDeleting] = useState<Song | null>(null);
    const [deletingBusy, setDeletingBusy] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);

    // Recarga solo la lista (sin recargar la página).
    const reloadSongs = useCallback(() => router.reload({ only: ['songs'] }), []);

    // Búsqueda instantánea (título, archivo o estado) + filtro rápido.
    const visible = useMemo(() => {
        const q = normalize(query.trim());
        const test = FILTERS.find((f) => f.value === filter)!.test;
        return liveSongs.filter(
            (s) =>
                test(s) &&
                (!q ||
                    normalize(`${s.title} ${s.original_name} ${statusLabel(s.status)} ${chordsLabel(s.chords_status, s.chords_key) ?? ''}`).includes(
                        q,
                    )),
        );
    }, [liveSongs, query, filter]);

    const withoutChords = liveSongs.filter((s) => !s.chords_status || s.chords_status === 'failed' || s.chords_status === 'canceled').length;

    const changeSort = (value: Sort) =>
        router.patch(route('preferences.sort'), { songs_sort: value }, { preserveScroll: true, only: ['songs', 'sort'] });

    /** Guarda preferencias de subida (interruptor de acordes y/o modo recordado). */
    const savePrefs = async (patch: Partial<UploadPrefs>, okMessage?: string) => {
        const before = prefs;
        setPrefs({ ...prefs, ...patch });
        try {
            const { data } = await axios.patch<UploadPrefs>(route('preferences.upload'), patch, { headers: { Accept: 'application/json' } });
            setPrefs(data);
            if (okMessage) toast.success(okMessage);
        } catch (err) {
            setPrefs(before);
            toast.error(errorText(err, 'No se pudo guardar la preferencia.'));
        }
    };

    /** Acción sobre una canción (separar, detectar acordes...). */
    const act = async (song: Song, name: 'songs.separate' | 'songs.chords.analyze', ok: string) => {
        try {
            await axios.post(route(name, song.id), {}, { headers: { Accept: 'application/json' } });
            toast.success(ok);
            reloadSongs();
        } catch (err) {
            toast.error(errorText(err, 'No se pudo completar la acción.'));
        }
    };

    const analyzeMissing = async () => {
        setBulkBusy(true);
        try {
            const { data } = await axios.post<{ message: string }>(route('songs.chords.missing'), {}, { headers: { Accept: 'application/json' } });
            toast.success(data.message);
            reloadSongs();
        } catch (err) {
            toast.error(errorText(err, 'No se pudo poner en cola.'));
        } finally {
            setBulkBusy(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        setDeletingBusy(true);
        try {
            await axios.delete(route('songs.destroy', deleting.id), { headers: { Accept: 'application/json' } });
            toast.success(`Se borró «${deleting.title}».`);
            setDeleting(null);
            reloadSongs();
        } catch (err) {
            toast.error(errorText(err, 'No se pudo borrar la canción.'));
        } finally {
            setDeletingBusy(false);
        }
    };

    const menuItems = (song: LiveSong) => {
        const chordsMissing = !song.chords_status || song.chords_status === 'failed' || song.chords_status === 'canceled';
        return (
            <>
                {song.status === 'none' && (
                    <DropdownMenuItem onSelect={() => act(song, 'songs.separate', `«${song.title}» en cola para separar.`)}>
                        <Layers /> Separar pistas
                    </DropdownMenuItem>
                )}
                {chordsMissing && (
                    <DropdownMenuItem onSelect={() => act(song, 'songs.chords.analyze', `Detectando los acordes de «${song.title}».`)}>
                        <Music2 /> Detectar acordes
                    </DropdownMenuItem>
                )}
                {song.can_improve_chords && (
                    <DropdownMenuItem
                        onSelect={() =>
                            act(song, 'songs.chords.analyze', 'Mejorando los acordes con las pistas separadas. Tus correcciones se conservan.')
                        }
                    >
                        <Sparkles /> Mejorar acordes con pistas separadas
                    </DropdownMenuItem>
                )}
                {(song.status === 'none' || chordsMissing || song.can_improve_chords) && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => setRenaming(song)}>
                    <Pencil /> Renombrar
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => setDeleting(song)}
                    disabled={song.status === 'processing' || song.chords_status === 'processing'}
                    className="text-red-700 focus:text-red-700 dark:text-red-400"
                >
                    <Trash2 /> Borrar
                </DropdownMenuItem>
            </>
        );
    };

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Canciones" />
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
                <header className="space-y-3">
                    <div>
                        <h1 className="text-2xl font-semibold">Canciones</h1>
                        <p className="text-muted-foreground mt-1">
                            Sube una o varias canciones. Para cada subida eliges si <strong className="text-foreground">separar las pistas</strong>{' '}
                            con la GPU o <strong className="text-foreground">solo subirla</strong> tal cual. Todas se abren en el mezclador.
                        </p>
                    </div>
                    <div className="bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                        <Label htmlFor="chords-auto" className="cursor-pointer leading-snug">
                            Detectar acordes automáticamente en canciones nuevas
                            <span className="text-muted-foreground block text-xs font-normal">
                                Si está desactivado, puedes activarlo en cada subida o detectarlos después en cada canción.
                            </span>
                        </Label>
                        <Switch
                            id="chords-auto"
                            checked={prefs.chords_auto}
                            onCheckedChange={(v) =>
                                savePrefs(
                                    { chords_auto: v },
                                    v ? 'Las canciones nuevas detectarán sus acordes.' : 'Las canciones nuevas no detectarán acordes.',
                                )
                            }
                        />
                    </div>
                </header>

                <UploadDropzone
                    limits={limits}
                    prefs={prefs}
                    onRemember={(p) => savePrefs(p, 'Elección recordada. Puedes cambiarla en Configuración.')}
                    onUploaded={reloadSongs}
                />

                <section aria-labelledby="mis-canciones" className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 id="mis-canciones" className="text-lg font-semibold">
                            Mis canciones <span className="text-muted-foreground font-normal">({songs.length})</span>
                        </h2>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" onClick={analyzeMissing} disabled={bulkBusy || withoutChords === 0}>
                                <Music2 /> Detectar acordes en las que no tienen{withoutChords ? ` (${withoutChords})` : ''}
                            </Button>
                            <div className="relative">
                                <Search
                                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                                    aria-hidden
                                />
                                <Input
                                    type="search"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Buscar canción…"
                                    aria-label="Buscar canción"
                                    className="w-48 pl-8 sm:w-56"
                                />
                            </div>
                            <label className="text-muted-foreground flex items-center gap-2 text-sm">
                                Ordenar
                                <select
                                    value={sort}
                                    onChange={(e) => changeSort(e.target.value as Sort)}
                                    className="border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm"
                                >
                                    <option value="recent">Más recientes</option>
                                    <option value="title">Por título</option>
                                    <option value="status">Por estado</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar canciones">
                        {FILTERS.map((f) => {
                            const count = liveSongs.filter(f.test).length;
                            return (
                                <button
                                    key={f.value}
                                    type="button"
                                    aria-pressed={filter === f.value}
                                    onClick={() => setFilter(f.value)}
                                    className={cn(
                                        'focus-visible:ring-ring rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                                        filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
                                    )}
                                >
                                    {f.label} <span className="opacity-70">{count}</span>
                                </button>
                            );
                        })}
                    </div>

                    <SongList
                        songs={visible}
                        emptyMessage={
                            query
                                ? `Ninguna canción coincide con «${query}».`
                                : filter !== 'all'
                                  ? 'Ninguna canción en este filtro.'
                                  : 'Aún no has subido canciones.'
                        }
                        actions={(song) => (
                            <>
                                <Button size="sm" asChild>
                                    <Link href={route('songs.show', song.id)}>
                                        <SlidersHorizontal /> Abrir mezclador
                                    </Link>
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" aria-label={`Más acciones para ${song.title}`}>
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">{menuItems(song)}</DropdownMenuContent>
                                </DropdownMenu>
                            </>
                        )}
                        details={(song) => <SongStatusDetails song={song} anyProcessing={anyProcessing} onRetried={reloadSongs} />}
                    />
                </section>
            </div>

            <RenameSongDialog song={renaming} onClose={() => setRenaming(null)} onRenamed={reloadSongs} />

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="¿Borrar esta canción?"
                description={
                    <>
                        Se borrarán <strong>«{deleting?.title}»</strong>, su archivo original, sus pistas separadas, sus acordes y todos sus ajustes y
                        silencios. No se puede deshacer.
                    </>
                }
                confirmLabel="Borrar canción"
                destructive
                processing={deletingBusy}
                onConfirm={confirmDelete}
            />
        </AppLayout>
    );
}
