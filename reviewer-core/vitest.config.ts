import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Single-sourced contracts live in the server's vendored shared (the
      // engine borrows them; see tsconfig paths).
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      // Self-alias: `test/run.test.ts` pulls in `server/src/adapters/mocks.ts`
      // for its Mock*Client fixtures, which imports `server/src/adapters/git/
      // diff-parser.ts` — reduced (WI11) to a one-line re-export of THIS
      // package's own `parseUnifiedDiff`. Without this alias, Vite can't
      // resolve the bare `@devdigest/reviewer-core` specifier from a file
      // that lives outside this package. Mirrors `server/vitest.config.ts`'s
      // alias for the same package, pointed the other direction.
      '@devdigest/reviewer-core': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
