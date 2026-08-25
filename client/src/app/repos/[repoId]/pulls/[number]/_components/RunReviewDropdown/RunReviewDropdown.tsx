/* RunReviewDropdown — ported from components2.jsx.
   "Run all enabled agents" / a specific agent → kicks off POST /pulls/:id/review
   and hands the resulting runIds up so the parent can stream SSE live status.

   ALSO carries a "pick agents to run" checkbox section (added on top, per
   product decision — the `SPEC-04` boundary "not a replacement for
   RunReviewDropdown" originally kept this dropdown single/all-only, with the
   full Multi-Agent Review picker living only on its own configure-run screen;
   this section deliberately overrides that call for a faster in-place path,
   while leaving "Run all enabled agents" and the per-agent single-run items
   below it untouched). Picking agents and pressing "Run multi-agent review"
   starts a batch via `useStartMultiAgentRun` and navigates straight to that
   batch's results screen — same destination as `PrDetailHeader`'s own
   "Multi-Agent Review" button, just pre-run instead of pre-selected.

   Not built on the vendored `Dropdown` primitive (`src/vendor/ui`,
   do-not-touch): that component closes on every item click, which the
   checkbox section can't allow. This is its own small popover, styled to
   match `Dropdown`'s panel 1:1. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon, type IconName } from "@devdigest/ui";
import { agentVisualFrom, agentVisuals } from "@/app/repos/[repoId]/multi-agent/agent-visuals";
import { useAgentStats, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import { DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

function ActionRow({
  icon,
  label,
  hint,
  muted,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const I = Icon[icon];
  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={s.actionRow(hovered, muted)}
    >
      <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={s.actionRowHint}>{hint}</span>}
    </button>
  );
}

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const params = useParams<{ repoId: string }>();
  const { data: agents } = useAgents();
  const { data: stats } = useAgentStats();
  const run = useRunReview();
  const startMultiAgent = useStartMultiAgentRun();
  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);
  const durationByAgentId = new Map((stats ?? []).map((st) => [st.agent_id, st.avg_duration_ms]));
  const visuals = React.useMemo(() => agentVisuals(all.map((a) => ({ id: a.id, name: a.name }))), [all]);

  const [open, setOpen] = React.useState(false);
  const [pickedIds, setPickedIds] = React.useState<string[] | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Seed the default selection (every enabled agent, same default as
  // ConfigureRunView) once, the first time the agent list loads.
  React.useEffect(() => {
    if (pickedIds === null && agents) setPickedIds(agents.filter((a) => a.enabled).map((a) => a.id));
  }, [agents, pickedIds]);

  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const picked = pickedIds ?? [];
  const togglePicked = (agentId: string, checked: boolean) => {
    setPickedIds((prev) => {
      const cur = prev ?? [];
      return checked ? [...cur, agentId] : cur.filter((id) => id !== agentId);
    });
  };

  const kick = async (opts: { all?: boolean; agentId?: string }) => {
    setOpen(false);
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  const handleRunMultiAgent = () => {
    if (picked.length === 0) return;
    setOpen(false);
    startMultiAgent.mutate(
      { prId, agentIds: picked },
      { onSuccess: (data) => router.push(`/repos/${params.repoId}/multi-agent?run=${data.multi_agent_run_id}`) },
    );
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={run.isPending}>
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {open && (
        <div style={s.panel(DROPDOWN_WIDTH)}>
          {warnMerged && (
            <>
              <div style={s.mergedWarning}>
                <Icon.AlertTriangle size={13} />
                {t("runReview.mergedWarning")}
              </div>
              <div style={s.divider} />
            </>
          )}

          {all.length > 0 && (
            <>
              <div style={s.pickerHead}>
                <span style={s.pickerLabel}>{t("runReview.pickAgents")}</span>
                <Button kind="ghost" size="sm" onClick={() => setPickedIds([])}>
                  {t("runReview.clear")}
                </Button>
              </div>
              <div style={s.pickerList}>
                {all.map((a) => {
                  const visual = agentVisualFrom(visuals, a.id);
                  const VisualIcon = Icon[visual.icon];
                  const durationMs = durationByAgentId.get(a.id);
                  return (
                    <div key={a.id} style={s.pickerRow}>
                      <Checkbox
                        checked={picked.includes(a.id)}
                        onChange={(checked) => togglePicked(a.id, checked)}
                        label={
                          <span style={s.pickerRowLabel}>
                            <VisualIcon size={13} style={{ color: visual.color, flexShrink: 0 }} />
                            <span style={s.pickerRowName}>{a.name}</span>
                            {durationMs != null && (
                              <span style={s.actionRowHint}>≈{Math.round(durationMs / 1000)}s</span>
                            )}
                          </span>
                        }
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "6px 4px 2px" }}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Users"
                  full
                  disabled={picked.length === 0}
                  loading={startMultiAgent.isPending}
                  onClick={handleRunMultiAgent}
                >
                  {t("runReview.runMultiAgent", { count: picked.length })}
                </Button>
              </div>
              <div style={s.divider} />
            </>
          )}

          <ActionRow
            icon="Play"
            label={t("runReview.runAll")}
            muted={!hasEnabled}
            onClick={() => kick({ all: true })}
          />
          <div style={s.divider} />
          {all.length ? (
            all.map((a) => (
              <ActionRow
                key={a.id}
                icon="Cpu"
                label={a.name}
                hint={a.enabled ? a.model : `${a.model} · disabled`}
                onClick={() => kick({ agentId: a.id })}
              />
            ))
          ) : (
            <ActionRow icon="Plus" label="No agents yet — create one" muted onClick={() => router.push("/agents")} />
          )}
          <div style={s.divider} />
          <ActionRow icon="Settings" label={t("runReview.configureAgents")} muted onClick={() => router.push("/agents")} />
        </div>
      )}
    </div>
  );
}
