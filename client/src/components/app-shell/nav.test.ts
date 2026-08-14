/**
 * NAV registry — the Onboarding Tour entry (WI10/FIX-7 W10).
 *
 * Oracle (derived from docs/plans/spec-02-onboarding-generator.md WI10 BEFORE
 * reading `client/src/vendor/ui/nav.ts`): "Add the item to `NAV`'s
 * **`WORKSPACE`** group ... with an `:repoId`-templated `href:
 * "/repos/:repoId/onboarding"`" and its Definition of done: "a component test
 * exists on the nav registry (key `onboarding-tour`, `WORKSPACE` group,
 * `:repoId` href, no collision with `/onboarding`)". `nav.ts` itself is
 * do-not-touch (`client/src/vendor/ui/**`, root `AGENTS.md`), so this test
 * imports it only through the `@devdigest/ui` barrel every real caller uses
 * (`useShellCommands.ts`, `Sidebar.tsx`) — it never touches the vendor file.
 *
 * FIX-7 W10 explicitly calls out that, before this file, only `activeKeyFor`
 * (a DERIVED helper) was tested — never the `NAV` array itself, which is the
 * actual source of truth the sidebar renders from.
 */
import { describe, it, expect } from "vitest";
import { NAV, resolveHref } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

describe("NAV registry — onboarding-tour entry", () => {
  it("exists exactly once, in the WORKSPACE group", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspace).toBeDefined();
    const matches = workspace!.items.filter((i) => i.key === "onboarding-tour");
    expect(matches).toHaveLength(1);
  });

  it("is NOT present in any other group (e.g. SKILLS LAB)", () => {
    const nonWorkspace = NAV.filter((g) => g.section !== "WORKSPACE");
    for (const group of nonWorkspace) {
      expect(group.items.some((i) => i.key === "onboarding-tour")).toBe(false);
    }
  });

  it("has an :repoId-templated href that resolves to the repo-scoped route", () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === "onboarding-tour")!;
    expect(item.href).toContain(":repoId");
    expect(resolveHref(item.href, "repo-1")).toBe("/repos/repo-1/onboarding");
  });

  it("does NOT collide with the top-level add-repo route /onboarding — activeKeyFor keeps them distinct", () => {
    // Same fix (Recommendation 5, E-17, AC-37) `helpers.test.ts` already
    // covers for `activeKeyFor` in isolation; re-asserted here against the
    // REAL NAV entry to prove the registry and the predicate agree.
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === "onboarding-tour")!;
    expect(activeKeyFor("/onboarding")).not.toBe(item.key);
    expect(activeKeyFor(resolveHref(item.href, "repo-1"))).toBe(item.key);
  });
});
