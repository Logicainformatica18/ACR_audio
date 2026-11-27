import { SongList } from '@/components/songs/song-list';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import { formatBytes } from '@/lib/format';
import { type BreadcrumbItem, type SharedData, type Song } from '@/types';
import { Head, Link, usePage } from '@inertiajs/react';
import { Music, SlidersHorizontal, Upload } from 'lucide-react';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Panel', href: '/dashboard' }];

interface Props {
    stats: { total: number; pending: number; processing: number; ready: number; failed: number; bytes: number; minutes: number };
    recent: Song[];
}

export default function Dashboard({ stats, recent }: Props) {
    const { auth } = usePage<SharedData>().props;

    const cards = [
        { label: 'Canciones', value: stats.total },
        { label: 'Listas', value: stats.ready },
        { label: 'En cola o procesando', value: stats.pending + stats.processing },
        { label: 'Con error', value: stats.failed },
        { label: 'Minutos separados', value: stats.minutes.toLocaleString('es') },
        { label: 'Espacio en disco', value: formatBytes(stats.bytes) },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Panel" />
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-4">
                <header className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-semibold">Hola, {auth.user.name}</h1>
                        <p className="text-muted-foreground mt-1">Separa canciones en pistas con IA y escúchalas en el mezclador.</p>
                    </div>
                    <Button asChild>
                        <Link href={route('songs.index')}>
                            <Upload /> Subir canciones
                        </Link>
                    </Button>
                </header>

                <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {cards.map((c) => (
                        <div key={c.label} className="bg-card rounded-xl border p-4">
                            <dt className="text-muted-foreground text-sm">{c.label}</dt>
                            <dd className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</dd>
                        </div>
                    ))}
                </dl>

                <section className="space-y-3" aria-labelledby="recientes">
                    <div className="flex items-center justify-between">
                        <h2 id="recientes" className="text-lg font-semibold">
                            Últimas canciones
                        </h2>
                        {stats.total > 0 && (
                            <Link href={route('songs.index')} className="text-sm underline-offset-4 hover:underline">
                                Ver todas
                            </Link>
                        )}
                    </div>
                    <SongList
                        songs={recent}
                        emptyMessage="Todavía no hay canciones. Ve a Canciones y arrastra tu primer archivo."
                        actions={(song) =>
                            song.status === 'ready' && (
                                <Button size="sm" variant="outline" asChild>
                                    <Link href={route('songs.show', song.id)}>
                                        <SlidersHorizontal /> Mezclador
                                    </Link>
                                </Button>
                            )
                        }
                    />
                </section>

                <section className="text-muted-foreground bg-muted/40 rounded-xl border p-4 text-sm">
                    <p className="text-foreground mb-1 flex items-center gap-2 font-medium">
                        <Music className="size-4" /> Recuerda
                    </p>
                    Para que las canciones se separen, la ventana de <strong>iniciar.bat</strong> tiene que estar abierta.
                </section>
            </div>
        </AppLayout>
    );
}
