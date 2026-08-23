"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { usePromoteConventions } from "../../../../../../lib/hooks/conventions";
import { buildDraftSkillBody, buildDraftSkillName } from "./helpers";
import { s } from "./styles";

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  candidates,
  onClose,
  onCreated,
}: {
  repoId: string;
  repoName: string;
  candidates: ConventionCandidate[];
  onClose: () => void;
  onCreated: (promotedIds: string[]) => void;
}) {
  const t = useTranslations("conventions");
  const [name, setName] = React.useState(() => buildDraftSkillName(repoName));
  const [description, setDescription] = React.useState(
    () => t("modal.descriptionPlaceholder", { repo: repoName }),
  );
  const [body, setBody] = React.useState(() => buildDraftSkillBody(candidates));
  const [enabled, setEnabled] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const promoteConventions = usePromoteConventions();

  const submit = async () => {
    setError(null);
    const conventionIds = candidates.map((candidate) => candidate.id);
    try {
      await promoteConventions.mutateAsync({
        repoId,
        conventionIds,
        skill: { name: name.trim(), description: description.trim(), body, enabled },
      });
      onCreated(conventionIds);
    } catch {
      setError(t("modal.createFailed"));
    }
  };

  return (
    <Modal
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            loading={promoteConventions.isPending}
            disabled={!name.trim() || !body.trim()}
            onClick={submit}
          >
            {promoteConventions.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          {t("modal.banner", { count: candidates.length, repo: repoName })}
        </div>

        <FormField label={t("modal.nameLabel")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
          <Toggle on={enabled} onChange={setEnabled} size={14} />
        </FormField>

        {error && <div style={s.error}>{error}</div>}

        <FormField label={t("modal.bodyLabel")}>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </FormField>
      </div>
    </Modal>
  );
}
