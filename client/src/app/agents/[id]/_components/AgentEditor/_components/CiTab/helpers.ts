import type { IconName } from "@devdigest/ui";
import type { CiInstallation, CiRunStatus } from "@/lib/types";

/** Compact relative time (e.g. "3h", "2d") — same shape as
 *  `app/repos/[repoId]/pulls/helpers.ts`'s `relativeTime` (no shared
 *  location for this exists yet; kept feature-local like that one). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** A human label for an installation's `target_type` (only "gha" exists
 *  today — D-12/AC-3 — but this stays a lookup rather than a literal so a
 *  future target doesn't need a new branch here). */
export function targetLabel(targetType: CiInstallation["target_type"]): string {
  const labels: Record<string, string> = {
    gha: "GitHub Actions",
    circle: "CircleCI",
    jenkins: "Jenkins",
    cli: "Generic CLI",
  };
  return labels[targetType] ?? targetType;
}

/** AC-47/E-7 — an installation is running an older configuration whenever
 *  the agent's CURRENT version has moved past what was recorded at its own
 *  last export. */
export function isDrifted(installation: CiInstallation, agentVersion: number): boolean {
  return installation.agent_version !== agentVersion;
}

/** Status → color/icon, mirroring `RunHistory.tsx`'s `outcomeOf` shape for
 *  the studio's own run timeline (same four-state contract, AC-67). */
export function statusVisual(status: CiRunStatus): { color: string; bg: string; icon: IconName } {
  if (status === "running") return { color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed") return { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "no_findings") return { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "CheckCircle" };
  return { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

/** `CiRunStatus` value → the matching `ci.json` `runs.status.*` key (the
 *  contract uses snake_case, the i18n namespace uses camelCase). */
export function statusI18nKey(status: CiRunStatus): "succeeded" | "failed" | "noFindings" | "running" {
  if (status === "no_findings") return "noFindings";
  return status;
}
