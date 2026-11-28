import HeadingSmall from '@/components/heading-small';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/app-layout';
import SettingsLayout from '@/layouts/settings/layout';
import { type BreadcrumbItem } from '@/types';
import { Head, useForm } from '@inertiajs/react';
import axios, { AxiosError } from 'axios';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { FormEventHandler, useEffect, useState } from 'react';
import { toast } from 'sonner';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Preferencias', href: '/settings/preferences' }];

interface Props {
    preferences: {
        separation_model: string;
        songs_sort: 'recent' | 'title' | 'status';
        keyboard_shortcuts: boolean;
        master_volume: number;
        chords_auto: boolean;
        upload_mode: 'ask' | 'separate' | 'upload';
    };
    models: { value: string; label: string }[];
    defaultModel: string;
}

const selectClass = 'border-input bg-background h-9 w-full rounded-md border px-3 text-sm';

export default function Preferences({ preferences, models, defaultModel }: Props) {
    const { data, setData, put, processing, errors } = useForm(preferences);

    const submit: FormEventHandler = (e) => {
        e.preventDefault();
        put(route('preferences.update'), { preserveScroll: true });
    };

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Preferencias" />
            <SettingsLayout>
                <div className="space-y-6">
                    <HeadingSmall title="Preferencias" description="Qué pasa al subir canciones, cómo se separan y cómo se comporta el mezclador" />

                    <form onSubmit={submit} className="space-y-6">
                        <div className="grid gap-2">
                            <Label htmlFor="upload_mode">Al subir canciones</Label>
                            <select
                                id="upload_mode"
                                className={selectClass}
                                value={data.upload_mode}
                                onChange={(e) => setData('upload_mode', e.target.value as Props['preferences']['upload_mode'])}
                            >
                                <option value="ask">Preguntar cada vez (Separar pistas o Solo subir)</option>
                                <option value="separate">Separar pistas siempre, sin preguntar</option>
                                <option value="upload">Solo subir siempre, sin preguntar</option>
                            </select>
                            <p className="text-muted-foreground text-sm">
                                Si marcaste «Recordar y no volver a preguntar» al subir, elige «Preguntar cada vez» para que vuelva a aparecer la
                                ventana.
                            </p>
                            <InputError message={errors.upload_mode} />
                        </div>

                        <div className="flex items-start gap-3">
                            <Checkbox id="chords_auto" checked={data.chords_auto} onCheckedChange={(v) => setData('chords_auto', v === true)} />
                            <div className="grid gap-1">
                                <Label htmlFor="chords_auto">Detectar acordes automáticamente en canciones nuevas</Label>
                                <p className="text-muted-foreground text-sm">
                                    Con las pistas separadas si eliges separar (esperando a que termine) o con el audio original si eliges «Solo
                                    subir». También está en la página de Canciones.
                                </p>
                                <InputError message={errors.chords_auto} />
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="separation_model">Modelo de separación</Label>
                            <select
                                id="separation_model"
                                className={selectClass}
                                value={data.separation_model}
                                onChange={(e) => setData('separation_model', e.target.value)}
                            >
                                {models.map((m) => (
                                    <option key={m.value} value={m.value}>
                                        {m.label}
                                        {m.value === defaultModel ? ' (predeterminado)' : ''}
                                    </option>
                                ))}
                            </select>
                            <p className="text-muted-foreground text-sm">
                                Se usa para las próximas canciones que subas. Solo aparecen los modelos que ya están descargados en la carpeta de
                                modelos.
                            </p>
                            <InputError message={errors.separation_model} />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="songs_sort">Orden de la lista de canciones</Label>
                            <select
                                id="songs_sort"
                                className={selectClass}
                                value={data.songs_sort}
                                onChange={(e) => setData('songs_sort', e.target.value as Props['preferences']['songs_sort'])}
                            >
                                <option value="recent">Más recientes primero</option>
                                <option value="title">Por título (A–Z)</option>
                                <option value="status">Por estado (las que se están procesando primero)</option>
                            </select>
                            <InputError message={errors.songs_sort} />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="master_volume">Volumen general del mezclador: {Math.round(data.master_volume * 100)}%</Label>
                            <input
                                id="master_volume"
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={data.master_volume}
                                onChange={(e) => setData('master_volume', +e.target.value)}
                                className="accent-primary w-full"
                            />
                            <InputError message={errors.master_volume} />
                        </div>

                        <div className="flex items-start gap-3">
                            <Checkbox
                                id="keyboard_shortcuts"
                                checked={data.keyboard_shortcuts}
                                onCheckedChange={(v) => setData('keyboard_shortcuts', v === true)}
                            />
                            <div className="grid gap-1">
                                <Label htmlFor="keyboard_shortcuts">Atajos de teclado en el mezclador</Label>
                                <p className="text-muted-foreground text-sm">
                                    Espacio para reproducir o pausar, 1 a 9 para silenciar pistas, Inicio para volver al principio.
                                </p>
                            </div>
                        </div>

                        <Button disabled={processing}>Guardar preferencias</Button>
                    </form>

                    <YoutubeSection />
                </div>
            </SettingsLayout>
        </AppLayout>
    );
}

/** YouTube cambia a menudo: versión de yt-dlp y botón para actualizarlo (php artisan youtube:actualizar). */
function YoutubeSection() {
    const [version, setVersion] = useState<{ ok: boolean; yt_dlp: string | null; deno: string | null; message: string | null } | null>(null);
    const [updating, setUpdating] = useState(false);
    const [output, setOutput] = useState<string | null>(null);

    const load = () =>
        axios
            .get(route('youtube.version'), { headers: { Accept: 'application/json' } })
            .then((r) => setVersion(r.data))
            .catch(() => setVersion({ ok: false, yt_dlp: null, deno: null, message: 'No se pudo consultar la versión.' }));
    useEffect(() => {
        void load();
    }, []);

    const update = async () => {
        setUpdating(true);
        setOutput(null);
        try {
            const { data } = await axios.post<{ ok: boolean; output: string }>(
                route('youtube.update'),
                {},
                { headers: { Accept: 'application/json' } },
            );
            setOutput(data.output);
            toast.success('yt-dlp actualizado.');
        } catch (err) {
            const out = (err as AxiosError<{ output?: string; message?: string }>).response?.data;
            setOutput(out?.output ?? out?.message ?? 'No se pudo actualizar.');
            toast.error('No se pudo actualizar yt-dlp.');
        } finally {
            setUpdating(false);
            void load();
        }
    };

    return (
        <section className="space-y-3 border-t pt-6" aria-labelledby="yt-heading">
            <HeadingSmall title="YouTube" description="Motor de descargas (yt-dlp). YouTube cambia a menudo: si las descargas fallan, actualízalo." />
            <p className="text-sm">
                {version === null
                    ? 'Consultando versión…'
                    : version.ok
                      ? `yt-dlp ${version.yt_dlp} · Deno ${version.deno ?? 'no encontrado'}`
                      : (version.message ?? 'El motor de YouTube no está instalado.')}
            </p>
            <Button type="button" variant="outline" onClick={update} disabled={updating}>
                {updating ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{' '}
                {updating ? 'Actualizando… (hasta un minuto)' : 'Actualizar yt-dlp'}
            </Button>
            {output && <pre className="bg-muted max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{output}</pre>}
        </section>
    );
}
