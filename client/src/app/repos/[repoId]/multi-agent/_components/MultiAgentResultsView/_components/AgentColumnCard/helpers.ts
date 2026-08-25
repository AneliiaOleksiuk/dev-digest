/* AgentColumnCard/helpers.ts — status → icon/color/text-label mapping, kept
   pure so a status is NEVER conveyed by color alone (WCAG AA — same rule
   `SeverityBadge` already follows for findings). */
import type { AgentColumn } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

export interface StatusMeta {
  icon: IconName;
  color: string;
  labelKey: `page.columnCard.status.${AgentColumn["status"]}`;
}

const STATUS_META: Record<AgentColumn["status"], StatusMeta> = {
  running: { icon: "RefreshCw", color: "var(--warn)", labelKey: "page.columnCard.status.running" },
  done: { icon: "CheckCircle", color: "var(--ok)", labelKey: "page.columnCard.status.done" },
  failed: { icon: "XCircle", color: "var(--crit)", labelKey: "page.columnCard.status.failed" },
  cancelled: { icon: "Slash", color: "var(--text-muted)", labelKey: "page.columnCard.status.cancelled" },
};

export function statusMetaFor(status: AgentColumn["status"]): StatusMeta {
  return STATUS_META[status];
}
