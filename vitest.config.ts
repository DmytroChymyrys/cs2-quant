import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 15000 }, resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } });
