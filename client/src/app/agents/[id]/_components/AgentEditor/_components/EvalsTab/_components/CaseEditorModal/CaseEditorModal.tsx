"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Modal, Tabs, TextInput, Textarea } from "@devdigest/ui";
import { EvalExpectation } from "@devdigest/shared";
import type { EvalCaseRecord, EvalRunRecord } from "@/lib/types";
import { useCreateEvalCase, useRunEvalCase, useUpdateEvalCase } from "@/lib/hooks/eval";
import { notify } from "@/lib/toast";
import { pct } from "../../helpers";
import { s } from "./styles";

type InputTab = "diff" | "prMeta";

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Create/edit a case (AC-10): name, diff / PR-meta tabs, and the raw
 * `expected_output` JSON with a live validity badge — `caseEditor.validJson`
 * / `invalidJson` per `eval.json`. Save is disabled while the JSON doesn't
 * parse against `EvalExpectation` (client-side pre-check; the server
 * re-validates independently on write, AC-11/A08). A case that's already
 * run shows its last result (`caseEditor.lastRunPassed`/`resultSummary`)
 * and offers "Run case" directly from the editor.
 */
export function CaseEditorModal({
  agentId,
  evalCase,
  lastRun,
  onClose,
}: {
  agentId: string;
  evalCase?: EvalCaseRecord;
  lastRun?: EvalRunRecord;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const runCase = useRunEvalCase();
  const isNew = !evalCase;

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [inputDiff, setInputDiff] = React.useState(evalCase?.input_diff ?? "");
  const [prTitle, setPrTitle] = React.useState(evalCase?.input_meta?.title ?? "");
  const [prBody, setPrBody] = React.useState(evalCase?.input_meta?.body ?? "");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [expectedText, setExpectedText] = React.useState(
    JSON.stringify(evalCase?.expected_output ?? { version: 1, must_find: [], must_not_flag: [] }, null, 2),
  );

  const parsedExpectation = React.useMemo(() => {
    try {
      return EvalExpectation.safeParse(JSON.parse(expectedText));
    } catch {
      return { success: false as const };
    }
  }, [expectedText]);
  const isValid = parsedExpectation.success;
  const saving = create.isPending || update.isPending;

  const save = () => {
    if (!parsedExpectation.success) return;
    const meta = prTitle.trim() || prBody.trim() ? { title: prTitle, body: prBody } : null;
    if (isNew) {
      create.mutate(
        {
          owner_id: agentId,
          name: name.trim() || t("caseEditor.namePlaceholder"),
          input_diff: inputDiff,
          input_files: null,
          input_meta: meta,
          expected_output: parsedExpectation.data,
          notes: null,
        },
        {
          onSuccess: onClose,
          onError: (err) => notify.error(errMsg(err, "Couldn't create eval case")),
        },
      );
    } else {
      update.mutate(
        {
          id: evalCase.id,
          patch: {
            name: name.trim() || evalCase.name,
            input_diff: inputDiff,
            input_meta: meta,
            expected_output: parsedExpectation.data,
          },
        },
        {
          onSuccess: onClose,
          onError: (err) => notify.error(errMsg(err, "Couldn't save eval case")),
        },
      );
    }
  };

  const run = () => {
    if (!evalCase) return;
    runCase.mutate(
      { caseId: evalCase.id, ownerId: agentId },
      { onError: (err) => notify.error(errMsg(err, "Run failed")) },
    );
  };

  return (
    <Modal
      width={720}
      title={isNew ? t("caseEditor.newCase") : t("caseEditor.caseTitle", { name: evalCase!.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {!isNew && (
            <Button kind="secondary" icon="Play" disabled={runCase.isPending} onClick={run}>
              {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <div style={s.footerRight}>
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" icon="Check" disabled={!isValid || saving} onClick={save}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        {!isNew && lastRun && (
          <div style={s.badgeRow}>
            <Badge color={lastRun.pass ? "var(--ok)" : "var(--crit)"}>
              {t(lastRun.pass ? "caseEditor.lastRunPassed" : "caseEditor.lastRunFailed")}
            </Badge>
            <span style={s.resultSummary}>
              {t("caseEditor.resultSummary", {
                recall: pct(lastRun.recall) ?? "—",
                precision: pct(lastRun.precision) ?? "—",
                citation: pct(lastRun.citation_accuracy) ?? "—",
                duration: lastRun.duration_ms != null ? (lastRun.duration_ms / 1000).toFixed(1) : "—",
              })}
            </span>
          </div>
        )}

        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>

        <FormField label={t("caseEditor.inputLabel")}>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={inputTab}
            onChange={(k) => setInputTab(k as InputTab)}
            pad="0"
          />
          <div style={{ marginTop: 10 }}>
            {inputTab === "diff" ? (
              <Textarea
                value={inputDiff}
                onChange={setInputDiff}
                rows={10}
                mono
                placeholder={t("caseEditor.diffPlaceholder")}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput value={prTitle} onChange={setPrTitle} placeholder={t("caseEditor.titlePlaceholder")} />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <Textarea
                    value={prBody}
                    onChange={setPrBody}
                    rows={5}
                    placeholder={t("caseEditor.bodyPlaceholder")}
                  />
                </FormField>
              </div>
            )}
          </div>
        </FormField>

        <FormField
          label={t("caseEditor.expectedOutput")}
          right={
            <Badge color={isValid ? "var(--ok)" : "var(--crit)"}>
              {t(isValid ? "caseEditor.validJson" : "caseEditor.invalidJson")}
            </Badge>
          }
        >
          <Textarea value={expectedText} onChange={setExpectedText} rows={10} mono />
        </FormField>
      </div>
    </Modal>
  );
}
