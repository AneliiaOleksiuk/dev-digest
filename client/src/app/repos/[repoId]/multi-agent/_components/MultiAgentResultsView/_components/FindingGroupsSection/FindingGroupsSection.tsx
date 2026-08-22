/* FindingGroupsSection — near-duplicate findings grouped by matching
   file+category+overlapping line range (AC-22..25). Collapsed by default;
   expanding shows EVERY member's title/rationale/suggestion/confidence
   VERBATIM (never merged/paraphrased — the whole point of the grouping is
   per-agent attribution surviving it). A finding flagged by exactly one
   agent still renders, as a group of one. Reuses `FindingCard` unforked so
   Accept/Dismiss act on that ONE finding id — never a group's siblings, no
   bulk "dismiss all in group" (OQ-2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingActionKind, FindingGroup, FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { groupKey, memberFindingRecord } from "./helpers";
import { s } from "./styles";

export function FindingGroupsSection({
  groups,
  findingsById,
  prId,
}: {
  groups: FindingGroup[];
  findingsById: Map<string, FindingRecord>;
  prId: string | null;
}) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleAction = (findingId: string, kind: FindingActionKind) => {
    action.mutate({ findingId, action: kind, prId: prId ?? undefined });
  };

  return (
    <div style={s.root}>
      <div style={s.head}>
        <div style={s.title}>{t("page.groups.title")}</div>
        <div style={s.subtitle}>{t("page.groups.subtitle")}</div>
        <div style={s.note}>{t("page.groups.sameLocationNote")}</div>
      </div>
      {groups.length === 0 ? (
        <div style={s.empty}>{t("page.groups.empty")}</div>
      ) : (
        groups.map((group) => {
          const key = groupKey(group);
          const open = expanded.has(key);
          return (
            <div key={key} style={s.group}>
              <div style={s.groupHeader} onClick={() => toggle(key)}>
                <Icon.ChevronDown
                  size={14}
                  style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", color: "var(--text-muted)" }}
                />
                <span className="mono" style={s.location}>
                  {group.file}:{group.start_line}
                </span>
                <span style={s.members}>
                  {group.members.map((m) => m.agent_name).join(", ")} —{" "}
                  {t("page.groups.memberCount", { count: group.members.length })}
                </span>
              </div>
              {open && (
                <div style={s.body}>
                  {group.members.map((member) => (
                    <FindingCard
                      key={member.id}
                      finding={memberFindingRecord(group, member, findingsById)}
                      onAction={(kind) => handleAction(member.id, kind)}
                      pending={action.isPending}
                      defaultExpanded
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
