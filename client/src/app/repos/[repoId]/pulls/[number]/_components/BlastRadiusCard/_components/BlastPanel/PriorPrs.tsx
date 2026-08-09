/* PriorPrs — collapsible "Prior PRs touching these files" section at the
   bottom of BlastPanel (WI6, L04 follow-ups — Item 2, net-new). Collapsed by
   default; each row links to `/repos/:repoId/pulls/:number`, an INTERNAL
   Next.js route — unlike a caller `file:line` (which always goes to
   github.com, client/INSIGHTS.md), this is a DevDigest PR we already have a
   row for. Renders nothing when `prior_prs` is empty — a `[0]` collapsible
   row would be noise (contrast with the blast tree itself, where an empty
   list is meaningful and gets `noDownstream`). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { PriorPr } from "@devdigest/shared";
import { s } from "./styles";

export function PriorPrs({ repoId, priorPrs }: { repoId: string; priorPrs: PriorPr[] }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);

  if (priorPrs.length === 0) return null;

  return (
    <div style={s.priorPrsWrap}>
      <button
        type="button"
        style={s.priorPrsHeader}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon.ChevronDown
          size={14}
          style={{ ...s.priorPrsChevron, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        <span>{t("priorPrs.title")}</span>
        <Badge color="var(--text-muted)">{priorPrs.length}</Badge>
      </button>

      {open && (
        <ul style={s.priorPrsList}>
          {priorPrs.map((pr) => (
            <li key={pr.id}>
              <Link href={`/repos/${repoId}/pulls/${pr.number}`} style={s.priorPrsRow}>
                <span style={s.priorPrsNumber}>#{pr.number}</span> · <span>{pr.title}</span> ·{" "}
                <span style={s.priorPrsMeta}>
                  {t("priorPrs.byAuthor", { author: pr.author })} ·{" "}
                  {t("priorPrs.sharedFiles", { count: pr.overlapping_files })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
