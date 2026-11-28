import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests de JavaScript (lógica pura, sin navegador): npm run test:js
export default defineConfig({
    resolve: {
        alias: { '@': resolve(__dirname, 'resources/js') },
    },
    test: {
        include: ['resources/js/**/*.test.ts'],
        environment: 'node',
    },
});
