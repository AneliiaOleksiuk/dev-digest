/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  finding,
  focused,
  defaultExpanded,
  forceExpanded,
  highlighted,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  finding: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  /** Force this card open — used to land on a specific finding from a deep link.
   *  Only forces open on change; a later manual collapse by the user sticks. */
  forceExpanded?: boolean;
  /** Briefly emphasized border/shadow — the deep-linked finding among others. */
  highlighted?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const { id, severity, title, category, file, confidence, rationale, suggestion } = finding;
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  React.useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded, id]);

  const sevColor = SEV_COLOR[severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, file, finding.start_line, finding.end_line) : undefined;
  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={id} style={s.card(!!focused, sevColor, muted, !!highlighted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{title}</span>
            <CategoryTag category={category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {file}:{lineLabel(finding)}
            </MonoLink>
            <ConfidenceNum value={confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{rationale}</Markdown>
          </div>
          {suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
