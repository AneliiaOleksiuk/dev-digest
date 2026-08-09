import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Single-sourced contracts live in the server's vendored shared (mcp/
      // only ever imports TYPES from here — see AGENTS.md/INSIGHTS.md).
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      // The pre-push CLI only (`src/cli.ts` + `src/cli/*`) imports
      // `@devdigest/reviewer-core` in-process — a documented, deliberate
      // exception to the tools' HTTP-only rule (see mcp/AGENTS.md). Mirrors
      // `server/vitest.config.ts`'s alias for the same package.
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
