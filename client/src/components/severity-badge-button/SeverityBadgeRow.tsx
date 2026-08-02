/* SeverityBadgeRow — the CRITICAL/WARNING/SUGGESTION badge trio, each
   clickable, built once and reused everywhere findings counts are shown (PR
   list, Timeline, Review-runs header) instead of repeating the same
   three-badge JSX block per surface. */
"use client";

import React from "react";
import type { Severity } from "@devdigest/ui";
import { SeverityBadgeButton } from "./SeverityBadgeButton";

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];

export type SeverityCounts = Partial<Record<Severity, number | null | undefined>>;

export function SeverityBadgeRow({
  counts,
  onClick,
  labelFor,
}: {
  counts: SeverityCounts;
  onClick: (severity: Severity) => void;
  labelFor?: (severity: Severity) => string;
}) {
  return (
    <>
      {SEVERITY_ORDER.filter((severity) => !!counts[severity]).map((severity) => (
        <SeverityBadgeButton
          key={severity}
          severity={severity}
          count={counts[severity] ?? undefined}
          ariaLabel={labelFor?.(severity)}
          onClick={(e) => {
            e.stopPropagation();
            onClick(severity);
          }}
        />
      ))}
    </>
  );
}
