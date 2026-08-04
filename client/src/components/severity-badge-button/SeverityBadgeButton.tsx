/* SeverityBadgeButton — a SeverityBadge wrapped as a real button. Clicking it
   jumps to that severity's findings. Shared across the PR list, Timeline, and
   Review-runs header so all three findings counters use the same affordance. */
"use client";

import React from "react";
import { SeverityBadge, type Severity } from "@devdigest/ui";

export const unstyledButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  font: "inherit",
  color: "inherit",
};

export function SeverityBadgeButton({
  severity,
  count,
  onClick,
  ariaLabel,
}: {
  severity: Severity;
  count?: number;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} style={unstyledButtonStyle}>
      <SeverityBadge severity={severity} count={count} compact />
    </button>
  );
}
