"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, TextInput } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { CiExportInputBody } from "@/lib/types";
import { isLocalhostUrl } from "../helpers";
import { s } from "../styles";

const TRIGGER_KEYS = ["opened", "synchronize", "reopened"] as const;
const POST_AS_VALUES = ["github_review", "pr_comment", "none"] as const;
const POST_AS_LABEL_KEY: Record<(typeof POST_AS_VALUES)[number], string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

/**
 * Configure step (AC-7, AC-8, AC-12, Q-8) — triggers with their per-trigger
 * cost note, "Post results as", the ingest URL + localhost warning, the
 * three-secret checklist (never a live check), and the AC-12 provider
 * notice. Deliberately has NO editable `Fail CI on` control of its own —
 * that value lives on the agent (Config/CI tab) and reaches CI through the
 * manifest alone (AC-28); duplicating it here would be a second channel for
 * the same decision.
 */
export function ConfigureStep({
  agent,
  triggers,
  onToggleTrigger,
  postAs,
  onPostAsChange,
  ingestUrl,
  onIngestUrlChange,
  ingestSecretName,
}: {
  agent: Agent;
  triggers: string[];
  onToggleTrigger: (key: string) => void;
  postAs: CiExportInputBody["post_as"];
  onPostAsChange: (value: CiExportInputBody["post_as"]) => void;
  ingestUrl: string;
  onIngestUrlChange: (v: string) => void;
  /** SPEC-05 AC-28: this export's own ingest secret name, server-derived
   *  (Preview's `ingest_secret_name` — Recommendation 6) — `null` only
   *  before the first Preview response has returned. */
  ingestSecretName: string | null;
}) {
  const t = useTranslations("ci");
  const localhost = isLocalhostUrl(ingestUrl);

  return (
    <div style={s.stepWrap}>
      <FormField label={t("exportWizard.triggersLabel")}>
        <div style={s.triggerList}>
          <div style={s.triggerPillRow}>
            {TRIGGER_KEYS.map((key) => {
              const active = triggers.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggleTrigger(key)}
                  style={{ ...s.triggerPill, ...(active ? s.triggerPillActive : {}) }}
                >
                  {active && <Icon.Check size={13} />}
                  {t(`exportWizard.triggers.${key}`)}
                </button>
              );
            })}
          </div>
          <div style={s.triggerCostList}>
            {TRIGGER_KEYS.filter((key) => triggers.includes(key)).map((key) => (
              <span key={key} style={s.triggerCost}>{t(`exportWizard.triggers.${key}Cost`)}</span>
            ))}
          </div>
        </div>
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")}>
        <div style={s.radioList}>
          {POST_AS_VALUES.map((value) => (
            <label key={value} style={s.radioRow}>
              <input
                type="radio"
                name="ci-post-as"
                checked={postAs === value}
                onChange={() => onPostAsChange(value)}
              />
              {t(`exportWizard.postAs.${POST_AS_LABEL_KEY[value]}`)}
              {value === "github_review" && <Badge>{t("exportWizard.recommended")}</Badge>}
            </label>
          ))}
        </div>
      </FormField>

      <FormField label={t("exportWizard.ingestUrlLabel")} hint={t("exportWizard.ingestUrlHint")}>
        <TextInput value={ingestUrl} onChange={onIngestUrlChange} mono />
        {localhost && <p style={s.warnText}>{t("exportWizard.ingestUrlLocalhostWarning")}</p>}
      </FormField>

      <div style={s.secretsPanel}>
        <div style={s.secretsPanelTitle}>{t("exportWizard.secretsPanel.title")}</div>
        <div style={s.secretRow}>
          <span style={s.secretName}>{t("exportWizard.secretsPanel.openrouterName")}</span>
          <span style={s.secretStatus}>{t("exportWizard.secretsPanel.openrouterStatus")}</span>
        </div>
        <div style={s.secretRow}>
          <span style={s.secretName}>{t("exportWizard.secretsPanel.githubTokenName")}</span>
          <span style={s.secretStatus}>{t("exportWizard.secretsPanel.githubTokenStatus")}</span>
        </div>
        <div style={s.secretRow}>
          <span style={s.secretName}>
            {t("exportWizard.secretsPanel.ingestTokenName", {
              secretName: ingestSecretName ?? "DEVDIGEST_INGEST_TOKEN",
            })}
          </span>
          <span style={s.secretStatus}>{t("exportWizard.secretsPanel.ingestTokenStatus")}</span>
        </div>
        <p style={s.note}>{t("exportWizard.secretsPanel.disclaimer")}</p>
        <p style={s.note}>{t("exportWizard.blockMergeDesc")}</p>
      </div>

      {agent.provider !== "openrouter" && (
        <p style={s.note}>
          {t("exportWizard.providerNotice", { provider: agent.provider, model: agent.model })}
        </p>
      )}
    </div>
  );
}
