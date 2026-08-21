/**
 * useShellCommands — live NAV ↔ shell.json i18n regression (Phase D fix-loop
 * required-fix 1).
 *
 * `nav.test.ts` already pins the STATIC contract (every `NAV` item key has a
 * matching `messages/en/shell.json` `nav.<key>` entry), but that check alone
 * would have passed the exact bug that shipped: a stale singular `nav.eval`
 * key next to a plural `"evals"` NAV item key. This file instead renders the
 * REAL hook against the REAL `next-intl` `t()` call and the REAL
 * `messages/en/shell.json` file (no mocked messages, no mocked `NAV`), the
 * same runtime path `next build`'s static generation hit as
 * `MISSING_MESSAGE: shell.nav.evals (en)`. If the coupling regresses again,
 * this test fails with the actual `next-intl` error, not a lookup diff.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { NAV } from "@devdigest/ui";
import shellMessages from "../../../../messages/en/shell.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1" }),
}));
vi.mock("../../../lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggle: vi.fn() }),
}));

import { useShellCommands } from "./useShellCommands";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("useShellCommands — every NAV item resolves a REAL, non-empty 'Go to <label>' command", () => {
  it("builds one command per NAV item with a real translated label (no MISSING_MESSAGE, no blank interpolation)", () => {
    const { result } = renderHook(() => useShellCommands(), { wrapper });

    const navItemCount = NAV.flatMap((g) => g.items).length;
    // +2: the Settings command and the theme-toggle command (see useShellCommands.ts).
    expect(result.current.length).toBe(navItemCount + 2);

    for (const item of NAV.flatMap((g) => g.items)) {
      const cmd = result.current.find((c) => c.id === item.key)!;
      expect(cmd, `no command built for NAV item key "${item.key}"`).toBeDefined();
      expect(cmd.label.startsWith("Go to ")).toBe(true);
      // The regression this guards: a missing shell.json key renders as a
      // literal empty interpolation ("Go to " with nothing after it).
      expect(cmd.label).not.toBe("Go to ");
      expect(cmd.label.trim()).not.toBe("Go to");
    }
  });

  it("the evals NAV item specifically resolves to 'Go to Eval Dashboard' (the exact fix required by this fix-loop)", () => {
    const { result } = renderHook(() => useShellCommands(), { wrapper });
    const evalsCmd = result.current.find((c) => c.id === "evals");
    expect(evalsCmd?.label).toBe("Go to Eval Dashboard");
  });
});
