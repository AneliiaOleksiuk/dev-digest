/**
 * brief.ts hook-level regression test (SPEC-03, plan-verifier required-fix
 * item 2). Deliberately NOT colocated with PrBriefCard.test.tsx's
 * one-mock-per-file convention (which mocks `@/lib/hooks/brief` itself) —
 * this file exercises the REAL hooks against a REAL `QueryClient`, mocking
 * only the API transport (`../api`), so the query-cache side effects of
 * `useGeneratePrBrief`'s `onSuccess` are actually observed rather than
 * assumed.
 *
 * Oracle (derived from the plan/contract, not from reading `onSuccess`'s
 * current implementation):
 *   - `BriefState` docs (`review-api.ts`): `'budget_exceeded'`/`'failed'` are
 *     TRANSIENT GENERATE-ONLY outcomes that persist nothing server-side.
 *     AC-42 requires a failed attempt to "leave any prior row untouched".
 *     A client cache write that overwrites `["pr-brief", prId]` with
 *     `record: null` for these two states silently erases a good,
 *     previously-persisted brief for any consumer reading `usePrBrief()`
 *     fresh from the cache — that is the regression this file guards.
 *   - A genuine `state: "current"` generate response is a real, persisted
 *     outcome and MUST update the `["pr-brief", prId]` cache, and MUST
 *     invalidate `["pr-brief-timeline", prId]` (pre-existing, already-
 *     correct behavior — kept here as a contrast/control case so a fix that
 *     over-corrects into "generate never updates the cache" would also be
 *     caught).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { BriefRecord, BriefResponse } from "@/lib/types";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { useGeneratePrBrief } from "./brief";

afterEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

function record(overrides: Partial<BriefRecord> = {}): BriefRecord {
  return {
    what: "Adds rate limiting middleware to the public API.",
    why: "Protects the API from abuse per the linked issue.",
    risk_level: "medium",
    risks: [],
    review_focus: [],
    pr_id: "pr-1",
    head_sha: "sha-current-1234567",
    generated_at: "2026-08-01T00:00:00.000Z",
    input_status: {
      intent_status: "used",
      blast_status: "full",
      changed_file_count: 1,
      spec_files_used: [],
      spec_files_unresolved: [],
      linked_issue_status: "not_referenced",
      dropped_inputs: [],
    },
    usage: {
      provider: "openai",
      model: "gpt-4.1",
      input_tokens: 500,
      tokens_in: 400,
      tokens_out: 100,
      cost_usd: 0.02,
      dropped_risk_refs: 0,
      dropped_focus_items: 0,
    },
    ...overrides,
  };
}

function response(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    state: "absent",
    current_head_sha: "sha-current-1234567",
    record: null,
    reused: true,
    reason: null,
    ...overrides,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useGeneratePrBrief — onSuccess cache guard (regression, plan-verifier required-fix item 2)", () => {
  const prId = "pr-1";

  it.each(["budget_exceeded", "failed"] as const)(
    "a %s generate response must NOT overwrite a persisted good pr-brief cache entry",
    async (state) => {
      const qc = makeQueryClient();
      const goodResponse = response({
        state: "current",
        record: record(),
        reused: true,
      });
      qc.setQueryData(["pr-brief", prId], goodResponse);

      apiPost.mockResolvedValue(
        response({
          state,
          record: null,
          reused: false,
          reason: state === "budget_exceeded"
            ? "The composed inputs alone exceed the 8,000-token budget — no call was made and nothing was charged."
            : "The last generation attempt failed. Any previously stored brief for this commit is unchanged.",
        }),
      );

      const { result } = renderHook(() => useGeneratePrBrief(prId), {
        wrapper: wrapperFor(qc),
      });

      act(() => {
        result.current.mutate({ headSha: "sha-current-1234567" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // The regression check: the persisted-read cache entry is UNCHANGED.
      expect(qc.getQueryData(["pr-brief", prId])).toEqual(goodResponse);
    },
  );

  it("a real 'current' generate response DOES update the pr-brief cache and invalidates the timeline (control case)", async () => {
    const qc = makeQueryClient();
    qc.setQueryData(["pr-brief", prId], response({ state: "absent" }));
    qc.setQueryData(["pr-brief-timeline", prId], {
      entries: [],
      brief_count: 0,
      commit_count: 0,
    });

    const newResponse = response({
      state: "current",
      record: record({ head_sha: "sha-new-7654321" }),
      reused: false,
    });
    apiPost.mockResolvedValue(newResponse);

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useGeneratePrBrief(prId), {
      wrapper: wrapperFor(qc),
    });

    act(() => {
      result.current.mutate({ headSha: "sha-new-7654321" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData(["pr-brief", prId])).toEqual(newResponse);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["pr-brief-timeline", prId],
    });
  });
});
