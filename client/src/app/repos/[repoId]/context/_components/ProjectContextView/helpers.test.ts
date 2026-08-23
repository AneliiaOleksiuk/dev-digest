/**
 * `computeCoverage` (AC-29/AC-30/AC-32, WI6). Oracle derived from the Spec
 * (AC-29, AC-32, E-24, E-25, D-10) and the Plan's WI6 Definition of done
 * before `helpers.ts` was opened for wiring facts: excludes `missing: true`
 * from BOTH the numerator and the denominator, returns `null` (not 0/NaN)
 * when zero eligible documents remain, and the numerator counts on
 * `used_by_agents > 0` — a value the server already computes with the
 * enabled-only rule baked in (AC-30 is server-side, so this file does not
 * re-derive it — see `test/project-context-service.test.ts` on the server
 * side for AC-30's own oracle).
 */
import { describe, it, expect } from "vitest";
import type { ContextDocument } from "@devdigest/shared";
import { computeCoverage } from "./helpers";

function doc(overrides: Partial<ContextDocument>): ContextDocument {
  return {
    path: "docs/x.md",
    source_folder: "docs",
    type: "md",
    tokens: 10,
    bytes: 40,
    used_by_agents: 0,
    missing: false,
    ...overrides,
  };
}

describe("computeCoverage", () => {
  it("AC-29: 3 of 4 present documents used by at least one agent → 75%", () => {
    const documents = [
      doc({ path: "a.md", used_by_agents: 1 }),
      doc({ path: "b.md", used_by_agents: 2 }),
      doc({ path: "c.md", used_by_agents: 0 }),
      doc({ path: "d.md", used_by_agents: 5 }),
    ];
    expect(computeCoverage(documents)).toEqual({ covered: 3, total: 4, pct: 75 });
  });

  it("AC-29/E-24: a fifth missing:true document changes nothing — excluded from BOTH numerator and denominator", () => {
    const documents = [
      doc({ path: "a.md", used_by_agents: 1 }),
      doc({ path: "b.md", used_by_agents: 2 }),
      doc({ path: "c.md", used_by_agents: 0 }),
      doc({ path: "d.md", used_by_agents: 5 }),
      doc({ path: "gone.md", used_by_agents: 1, missing: true }),
    ];
    expect(computeCoverage(documents)).toEqual({ covered: 3, total: 4, pct: 75 });
  });

  it("AC-32/E-14: an empty document set renders no coverage (null, not 0/NaN)", () => {
    expect(computeCoverage([])).toBeNull();
  });

  it("AC-32/E-24: a listing of ONLY missing:true rows renders no coverage — not 100%", () => {
    const documents = [
      doc({ path: "gone-1.md", used_by_agents: 1, missing: true }),
      doc({ path: "gone-2.md", used_by_agents: 3, missing: true }),
    ];
    expect(computeCoverage(documents)).toBeNull();
  });

  it("E-25: zero agents attached to any document is a legitimate 0%, not null/hidden", () => {
    const documents = [doc({ path: "a.md", used_by_agents: 0 }), doc({ path: "b.md", used_by_agents: 0 })];
    expect(computeCoverage(documents)).toEqual({ covered: 0, total: 2, pct: 0 });
  });

  it("all eligible documents covered → 100%", () => {
    const documents = [doc({ path: "a.md", used_by_agents: 1 }), doc({ path: "b.md", used_by_agents: 1 })];
    expect(computeCoverage(documents)).toEqual({ covered: 2, total: 2, pct: 100 });
  });
});
