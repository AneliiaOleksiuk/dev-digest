import { describe, it, expect } from "vitest";
import { agentVisualFrom, agentVisuals } from "./agent-visuals";

const AUTO_COLORS = ["var(--agent-violet)", "var(--agent-magenta)"];

describe("agentVisuals", () => {
  it("keeps the reserved semantic color for named personas", () => {
    const visuals = agentVisuals([{ id: "s1", name: "Security Reviewer" }]);
    expect(visuals.get("s1")?.color).toBe("var(--crit)");
  });

  it("keeps Architecture's icon but draws its color from the auto palette", () => {
    const visuals = agentVisuals([{ id: "arch-1", name: "Architecture" }]);
    const visual = visuals.get("arch-1");
    expect(visual?.icon).toBe("Layers");
    expect(visual?.color).not.toBe("var(--text-secondary)");
    expect(AUTO_COLORS).toContain(visual?.color);
  });

  it("never leaves an unmapped agent on the plain default border", () => {
    const visuals = agentVisuals([{ id: "g1", name: "General Reviewer" }]);
    expect(AUTO_COLORS).toContain(visuals.get("g1")?.color);
  });

  it("spreads more unmapped agents than the 2-color palette as evenly as possible — no color used more than ceil(n/2) times", () => {
    const agents = Array.from({ length: 6 }, (_, i) => ({ id: `agent-${i}`, name: `General Reviewer ${i}` }));
    const visuals = agentVisuals(agents);
    const counts = new Map<string, number>();
    for (const a of agents) {
      const color = visuals.get(a.id)!.color;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(3); // ceil(6 / 2) = 3
    }
  });

  it("gives every unmapped agent up to the 8th its own distinct icon, even once color starts repeating", () => {
    // 6 unmapped agents: colors repeat after 2 (round-robin over AUTO_PALETTE),
    // but AUTO_ICONS is 8 long, so all 6 icons here are still unique — two
    // agents sharing a color must still be tellable apart by icon.
    const agents = Array.from({ length: 6 }, (_, i) => ({ id: `agent-${i}`, name: `General Reviewer ${i}` }));
    const visuals = agentVisuals(agents);
    const icons = agents.map((a) => visuals.get(a.id)!.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("is stable regardless of the input array's order", () => {
    const a = agentVisuals([
      { id: "z", name: "General Reviewer" },
      { id: "a", name: "Test Quality Reviewer" },
    ]);
    const b = agentVisuals([
      { id: "a", name: "Test Quality Reviewer" },
      { id: "z", name: "General Reviewer" },
    ]);
    expect(a.get("z")?.color).toBe(b.get("z")?.color);
    expect(a.get("a")?.color).toBe(b.get("a")?.color);
  });

  it("gives two agents that share a display name but differ by id their own slot", () => {
    const visuals = agentVisuals([
      { id: "smoke-1", name: "Smoke Test Agent!!" },
      { id: "smoke-2", name: "Smoke Test Agent!!" },
    ]);
    expect(visuals.get("smoke-1")?.color).not.toBe(visuals.get("smoke-2")?.color);
  });
});

describe("agentVisualFrom", () => {
  it("falls back to a real color instead of throwing on a miss", () => {
    const visuals = agentVisuals([]);
    const visual = agentVisualFrom(visuals, "unknown-id");
    expect(visual.color).toBe(AUTO_COLORS[0]);
  });
});
