import { SongList } from '@/components/songs/song-list';
import { UploadDropzone } from '@/components/songs/upload-dropzone';
import AppLayout from '@/layouts/app-layout';
import { type BreadcrumbItem, type Song, type UploadLimits } from '@/types';
import { Head, router } from '@inertiajs/react';
import { useCallback } from 'react';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Canciones', href: '/songs' }];

interface Props {
    songs: Song[];
    limits: UploadLimits;
}

export default function SongsIndex({ songs, limits }: Props) {
    // Tras cada subida, recarga solo la lista (sin recargar la página).
    const onUploaded = useCallback(() => {
        router.reload({ only: ['songs'] });
    }, []);

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

                <UploadDropzone limits={limits} onUploaded={onUploaded} />

                <section aria-labelledby="mis-canciones" className="space-y-3">
                    <h2 id="mis-canciones" className="text-lg font-semibold">
                        Mis canciones <span className="text-muted-foreground font-normal">({songs.length})</span>
                    </h2>
                    <SongList songs={songs} />
                </section>
            </div>
        </AppLayout>
    );
}
