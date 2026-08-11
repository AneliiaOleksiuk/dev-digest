/* Pure helpers for BlastPanel — stat counts + a lightweight graph-view layout.
   No fetching, no DOM — server already groups `downstream` by changed symbol
   (WI2), this file only derives display data from that shape. Moved here
   verbatim from the standalone Blast tab's old helpers.ts (WI1, L04
   follow-ups). */
import type { BlastRadiusResponse, DownstreamImpact } from "@devdigest/shared";

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  /** null = unavailable (status !== "full" — never a confident 0). */
  crons: number | null;
}

/** Append `()` for display when the index name has no call/paren form. */
export function formatSymbolName(name: string): string {
  if (name.includes("(") || name.includes(")")) return name;
  return `${name}()`;
}

/** Stat-row counts. `callers` sums per-group rows (matches the server's own
 *  `summary` counting); `endpoints`/`crons` are deduped across all groups. */
export function computeStats(data: BlastRadiusResponse): BlastStats {
  const callers = data.downstream.reduce((sum, group) => sum + group.callers.length, 0);
  const endpoints = new Set(data.downstream.flatMap((group) => group.endpoints_affected)).size;
  const crons = new Set(data.downstream.flatMap((group) => group.crons_affected)).size;
  return {
    symbols: data.changed_symbols.length,
    callers,
    endpoints,
    crons: data.status === "full" ? crons : null,
  };
}

export interface GraphNode {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  kind: "symbol" | "caller";
}

export interface GraphEdge {
  fromId: string;
  toId: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const ROW_HEIGHT = 34;
/** Horizontal gap between the two node columns (edge span). */
const COL_GAP = 200;
/** Reserved space for left-column labels (textAnchor=end). */
const LEFT_LABEL_W = 132;
/** Reserved space for right-column labels (textAnchor=start). */
const RIGHT_LABEL_W = 132;
/** Gap between a node circle and its label. */
const NODE_GUTTER = 10;
const LEFT_X = LEFT_LABEL_W + NODE_GUTTER;
const RIGHT_X = LEFT_X + COL_GAP;
const GRAPH_WIDTH = RIGHT_X + NODE_GUTTER + RIGHT_LABEL_W;
/** Caps the right column so a fan-out symbol doesn't render an unreadable graph. */
const MAX_GRAPH_CALLER_NODES = 24;

function callerKey(file: string, name: string): string {
  return `${file}::${name}`;
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * Two-column layout: one node per changed symbol (with ≥1 caller) on the
 * left, one node per distinct caller (deduped by file+name, capped) on the
 * right, an edge per symbol→caller reach. Pure geometry — `BlastGraph`
 * renders it as an SVG. Width includes label pads so a `width:100%` SVG
 * can scale into the card without clipping text or needing horizontal scroll.
 */
export function buildGraphLayout(downstream: DownstreamImpact[]): GraphLayout {
  const symbolGroups = downstream.filter((group) => group.callers.length > 0);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const symbolNodeIds = symbolGroups.map((group, i) => {
    const id = `symbol:${group.symbol}:${i}`;
    nodes.push({
      id,
      label: formatSymbolName(group.symbol),
      x: LEFT_X,
      y: (i + 1) * ROW_HEIGHT,
      kind: "symbol",
    });
    return id;
  });

  const callerNodeIdByKey = new Map<string, string>();
  let callerRowCount = 0;
  for (const group of symbolGroups) {
    for (const caller of group.callers) {
      const key = callerKey(caller.file, caller.name);
      if (callerNodeIdByKey.has(key)) continue;
      if (callerRowCount >= MAX_GRAPH_CALLER_NODES) continue;
      callerRowCount += 1;
      const id = `caller:${key}`;
      callerNodeIdByKey.set(key, id);
      nodes.push({
        id,
        label: caller.name,
        sublabel: basename(caller.file),
        x: RIGHT_X,
        y: callerRowCount * ROW_HEIGHT,
        kind: "caller",
      });
    }
  }

  symbolGroups.forEach((group, i) => {
    const fromId = symbolNodeIds[i]!;
    for (const caller of group.callers) {
      const toId = callerNodeIdByKey.get(callerKey(caller.file, caller.name));
      if (!toId) continue; // capped out of the graph
      edges.push({ fromId, toId });
    }
  });

  const rowCount = Math.max(symbolNodeIds.length, callerRowCount) + 1;
  return { nodes, edges, width: GRAPH_WIDTH, height: rowCount * ROW_HEIGHT + ROW_HEIGHT };
}

/** Display truncate so labels stay inside LEFT/RIGHT_LABEL_W when the SVG scales. */
export function truncateGraphLabel(label: string, max = 20): string {
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(1, max - 1))}…`;
}
