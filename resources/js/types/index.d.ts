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
    flash?: { success?: string | null; error?: string | null };
    [key: string]: unknown;
}

/** Estado de la SEPARACIÓN. "none" = no solicitada (se subió con "Solo subir"). */
export type SongStatus = 'none' | 'pending' | 'processing' | 'ready' | 'failed' | 'canceled';

/** Estado de los ACORDES (independiente). null = no solicitados; "waiting" = esperan a la separación. */
export type ChordsStatus = null | 'waiting' | 'pending' | 'processing' | 'ready' | 'failed' | 'canceled';

/** Qué hacer con una subida: separar pistas o guardar el original tal cual. */
export type UploadMode = 'separate' | 'upload';

export interface UploadPrefs {
    chords_auto: boolean;
    upload_mode: UploadMode | null; // null = preguntar con el modal
}

export interface Song {
    id: number;
    title: string;
    folder_id: number | null;
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
    chords_status: ChordsStatus;
    chords_progress: number;
    chords_key: string | null;
    chords_source: 'original' | 'stems' | null;
    chords_error: string | null;
    can_improve_chords: boolean;
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
