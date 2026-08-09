/**
 * DiffTab — Smart / Original order toggle + degradation when smart-diff fails.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const useSmartDiff = vi.fn();
const usePrComments = vi.fn();
const useCreatePrComment = vi.fn();

vi.mock("../../../../../../../lib/hooks/smart-diff", () => ({
  useSmartDiff: (...args: unknown[]) => useSmartDiff(...args),
}));

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePrComments: (...args: unknown[]) => usePrComments(...args),
  useCreatePrComment: (...args: unknown[]) => useCreatePrComment(...args),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  useSmartDiff.mockReset();
  usePrComments.mockReset();
  useCreatePrComment.mockReset();
});

const FILES: PrFile[] = [
  {
    path: "src/a.ts",
    additions: 1,
    deletions: 0,
    patch: "@@ -1,0 +1,1 @@\n+hello\n",
  },
  {
    path: "package-lock.json",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,0 +1,1 @@\n+{}\n",
  },
];

function renderTab() {
  usePrComments.mockReturnValue({ data: [] });
  useCreatePrComment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <DiffTab
        prId="pr-1"
        filesCount={2}
        files={FILES}
        findings={[]}
        onFocusFindings={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab Smart Diff toggle", () => {
  it("renders SmartDiffViewer when smart order data is ready", () => {
    useSmartDiff.mockReturnValue({
      data: {
        groups: [
          {
            role: "core",
            files: [
              {
                path: "src/a.ts",
                additions: 1,
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
                additions: 2,
                deletions: 0,
                finding_lines: [],
                pseudocode_summary: null,
              },
            ],
          },
        ],
        split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
      },
      isError: false,
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText(/Reviewer-ordered diff/)).toBeInTheDocument();
  });

  it("falls back to flat DiffViewer on Original order", () => {
    useSmartDiff.mockReturnValue({
      data: {
        groups: [
          {
            role: "core",
            files: [
              {
                path: "src/a.ts",
                additions: 1,
                deletions: 0,
                finding_lines: [],
                pseudocode_summary: null,
              },
            ],
          },
        ],
        split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
      },
      isError: false,
      isLoading: false,
    });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    // Flat viewer still lists both files (including boilerplate) without role headers.
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
  });

  it("forces original order and shows unavailable when smart-diff errors", () => {
    useSmartDiff.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText(/Smart order unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smart order" })).toBeDisabled();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });
});
