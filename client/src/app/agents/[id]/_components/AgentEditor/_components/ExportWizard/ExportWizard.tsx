"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiInstallation } from "@devdigest/shared";
import { useCiExport, useCiExportZip, useCiPreview } from "@/lib/hooks/ci";
import type { CiFile } from "@/lib/types";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { buildExportInput, defaultIngestUrl, downloadBlob, isValidRepoRef, WORKFLOW_PATH, type WizardState } from "./helpers";
import { s } from "./styles";

const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

function errMsg(err: unknown): string | null {
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The four-step Export Wizard (AC-1..AC-41, AC-50) — Target → Preview →
 * Configure → Install, all of it driven by ONE piece of wizard state that
 * lives here in the parent, never per-step local state: `files` and
 * `workflowOverride` in particular. Because Back only changes `step` and
 * never remounts the steps' data, a hand-edited workflow survives Back/
 * Continue navigation intact (AC-1) by construction, not by a save/restore
 * mechanism.
 *
 * `initial` is non-null for "Update CI config" (AC-45) — same generation/
 * validation/install path as a first install, just pre-filled from the
 * existing installation and with its repo field locked (updating targets
 * the SAME (agent, repo) pair the server looks up by).
 */
export function ExportWizard({
  agent,
  initial,
  onClose,
}: {
  agent: Agent;
  initial: CiInstallation | null;
  onClose: () => void;
}) {
  const t = useTranslations("ci");

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(initial?.repo ?? "");
  const [base] = React.useState(initial?.base ?? "main");
  const [triggers, setTriggers] = React.useState<string[]>(initial?.triggers ?? ["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<WizardState["postAs"]>(initial?.post_as ?? "github_review");
  const [ingestUrl, setIngestUrl] = React.useState(initial?.ingest_url ?? defaultIngestUrl());
  const [workflowOverride, setWorkflowOverride] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<CiFile[] | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [tokenAcknowledged, setTokenAcknowledged] = React.useState(false);

  const preview = useCiPreview();
  const install = useCiExport();
  const zip = useCiExportZip();

  const currentState = (): WizardState => ({
    repo,
    base,
    triggers,
    postAs,
    ingestUrl,
    workflowOverride,
    replaceExisting: false,
  });

  /** The one function that ever calls the Preview mutation — always an
   *  explicit user action (entering step 2, or changing a Configure
   *  option), never a mount effect (AC-2, AC-46). `overrides` lets a caller
   *  pass a just-changed value before its `setState` has committed, so the
   *  request body reflects what the user just picked rather than a stale
   *  closure. */
  const regeneratePreview = (overrides?: Partial<WizardState>) => {
    const input = buildExportInput({ ...currentState(), ...overrides });
    preview.mutate(
      { agentId: agent.id, input },
      {
        onSuccess: (data) => {
          setFiles(data.files);
          setSelectedPath((prev) => prev ?? WORKFLOW_PATH);
        },
      },
    );
  };

  const goToPreview = () => {
    setStep(1);
    regeneratePreview();
  };

  const toggleTrigger = (key: string) => {
    const next = triggers.includes(key) ? triggers.filter((k) => k !== key) : [...triggers, key];
    setTriggers(next);
    regeneratePreview({ triggers: next });
  };

  const changePostAs = (value: WizardState["postAs"]) => {
    setPostAs(value);
    regeneratePreview({ postAs: value });
  };

  const editWorkflow = (text: string) => {
    setWorkflowOverride(text);
    setFiles((prev) => (prev ? prev.map((f) => (f.path === WORKFLOW_PATH ? { ...f, contents: text } : f)) : prev));
  };

  const doInstall = (replaceExisting = false) => {
    const input = buildExportInput({ ...currentState(), replaceExisting });
    install.mutate(
      { agentId: agent.id, input },
      { onSuccess: () => setTokenAcknowledged(false) },
    );
  };

  const doZip = () => {
    const input = buildExportInput(currentState());
    zip.mutate(
      { agentId: agent.id, input },
      { onSuccess: (blob) => downloadBlob("devdigest-ci.zip", blob) },
    );
  };

  const repoValid = isValidRepoRef(repo);
  const tokenPending = install.isSuccess && !!install.data.ingest_token && !tokenAcknowledged;

  const canContinue = step === 0 ? repoValid : true;

  return (
    <Modal
      width={860}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={tokenPending ? undefined : onClose}
      footer={
        !(step === 3 && install.isSuccess) && (
          <div style={s.footer}>
            {step > 0 && (
              <Button kind="secondary" onClick={() => setStep((v) => v - 1)} disabled={install.isPending}>
                {t("exportWizard.back")}
              </Button>
            )}
            <div style={s.footerSpacer} />
            {step < 3 && (
              <Button kind="primary" onClick={() => (step === 0 ? goToPreview() : setStep((v) => v + 1))} disabled={!canContinue}>
                {t("exportWizard.continue")}
              </Button>
            )}
          </div>
        )
      }
    >
      <div style={s.progressWrap}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`))} />
      </div>
      <div style={s.body}>
        {step === 0 && (
          <TargetStep
            repo={repo}
            onRepoChange={setRepo}
            repoLocked={!!initial}
            updateNote={initial ? t("exportWizard.repoUpdateNote", { repo: initial.repo }) : undefined}
          />
        )}
        {step === 1 && (
          <PreviewStep
            files={files}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onEditWorkflow={editWorkflow}
            loading={preview.isPending}
            error={errMsg(preview.error)}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            agent={agent}
            triggers={triggers}
            onToggleTrigger={toggleTrigger}
            postAs={postAs}
            onPostAsChange={changePostAs}
            ingestUrl={ingestUrl}
            onIngestUrlChange={setIngestUrl}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={repo}
            filesCount={files?.length ?? 0}
            install={install}
            zip={zip}
            onInstall={doInstall}
            onZip={doZip}
            onAcknowledgeToken={() => {
              setTokenAcknowledged(true);
              onClose();
            }}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
