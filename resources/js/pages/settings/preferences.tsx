import HeadingSmall from '@/components/heading-small';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import AppLayout from '@/layouts/app-layout';
import SettingsLayout from '@/layouts/settings/layout';
import { type BreadcrumbItem } from '@/types';
import { Head, useForm } from '@inertiajs/react';
import { FormEventHandler } from 'react';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Preferencias', href: '/settings/preferences' }];

interface Props {
    preferences: {
        separation_model: string;
        songs_sort: 'recent' | 'title' | 'status';
        keyboard_shortcuts: boolean;
        master_volume: number;
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
                    <HeadingSmall title="Preferencias" description="Cómo se separan tus canciones y cómo se comporta el mezclador" />

                    <form onSubmit={submit} className="space-y-6">
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
                                Se usa para las próximas canciones que subas. Solo aparecen los modelos que ya están descargados en la carpeta de modelos.
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
                                <p className="text-muted-foreground text-sm">Espacio para reproducir o pausar, 1 a 9 para silenciar pistas, Inicio para volver al principio.</p>
                            </div>
                        </div>

                        <Button disabled={processing}>Guardar preferencias</Button>
                    </form>
                </div>
            </SettingsLayout>
        </AppLayout>
    );
}
