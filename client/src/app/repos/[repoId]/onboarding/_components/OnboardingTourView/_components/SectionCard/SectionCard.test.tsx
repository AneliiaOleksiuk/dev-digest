/**
 * SectionCard (WI11) — one collapsible tour section card.
 *
 * Oracle (derived from specs/SPEC-02-onboarding-generator.md AND
 * docs/plans/spec-02-onboarding-generator.md BEFORE reading SectionCard.tsx):
 *   - AC-38: each of the five sections shows its own deterministic fallback
 *     when its body is empty rather than an empty card.
 *   - AC-33/E-9: an invalid mermaid `diagram` string renders nothing while
 *     the section's prose still renders — verified via the real
 *     `MermaidDiagram` component's own `suppressErrors` contract (its regex
 *     pre-check means a non-mermaid-looking string never even imports the
 *     `mermaid` package, so no network/module mocking is needed here).
 *   - `diagram` only renders for the `architecture` kind (server already
 *     forces this at grounding time; the client honours it too).
 *   - AC-35/D-12: an "Open"-style link is built via `githubBlobUrl` at the
 *     repo's DEFAULT BRANCH, not a head sha.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@/lib/types";
import onboardingMessages from "../../../../../../../../../messages/en/onboarding.json";

import { SectionCard } from "./SectionCard";

afterEach(cleanup);

function section(overrides: Partial<OnboardingSection> = {}): OnboardingSection {
  return {
    kind: "architecture",
    title: "Architecture overview",
    body: "This system is a Fastify API plus a Next.js client.",
    diagram: null,
    links: [],
    ...overrides,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof SectionCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <SectionCard
        section={section()}
        title="Architecture overview"
        defaultOpen={true}
        repoFullName="acme/widgets"
        defaultBranch="main"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("SectionCard", () => {
  // ------------------------------------------------------------------ AC-38
  it("AC-38: an empty body renders the deterministic fallback line, never an empty card", () => {
    renderCard({ section: section({ body: "" }) });
    expect(screen.getByText("No content available for this section yet.")).toBeInTheDocument();
  });

  it("a non-empty body renders through Markdown, not the fallback", () => {
    renderCard({ section: section({ body: "Real prose about the architecture." }) });
    expect(screen.getByText("Real prose about the architecture.")).toBeInTheDocument();
    expect(screen.queryByText("No content available for this section yet.")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------- AC-33/E-9
  it("AC-33/E-9: an invalid mermaid diagram renders nothing while the section's prose still renders", async () => {
    renderCard({
      section: section({
        kind: "architecture",
        body: "Prose that must survive even if the diagram is junk.",
        diagram: "this is not a valid mermaid diagram at all",
      }),
    });

    // Prose is present immediately.
    expect(screen.getByText("Prose that must survive even if the diagram is junk.")).toBeInTheDocument();
    // MermaidDiagram's own contract: unparseable input renders NOTHING — its
    // wrapper `<div>` (identified by its distinctive `overflow-x: auto`
    // style, unique to that component within this card — the chevron/link
    // icons are plain `<svg>`s so a bare "svg" query would false-positive on
    // those) never appears at all.
    await waitFor(() => {
      expect(document.querySelector('div[style*="overflow-x: auto"]')).not.toBeInTheDocument();
    });
  });

  it("diagram is rendered ONLY for the architecture kind — a non-architecture section never attempts it, even with a diagram string present", () => {
    renderCard({
      section: section({ kind: "critical_paths", title: "Critical paths", diagram: "flowchart TD\nA-->B" }),
    });
    // MermaidDiagram is never mounted at all for a non-architecture kind —
    // nothing to suppress-error on, its wrapper div never appears.
    expect(document.querySelector('div[style*="overflow-x: auto"]')).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------------ AC-35
  it("AC-35/D-12: a link's Open target is the repo's DEFAULT BRANCH blob URL, not a head sha", () => {
    renderCard({
      section: section({
        links: [{ label: "server entry", path: "src/server.ts" }],
      }),
      defaultBranch: "develop",
    });
    const link = screen.getByRole("link", { name: /server entry/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/blob/develop/src/server.ts");
  });

  it("no repoFullName known yet ⇒ the link renders with no href rather than a broken URL", () => {
    renderCard({
      section: section({ links: [{ label: "server entry", path: "src/server.ts" }] }),
      repoFullName: null,
    });
    // An <a> with no href isn't exposed with the "link" role, so query by
    // text and inspect the anchor directly.
    const anchor = screen.getByText("server entry").closest("a");
    expect(anchor).not.toHaveAttribute("href");
  });

  // ------------------------------------------------------------------ AC-12
  // FIX-8 KNOWN-STALE (implementer, not fixed here — test-writer's job next):
  // these two assertions still encode the OLD one-badge-in-header design
  // (a single "Model estimate" badge shown once for the whole section). FIX-8
  // replaced it with a per-task complexity badge inside each task card, so
  // `firstTasksBadge` no longer exists as a prop at all (a TYPE error, not
  // just a stale assertion) — removed from the call sites below only so this
  // file keeps compiling; the assertions themselves are left failing
  // intentionally, same pattern as this repo's other known-regression fixes
  // (see client/INSIGHTS.md's FIX-6/IntentCard entries).
  it("AC-12: the First-tasks badge is labelled as a model ESTIMATE, not an unqualified measured property, and its tooltip states that", () => {
    renderCard({ section: section({ kind: "first_tasks", title: "First tasks" }) });
    const badge = screen.getByText("Model estimate");
    expect(badge).toBeInTheDocument();
    // The tooltip lives on the wrapping element's `title` attribute.
    expect(badge.closest("[title]")).toHaveAttribute(
      "title",
      "Task ordering is the model's own estimate, not a measured property.",
    );
  });

  it("AC-12: a section that is NOT first_tasks never renders the badge, even if firstTasksBadge were mistakenly passed true", () => {
    renderCard({ section: section({ kind: "architecture" }) });
    expect(screen.queryByText("Model estimate")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------- design conformance
  it("critical_paths: a parseable bullet body renders file rows with an Open link, not raw markdown", () => {
    renderCard({
      section: section({
        kind: "critical_paths",
        body: "- `src/server.ts` — App bootstrap + middleware chain",
      }),
    });
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText(/App bootstrap \+ middleware chain/)).toBeInTheDocument();
    const openLink = screen.getByRole("link", { name: /Open/ });
    expect(openLink).toHaveAttribute("href", "https://github.com/acme/widgets/blob/main/src/server.ts");
  });

  it("critical_paths: an unparseable body (no bullets) falls back to Markdown, never blank", () => {
    renderCard({ section: section({ kind: "critical_paths", body: "Just prose, no bullets." }) });
    expect(screen.getByText("Just prose, no bullets.")).toBeInTheDocument();
  });

  it("critical_paths: the generic links list is suppressed once rows render — it would just repeat the same paths", () => {
    renderCard({
      section: section({
        kind: "critical_paths",
        body: "- `src/server.ts` — App bootstrap + middleware chain",
        links: [{ label: "server.ts", path: "src/server.ts" }],
      }),
    });
    // Exactly one Open-style link for src/server.ts (the row's own), not two.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("server.ts")).not.toBeInTheDocument();
  });

  it("critical_paths: the generic links list still renders when the body doesn't parse into rows", () => {
    renderCard({
      section: section({
        kind: "critical_paths",
        body: "Just prose, no bullets.",
        links: [{ label: "server.ts", path: "src/server.ts" }],
      }),
    });
    expect(screen.getByText("server.ts")).toBeInTheDocument();
  });

  it("reading_path: a numbered body renders a numbered badge per entry", () => {
    renderCard({
      section: section({
        kind: "reading_path",
        body: "1. `src/server.ts` — See the whole request lifecycle in one file",
      }),
    });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText("See the whole request lifecycle in one file")).toBeInTheDocument();
  });

  it("run_locally: a fenced command body renders one row per command with a per-row copy action, and no header copy button", () => {
    renderCard({
      section: section({ kind: "run_locally", body: "```bash\npnpm install\npnpm dev\n```" }),
    });
    expect(screen.getByText("pnpm install")).toBeInTheDocument();
    expect(screen.getByText("pnpm dev")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
  });
});
