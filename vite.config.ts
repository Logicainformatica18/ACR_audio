import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
        }),
        react(),
        tailwindcss(),
    ],
    esbuild: {
        jsx: 'automatic',
    },
    server: {
        watch: {
            // No vigilar carpetas que no son de la web: los entornos de Python
            // (separador/ y tools/acordes/.venv tienen ~64 000 archivos) dejaban
            // a Vite sin responder y el login se quedaba cargando.
            ignored: ['**/separador/**', '**/tools/**', '**/storage/**', '**/vendor/**', '**/referencias/**', '**/docs/**'],
        },
    },
    resolve: {
        alias: {
            'ziggy-js': resolve(__dirname, 'vendor/tightenco/ziggy'),
        },
    },
});
