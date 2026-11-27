import { LucideIcon } from 'lucide-react';
import type { Config } from 'ziggy-js';

export interface Auth {
    user: User;
}

export interface BreadcrumbItem {
    title: string;
    href: string;
}

export interface NavGroup {
    title: string;
    items: NavItem[];
}

export interface NavItem {
    title: string;
    href: string;
    icon?: LucideIcon | null;
    isActive?: boolean;
}

export interface SharedData {
    name: string;
    quote: { message: string; author: string };
    auth: Auth;
    ziggy: Config & { location: string };
    sidebarOpen: boolean;
    [key: string]: unknown;
}

export type SongStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface Song {
    id: number;
    title: string;
    status: SongStatus;
    error: string | null;
    original_name: string;
    original_ext: string;
    original_size: number;
    duration: number | null;
    model: string | null;
    tracks_count?: number;
    created_at: string;
    queued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
}

/** Canción con datos de estado en vivo (GET /songs/status). */
export interface LiveSong extends Song {
    progress: number | null; // % mientras se procesa
    queue_position: number | null; // posición en la cola mientras espera
}

export interface UploadLimits {
    max_mb: number;
    extensions: string[];
}

export interface User {
    id: number;
    name: string;
    email: string;
    avatar?: string;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: unknown; // This allows for additional properties...
}
