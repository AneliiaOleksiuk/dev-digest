"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, FormField, Icon, TextInput } from "@devdigest/ui";
import { isValidRepoRef } from "../helpers";
import { s } from "../styles";

const DISABLED_TARGETS = ["circle", "jenkins", "cli"] as const;

/**
 * Target step (AC-3, AC-4) — GitHub Actions pre-selected and labelled
 * recommended; CircleCI/Jenkins/Generic CLI render as visibly disabled,
 * non-activatable cards with a stated reason, never merely unselected.
 */
export function TargetStep({
  repo,
  onRepoChange,
  repoLocked,
  updateNote,
}: {
  repo: string;
  onRepoChange: (v: string) => void;
  repoLocked?: boolean;
  updateNote?: string;
}) {
  const t = useTranslations("ci");
  const invalid = repo.trim().length > 0 && !isValidRepoRef(repo);

  return (
    <div style={s.stepWrap}>
      <div style={s.targetGrid}>
        <Card style={s.targetCardActive}>
          <div style={s.targetCardHead}>
            <Icon.GitBranch size={18} />
            <span style={s.targetCardTitle}>{t("exportWizard.targets.gha")}</span>
            <Badge color="var(--ok)" bg="var(--ok-bg)">
              {t("exportWizard.recommended")}
            </Badge>
          </div>
          <p style={s.targetCardDesc}>{t("exportWizard.targets.ghaDesc")}</p>
        </Card>
        {DISABLED_TARGETS.map((key) => (
          <Card key={key} style={s.targetCardDisabled}>
            <div style={s.targetCardHead}>
              <span style={s.targetCardTitle}>{t(`exportWizard.targets.${key}`)}</span>
            </div>
            <p style={s.targetCardDesc}>{t(`exportWizard.targets.${key}Desc`)}</p>
            <p style={s.targetCardReason}>{t("exportWizard.targetDisabledReason")}</p>
          </Card>
        ))}
      </div>

      {updateNote && <p style={s.hintText}>{updateNote}</p>}

      <FormField
        label={t("exportWizard.repoLabel")}
        hint={invalid ? t("exportWizard.repoInvalid") : t("exportWizard.repoHint")}
        required
      >
        <TextInput
          value={repo}
          onChange={onRepoChange}
          placeholder={t("exportWizard.repoPlaceholder")}
          disabled={repoLocked}
        />
      </FormField>
    </div>
  );
}
