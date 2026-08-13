import type { ContextDocument } from "@devdigest/shared";

/** Plain-text match over the already-loaded listing — path, source folder,
 *  or type. Never interpolated into a filesystem glob or SQL fragment
 *  (Untrusted inputs table). */
export function filterDocuments(documents: ContextDocument[], query: string): ContextDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter(
    (d) =>
      d.path.toLowerCase().includes(q) ||
      d.source_folder.toLowerCase().includes(q) ||
      d.type.toLowerCase().includes(q),
  );
}

/** Sum of the per-document token estimates (AC-6/AC-7 — reflects whatever
 *  subset is passed in, so the caller decides "all" vs "filtered"). */
export function sumTokens(documents: ContextDocument[]): number {
  return documents.reduce((sum, d) => sum + d.tokens, 0);
}

/**
 * AC-29/AC-31 — coverage over whatever subset is passed in (the same
 * `filtered` array the header summary already uses, D-10/UX-17 — no second
 * filter path). `used_by_agents` already excludes disabled-skill-only
 * attachments (AC-15/AC-30 — computed server-side at `service.ts:87`), so
 * this is a pure client-side reduction, no new endpoint. `missing: true`
 * documents are excluded from BOTH the numerator and the denominator
 * (E-24) — a listing of only `missing: true` rows must show no percentage,
 * not 100%. Returns `null` when zero eligible documents remain (AC-32) so
 * the caller renders nothing instead of 0/NaN.
 */
export function computeCoverage(
  documents: ContextDocument[],
): { covered: number; total: number; pct: number } | null {
  const eligible = documents.filter((d) => !d.missing);
  if (eligible.length === 0) return null;
  const covered = eligible.filter((d) => d.used_by_agents > 0).length;
  return { covered, total: eligible.length, pct: Math.round((covered / eligible.length) * 100) };
}
