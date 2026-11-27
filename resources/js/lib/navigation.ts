import { type NavItem } from '@/types';
import { LayoutGrid, Music } from 'lucide-react';

/** Menú principal (barra lateral y menú móvil). */
export const mainNavItems: NavItem[] = [
    {
        title: 'Panel',
        href: '/dashboard',
        icon: LayoutGrid,
    },
    {
        title: 'Canciones',
        href: '/songs',
        icon: Music,
    },
];
