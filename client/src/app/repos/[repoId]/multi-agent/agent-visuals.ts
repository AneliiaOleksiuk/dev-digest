/* agent-visuals — per-agent icon + accent color for the Multi-Agent Review
   screens (configure-run picker cards, Columns cards, Tabs, and the PR-page
   RunReviewDropdown's checkbox picker). Four named personas keep a
   hand-picked color that doubles as a semantic cue (danger/warning/info/
   positive), reusing this design system's existing severity/status tokens
   (`src/vendor/ui/styles.css`, do-not-touch).

   EVERY other agent — including ones added after this file was written —
   gets a color from AUTO_PALETTE + an icon from AUTO_ICONS. Assignment is
   ROUND-ROBIN over the whole roster (`agentVisuals(agents)`, called once by
   the screen that already has the full list), not a per-agent hash: with a
   small fixed palette and an open-ended agent count, a hash-mod assignment
   can land 3+ agents on the same slot by pure chance (confirmed in
   practice). Round-robin over a STABLE (sorted-by-id) order guarantees the
   fairest possible split for whatever roster size is passed in and needs no
   per-row context beyond the roster itself.

   AUTO_PALETTE is deliberately only TWO hues, not four — this app's own
   `--crit`/`--warn`/`--sugg`/`--ok` (vendored, do-not-touch) already occupy
   red/orange/blue/green, and `dataviz`'s validate_palette.js (run against
   this app's real surfaces) showed every candidate tried in the warn↔ok and
   ok↔sugg gaps fails the HARD "normal-vision floor ≥15" gate against its
   nearest reserved neighbor — not a soft CVD warning, a real "reads as the
   same color to someone with ordinary vision" fail (confirmed in practice:
   an earlier 4-hue attempt made General Reviewer/Test Quality Reviewer read
   as the same orange/blue as Performance Reviewer/Junior Mentor). Violet
   and magenta are the only two hues that clear all-pairs against the
   reserved four in both themes; they live as theme-aware CSS vars in
   `src/app/globals.css` (see that file's comment for the validator output).
   Because only 2 colors exist, AUTO_ICONS independently round-robins
   through MORE options (round-robin desync, not the same modulus) so two
   agents sharing a color still differ by icon — color is never the sole
   identifier for any agent on these screens, named or auto. */
import type { IconName } from "@devdigest/ui";

export interface AgentVisual {
  icon: IconName;
  color: string;
}

const AGENT_VISUALS: Record<string, AgentVisual> = {
  "Security Reviewer": { icon: "Shield", color: "var(--crit)" },
  "Performance Reviewer": { icon: "Zap", color: "var(--warn)" },
  "Junior Mentor": { icon: "Lightbulb", color: "var(--sugg)" },
  "Customer-Facing": { icon: "MessageSquare", color: "var(--ok)" },
};

// Agents with a fitting icon but no reserved semantic color — they still
// draw their color from AUTO_PALETTE like any unmapped agent.
const ICON_OVERRIDES: Record<string, IconName> = {
  Architecture: "Layers",
};

const AUTO_PALETTE: readonly string[] = ["var(--agent-violet)", "var(--agent-magenta)"];

// Deliberately a different length than AUTO_PALETTE (8 vs 2) so the two
// round-robins desync — every unmapped agent still gets its own icon until
// the 9th, well past where the 2-color palette starts repeating.
const AUTO_ICONS: readonly IconName[] = ["Cpu", "Wrench", "Search", "FlaskConical", "Boxes", "Target", "Bug", "Database"];

const FALLBACK_VISUAL: AgentVisual = { icon: AUTO_ICONS[0]!, color: AUTO_PALETTE[0]! };

/** Resolve every agent in the roster to its icon + color in one pass — call
 *  once per screen with the FULL list of agents it's about to render (order
 *  doesn't matter, the result is sorted internally by id for stability), and
 *  look up each agent's `AgentVisual` from the returned map by id. */
export function agentVisuals(agents: { id: string; name: string }[]): Map<string, AgentVisual> {
  const result = new Map<string, AgentVisual>();
  const unmapped: { id: string; name: string }[] = [];

  for (const a of agents) {
    const named = AGENT_VISUALS[a.name];
    if (named) result.set(a.id, named);
    else unmapped.push(a);
  }

  // Stable order independent of API/array fetch order, so the same roster
  // always assigns the same colors regardless of how it was sorted upstream.
  unmapped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  unmapped.forEach((a, i) => {
    result.set(a.id, {
      icon: ICON_OVERRIDES[a.name] ?? AUTO_ICONS[i % AUTO_ICONS.length]!,
      color: AUTO_PALETTE[i % AUTO_PALETTE.length]!,
    });
  });

  return result;
}

/** Convenience getter — never throws on a miss, falls back to the first auto
 *  color rather than a plain/uncolored border. */
export function agentVisualFrom(visuals: Map<string, AgentVisual>, agentId: string): AgentVisual {
  return visuals.get(agentId) ?? FALLBACK_VISUAL;
}
