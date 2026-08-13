"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import { useCreateContextDocument } from "@/lib/hooks/context";
import { ApiError } from "@/lib/api";
import { nd } from "./styles";

/** Appends `.md` unless the relative path already ends with it (UX-16) — a
 *  client-side convenience that makes most of AC-43/AC-47's rejections
 *  unreachable from this dialog. The server still validates independently
 *  (D-12) — this is additive, never a replacement for WI2's guard chain. */
function buildDocPath(root: string, relative: string): string {
  const trimmed = relative.trim().replace(/^\/+/, "");
  const withExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  return `${root}/${withExt}`;
}

export function NewDocumentDialog({
  repoId,
  roots,
  onClose,
  onCreated,
}: {
  repoId: string | null | undefined;
  roots: string[];
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const t = useTranslations("context");
  const [root, setRoot] = React.useState(roots[0] ?? "");
  const [relative, setRelative] = React.useState("");
  const [content, setContent] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const create = useCreateContextDocument(repoId);

  const path = root && relative.trim() ? buildDocPath(root, relative) : null;
  const canSubmit = roots.length > 0 && !!path;

  async function handleCreate() {
    if (!path) return;
    setError(null);
    try {
      const result = await create.mutateAsync({ path, content });
      onCreated(result.document.path);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("newDocument.error"));
    }
  }

  return (
    <Modal title={t("newDocument.title")} subtitle={t("newDocument.subtitle")} onClose={onClose}>
      <div style={nd.form}>
        {roots.length === 0 ? (
          <p style={nd.error}>{t("newDocument.noRoots")}</p>
        ) : (
          <>
            <div style={nd.field}>
              <span style={nd.label}>{t("newDocument.pathLabel")}</span>
              <div style={nd.pathRow}>
                <div style={nd.pathRoot}>
                  <SelectInput value={root} onChange={setRoot} options={roots} />
                </div>
                <span style={nd.pathSep}>/</span>
                <div style={nd.pathRelative}>
                  <TextInput
                    value={relative}
                    onChange={setRelative}
                    placeholder={t("newDocument.relativePlaceholder")}
                  />
                </div>
              </div>
              <span className="mono" style={nd.suffix}>
                {path ?? `${root}/…`}
              </span>
            </div>

            <div style={nd.field}>
              <span style={nd.label}>{t("newDocument.contentLabel")}</span>
              <Textarea value={content} onChange={setContent} rows={10} mono />
            </div>
          </>
        )}

        {error && <p style={nd.error}>{error}</p>}

        {/* NFR A04 — the same outbound-data notice as the rest of this page,
            visible on this authoring surface too. */}
        <p style={nd.notice}>{t("outboundNotice")}</p>

        <div style={nd.footer}>
          <Button size="sm" kind="secondary" onClick={onClose}>
            {t("newDocument.cancel")}
          </Button>
          <Button
            size="sm"
            kind="primary"
            icon="Plus"
            disabled={!canSubmit || create.isPending}
            loading={create.isPending}
            onClick={() => void handleCreate()}
          >
            {t("newDocument.create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
