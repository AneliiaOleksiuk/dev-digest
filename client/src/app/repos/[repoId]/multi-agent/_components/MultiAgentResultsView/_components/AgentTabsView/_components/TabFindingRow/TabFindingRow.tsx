/* TabFindingRow — reuses `FindingCard` UNFORKED (Accept/Dismiss render
   identically to the single-run findings UI) and adds Learn + Turn-into-
   eval-case as a visually SEPARATE row below it (WI13) — Learn is additive
   (saves to memory), not a terminal verdict change like Accept/Dismiss, so it
   must not look like a third sibling of those two buttons. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useTurnIntoEvalCase } from "@/lib/hooks/multi-agent";
import { s } from "./styles";

export function TabFindingRow({ finding, prId }: { finding: FindingRecord; prId: string | null }) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  const evalCase = useTurnIntoEvalCase();
  const [justLearned, setJustLearned] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);

  const handleAction = (kind: FindingActionKind) => {
    action.mutate({ findingId: finding.id, action: kind, prId: prId ?? undefined });
  };

  const handleLearn = () => {
    action.mutate(
      { findingId: finding.id, action: "learn", prId: prId ?? undefined },
      {
        onSuccess: () => {
          setJustLearned(true);
          setTimeout(() => setJustLearned(false), 2000);
        },
      },
    );
  };

  const handleEvalCase = () => {
    evalCase.mutate(finding.id, {
      onSuccess: () => {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      },
    });
  };

  return (
    <div style={s.wrap}>
      <FindingCard finding={finding} onAction={handleAction} pending={action.isPending} />
      <div style={s.extraActions}>
        <Button kind="tertiary" size="sm" icon="Brain" onClick={handleLearn} loading={action.isPending}>
          {t("page.learn.action")}
        </Button>
        {justLearned && <span style={s.confirmText}>{t("page.learn.saved")}</span>}
        <span style={{ flex: 1 }} />
        <Button kind="tertiary" size="sm" icon="FlaskConical" onClick={handleEvalCase} loading={evalCase.isPending}>
          {t("page.evalCase.action")}
        </Button>
        {justSaved && <span style={s.confirmText}>{t("page.evalCase.saved")}</span>}
      </div>
    </div>
  );
}
