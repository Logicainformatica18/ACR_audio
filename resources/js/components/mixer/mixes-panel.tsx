import { InlineEdit } from '@/components/inline-edit';
import { Button } from '@/components/ui/button';
import { formatBytes, formatDate } from '@/lib/format';
import { fmt } from '@/lib/mixer/time';
import { Download, FileAudio, Save, Trash2, Upload, Wand2 } from 'lucide-react';
import { useState } from 'react';

export interface MixSettings {
    master: number;
    tracks: { id: number; volume: number; muted: boolean; solo: boolean }[];
    silences: { track_id: number; start: number; end: number }[];
    show_original: boolean;
    range: { start: number; end: number } | null;
}

export interface SavedMix {
    id: number;
    name: string;
    settings: MixSettings;
    updated_at: string | null;
}

export interface MixExportFile {
    id: number;
    mix_id: number | null;
    name: string;
    format: 'wav' | 'flac' | 'mp3';
    size: number;
    duration: number | null;
    range_start: number | null;
    range_end: number | null;
    gain_applied: number | null;
    created_at: string | null;
    download_url: string;
}

interface Props {
    mixes: SavedMix[];
    exports: MixExportFile[];
    /** Resumen legible de unos ajustes ("sin batería · 1:00–2:30"). */
    summarize: (s: MixSettings) => string;
    editingMixId: number | null;
    setEditingMixId: (id: number | null) => void;
    onSave: () => void;
    onRename: (mix: SavedMix, name: string) => void;
    onLoad: (mix: SavedMix) => void;
    onExport: (mix: SavedMix) => void;
    onDeleteMix: (mix: SavedMix) => void;
    onDeleteExport: (file: MixExportFile) => void;
    disabled: boolean;
}

/** Mezclas guardadas (cargar, exportar, borrar) y archivos exportados (descargar de nuevo, borrar). */
export function MixesPanel(props: Props) {
    const { mixes, exports, summarize, editingMixId, setEditingMixId, onSave, onRename, onLoad, onExport, onDeleteMix, onDeleteExport, disabled } =
        props;
    const [showAll, setShowAll] = useState(false);
    const shownExports = showAll ? exports : exports.slice(0, 6);
    const totalSize = exports.reduce((a, e) => a + e.size, 0);

    return (
        <section className="space-y-6 border-t pt-6" aria-labelledby="mezclas">
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 id="mezclas" className="text-xl font-semibold">
                            Mezclas guardadas
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Guarda los ajustes actuales (mute, solo, volúmenes, silencios y tramo) para volver a ellos o exportarlos.
                        </p>
                    </div>
                    <Button variant="outline" onClick={onSave} disabled={disabled}>
                        <Save /> Guardar esta mezcla
                    </Button>
                </div>
                {mixes.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Todavía no hay mezclas guardadas.</p>
                ) : (
                    <ul className="grid gap-1.5">
                        {mixes.map((m) => (
                            <li key={m.id} className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 text-sm">
                                <Wand2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
                                <div className="min-w-0 flex-1 basis-48">
                                    <InlineEdit
                                        value={m.name}
                                        editing={editingMixId === m.id}
                                        onEditingChange={(e) => setEditingMixId(e ? m.id : null)}
                                        onSave={(name) => onRename(m, name)}
                                        ariaLabel="Nombre de la mezcla"
                                        maxLength={120}
                                        className="block truncate font-medium"
                                        inputClassName="w-full text-sm font-medium"
                                    />
                                    <span className="text-muted-foreground block truncate text-xs">{summarize(m.settings)}</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    <Button size="sm" variant="outline" onClick={() => onLoad(m)} disabled={disabled}>
                                        <Upload /> Cargar
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => onExport(m)} disabled={disabled}>
                                        <Download /> Exportar
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => onDeleteMix(m)} aria-label={`Borrar la mezcla ${m.name}`}>
                                        <Trash2 />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="space-y-3">
                <div>
                    <h2 className="text-xl font-semibold">Archivos exportados</h2>
                    <p className="text-muted-foreground text-sm">
                        Se guardan en tu carpeta de audios para descargarlos otra vez.{' '}
                        {exports.length > 0 && `Ocupan ${formatBytes(totalSize)}; bórralos para liberar espacio.`}
                    </p>
                </div>
                {exports.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Aún no has exportado ninguna mezcla de esta canción.</p>
                ) : (
                    <ul className="grid gap-1.5">
                        {shownExports.map((e) => (
                            <li key={e.id} className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
                                <FileAudio className="text-muted-foreground size-4 shrink-0" aria-hidden />
                                <div className="min-w-0 flex-1 basis-48">
                                    <span className="block truncate font-medium" title={`${e.name}.${e.format}`}>
                                        {e.name}.{e.format}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                        {e.format.toUpperCase()} · {formatBytes(e.size)}
                                        {e.duration ? ` · ${fmt(e.duration)}` : ''}
                                        {e.created_at ? ` · ${formatDate(e.created_at)}` : ''}
                                        {e.gain_applied && e.gain_applied < 0.999
                                            ? ` · volumen bajado ${Math.round(20 * Math.log10(e.gain_applied) * 10) / 10} dB para no saturar`
                                            : ''}
                                    </span>
                                </div>
                                <Button size="sm" variant="outline" asChild>
                                    <a href={e.download_url}>
                                        <Download /> Descargar
                                    </a>
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => onDeleteExport(e)} aria-label={`Borrar el archivo ${e.name}`}>
                                    <Trash2 />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                {exports.length > 6 && (
                    <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                        {showAll ? 'Ver menos' : `Ver los ${exports.length}`}
                    </Button>
                )}
            </div>
        </section>
    );
}
