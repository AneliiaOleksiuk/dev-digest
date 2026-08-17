/**
 * SmartDiffViewer — role groups, default collapse, banner, finding-line scroll.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiffResponse } from "@devdigest/shared";
import type { FocusFindingsOptions } from "@/lib/types";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

const FILES: PrFile[] = [
  {
    path: "src/middleware/ratelimit.ts",
    additions: 10,
    deletions: 0,
    patch: "@@ -1,0 +1,3 @@\n+a\n+b\n+c\n",
  },
  {
    path: "src/server.ts",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,0 +1,1 @@\n+x\n",
  },
  {
    path: "package-lock.json",
    additions: 5,
    deletions: 0,
    patch: "@@ -1,0 +1,1 @@\n+{}\n",
  },
];

const SMART: SmartDiffResponse = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          additions: 10,
          deletions: 0,
          finding_lines: [2],
          pseudocode_summary: null,
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/server.ts",
          additions: 2,
          deletions: 0,
          finding_lines: [],
          pseudocode_summary: null,
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          additions: 5,
          deletions: 0,
          finding_lines: [],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: {
    too_big: true,
    total_lines: 500,
    proposed_splits: [
      { name: "core", files: ["src/middleware/ratelimit.ts"] },
      { name: "wiring", files: ["src/server.ts"] },
      { name: "boilerplate", files: ["package-lock.json"] },
    ],
  },
};

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "Race",
    file: "src/middleware/ratelimit.ts",
    start_line: 2,
    end_line: 2,
    rationale: "…",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderViewer(
  smartDiff: SmartDiffResponse = SMART,
  onFocusFindings?: (opts: FocusFindingsOptions) => void,
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <SmartDiffViewer
        smartDiff={smartDiff}
        files={FILES}
        findings={FINDINGS}
        onFocusFindings={onFocusFindings}
      />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders role groups in response order with file counts", () => {
    renderViewer();
    expect(screen.getAllByText("Core logic").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Wiring").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Boilerplate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("keeps boilerplate group collapsed by default", () => {
    renderViewer();
    expect(screen.queryByText("package-lock.json")).not.toBeInTheDocument();
  });

  it("opens core files by default regardless of size", () => {
    renderViewer();
    // Expanded body shows the patched add line text.
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("shows the large-PR banner when too_big", () => {
    renderViewer();
    expect(screen.getByText(/This PR is large/)).toBeInTheDocument();
  });

  it("shows What this does + summary badge from patch when pseudocode_summary is null", () => {
    renderViewer();
    expect(screen.getAllByText(/What this does/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /^summary$/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the Core logic group header on one line", () => {
    renderViewer();
    const subtitle = screen.getByText(/The substance of the change/);
    const row = subtitle.parentElement;
    expect(row?.textContent).toMatch(/Core logic/);
    expect(row?.textContent).toMatch(/The substance of the change/);
  });

  it("shows the file-header severity badge in Smart Diff mode (reachable, not gated behind smartMode)", () => {
    renderViewer(SMART, vi.fn());
    expect(screen.getByRole("button", { name: "Show WARNING findings" })).toBeInTheDocument();
  });

  it("clicking the file-header severity badge passes both severity and a findingId from that file", () => {
    const onFocusFindings = vi.fn();
    renderViewer(SMART, onFocusFindings);
    const badge = screen.getByRole("button", { name: "Show WARNING findings" });
    fireEvent.click(badge);
    expect(onFocusFindings).toHaveBeenCalledWith({ severity: "WARNING", findingId: "f1" });
  });

  it("scrolls to data-diff-line when the status dot is clicked", () => {
    renderViewer();
    const dot = screen.getByRole("button", { name: /Jump to line 2/i });
    fireEvent.click(dot);
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
          resolve();
        });
      });
    });
  });

  // ---------------------------------------------------------- AC-30/WI13
  it("AC-30: externalFocus expands an ALREADY-OPEN-GROUP (core) file and scrolls to its data-diff-line anchor", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <SmartDiffViewer
          smartDiff={SMART}
          files={FILES}
          findings={FINDINGS}
          externalFocus={{ path: "src/server.ts", line: 1 }}
        />
      </NextIntlClientProvider>,
    );
    // "x" appears twice when open (the added line AND the summary-badge
    // preview text derived from the same patch) — assert via the anchor
    // DOM contract itself (`data-diff-line`, `CodeLine.tsx`) rather than a
    // duplicated text match.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(document.querySelector('[data-diff-line="src/server.ts:1"]')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // Previously a documented FAILING implementation-bug test: `onJumpToLine`
  // used to force only the FILE's own `openMap` entry, never the enclosing
  // `RoleGroup`'s `groupOpen` state, so a `boilerplate`-role file (default
  // collapsed) was never mounted and the scroll target was never found.
  // `implementer` fixed this by lifting `groupOpen` into `SmartDiffViewer`
  // as `groupOpenMap`, with `onJumpToLine` now opening both the group and
  // the file before scrolling. As with the sibling ALREADY-OPEN-GROUP test
  // above, "{}" appears twice when open (the added line AND FileCard's
  // "what this does" preview badge derived from the same patch) — assert
  // via the anchor DOM contract itself (`data-diff-line`, `CodeLine.tsx`)
  // rather than a duplicated text match.
  it("AC-30: externalFocus for a file in an initially-collapsed role group (boilerplate) still expands the group and scrolls to it", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <SmartDiffViewer
          smartDiff={SMART}
          files={FILES}
          findings={FINDINGS}
          externalFocus={{ path: "package-lock.json", line: 1 }}
        />
      </NextIntlClientProvider>,
    );
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(document.querySelector('[data-diff-line="package-lock.json:1"]')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("AC-31/E-22 safe no-op: externalFocus naming a path NOT in this PR's files neither scrolls nor throws, nor force-opens anything", () => {
    const render_ = () =>
      render(
        <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
          <SmartDiffViewer
            smartDiff={SMART}
            files={FILES}
            findings={FINDINGS}
            externalFocus={{ path: "src/does-not-exist.ts", line: 1 }}
          />
        </NextIntlClientProvider>,
      );
    expect(render_).not.toThrow();
    expect(screen.queryByText("{}")).not.toBeInTheDocument(); // boilerplate stays collapsed
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
