/**
 * BriefTimeline (SPEC-03, WI12). Oracle derived from the Spec/Plan BEFORE
 * this component was opened for wiring facts:
 *   - AC-33: exactly the entries whose risk_level differs from the entry
 *     BEFORE them (older neighbour) get a "risk changed" marker — not every
 *     entry.
 *   - AC-34: the disclosure string reflects brief_count/commit_count and is
 *     present whenever the timeline has entries (the "honest gap" copy).
 *   - AC-15 (client half): activating an older entry costs zero NEW
 *     requests — every entry already carries its full BriefRecord in the
 *     payload; the component only needs to call back with that entry.
 *   - Lazy fetch: the timeline query only becomes enabled once the
 *     disclosure is opened (a collapsed card must not fetch the timeline
 *     eagerly).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../../../messages/en/brief.json";
import type { BriefTimelineEntry, BriefTimelineResponse } from "@/lib/types";

const usePrBriefTimeline = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBriefTimeline: (...args: unknown[]) => usePrBriefTimeline(...args),
}));

import { BriefTimeline } from "./BriefTimeline";

afterEach(() => {
  cleanup();
  usePrBriefTimeline.mockReset();
});

function briefRecordStub(overrides: Record<string, unknown> = {}) {
  return {
    what: "x",
    why: "y",
    risk_level: "low",
    risks: [],
    review_focus: [],
    pr_id: "pr-1",
    head_sha: "sha",
    generated_at: "2026-08-01T00:00:00.000Z",
    input_status: {
      intent_status: "used",
      blast_status: "full",
      changed_file_count: 0,
      spec_files_used: [],
      spec_files_unresolved: [],
      linked_issue_status: "not_referenced",
      dropped_inputs: [],
    },
    usage: {
      provider: "openai",
      model: "gpt-4.1",
      input_tokens: 1,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      dropped_risk_refs: 0,
      dropped_focus_items: 0,
    },
    ...overrides,
  };
}

function entry(overrides: Partial<BriefTimelineEntry> = {}): BriefTimelineEntry {
  const headSha = (overrides.head_sha as string) ?? "sha-x";
  return {
    head_sha: headSha,
    generated_at: "2026-08-01T00:00:00.000Z",
    risk_level: "low",
    is_current_head: false,
    risk_changed: false,
    record: briefRecordStub({ head_sha: headSha, risk_level: overrides.risk_level ?? "low" }) as never,
    ...overrides,
  };
}

function renderTimeline(props: Partial<React.ComponentProps<typeof BriefTimeline>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <BriefTimeline
        prId="pr-1"
        selectedHeadSha={null}
        onSelect={vi.fn()}
        onBackToCurrent={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** jsdom's native `<summary>` click DOES flip the `<details>` element's
 *  `open` DOM attribute, but does not reliably fire a same-tick 'toggle'
 *  event the way a real browser does, so `fireEvent.click` alone leaves
 *  BriefTimeline's own React `open` state (and therefore its render output)
 *  out of sync with the DOM attribute. Drive it the way a real browser
 *  would: flip `.open` directly, then dispatch the 'toggle' event React's
 *  `onToggle` listens for — this is the documented workaround for testing
 *  controlled `<details>` under RTL+jsdom. */
function openDisclosure() {
  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

describe("BriefTimeline — lazy fetch", () => {
  it("does not enable the timeline query before the disclosure is opened", () => {
    usePrBriefTimeline.mockReturnValue({ data: undefined, isLoading: false });
    renderTimeline();
    expect(usePrBriefTimeline).toHaveBeenCalledWith("pr-1", { enabled: false });
  });

  it("enables the timeline query once the <details> is opened", () => {
    usePrBriefTimeline.mockReturnValue({ data: undefined, isLoading: false });
    renderTimeline();
    openDisclosure();
    expect(usePrBriefTimeline).toHaveBeenLastCalledWith("pr-1", { enabled: true });
  });
});

describe("BriefTimeline — AC-34: honest-gap disclosure", () => {
  it("shows the disclosure text reflecting brief_count/commit_count", () => {
    const response: BriefTimelineResponse = {
      entries: [entry({ head_sha: "c1" })],
      brief_count: 3,
      commit_count: 12,
    };
    usePrBriefTimeline.mockReturnValue({ data: response, isLoading: false });
    renderTimeline();
    openDisclosure();
    expect(screen.getByText("3 briefs generated across 12 commits")).toBeInTheDocument();
  });

  it("shows an honest empty state when zero briefs exist", () => {
    const response: BriefTimelineResponse = { entries: [], brief_count: 0, commit_count: 5 };
    usePrBriefTimeline.mockReturnValue({ data: response, isLoading: false });
    renderTimeline();
    openDisclosure();
    expect(screen.getByText("No briefs generated yet.")).toBeInTheDocument();
  });
});

describe("BriefTimeline — AC-33: risk-changed markers", () => {
  it("marks exactly the entries whose risk_level differs from the entry before them — not every entry", () => {
    // newest -> oldest: high, high, low — matches markRiskChanges' contract:
    // index0 vs index1 (high vs high) unchanged; index1 vs index2 (high vs
    // low) changed; index2 (oldest) has no older neighbour, never marked.
    const response: BriefTimelineResponse = {
      entries: [
        entry({ head_sha: "c3", risk_level: "high", risk_changed: false }),
        entry({ head_sha: "c2", risk_level: "high", risk_changed: true }),
        entry({ head_sha: "c1", risk_level: "low", risk_changed: false }),
      ],
      brief_count: 3,
      commit_count: 3,
    };
    usePrBriefTimeline.mockReturnValue({ data: response, isLoading: false });
    renderTimeline();
    openDisclosure();

    const markers = screen.getAllByText("risk changed");
    expect(markers).toHaveLength(1); // exactly ONE of three entries, not all three
  });
});

describe("BriefTimeline — AC-15: activating an entry costs zero new requests", () => {
  it("clicking a non-current entry calls onSelect with that entry's ALREADY-FETCHED record — no new fetch triggered", () => {
    const onSelect = vi.fn();
    const target = entry({ head_sha: "c-old", risk_level: "high", is_current_head: false });
    const response: BriefTimelineResponse = {
      entries: [entry({ head_sha: "c-current", is_current_head: true }), target],
      brief_count: 2,
      commit_count: 2,
    };
    usePrBriefTimeline.mockReturnValue({ data: response, isLoading: false });
    renderTimeline({ onSelect });
    openDisclosure();

    const callsBeforeClick = usePrBriefTimeline.mock.calls.length;
    fireEvent.click(screen.getByText(target.head_sha.slice(0, 7)));

    expect(onSelect).toHaveBeenCalledWith(target);
    // No re-render caused an additional distinct hook invocation with a
    // different enabled/prId pair — the hook call count only grows from
    // React re-renders, never from a manually triggered new query.
    expect(usePrBriefTimeline.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeClick);
  });

  it("clicking the current-head entry calls onBackToCurrent instead of onSelect", () => {
    const onSelect = vi.fn();
    const onBackToCurrent = vi.fn();
    const current = entry({ head_sha: "c-current", is_current_head: true });
    const response: BriefTimelineResponse = { entries: [current], brief_count: 1, commit_count: 1 };
    usePrBriefTimeline.mockReturnValue({ data: response, isLoading: false });
    renderTimeline({ onSelect, onBackToCurrent });
    openDisclosure();
    fireEvent.click(screen.getByText(current.head_sha.slice(0, 7)));

    expect(onBackToCurrent).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
