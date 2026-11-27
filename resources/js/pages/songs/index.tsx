import { ConfirmDialog } from '@/components/confirm-dialog';
import { RenameSongDialog } from '@/components/songs/rename-song-dialog';
import { SongList } from '@/components/songs/song-list';
import { SongStatusDetails } from '@/components/songs/song-status-details';
import { statusLabel } from '@/components/songs/status-badge';
import { UploadDropzone } from '@/components/songs/upload-dropzone';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useSongStatus } from '@/hooks/use-song-status';
import AppLayout from '@/layouts/app-layout';
import { type BreadcrumbItem, type Song, type UploadLimits } from '@/types';
import { Head, Link, router } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import { MoreHorizontal, Pencil, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Canciones', href: '/songs' }];

type Sort = 'recent' | 'title' | 'status';

interface Props {
    songs: Song[];
    sort: Sort;
    limits: UploadLimits;
}

/** Quita tildes y pasa a minúsculas para buscar "cancion" y encontrar "Canción". */
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SongsIndex({ songs, sort, limits }: Props) {
    const liveSongs = useSongStatus(songs);
    const anyProcessing = liveSongs.some((s) => s.status === 'processing');
    const [query, setQuery] = useState('');
    const [renaming, setRenaming] = useState<Song | null>(null);
    const [deleting, setDeleting] = useState<Song | null>(null);
    const [deletingBusy, setDeletingBusy] = useState(false);

    // Recarga solo la lista (sin recargar la página).
    const reloadSongs = useCallback(() => router.reload({ only: ['songs'] }), []);

    // Búsqueda instantánea por título, nombre del archivo o estado.
    const visible = useMemo(() => {
        const q = normalize(query.trim());
        if (!q) return liveSongs;
        return liveSongs.filter((s) => normalize(`${s.title} ${s.original_name} ${statusLabel(s.status)}`).includes(q));
    }, [liveSongs, query]);

    const changeSort = (value: Sort) => router.patch(route('preferences.sort'), { songs_sort: value }, { preserveScroll: true, only: ['songs', 'sort'] });

    const confirmDelete = async () => {
        if (!deleting) return;
        setDeletingBusy(true);
        try {
            await axios.delete(route('songs.destroy', deleting.id), { headers: { Accept: 'application/json' } });
            toast.success(`Se borró «${deleting.title}».`);
            setDeleting(null);
            reloadSongs();
        } catch (err) {
            toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo borrar la canción.');
        } finally {
            setDeletingBusy(false);
        }
    };

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Canciones" />
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-4">
                <header>
                    <h1 className="text-2xl font-semibold">Canciones</h1>
                    <p className="text-muted-foreground mt-1">
                        Sube una o varias canciones. Cada una se separa automáticamente en pistas y después puedes abrirla en el mezclador.
                    </p>
                </header>

                <UploadDropzone limits={limits} onUploaded={reloadSongs} />

                <section aria-labelledby="mis-canciones" className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 id="mis-canciones" className="text-lg font-semibold">
                            Mis canciones <span className="text-muted-foreground font-normal">({songs.length})</span>
                        </h2>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
                                <Input
                                    type="search"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Buscar canción…"
                                    aria-label="Buscar canción"
                                    className="w-56 pl-8"
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

                    <SongList
                        songs={visible}
                        emptyMessage={query ? `Ninguna canción coincide con «${query}».` : 'Aún no has subido canciones.'}
                        actions={(song) => (
                            <>
                                {song.status === 'ready' && (
                                    <Button size="sm" asChild>
                                        <Link href={route('songs.show', song.id)}>
                                            <SlidersHorizontal /> Abrir mezclador
                                        </Link>
                                    </Button>
                                )}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" aria-label={`Más acciones para ${song.title}`}>
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onSelect={() => setRenaming(song)}>
                                            <Pencil /> Renombrar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onSelect={() => setDeleting(song)}
                                            disabled={song.status === 'processing'}
                                            className="text-red-700 focus:text-red-700 dark:text-red-400"
                                        >
                                            <Trash2 /> Borrar
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
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
                        Se borrarán <strong>«{deleting?.title}»</strong>, su archivo original, sus pistas separadas y todos sus ajustes y silencios. No se puede
                        deshacer.
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
