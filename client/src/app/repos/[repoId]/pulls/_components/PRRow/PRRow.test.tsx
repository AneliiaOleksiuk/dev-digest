import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: null,
    cost_usd: null,
    critical_count: null,
    warning_count: null,
    suggestion_count: null,
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings cell", () => {
  it("shows one severity badge per non-zero count when reviewed", () => {
    renderWithIntl(
      <PRRow
        pr={pr({ score: 61, critical_count: 2, warning_count: 1, suggestion_count: 0 })}
        repoId="repo1"
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a dash when the PR has never been reviewed", () => {
    renderWithIntl(<PRRow pr={pr({ score: null })} repoId="repo1" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
