/* BlastGraph — a minimal two-column node/edge SVG (changed symbols → their
   direct callers), driven by helpers.ts's `buildGraphLayout`. No charting
   library — this codebase has none (see `dataviz`-style inline-SVG
   convention already used elsewhere in this repo). Moved here verbatim from
   the standalone Blast tab's old BlastGraph.tsx (WI1, L04 follow-ups). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { buildGraphLayout, truncateGraphLabel } from "./helpers";
import { s } from "./styles";

export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");
  const layout = React.useMemo(() => buildGraphLayout(downstream), [downstream]);

  if (layout.nodes.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div style={s.graphWrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={s.graphSvg}
      >
        {layout.edges.map((edge, i) => {
          const from = nodeById.get(edge.fromId);
          const to = nodeById.get(edge.toId);
          if (!from || !to) return null;
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}
        {layout.nodes.map((node) => {
          const display = truncateGraphLabel(node.label);
          const titleText = node.sublabel ? `${node.label} · ${node.sublabel}` : node.label;
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={5}
                fill={node.kind === "symbol" ? "var(--accent)" : "var(--text-muted)"}
              />
              <text
                x={node.kind === "symbol" ? node.x - 10 : node.x + 10}
                y={node.y + 4}
                fontSize={11}
                textAnchor={node.kind === "symbol" ? "end" : "start"}
                fill="var(--text-secondary)"
              >
                <title>{titleText}</title>
                {display}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
