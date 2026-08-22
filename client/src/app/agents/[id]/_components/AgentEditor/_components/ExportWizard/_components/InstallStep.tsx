"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Card } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import type { CiExport, CiExportInputBody } from "@/lib/types";
import { s } from "../styles";

type InstallMutation = UseMutationResult<CiExport, unknown, { agentId: string; input: CiExportInputBody }>;
type ZipMutation = UseMutationResult<Blob, unknown, { agentId: string; input: CiExportInputBody }>;

/** The generated file set's actual setup doc — `agent-runner/README.md`
 *  covers exactly what the exported workflow does and how to configure it
 *  (AC-41). */
const SETUP_DOCS_URL = "https://github.com/AneliiaOleksiuk/dev-digest/blob/main/agent-runner/README.md";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/**
 * Install step (AC-34..AC-41, AC-50) — PR vs. zip, the AC-39 conflict
 * confirmation, a setup-docs link, and the one-time ingest token display —
 * the highest-stakes moment in this wizard: shown exactly once, with a
 * copy affordance and a warning that must be visible before the dialog can
 * be dismissed (the Modal wrapping this step omits its close [X] while
 * that warning is unacknowledged, see ExportWizard.tsx).
 */
export function InstallStep({
  repo,
  filesCount,
  install,
  zip,
  onInstall,
  onZip,
  onAcknowledgeToken,
  onClose,
}: {
  repo: string;
  filesCount: number;
  install: InstallMutation;
  zip: ZipMutation;
  onInstall: (replaceExisting?: boolean) => void;
  onZip: () => void;
  onAcknowledgeToken: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const [copied, setCopied] = React.useState(false);
  const conflict = install.isError && install.error instanceof ApiError && install.error.status === 409;

  if (install.isSuccess) {
    const data = install.data;
    return (
      <div style={s.stepWrap}>
        <p style={s.successTitle}>{t("exportWizard.prReady")}</p>
        {data.pr_url && (
          <a href={data.pr_url} target="_blank" rel="noreferrer" style={s.link}>
            {t("exportWizard.viewPr")}
          </a>
        )}
        {data.ingest_token ? (
          <div style={s.tokenBlock}>
            <div style={s.tokenBlockTitle}>{t("exportWizard.tokenBlock.title")}</div>
            <div style={s.tokenValueRow}>
              <code style={s.tokenValue}>{data.ingest_token}</code>
              <Button
                kind="secondary"
                size="sm"
                icon="Copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(data.ingest_token ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? t("exportWizard.tokenBlock.copied") : t("exportWizard.tokenBlock.copy")}
              </Button>
            </div>
            {/* AC-50/UX-9 — this warning must be visible before the dialog
               can be dismissed; ExportWizard.tsx withholds Modal's onClose
               until this exact button is pressed. */}
            <p style={s.warnText}>{t("exportWizard.tokenBlock.warning")}</p>
            <Button kind="primary" onClick={onAcknowledgeToken}>
              {t("exportWizard.tokenBlock.close")}
            </Button>
          </div>
        ) : (
          <Button kind="primary" onClick={onClose}>
            {t("exportWizard.close")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div style={s.stepWrap}>
      <a href={SETUP_DOCS_URL} target="_blank" rel="noreferrer" style={s.setupLink}>
        {t("exportWizard.setupDocsLink")}
      </a>

      {conflict && (
        <div style={s.conflictBox}>
          <div style={s.conflictTitle}>{t("exportWizard.conflictTitle")}</div>
          <p style={s.note}>{errMsg(install.error)}</p>
          <Button kind="danger" onClick={() => onInstall(true)} loading={install.isPending}>
            {t("exportWizard.conflictConfirm")}
          </Button>
        </div>
      )}

      {install.isError && !conflict && (
        <p style={s.errorText}>
          {t("exportWizard.installFailed")}: {errMsg(install.error)}
        </p>
      )}
      {zip.isError && <p style={s.errorText}>{errMsg(zip.error)}</p>}

      <div style={s.installCards}>
        <Card style={s.installCard}>
          <div style={s.installCardTitle}>{t("exportWizard.installCardTitle")}</div>
          <p style={s.note}>{t("exportWizard.installCardBody", { repo, count: filesCount })}</p>
          <Button kind="primary" onClick={() => onInstall()} loading={install.isPending} disabled={install.isPending}>
            {install.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
          </Button>
        </Card>
        <Card style={s.installCard}>
          <div style={s.installCardTitle}>{t("exportWizard.zipCardTitle")}</div>
          <p style={s.note}>{t("exportWizard.zipCardBody")}</p>
          <p style={s.note}>{t("exportWizard.zipCardNoToken")}</p>
          <Button kind="secondary" onClick={onZip} loading={zip.isPending} disabled={zip.isPending}>
            {zip.isPending ? t("exportWizard.zipDownloading") : t("exportWizard.downloadZip")}
          </Button>
          {zip.isSuccess && <p style={s.note}>{t("exportWizard.zipDownloaded")}</p>}
        </Card>
      </div>
    </div>
  );
}
