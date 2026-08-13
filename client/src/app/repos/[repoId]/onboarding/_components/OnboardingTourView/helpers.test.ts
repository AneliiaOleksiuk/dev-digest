/**
 * OnboardingTourView/helpers.ts (WI13) — pure helper unit tests.
 *
 * Oracle (derived BEFORE reading helpers.ts): WI13's DoD ("a unit test
 * exists asserting the produced Markdown contains all five sections plus
 * the status line, and that no network request is issued (AC-39, E-19)")
 * plus AC-4 order defense-in-depth (`orderedSections` never trusts the
 * API's own section order) and AC-6/hasStoredTour's gate for the confirm
 * modal.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { OnboardingSection, OnboardingTourResponse } from "@/lib/types";
import { downloadTextFile, hasStoredTour, orderedSections, toMarkdown } from "./helpers";

function section(kind: OnboardingSection["kind"], overrides: Partial<OnboardingSection> = {}): OnboardingSection {
  return { kind, title: kind, body: `body for ${kind}`, diagram: null, links: [], ...overrides };
}

const FULL_TOUR: OnboardingTourResponse = {
  sections: [
    section("architecture"),
    section("critical_paths"),
    section("run_locally"),
    section("reading_path"),
    section("first_tasks"),
  ],
  status: "ok",
  generated_at: "2026-08-01T00:00:00.000Z",
  files_indexed: 42,
  index_status: "full",
  index_sha: "sha-1",
  stale: false,
  usage: { provider: "openrouter", model: "deepseek/deepseek-v4-flash", call_count: 1, tokens_in: 10, tokens_out: 5, cost_usd: 0.001 },
  reason: "Generated from a full index of 42 files.",
};

const sectionTitle = (kind: string) => `Title: ${kind}`;

describe("orderedSections — AC-4 defense in depth", () => {
  it("returns sections in the FIXED AC-4 order, even when the API returned them scrambled", () => {
    const scrambled: OnboardingTourResponse = {
      ...FULL_TOUR,
      sections: [section("first_tasks"), section("architecture"), section("run_locally")],
    };
    expect(orderedSections(scrambled).map((s) => s.kind)).toEqual(["architecture", "run_locally", "first_tasks"]);
  });

  it("returns [] for an undefined tour", () => {
    expect(orderedSections(undefined)).toEqual([]);
  });

  it("silently drops a kind absent from the tour rather than inserting a placeholder", () => {
    const partial: OnboardingTourResponse = { ...FULL_TOUR, sections: [section("architecture")] };
    expect(orderedSections(partial).map((s) => s.kind)).toEqual(["architecture"]);
  });
});

describe("hasStoredTour — AC-6's gate for the confirm modal", () => {
  it("true only when generated_at is non-null (a real persisted row)", () => {
    expect(hasStoredTour(FULL_TOUR)).toBe(true);
    expect(hasStoredTour({ ...FULL_TOUR, generated_at: null })).toBe(false);
    expect(hasStoredTour(undefined)).toBe(false);
  });
});

describe("toMarkdown — AC-39/E-19 client-side export", () => {
  it("contains all five section titles and their bodies", () => {
    const md = toMarkdown(FULL_TOUR, "acme/widgets", sectionTitle);
    for (const kind of ["architecture", "critical_paths", "run_locally", "reading_path", "first_tasks"]) {
      expect(md).toContain(`Title: ${kind}`);
      expect(md).toContain(`body for ${kind}`);
    }
  });

  it("E-19: carries the SAME status line the page shows — a degraded/skeleton tour never exports as though complete", () => {
    const skeleton: OnboardingTourResponse = {
      ...FULL_TOUR,
      status: "not_indexed",
      reason: "This repo has not been indexed yet — the tour is built from a bounded, deterministic file sample instead of the import graph.",
    };
    const md = toMarkdown(skeleton, "acme/widgets", sectionTitle);
    expect(md).toContain("Status: not_indexed");
    expect(md).toContain("This repo has not been indexed yet");
  });

  it("marks a stale tour distinctly in the status line", () => {
    const md = toMarkdown({ ...FULL_TOUR, stale: true }, "acme/widgets", sectionTitle);
    expect(md).toContain("Status: ok (stale)");
  });

  it("an empty-body section gets an explicit placeholder, never a silently blank heading", () => {
    const withEmpty: OnboardingTourResponse = {
      ...FULL_TOUR,
      sections: FULL_TOUR.sections.map((s) => (s.kind === "first_tasks" ? { ...s, body: "" } : s)),
    };
    const md = toMarkdown(withEmpty, "acme/widgets", sectionTitle);
    expect(md).toContain("_No content available for this section yet._");
  });

  it("includes a fenced mermaid block when a section carries a diagram", () => {
    const withDiagram: OnboardingTourResponse = {
      ...FULL_TOUR,
      sections: FULL_TOUR.sections.map((s) =>
        s.kind === "architecture" ? { ...s, diagram: "flowchart TD\nA-->B" } : s,
      ),
    };
    const md = toMarkdown(withDiagram, "acme/widgets", sectionTitle);
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart TD\nA-->B");
  });

  it("renders links as markdown link syntax", () => {
    const withLinks: OnboardingTourResponse = {
      ...FULL_TOUR,
      sections: FULL_TOUR.sections.map((s) =>
        s.kind === "architecture" ? { ...s, links: [{ label: "server", path: "src/server.ts" }] } : s,
      ),
    };
    const md = toMarkdown(withLinks, "acme/widgets", sectionTitle);
    expect(md).toContain("- [server](src/server.ts)");
  });
});

describe("downloadTextFile — AC-39/WI13: no network request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("triggers a client-side Blob download WITHOUT calling fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // jsdom doesn't implement createObjectURL/revokeObjectURL at all —
    // define them (vi.fn stand-ins) rather than spyOn a non-existent method.
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURLSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("acme-widgets-onboarding-tour.md", "# Tour\n\nContent.");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });
});
