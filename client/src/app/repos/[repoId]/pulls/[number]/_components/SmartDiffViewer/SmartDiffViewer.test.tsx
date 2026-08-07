/**
 * SmartDiffViewer — role groups, default collapse, banner, finding-line scroll.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiffResponse } from "@devdigest/shared";
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

function renderViewer(smartDiff: SmartDiffResponse = SMART) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <SmartDiffViewer smartDiff={smartDiff} files={FILES} findings={FINDINGS} />
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
});
