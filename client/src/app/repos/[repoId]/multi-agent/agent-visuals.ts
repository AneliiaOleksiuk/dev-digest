/* agent-visuals — per-agent icon + accent color for the Multi-Agent Review
   screens (configure-run picker cards, Columns cards). Keyed by agent NAME
   with a neutral fallback for any agent outside the six seeded personas —
   the picker still lists every workspace agent with no allow-list (D-12);
   this is presentation only, never a filter. Colors reuse this design
   system's existing severity/status tokens (`src/vendor/ui/styles.css`,
   do-not-touch) rather than inventing new ones. */
import type { IconName } from "@devdigest/ui";

interface AgentVisual {
  icon: IconName;
  color: string;
}

// Plain neutral border for any agent outside the map below — deliberately
// the SAME shade the cards already used before this feature, so it reads as
// "no particular color" rather than a washed-out accent.
const DEFAULT_VISUAL: AgentVisual = { icon: "Cpu", color: "var(--border-strong)" };

const AGENT_VISUALS: Record<string, AgentVisual> = {
  "Security Reviewer": { icon: "Shield", color: "var(--crit)" },
  "Performance Reviewer": { icon: "Zap", color: "var(--warn)" },
  "Junior Mentor": { icon: "Lightbulb", color: "var(--sugg)" },
  "Customer-Facing": { icon: "MessageSquare", color: "var(--ok)" },
  // No spare hue left in this design system's token set (do-not-touch) once
  // red/orange/blue/green are taken — `--text-secondary` (a visibly lighter
  // gray than the plain neutral border above) keeps Architecture legibly
  // distinct without inventing a new color.
  Architecture: { icon: "Layers", color: "var(--text-secondary)" },
};

export function agentVisual(agentName: string): AgentVisual {
  return AGENT_VISUALS[agentName] ?? DEFAULT_VISUAL;
}
