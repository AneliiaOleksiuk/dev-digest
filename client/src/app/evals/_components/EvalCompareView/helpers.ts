import type { EvalBatchRecord } from "@/lib/types";

/** Q-3/E-8 — a skill link/order/version change never bumps `agents.version`,
 *  so two batches can share the SAME recorded version yet have run
 *  different prompts. `skills_fingerprint` (the ordered `{skill_id,
 *  version}` list of enabled linked skills at batch start) makes that
 *  visible; compare it structurally rather than assuming identical
 *  versions means identical config. */
export function sameVersionDifferentSkills(base: EvalBatchRecord, head: EvalBatchRecord): boolean {
  if (base.agent_version !== head.agent_version) return false;
  return JSON.stringify(base.skills_fingerprint) !== JSON.stringify(head.skills_fingerprint);
}

/** Signed delta formatting. `invert` flips the up/down color semantics for
 *  a metric where a higher number is WORSE (cost). */
export function deltaColor(value: number | null, invert = false): string {
  if (value == null || value === 0) return "var(--text-muted)";
  const positive = value > 0;
  const good = invert ? !positive : positive;
  return good ? "var(--ok)" : "var(--crit)";
}

export function fmtDeltaPct(value: number | null): string {
  if (value == null) return "—";
  const pct = Math.round(value * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
