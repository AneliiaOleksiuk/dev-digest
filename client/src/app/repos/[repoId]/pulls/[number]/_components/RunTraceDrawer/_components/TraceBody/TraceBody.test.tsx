/**
 * TraceBody — implementer's own self-check (minimal; test-writer owns the
 * full suite per WI12's stated Definition of done): the "Specs read" row
 * and the new "Project context documents" row are fed by different fields
 * and never merged (ADR-0003), and an old trace with `project_context_docs:
 * []` renders without throwing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";

import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <TraceBody trace={trace} findings={[]} />
    </NextIntlClientProvider>,
  );
}

const BASE_TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: null,
    memory: null,
    specs: "<untrusted source=\"spec-0\">\nspecs/skills-feature.md\n\nRule text.\n</untrusted>",
    user: "Review PR #482",
  },
  tool_calls: [],
  raw_output: "",
  memory_pulled: [],
  specs_read: ["docs/adr/0003-specs-read-reuse-for-intent.md"],
  project_context_docs: [{ path: "specs/skills-feature.md", tokens: 120, chars: 480 }],
  log: [],
};

describe("TraceBody", () => {
  it("AC-27: Specs read and Project context documents are separate rows fed by different fields", () => {
    renderBody(BASE_TRACE);

    // Specs read row (fed by trace.specs_read).
    expect(screen.getByText("docs/adr/0003-specs-read-reuse-for-intent.md")).toBeInTheDocument();
    // Project context documents row (fed by trace.project_context_docs) —
    // distinct path, never folded into the row above.
    expect(screen.getByText(/specs\/skills-feature\.md/)).toBeInTheDocument();
    expect(screen.getByText("Specs read")).toBeInTheDocument();
    expect(screen.getByText("Project context documents")).toBeInTheDocument();
  });

  it("AC-25: the Prompt assembly label reads the untrusted-specs wording", () => {
    renderBody(BASE_TRACE);
    // Prompt assembly starts collapsed (defaultOpen={false}) — expand it.
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
  });

  it("renders without throwing on an old trace with project_context_docs: []", () => {
    const oldTrace: RunTrace = { ...BASE_TRACE, project_context_docs: [] };
    expect(() => renderBody(oldTrace)).not.toThrow();
    expect(screen.getByText("Project context documents")).toBeInTheDocument();
  });

  // test-writer addition — AC-26: "list, per injected document, its
  // repo-relative path AND that document's individual size" — the
  // implementer's self-check asserted the path renders but never asserted
  // the per-document size (tokens/chars) actually renders alongside it.
  it("AC-26: each project-context row shows its own non-null size, not just its path", () => {
    const trace: RunTrace = {
      ...BASE_TRACE,
      project_context_docs: [
        { path: "specs/skills-feature.md", tokens: 120, chars: 480 },
        { path: "docs/adr/0003-specs-read-reuse-for-intent.md", tokens: 340, chars: 1200 },
      ],
    };
    renderBody(trace);
    expect(screen.getByText(/specs\/skills-feature\.md \(120 tok \/ 480 ch\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/docs\/adr\/0003-specs-read-reuse-for-intent\.md \(340 tok \/ 1200 ch\)/),
    ).toBeInTheDocument();
  });
});
