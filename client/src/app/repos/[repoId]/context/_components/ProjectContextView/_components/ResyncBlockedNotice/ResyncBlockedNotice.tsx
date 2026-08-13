"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { useRepoIntelStatus, useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { rb } from "./styles";

const DIRTY_PREFIX = "dirty_clone:";

/** Parses the bounded, comma-separated path list out of a `dirty_clone:`
 *  reason string. Display text only — never fed to another filesystem/shell
 *  operation (Untrusted-inputs table). */
function dirtyPathsFrom(reason: string): string[] {
  return reason
    .slice(DIRTY_PREFIX.length)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * AC-52 — when the last resync was refused because the clone has
 * uncommitted changes (AC-50/AC-51), this reads as an instruction, not a
 * failure (UX-15): it names the affected paths and says to commit or
 * discard using the user's own git tooling, because this feature offers
 * neither action (Non-goals). "Check again" only re-attempts the resync —
 * it is not a commit or discard action.
 */
export function ResyncBlockedNotice({ repoId }: { repoId: string | null | undefined }) {
  const t = useTranslations("context");
  const { data: state } = useRepoIntelStatus(repoId);
  const resync = useResyncRepoIntel(repoId);

  const reason = state?.reason;
  if (!reason || !reason.startsWith(DIRTY_PREFIX)) return null;

  const paths = dirtyPathsFrom(reason);

  return (
    <div style={rb.banner} role="status">
      <div style={rb.iconWrap}>
        <Icon.AlertTriangle size={18} />
      </div>
      <div style={rb.body}>
        <p style={rb.title}>{t("resyncBlocked.title")}</p>
        <p style={rb.message}>{t("resyncBlocked.message")}</p>
        {paths.length > 0 && (
          <ul style={rb.pathList}>
            {paths.map((p) => (
              <li key={p} className="mono" style={rb.path}>
                {p}
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            size="sm"
            kind="secondary"
            icon="RefreshCw"
            loading={resync.isPending}
            onClick={() => resync.mutate()}
          >
            {t("resyncBlocked.checkAgain")}
          </Button>
        </div>
      </div>
    </div>
  );
}
