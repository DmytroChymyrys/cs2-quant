import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', testTimeout: 15000 }, resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } });
