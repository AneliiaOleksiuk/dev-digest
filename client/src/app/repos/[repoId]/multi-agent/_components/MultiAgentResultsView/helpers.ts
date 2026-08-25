/* MultiAgentResultsView/helpers.ts — pure helpers (no i18n/DOM), so the ONE
   shared `aria-live` region announces overall batch progress instead of each
   `AgentColumnCard` running its own — six simultaneous "polite" announcements
   would be as unhelpful as none. */
import type { AgentColumn } from "@devdigest/shared";

export interface ColumnsProgress {
  done: number;
  total: number;
}

/** A column has settled once it's no longer `running` — `done`/`failed`/
 *  `cancelled` all count toward "done" for progress-announcement purposes. */
export function columnsProgress(columns: AgentColumn[]): ColumnsProgress {
  return {
    done: columns.filter((c) => c.status !== "running").length,
    total: columns.length,
  };
}
