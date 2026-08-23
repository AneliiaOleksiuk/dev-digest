"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, FormField, SelectInput, Textarea, Toggle, Markdown } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { isUntrustedSource } from "../../../../../../lib/skill-trust";
import { TYPE_OPTIONS } from "../../constants";
import { s } from "./styles";

export function OverviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [editing, setEditing] = React.useState(false);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const untrusted = isUntrustedSource(skill);

  const save = async () => {
    setSaveError(null);
    try {
      await update.mutateAsync({ id: skill.id, patch: { type, body } });
      setEditing(false);
    } catch {
      setSaveError("Save failed. Please try again.");
    }
  };

  return (
    <>
      {untrusted && (
        <div style={s.untrustedNotice}>
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
          <p style={s.untrustedText}>{t("preview.untrustedNotice")}</p>
        </div>
      )}

      <div style={s.row}>
        <span style={s.rowLabel}>{skill.enabled ? t("preview.enabled") : t("preview.disabled")}</span>
        <Toggle
          on={skill.enabled}
          onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          size={14}
        />
      </div>

      {editing ? (
        <>
          <FormField label="Type">
            <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_OPTIONS]} />
          </FormField>
          <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
            <Textarea value={body} onChange={setBody} rows={16} mono />
          </FormField>
          {saveError && <div style={s.error}>{saveError}</div>}
          <div style={s.actions}>
            <Button
              kind="ghost"
              onClick={() => {
                setBody(skill.body);
                setType(skill.type);
                setEditing(false);
                setSaveError(null);
              }}
            >
              Cancel
            </Button>
            <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
              {t("preview.save")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={s.body}>
            <Markdown>{skill.body}</Markdown>
          </div>
          <div style={s.actions}>
            <Button kind="secondary" icon="Edit" onClick={() => setEditing(true)}>
              {t("preview.edit")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
