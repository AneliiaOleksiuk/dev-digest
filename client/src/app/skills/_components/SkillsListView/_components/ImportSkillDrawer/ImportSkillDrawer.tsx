"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, Tabs, FormField, TextInput, Textarea } from "@devdigest/ui";
import { useImportSkillFile, useImportSkillUrl } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

type ImportTab = "file" | "url";

export function ImportSkillDrawer({
  initialTab = "file",
  onClose,
  onImported,
}: {
  initialTab?: ImportTab;
  onClose: () => void;
  onImported: (skillId: string) => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<ImportTab>(initialTab);
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const importFile = useImportSkillFile();
  const importUrl = useImportSkillUrl();

  const submitFile = async () => {
    setError(null);
    try {
      const skill = await importFile.mutateAsync({ name: name.trim() || undefined, body });
      onImported(skill.id);
      onClose();
    } catch {
      setError(t("drawer.importFailed"));
    }
  };

  const submitUrl = async () => {
    setError(null);
    try {
      const skill = await importUrl.mutateAsync(url.trim());
      onImported(skill.id);
      onClose();
    } catch {
      setError(t("drawer.importFailed"));
    }
  };

  const tabs = [
    { key: "file", label: t("drawer.tabs.file") },
    { key: "url", label: t("drawer.tabs.url") },
  ];

  return (
    <Drawer title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as ImportTab)} pad="0" />
      <div style={s.body}>
        {tab === "file" && (
          <>
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
            </FormField>
            <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
              <Textarea value={body} onChange={setBody} rows={14} mono placeholder={t("file.bodyPlaceholder")} />
            </FormField>
            {error && <div style={s.error}>{error}</div>}
            <div style={s.actions}>
              <Button kind="primary" icon="Upload" onClick={submitFile} disabled={importFile.isPending || !body.trim()}>
                {importFile.isPending ? t("file.importing") : t("file.import")}
              </Button>
            </div>
          </>
        )}
        {tab === "url" && (
          <>
            <FormField label={t("url.label")} hint={t("url.hint")}>
              <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} mono />
            </FormField>
            {error && <div style={s.error}>{error}</div>}
            <div style={s.actions}>
              <Button kind="primary" icon="Link" onClick={submitUrl} disabled={importUrl.isPending || !url.trim()}>
                {importUrl.isPending ? t("url.fetching") : t("url.import")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
