import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 15000,
    /*
     * Several suites bootstrap a real PGlite database in beforeAll. Vitest runs
     * files in parallel, so those WASM instances start simultaneously and the
     * 10s default hook timeout is occasionally missed on a loaded machine --
     * producing failures that are about scheduling, not about the code.
     */
    hookTimeout: 30000 }, resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } });
