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

const DEFAULT_VISUAL: AgentVisual = { icon: "Cpu", color: "var(--text-muted)" };

const AGENT_VISUALS: Record<string, AgentVisual> = {
  "Security Reviewer": { icon: "Shield", color: "var(--crit)" },
  "Performance Reviewer": { icon: "Zap", color: "var(--warn)" },
  "Junior Mentor": { icon: "Lightbulb", color: "var(--sugg)" },
  "Customer-Facing": { icon: "MessageSquare", color: "var(--ok)" },
  Architecture: { icon: "Layers", color: "var(--info)" },
};

export function agentVisual(agentName: string): AgentVisual {
  return AGENT_VISUALS[agentName] ?? DEFAULT_VISUAL;
}
