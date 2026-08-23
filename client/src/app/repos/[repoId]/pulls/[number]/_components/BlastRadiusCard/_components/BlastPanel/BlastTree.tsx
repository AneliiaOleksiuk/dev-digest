/* BlastTree — symbol → callers → endpoint/cron badges. Collapsible groups
   (first expanded); caller rows are file:line only (mock parity). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { formatSymbolName } from "./helpers";
import { s } from "./styles";

export function BlastTree({
  groups,
  repoFullName,
  headSha,
}: {
  groups: DownstreamImpact[];
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const [openBySymbol, setOpenBySymbol] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach((group, i) => {
      initial[`${group.symbol}:${i}`] = i === 0;
    });
    return initial;
  });

  return (
    <div style={s.tree}>
      {groups.map((group, i) => {
        const key = `${group.symbol}:${i}`;
        const open = openBySymbol[key] ?? i === 0;
        return (
          <div key={key} style={s.symbolGroup}>
            <button
              type="button"
              style={s.symbolHeaderBtn}
              aria-expanded={open}
              onClick={() => setOpenBySymbol((prev) => ({ ...prev, [key]: !open }))}
            >
              <Icon.ChevronDown
                size={14}
                style={{
                  ...s.priorPrsChevron,
                  transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                  flexShrink: 0,
                }}
              />
              <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={s.symbolName}>{formatSymbolName(group.symbol)}</span>
              <Badge color="var(--text-muted)" style={{ flexShrink: 0 }}>
                {t("callerCount", { count: group.callers.length })}
              </Badge>
            </button>

            {open && (
              <>
                <ul style={s.callerList}>
                  {group.callers.map((caller, j) => {
                    const fileHref = repoFullName
                      ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                      : undefined;
                    return (
                      <li key={j} style={s.callerRow}>
                        <span style={s.callerPath}>
                          <MonoLink href={fileHref}>
                            {caller.file}:{caller.line}
                          </MonoLink>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {(group.endpoints_affected.length > 0 || group.crons_affected.length > 0) && (
                  <div style={s.factsRow}>
                    {group.endpoints_affected.map((endpoint) => (
                      <Badge
                        key={endpoint}
                        icon="Globe"
                        color="var(--text-secondary)"
                        style={s.factBadge}
                      >
                        {endpoint}
                      </Badge>
                    ))}
                    {group.crons_affected.map((cron) => (
                      <Badge key={cron} icon="Clock" color="var(--warn)" style={s.factBadge}>
                        {cron}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
