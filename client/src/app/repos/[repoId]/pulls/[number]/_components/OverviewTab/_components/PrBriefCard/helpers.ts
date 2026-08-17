import type { RiskSeverity } from "@/lib/types";

/** Same semantic-token pairing used elsewhere in this codebase for a
 *  high/medium/low severity scale (`--crit`/`--warn`/`--ok`, `styles.css`) —
 *  reused here rather than inventing a fourth color pair (see client/
 *  INSIGHTS.md's `Badge` complexity-pill entry for the same pattern). */
export function riskLevelMeta(level: RiskSeverity): { color: string; bg: string } {
  switch (level) {
    case "high":
      return { color: "var(--crit)", bg: "var(--crit-bg)" };
    case "medium":
      return { color: "var(--warn)", bg: "var(--warn-bg)" };
    case "low":
    default:
      return { color: "var(--ok)", bg: "var(--ok-bg)" };
  }
}

/** Short commit label — first 7 chars, the same convention git/GitHub use
 *  for a short SHA. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** AC-31 — a review-focus entry is only navigable when its file is present
 *  in the CURRENTLY LOADED Files-changed data (the PR may have advanced past
 *  the brief's head_sha, or the user may be viewing a historical brief from
 *  the Why Timeline). */
export function isFocusItemNavigable(path: string, changedFilePaths: string[]): boolean {
  return changedFilePaths.includes(path);
}
