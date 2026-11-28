import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface Props {
    value: string;
    /** Se llama con el texto nuevo (ya recortado) si cambió y no está vacío. */
    onSave: (value: string) => void;
    editing: boolean;
    onEditingChange: (editing: boolean) => void;
    className?: string;
    inputClassName?: string;
    ariaLabel: string;
    maxLength?: number;
    /** Permite guardar vacío (por ejemplo, para volver al nombre por defecto). */
    allowEmpty?: boolean;
}

/**
 * Edición en línea, sin ventanas: doble clic (o F2 desde fuera) muestra un
 * campo con el texto seleccionado. Enter guarda, Esc cancela y hacer clic
 * fuera también guarda.
 */
export function InlineEdit({
    value,
    onSave,
    editing,
    onEditingChange,
    className,
    inputClassName,
    ariaLabel,
    maxLength = 200,
    allowEmpty = false,
}: Props) {
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLInputElement>(null);
    const done = useRef(false);

    useEffect(() => {
        if (editing) {
            setDraft(value);
            done.current = false;
            requestAnimationFrame(() => {
                ref.current?.focus();
                ref.current?.select();
            });
        }
    }, [editing, value]);

    const finish = (save: boolean) => {
        if (done.current) return;
        done.current = true;
        const next = draft.trim();
        onEditingChange(false);
        if (save && next !== value.trim() && (next !== '' || allowEmpty)) onSave(next);
    };

    if (!editing) {
        return (
            <span className={className} onDoubleClick={() => onEditingChange(true)} title={`${value} · doble clic o F2 para renombrar`}>
                {value}
            </span>
        );
    }

    return (
        <input
            ref={ref}
            value={draft}
            maxLength={maxLength}
            aria-label={ariaLabel}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
            }}
            onBlur={() => finish(true)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
                'border-primary bg-background text-foreground focus-visible:ring-ring min-w-0 rounded border px-1 py-0 outline-none focus-visible:ring-2',
                inputClassName,
            )}
        />
    );
}
