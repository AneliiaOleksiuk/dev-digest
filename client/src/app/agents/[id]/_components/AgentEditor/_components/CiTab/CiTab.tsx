"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiInstallation } from "@devdigest/shared";
import { useAgentCiInstallations, useDeleteCiInstallation } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useToast } from "@/lib/toast";
import { CI_FAIL_ON_VALUES } from "../ConfigTab/constants";
import { ExportWizard } from "../ExportWizard";
import { isDrifted, relativeTime, statusI18nKey, statusVisual, targetLabel } from "./helpers";
import { s } from "./styles";

/**
 * CI tab (AC-42..AC-48) — deployment status, per-installation last-run +
 * drift, the agent's `Fail CI on` gate, Update/Remove, and the
 * "+ Add to CI" entry point into the Export Wizard. Rendering this tab
 * issues zero export requests and zero GitHub calls (AC-46, AC-48) — every
 * value below comes from `useAgentCiInstallations`, a plain read.
 */
export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");
  const toast = useToast();

  const { data: installations } = useAgentCiInstallations(agent.id);
  const updateAgent = useUpdateAgent();
  const deleteInstallation = useDeleteCiInstallation();

  // "new" = a fresh installation from the empty state / "+ Add to CI"; a
  // CiInstallation object = "Update CI config" for that existing row
  // (AC-45, same generation/validation/PR path as a first install).
  const [wizardFor, setWizardFor] = React.useState<"new" | CiInstallation | null>(null);

  const ciFailOnOptions = CI_FAIL_ON_VALUES.map((v) => ({
    value: v,
    label: tAgents(`config.ciFailOnOptions.${v}`),
  }));

  const saveFailOn = (value: CiFailOn) =>
    updateAgent.mutate(
      { id: agent.id, patch: { ci_fail_on: value } },
      { onSuccess: (data) => toast.success(tAgents("config.savedToast", { version: data.version })) },
    );

  const handleRemove = (installation: CiInstallation) => {
    // window.confirm — same pattern AgentCard's own delete action already
    // uses for a destructive, low-frequency action (no dedicated confirm
    // modal built for a single button).
    if (!window.confirm(t("ciTab.removeConfirmBody", { repo: installation.repo }))) return;
    deleteInstallation.mutate(
      { id: installation.id, agentId: agent.id },
      { onError: () => toast.error(t("ciTab.removeInstallation")) },
    );
  };

  return (
    <div style={s.wrap}>
      {wizardFor && (
        <ExportWizard
          agent={agent}
          initial={wizardFor === "new" ? null : wizardFor}
          onClose={() => setWizardFor(null)}
        />
      )}

      <div>
        <h3 style={s.title}>{t("ciTab.heading")}</h3>
        <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
      </div>

      {!installations ? (
        <>
          <Skeleton height={60} />
          <Skeleton height={120} />
        </>
      ) : installations.length === 0 ? (
        <EmptyState
          icon="GitBranch"
          title={t("ciTab.emptyTitle")}
          body={t("ciTab.emptyBody")}
          cta={t("ciTab.addToCi")}
          onCta={() => setWizardFor("new")}
        />
      ) : (
        <>
          <div style={s.header}>
            <Badge icon="GitBranch">{t("ciTab.installedCount", { count: installations.length })}</Badge>
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => setWizardFor("new")}>
              {t("ciTab.addToCi")}
            </Button>
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>{tAgents("config.ciFailOn")}</div>
            <div style={s.failOnRow}>
              <div style={s.failOnSelectWrap}>
                <SelectInput
                  value={agent.ci_fail_on}
                  onChange={(v) => saveFailOn(v as CiFailOn)}
                  options={ciFailOnOptions}
                />
              </div>
            </div>
            <p style={s.note}>{t("ciTab.failOnNote")}</p>
          </div>

          <div style={s.list}>
            {installations.map((inst) => {
              const drifted = isDrifted(inst, agent.version);
              const visual = inst.last_run ? statusVisual(inst.last_run.status) : null;
              return (
                <div key={inst.id} style={s.row}>
                  <div style={s.rowHead}>
                    <span style={s.repo}>{inst.repo}</span>
                    <Badge>{targetLabel(inst.target_type)}</Badge>
                    {inst.last_run && visual ? (
                      <Badge color={visual.color} bg={visual.bg} icon={visual.icon}>
                        {t(`runs.status.${statusI18nKey(inst.last_run.status)}`)} ·{" "}
                        {t("ciTab.ranAgo", { time: relativeTime(inst.last_run.ran_at) })}
                      </Badge>
                    ) : (
                      <Badge color="var(--text-muted)">{t("ciTab.neverRan")}</Badge>
                    )}
                    <span style={s.rowMeta}>v{inst.workflow_version}</span>
                  </div>

                  {/* SPEC-05 AC-31/UX-3: this installation's own ingest
                     secret name — not re-derivable by hand once the agent
                     has been renamed. */}
                  <div style={s.secretMeta}>
                    {t("ciTab.ingestSecretLabel", { secretName: inst.ingest_secret_name })}
                  </div>

                  {drifted && (
                    <div style={s.driftBanner}>
                      {t("ciTab.driftBanner", {
                        installedVersion: inst.agent_version,
                        currentVersion: agent.version,
                      })}
                    </div>
                  )}

                  <div style={s.rowActions}>
                    <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setWizardFor(inst)}>
                      {t("ciTab.updateConfig")}
                    </Button>
                    <Button kind="danger" size="sm" icon="Trash" onClick={() => handleRemove(inst)}>
                      {t("ciTab.removeInstallation")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
