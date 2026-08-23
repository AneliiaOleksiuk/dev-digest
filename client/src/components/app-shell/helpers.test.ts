/**
 * app-shell/helpers.ts — `activeKeyFor` nav-collision unit tests.
 *
 * Oracle (derived BEFORE reading helpers.ts): Development Plan
 * Recommendation 5 / E-17 / AC-37 — "the pre-existing `activeKeyFor` already
 * routes `/onboarding` to the tour's nav key ... the moment a nav item with
 * key `onboarding-tour` exists, the add-repo screen at `/onboarding` will
 * highlight the Onboarding Tour sidebar item ... WI10 must fix the predicate
 * (exact `/onboarding` → no tour key) as part of the nav work, not leave it."
 */
import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor — E-17/AC-37 nav-collision fix", () => {
  it("the top-level add-repo route `/onboarding` (exact) does NOT resolve to the tour's nav key", () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
  });

  it("the repo-scoped tour route `/repos/:repoId/onboarding` DOES resolve to the tour's nav key", () => {
    expect(activeKeyFor("/repos/repo-1/onboarding")).toBe("onboarding-tour");
  });

  it("a sub-path of the add-repo route still does not collide with the tour key", () => {
    expect(activeKeyFor("/onboarding/step-2")).not.toBe("onboarding-tour");
  });

  // Sanity checks that the fix didn't regress the other pathname routes.
  it("other repo-scoped routes are unaffected", () => {
    expect(activeKeyFor("/repos/repo-1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/repo-1/context")).toBe("context");
    expect(activeKeyFor("/repos/repo-1/conventions")).toBe("conventions");
  });

  it("an unrecognized pathname resolves to no active key", () => {
    expect(activeKeyFor("/some/other/route")).toBe("");
  });
});

/**
 * L06 WI13 — "What was built" records `app-shell/helpers.ts` fixing an
 * `activeKeyFor` nav-highlight bug: the predicate compared against the
 * singular "eval", which never matches `nav.ts`'s NAV item key "evals"
 * (plural), leaving the sidebar entry permanently unhighlighted. Oracle:
 * AC-36 requires the entry ("component test on the nav registry"); a
 * registry entry that never highlights when its own route is active is a
 * regression this dedicated case exists to catch even if `nav.test.ts`'s
 * registry-shape assertions pass.
 */
describe("activeKeyFor — L06/AC-36 evals nav-highlight", () => {
  it("/evals resolves to the 'evals' key (matching nav.ts's item key exactly, not 'eval')", () => {
    expect(activeKeyFor("/evals")).toBe("evals");
  });

  it("a sub-path of /evals still resolves to the 'evals' key", () => {
    expect(activeKeyFor("/evals?agent=ag1")).toBe("evals");
  });
});
