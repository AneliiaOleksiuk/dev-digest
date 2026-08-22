"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Textarea } from "@devdigest/ui";
import type { CiFile } from "@/lib/types";
import { MEMORY_PATH, WORKFLOW_PATH } from "../helpers";
import { s } from "../styles";

/**
 * Preview step (AC-5, AC-6, UX-2 — this feature's trust surface). File list
 * left, exact generated contents right. Only the workflow file is editable,
 * as a plain textarea — no structured form, no as-you-type validation, no
 * diff view. Every other file (including untrusted agent/skill text — the
 * manifest embeds the system prompt, and each skill file is a skill body)
 * renders as plain preformatted text via `<pre>`, never through a
 * markdown/HTML renderer (security A05) — React text nodes are escaped by
 * default, so this is inert regardless of what the file contains.
 */
export function PreviewStep({
  files,
  selectedPath,
  onSelect,
  onEditWorkflow,
  loading,
  error,
}: {
  files: CiFile[] | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onEditWorkflow: (text: string) => void;
  loading: boolean;
  error?: string | null;
}) {
  const t = useTranslations("ci");
  const selected = files?.find((f) => f.path === selectedPath) ?? null;

  return (
    <div style={s.stepWrap}>
      {loading && <p style={s.hintText}>{t("exportWizard.generating")}</p>}
      {error && (
        <p style={s.errorText}>
          {t("exportWizard.previewFailed")}: {error}
        </p>
      )}
      {files && (
        <div style={s.previewLayout}>
          <div>
            <div style={s.filesHeading}>{t("exportWizard.filesToCreate")}</div>
            <div style={s.fileList}>
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => onSelect(f.path)}
                  style={{ ...s.fileRow, ...(f.path === selectedPath ? s.fileRowActive : {}) }}
                >
                  <span style={s.filePath}>{f.path}</span>
                  {f.editable && <Badge>{t("exportWizard.editable")}</Badge>}
                </button>
              ))}
            </div>
          </div>

          <div style={s.fileContent}>
            {!selected ? (
              <p style={s.hintText}>{t("exportWizard.selectFilePrompt")}</p>
            ) : selected.path === WORKFLOW_PATH ? (
              <>
                <Textarea value={selected.contents} onChange={onEditWorkflow} rows={18} mono />
                <p style={s.note}>{t("exportWizard.workflowEditHint")}</p>
              </>
            ) : (
              <>
                {selected.preview_omitted && <p style={s.note}>{t("exportWizard.runnerFileNote")}</p>}
                {selected.path === MEMORY_PATH && <p style={s.note}>{t("exportWizard.memoryFileNote")}</p>}
                <pre style={s.pre}>{selected.contents}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
