import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';

/** Menú contextual (clic derecho) con el mismo aspecto que los menús desplegables. */
const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuSub = ContextMenuPrimitive.Sub;

const contentClass =
    'bg-popover text-popover-foreground z-50 min-w-[12rem] overflow-hidden rounded-md border p-1 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';
const itemClass =
    "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-muted-foreground";

function ContextMenuContent({ className, onCloseAutoFocus, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
                className={cn(contentClass, className)}
                // Al cerrarse no devuelve el foco a la fila: la acción elegida (renombrar en línea,
                // "Mover a…") ya lo puso en su campo y no hay que quitárselo.
                onCloseAutoFocus={onCloseAutoFocus ?? ((e) => e.preventDefault())}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    );
}

function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
    return <ContextMenuPrimitive.Item className={cn(itemClass, className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
    return <ContextMenuPrimitive.Separator className={cn('bg-border -mx-1 my-1 h-px', className)} {...props} />;
}

function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
    return (
        <ContextMenuPrimitive.SubTrigger className={cn(itemClass, 'data-[state=open]:bg-accent', className)} {...props}>
            {children}
            <ChevronRight className="ml-auto" />
        </ContextMenuPrimitive.SubTrigger>
    );
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.SubContent className={cn(contentClass, className)} {...props} />
        </ContextMenuPrimitive.Portal>
    );
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger };
