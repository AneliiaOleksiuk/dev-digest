#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * `bin` shim (WI13) — a `.ts` file cannot be a `bin` target under plain
 * `node`, so this small committed JS file re-execs `tsx src/cli.ts` with
 * whatever args the user passed (`devdigest review --mode working` etc.),
 * inheriting stdio and forwarding the child's exit code verbatim (the
 * documented 0/1/2 contract lives in `src/cli.ts`, not here).
 *
 * Resolves `tsx` from THIS package's own `node_modules` (not a global
 * install / PATH lookup) so `npm link` (or a direct
 * `node bin/devdigest.js ...` invocation) works right after `npm ci` —
 * no `npx` network round-trip needed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const tsxCli = join(pkgRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = join(pkgRoot, 'src', 'cli.ts');

const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
