/* DisagreementSection/helpers.ts — pure filter for the "Show only conflicts"
   toggle (default OFF).

   The server now emits EVERY shared location (any location any participating
   agent flagged) in `MultiAgentRun.conflicts`, unfiltered — a real finding or
   an `'ignored'` take for every participating agent, at every row. So OFF
   shows every row the server sent, unchanged. ON narrows to AC-30's actual,
   full definition of a genuine conflict: a location is a conflict when EITHER
   (a) at least one participating agent's take is `'ignored'` (silent) — a
   coverage gap is itself worth surfacing as disagreement, not just a severity
   clash — OR (b) two-or-more of the NON-ignored takes have differing
   severity. A location where every agent flagged it AND every agent agrees on
   severity is correctly excluded when ON. */
import type { Conflict } from "@devdigest/shared";

/** True when two-or-more of the takes that actually flagged this location
 *  (excluding 'ignored') disagree with each other on severity. */
function hasSeverityDivergence(conflict: Conflict): boolean {
  const flaggedSeverities = new Set(
    conflict.takes.filter((t) => t.verdict !== "ignored").map((t) => t.verdict),
  );
  return flaggedSeverities.size > 1;
}

/** True when at least one participating agent silently ignored this
 *  location — AC-30's first, independent conflict condition. */
function hasSilentParticipant(conflict: Conflict): boolean {
  return conflict.takes.some((t) => t.verdict === "ignored");
}

/** AC-30's full conflict definition: a silent/ignored participant OR
 *  severity divergence among the agents that did flag it — either condition
 *  alone is enough, they are not required together. */
export function isConflict(conflict: Conflict): boolean {
  return hasSilentParticipant(conflict) || hasSeverityDivergence(conflict);
}

export function filterConflicts(conflicts: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? conflicts.filter(isConflict) : conflicts;
}
