"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Badge, Icon, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { buildGithubFileUrl } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  selected,
  repoFullName,
  defaultBranch,
  onSelect,
  onDeselect,
  onUndo,
}: {
  candidate: ConventionCandidate;
  /** UI selection for Create skill — independent of server status races. */
  selected: boolean;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  onSelect: () => void;
  onDeselect: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations("conventions");
  const confidencePercent = Math.round(candidate.confidence * 100);
  const isPromoted = candidate.skill_id != null;
  const isRejected = candidate.status === "rejected";
  const githubUrl = buildGithubFileUrl(
    repoFullName,
    defaultBranch,
    candidate.evidence_path,
    candidate.evidence_line,
  );

  return (
    <Card
      style={isRejected ? s.cardRejected : selected && !isPromoted ? s.cardAccepted : s.cardNeutral}
      onClick={
        isPromoted || isRejected ? undefined : () => (selected ? onDeselect() : onSelect())
      }
    >
      <div style={s.card}>
        <div style={s.headerRow}>
          <div style={s.ruleColumn}>
            <div style={s.badgeRow}>
              {candidate.category && <Badge>{candidate.category}</Badge>}
              {isPromoted && <Badge color="var(--accent)">{t("card.promoted")}</Badge>}
              {isRejected && <Badge>{t("card.rejected")}</Badge>}
            </div>
            <div style={s.rule}>{candidate.rule}</div>
            {githubUrl ? (
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={s.evidenceLink}
              >
                <span style={s.evidencePath}>
                  {candidate.evidence_path}
                  {candidate.evidence_line != null ? `:${candidate.evidence_line}` : ""}
                  <Icon.ExternalLink size={11} style={s.evidenceLinkIcon} />
                </span>
                {candidate.evidence_snippet}
              </a>
            ) : (
              <div style={s.evidence}>
                <span style={s.evidencePath}>{candidate.evidence_path}</span>
                {candidate.evidence_snippet}
              </div>
            )}
          </div>
          {!isPromoted && isRejected && (
            <div style={s.actions}>
              <Button
                kind="secondary"
                size="sm"
                icon="History"
                onClick={(e) => {
                  e.stopPropagation();
                  onUndo();
                }}
              >
                {t("card.undo")}
              </Button>
            </div>
          )}
          {!isPromoted && !isRejected && (
            <div style={s.actions}>
              <Button
                kind={selected ? "primary" : "secondary"}
                size="sm"
                icon="Check"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                {t("card.accepted")}
              </Button>
              <Button
                kind={!selected ? "danger" : "secondary"}
                size="sm"
                icon="X"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeselect();
                }}
              >
                {t("card.reject")}
              </Button>
            </div>
          )}
        </div>
        <div style={s.footerRow}>
          <span style={s.confidenceLabel}>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={confidencePercent} />
          </div>
          <span style={s.confidenceLabel}>{confidencePercent}%</span>
        </div>
      </div>
    </Card>
  );
}
