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
});
