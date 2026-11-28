import { UploadChoiceDialog, type UploadChoice } from '@/components/songs/upload-choice-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { type Folder } from '@/lib/folders';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type UploadPrefs } from '@/types';
import axios, { AxiosError } from 'axios';
import { ListVideo, LoaderCircle, Search, Video, X, Youtube } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export interface YtEntry {
    id: string;
    title: string;
    channel: string | null;
    duration: number | null;
    thumbnail: string | null;
    available: boolean;
    url: string;
    existing: string | null; // título de la canción que ya tienes con este video
}

interface Inspect {
    video: YtEntry | null;
    playlist: { id: string; title: string; channel: string | null; entries: YtEntry[] } | null;
}

interface Props {
    prefs: UploadPrefs;
    folders: Folder[];
    currentFolderId: number | null;
    onCreateFolder: (name: string) => Promise<number | null>;
    onImported: () => void;
}

/**
 * "Pegar enlace de YouTube": muestra el video (o la lista, SIN descargar nada,
 * para elegir con casillas) y luego usa el mismo modal de subida.
 */
export function YoutubeImport({ prefs, folders, currentFolderId, onCreateFolder, onImported }: Props) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState<Inspect | null>(null);
    /** Si el enlace tiene video y lista: cuál quiere el usuario. */
    const [which, setWhich] = useState<'video' | 'playlist' | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [choosing, setChoosing] = useState<YtEntry[] | null>(null);
    const [importing, setImporting] = useState(false);

    const reset = () => {
        setData(null);
        setWhich(null);
        setChecked(new Set());
        setError('');
    };

    const inspect = async () => {
        if (!url.trim()) return;
        reset();
        setLoading(true);
        try {
            const { data: d } = await axios.post<Inspect>(route('youtube.inspect'), { url }, { headers: { Accept: 'application/json' } });
            setData(d);
            if (d.video && d.playlist) setWhich(null);
            else setWhich(d.playlist ? 'playlist' : 'video');
            // En una lista vienen marcados los disponibles que aún no tienes.
            if (d.playlist) setChecked(new Set(d.playlist.entries.filter((e) => e.available && !e.existing).map((e) => e.id)));
        } catch (err) {
            setError((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo leer el enlace.');
        } finally {
            setLoading(false);
        }
    };

    const doImport = async (choice: UploadChoice, entries: YtEntry[]) => {
        setChoosing(null);
        setImporting(true);
        try {
            const allowDup = entries.some((e) => e.existing); // el usuario marcó a propósito una que ya tenía
            const { data: r } = await axios.post<{ message: string }>(
                route('youtube.import'),
                {
                    videos: entries.map((e) => ({ id: e.id, title: e.title, channel: e.channel, duration: e.duration, thumbnail: e.thumbnail })),
                    mode: choice.mode,
                    chords: choice.chords,
                    folder_id: choice.folderId,
                    allow_duplicates: allowDup,
                },
                { headers: { Accept: 'application/json' } },
            );
            toast.success(r.message);
            setUrl('');
            reset();
            onImported();
        } catch (err) {
            toast.error((err as AxiosError<{ message?: string }>).response?.data?.message ?? 'No se pudo agregar.');
        } finally {
            setImporting(false);
        }
    };

    const list = data?.playlist;
    const video = data?.video;
    const selected = list?.entries.filter((e) => checked.has(e.id)) ?? [];

    return (
        <section aria-label="Agregar desde YouTube" className="bg-card space-y-3 rounded-xl border p-3 sm:p-4">
            <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void inspect();
                }}
            >
                <Youtube className="size-5 shrink-0 text-red-600" aria-hidden />
                <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onPaste={(e) => {
                        const text = e.clipboardData.getData('text');
                        if (/youtu/.test(text)) setTimeout(() => void inspect(), 0);
                    }}
                    placeholder="Pegar enlace de YouTube (video o lista)"
                    aria-label="Pegar enlace de YouTube"
                    className="min-w-0 flex-1 basis-60"
                    inputMode="url"
                />
                <Button type="submit" disabled={loading || !url.trim()}>
                    {loading ? <LoaderCircle className="animate-spin" /> : <Search />} Buscar
                </Button>
                {(data || error) && (
                    <Button type="button" variant="ghost" size="icon" onClick={reset} aria-label="Cerrar">
                        <X />
                    </Button>
                )}
            </form>
            {loading && <p className="text-muted-foreground text-sm">Leyendo el enlace en YouTube… (no se descarga nada todavía)</p>}
            {error && (
                <p className="text-sm text-red-700 dark:text-red-400" role="alert">
                    {error}
                </p>
            )}

            {/* Video + lista a la vez: preguntar cuál */}
            {data && video && list && which === null && (
                <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">Este enlace tiene un video y una lista. ¿Qué quieres agregar?</p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setWhich('video')}>
                            <Video /> Solo este video
                        </Button>
                        <Button variant="outline" onClick={() => setWhich('playlist')}>
                            <ListVideo /> La lista «{list.title}» ({list.entries.length})
                        </Button>
                    </div>
                </div>
            )}

            {/* Un video */}
            {data && video && which === 'video' && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    {video.thumbnail && (
                        <img src={video.thumbnail} alt="" className="h-20 w-36 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />
                    )}
                    <div className="min-w-0 flex-1 basis-48">
                        <p className="font-medium">{video.title}</p>
                        <p className="text-muted-foreground text-sm">
                            {video.channel && `${video.channel} · `}
                            {formatDuration(video.duration)}
                        </p>
                        {video.existing && <p className="text-sm text-amber-700 dark:text-amber-400">Ya tienes esta canción: «{video.existing}».</p>}
                    </div>
                    <div className="flex gap-2">
                        {video.existing && (
                            <Button variant="ghost" onClick={reset}>
                                Omitir
                            </Button>
                        )}
                        <Button disabled={importing} onClick={() => setChoosing([video])}>
                            {video.existing ? 'Agregar de todos modos' : 'Agregar'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Una lista: elegir con casillas */}
            {data && list && which === 'playlist' && (
                <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                            <ListVideo className="mr-1 inline size-4" aria-hidden /> {list.title}{' '}
                            <span className="text-muted-foreground font-normal">({list.entries.length} videos)</span>
                        </p>
                        <div className="flex gap-1">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setChecked(new Set(list.entries.filter((e) => e.available).map((e) => e.id)))}
                            >
                                Seleccionar todo
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                                Ninguno
                            </Button>
                        </div>
                    </div>
                    <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" aria-label="Videos de la lista">
                        {list.entries.map((e) => (
                            <li key={e.id} className={cn('flex items-center gap-3 px-2 py-1.5', !e.available && 'opacity-50')}>
                                <Checkbox
                                    id={`yt-${e.id}`}
                                    checked={checked.has(e.id)}
                                    disabled={!e.available}
                                    onCheckedChange={(v) =>
                                        setChecked((s) => {
                                            const n = new Set(s);
                                            if (v === true) n.add(e.id);
                                            else n.delete(e.id);
                                            return n;
                                        })
                                    }
                                />
                                {e.thumbnail ? (
                                    <img
                                        src={e.thumbnail}
                                        alt=""
                                        className="h-9 w-16 shrink-0 rounded object-cover"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <span className="bg-muted h-9 w-16 shrink-0 rounded" />
                                )}
                                <label htmlFor={`yt-${e.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                                    <span className="block truncate">{e.title}</span>
                                    <span className="text-muted-foreground text-xs">
                                        {formatDuration(e.duration)}
                                        {!e.available && ' · no disponible'}
                                        {e.existing && <span className="text-amber-700 dark:text-amber-400"> · ya la tienes («{e.existing}»)</span>}
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-muted-foreground text-sm">{selected.length} seleccionados</span>
                        <Button disabled={!selected.length || importing} onClick={() => setChoosing(selected)}>
                            Agregar {selected.length || ''}
                        </Button>
                    </div>
                </div>
            )}

            <UploadChoiceDialog
                files={null}
                items={choosing ? choosing.map((e) => ({ name: e.title, detail: formatDuration(e.duration) })) : undefined}
                title={choosing && choosing.length > 1 ? `¿Qué hacemos con estos ${choosing.length} videos?` : '¿Qué hacemos con este video?'}
                defaultChords={prefs.chords_auto}
                defaultMode={prefs.upload_mode ?? 'upload'}
                folders={folders}
                defaultFolderId={currentFolderId}
                suggestFolderName={choosing && which === 'playlist' && list ? list.title : null}
                onCreateFolder={onCreateFolder}
                onCancel={() => setChoosing(null)}
                onChoose={(choice) => choosing && void doImport(choice, choosing)}
            />
        </section>
    );
}
