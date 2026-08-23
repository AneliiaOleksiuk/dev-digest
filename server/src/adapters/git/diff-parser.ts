/**
 * Relocated to `reviewer-core/src/diff/parse.ts` (WI11) so the server and the
 * pre-push CLI (`mcp/src/cli.ts`) share exactly one unified-diff parser
 * implementation. All five existing import sites in this package keep
 * working unchanged against this re-export.
 */
export { parseUnifiedDiff } from '@devdigest/reviewer-core';
