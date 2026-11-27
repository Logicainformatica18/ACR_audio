import AppLayout from '@/layouts/app-layout';
import { type BreadcrumbItem, type SharedData } from '@/types';
import { Head, usePage } from '@inertiajs/react';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Panel', href: '/dashboard' }];

export default function Dashboard() {
    const { auth } = usePage<SharedData>().props;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Panel" />
            <div className="flex flex-1 flex-col gap-4 p-4">
                <h1 className="text-2xl font-semibold">Hola, {auth.user.name}</h1>
                <p className="text-muted-foreground max-w-prose">
                    Bienvenido a ACR Audio, tu plataforma local para separar canciones en pistas con IA y escucharlas en un mezclador.
                </p>
            </div>
        </AppLayout>
    );
}
