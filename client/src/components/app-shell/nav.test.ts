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
import { NAV, resolveHref, SHORTCUTS } from "@devdigest/ui";
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

/**
 * NAV registry — the Eval Dashboard entry (L06 WI13/AC-36).
 *
 * Oracle (derived from docs/plans/eval-pipeline.md WI13 BEFORE reading
 * `client/src/vendor/ui/nav.ts`): "AC-36 requires the sidebar entry ... Add
 * `{ key: "evals", label: "Eval Dashboard", icon: "Gauge", href: "/evals",
 * gKey: "e" }` to the SKILLS LAB group ... plus the matching SHORTCUTS
 * entry (`g e` is currently unused)." `nav.ts` is do-not-touch
 * (`client/src/vendor/ui/**`), so — same discipline as the onboarding-tour
 * block above — this only imports it through the `@devdigest/ui` barrel.
 */
describe("NAV registry — evals entry (AC-36)", () => {
  it("exists exactly once, in the SKILLS LAB group, with a plain (non-templated) /evals href", () => {
    const skillsLab = NAV.find((g) => g.section === "SKILLS LAB");
    expect(skillsLab).toBeDefined();
    const matches = skillsLab!.items.filter((i) => i.key === "evals");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.href).toBe("/evals");
    expect(matches[0]!.label).toBe("Eval Dashboard");
  });

  it("is NOT present in any other group", () => {
    const nonSkillsLab = NAV.filter((g) => g.section !== "SKILLS LAB");
    for (const group of nonSkillsLab) {
      expect(group.items.some((i) => i.key === "evals")).toBe(false);
    }
  });

  it("has a matching 'g e' entry in the SHORTCUTS registry", () => {
    expect(SHORTCUTS.some((s) => s.keys === "g e" && s.group === "Navigation")).toBe(true);
  });

  it("activeKeyFor highlights this entry when on /evals", () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === "evals")!;
    expect(activeKeyFor(resolveHref(item.href, "repo-1"))).toBe(item.key);
  });
});
