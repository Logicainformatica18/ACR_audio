import { SongList } from '@/components/songs/song-list';
import { SongStatusDetails } from '@/components/songs/song-status-details';
import { UploadDropzone } from '@/components/songs/upload-dropzone';
import { Button } from '@/components/ui/button';
import { useSongStatus } from '@/hooks/use-song-status';
import AppLayout from '@/layouts/app-layout';
import { type BreadcrumbItem, type Song, type UploadLimits } from '@/types';
import { Head, Link, router } from '@inertiajs/react';
import { SlidersHorizontal } from 'lucide-react';
import { useCallback } from 'react';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Canciones', href: '/songs' }];

interface Props {
    songs: Song[];
    limits: UploadLimits;
}

export default function SongsIndex({ songs, limits }: Props) {
    const liveSongs = useSongStatus(songs);
    const anyProcessing = liveSongs.some((s) => s.status === 'processing');

    // Recarga solo la lista (sin recargar la página).
    const reloadSongs = useCallback(() => router.reload({ only: ['songs'] }), []);

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
                    <h2 id="mis-canciones" className="text-lg font-semibold">
                        Mis canciones <span className="text-muted-foreground font-normal">({songs.length})</span>
                    </h2>
                    <SongList
                        songs={liveSongs}
                        actions={(song) =>
                            song.status === 'ready' && (
                                <Button size="sm" asChild>
                                    <Link href={route('songs.show', song.id)}>
                                        <SlidersHorizontal /> Abrir mezclador
                                    </Link>
                                </Button>
                            )
                        }
                        details={(song) => <SongStatusDetails song={song} anyProcessing={anyProcessing} onRetried={reloadSongs} />}
                    />
                </section>
            </div>
        </AppLayout>
    );
}
