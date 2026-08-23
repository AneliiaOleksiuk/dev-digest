/**
 * BlastRadiusCard — chrome + BlastPanel. Degraded shows server reason via
 * the panel banner (not a separate card-level unavailable copy). Full
 * responses render the tree inline.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";

const useBlastRadius = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (...args: unknown[]) => useBlastRadius(...args),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  useBlastRadius.mockReset();
});

function renderCard(props: { blastReady?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, blast: blastMessages }}>
      <BlastRadiusCard
        prId="pr-1"
        repoFullName="acme/widgets"
        headSha="abc1234"
        repoId="repo-1"
        blastReady={props.blastReady ?? true}
      />
    </NextIntlClientProvider>,
  );
}

const FULL_RESPONSE: BlastRadiusResponse = {
  changed_symbols: [{ name: "doThing", file: "src/a.ts", kind: "function" }],
  downstream: [
    {
      symbol: "doThing",
      callers: [{ name: "handler", file: "src/routes/things.ts", line: 42 }],
      endpoints_affected: ["GET /things"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol reached by 1 caller across 1 file, affecting 1 endpoint.",
  status: "full",
  reason: null,
  prior_prs: [],
};

describe("BlastRadiusCard", () => {
  it("degraded read → banner with the server's reason (never a fabricated tree)", () => {
    useBlastRadius.mockReturnValue({
      data: {
        changed_symbols: [],
        downstream: [],
        summary: "Blast radius is unavailable.",
        status: "degraded",
        reason: "This repo has no usable code index yet.",
        prior_prs: [],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    renderCard();

    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("This repo has no usable code index yet.");
    expect(screen.queryByText("src/routes/things.ts:42")).not.toBeInTheDocument();
  });

  it("full read → renders the symbol group and a caller file:line INLINE, no navigation", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    renderCard();

    expect(screen.getByText("doThing()")).toBeInTheDocument();
    const callerLink = screen.getByText("src/routes/things.ts:42");
    expect(callerLink).toBeInTheDocument();
    expect(callerLink.closest("a")).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/abc1234/src/routes/things.ts#L42",
    );
    expect(screen.queryByText("View blast radius")).not.toBeInTheDocument();
    expect(screen.queryByText("handler")).not.toBeInTheDocument();
  });
});
