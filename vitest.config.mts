import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path mapping in tsconfig.json.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file gets its own module registry, so setup.ts gives each one
    // a private database instead of sharing the project's.
    setupFiles: ['tests/setup.ts']
  }
});
