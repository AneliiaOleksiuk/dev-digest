/**
 * DiffViewer — plain (original-order) unified-diff viewer, extended by
 * SPEC-03 WI13 with a `focus` prop for the review-focus deep-link (AC-30).
 * Oracle derived from the Spec/Plan BEFORE this component was opened for
 * wiring facts:
 *   - AC-30/E-22: activating a review-focus entry must land on the correct
 *     `path:line` target in the ORIGINAL-order viewer too (SmartDiffViewer
 *     already had a jump mechanism; DiffViewer did not).
 *   - WI13 DoD (the shared-component regression risk): unfocused files must
 *     retain their default `AUTO_EXPAND_MAX_LINES` auto-expand behaviour,
 *     UNCHANGED by the new focus-overlay mechanism — DiffViewer is used
 *     outside this feature too, so a focus prop must never become a hidden
 *     "controlled mode for everyone" regression.
 *   - Nothing scrolls/errors when the referenced path isn't present in
 *     `files` — a safe no-op.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import shellMessages from "../../../../messages/en/shell.json";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { DiffViewer } from "./DiffViewer";

afterEach(cleanup);

/** A patch whose (additions+deletions) exceeds AUTO_EXPAND_MAX_LINES, so the
 *  file is COLLAPSED by default (FileCard's own uncontrolled-open rule). */
function bigPatch(path: string): PrFile {
  const lines = Array.from({ length: AUTO_EXPAND_MAX_LINES + 20 }, (_, i) => `+line ${i}`).join("\n");
  return {
    path,
    additions: AUTO_EXPAND_MAX_LINES + 20,
    deletions: 0,
    patch: `@@ -1,0 +1,${AUTO_EXPAND_MAX_LINES + 20} @@\n${lines}`,
  };
}

/** A small patch that auto-expands by default. */
function smallPatch(path: string): PrFile {
  return { path, additions: 1, deletions: 0, patch: "@@ -1,0 +1,1 @@\n+hello" };
}

function renderViewer(files: PrFile[], focus?: { path: string; line: number } | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <DiffViewer files={files} focus={focus} />
    </NextIntlClientProvider>,
  );
}

describe("DiffViewer — baseline auto-expand (no focus prop)", () => {
  it("a small file (under AUTO_EXPAND_MAX_LINES) is expanded by default", () => {
    renderViewer([smallPatch("src/small.ts")]);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("a large file (over AUTO_EXPAND_MAX_LINES) is COLLAPSED by default", () => {
    renderViewer([bigPatch("src/huge.ts")]);
    expect(screen.queryByText("line 0")).not.toBeInTheDocument();
  });
});

describe("DiffViewer — AC-30/WI13: focus prop expand-then-scroll", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("forces the focused (large, normally-collapsed) file open and scrolls to its data-diff-line anchor", async () => {
    renderViewer([bigPatch("src/huge.ts")], { path: "src/huge.ts", line: 1 });
    // Forced open despite exceeding AUTO_EXPAND_MAX_LINES.
    expect(await screen.findByText("line 0")).toBeInTheDocument();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("WI13 regression guard: a SECOND, unfocused large file is NOT force-opened — its default auto-expand behaviour is unchanged by the focus overlay", () => {
    renderViewer(
      [bigPatch("src/huge-focused.ts"), bigPatch("src/huge-other.ts")],
      { path: "src/huge-focused.ts", line: 1 },
    );
    // Both files render identical body content ("line 0".."line N") when
    // open, so if the unfocused file were WRONGLY force-opened too, "line 0"
    // would appear twice. It must appear exactly once — only the focused
    // file's body is open; the other stays collapsed, its own default.
    expect(screen.getAllByText("line 0")).toHaveLength(1);
    expect(screen.getByText("src/huge-other.ts")).toBeInTheDocument(); // header still renders, body doesn't
  });

  it("a SMALL, unfocused file keeps auto-expanding on its own (unaffected either way by an unrelated focus target)", () => {
    renderViewer(
      [smallPatch("src/small.ts"), bigPatch("src/huge.ts")],
      { path: "src/huge.ts", line: 1 },
    );
    expect(screen.getByText("hello")).toBeInTheDocument(); // small file's own default, untouched
  });

  it("safe no-op: a focus path absent from `files` neither scrolls nor throws", () => {
    expect(() =>
      renderViewer([smallPatch("src/small.ts")], { path: "src/does-not-exist.ts", line: 1 }),
    ).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
