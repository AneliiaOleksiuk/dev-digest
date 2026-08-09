---
name: react-project-structure
description: "Where React/Next.js code should physically live: component placement, folder structure, constants, and the utils/helpers vs. business-logic boundary. Use when creating a new component or feature, deciding where a file belongs, splitting a component into multiple files, or reviewing a project layout for consistency. Complements react-best-practices (component/hook internals) and next-best-practices (routing/RSC file conventions) — this skill governs placement, not component behavior."
---

# React Project Structure

File and folder placement conventions for React/Next.js apps — not component
design (see [react-best-practices](../react-best-practices/SKILL.md)) and not
routing/RSC conventions (see [next-best-practices](../next-best-practices/SKILL.md)).
For code examples, see [examples.md](examples.md). For sources, see
[references.md](references.md).

## Severity Levels

- **CRITICAL** — Wrong placement causes real coupling/testability problems, not just taste
- **HIGH** — Causes friction or duplication as the app grows
- **MEDIUM** — Hurts discoverability or consistency

---

## Feature-First, Not Type-First (CRITICAL)

- Default to colocating everything a feature needs — component, its hook,
  its helpers, its constants, its test — next to where it's used, not
  scattered across parallel `components/`, `hooks/`, `utils/` trees
- In Next.js App Router, colocate route-specific code in a private folder
  (`_components/`, `_lib/`) next to the route segment — the leading
  underscore opts it out of routing, so it's never accidentally a URL
- Promote code to a shared location only once **two or more** features
  need it — a `shared`/`common` folder created before the second consumer
  exists is premature abstraction
- Type-first (`components/`, `hooks/`, `utils/` as top-level siblings) is
  fine for a small app or an early-stage project — don't force feature
  folders before there's more than one feature to separate

## Component File Split (HIGH)

- One component per file; PascalCase component name matches the file name
- For a component complex enough to need it, split into a folder:
  `<Name>.tsx`, `<Name>.test.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`,
  `index.ts` (barrel re-export) — don't create this split for a five-line
  component
- Sub-components used only by one parent nest inside that parent's own
  `_components/`/folder; don't hoist a component to a shared folder just
  because it's in its own file
- Keep barrel (`index.ts`) chains shallow — a barrel re-exporting another
  barrel makes both bundler analysis and "find usages" harder

## Where Components Live (HIGH)

- **Route/feature-specific** → colocated with the route or feature that
  owns it (`_components/`)
- **Cross-route reusable** → a top-level `components/<name>/`, once actually
  reused by 2+ routes
- **Design-system primitives** (buttons, inputs, layout shells) → a
  separate UI-kit layer, imported only through its single barrel — never by
  reaching into the kit's internal files directly
- Atomic Design vocabulary (atoms/molecules/organisms) is a useful naming
  lens *only* inside that UI-kit layer, for visual-composition primitives —
  don't apply it to feature/business components, which are organized by
  what they do, not by visual complexity

## Constants Placement (MEDIUM)

- Constants used by one component/feature → colocated `constants.ts` next
  to it
- Constants used app-wide (design tokens, breakpoints, public config keys)
  → one top-level `constants.ts`
- A magic number or string duplicated across two or more files is a signal
  to hoist it to the nearest constants file that covers all its consumers —
  not necessarily the app-wide one

## Utils vs. Helpers vs. Business Logic (CRITICAL)

This is the boundary most codebases get wrong — three different concerns
get dumped into one `utils/` folder.

- **Business logic** — conditionals, calculations, data transforms,
  validation, API-response shaping. Write it as a **pure function**: same
  input, same output, no React import, no hook. Testable with plain
  `expect(fn(input)).toBe(output)`, no renderer needed.
- **Application logic** — orchestration that's inherently React-shaped:
  wiring state to effects, coordinating multiple business-logic calls,
  exposing loading/error state. This belongs in a **custom hook**, not a
  component body and not a plain util.
- **UI** — JSX and presentation only. A component should call a hook or a
  pure function, never re-implement either inline.
- **Utils** = generic, project-agnostic functions with no domain knowledge
  (date/number/string formatting) — reusable in any codebase, colocated at
  the scope that uses them or top-level `utils/`/`helpers/` if truly
  cross-cutting.
- **Helpers** = project- or feature-specific pure functions — colocated
  `helpers.ts` next to the component/feature that owns them, not promoted
  to a generic `utils/` just because they're pure.
- Rule of thumb: if a function needs `render()`/a hook-testing harness to
  test, it's application logic and belongs in a hook. If it needs neither,
  it's business logic/utils and belongs in a plain function.

## Centralized Data-Fetching Hooks (HIGH)

- All data fetching goes through custom hooks in one layer (e.g.
  `lib/hooks/`), wrapping a single API client module — components and
  feature code never call `fetch`/`axios` directly
- Keep the query key and fetcher function **unexported and colocated**
  inside the hook file that owns them; the hook itself is the only public
  surface other code imports
- This governs *where the client hook layer lives*, not the
  Server-Component-vs-Server-Action-vs-Route-Handler choice — see
  `next-best-practices`' `data-patterns.md` for that decision

## Next.js-Specific Placement (HIGH)

- Private folders (`_folder`) inside `app/` for non-routable colocated
  code; route groups (`(group)`) to share a layout without affecting the
  URL
- Keep `page.tsx`/`layout.tsx` thin — they compose colocated components,
  they don't contain feature logic themselves
- Deeper RSC boundary rules, async `params`/`cookies()` patterns, and
  route-handler conventions live in `next-best-practices` — don't duplicate
  them here, only the folder placement matters in this skill

## Shared Contracts & Vendor Boundaries (MEDIUM)

- Cross-cutting types/schemas that mirror an external or backend contract
  belong in one clearly marked shared/vendor layer — never re-declared ad
  hoc in the files that consume them
- That shared layer should have no dependencies pointing back into
  feature code — dependencies flow one direction, from features toward
  shared, never the reverse
- Import cross-cutting UI/contracts only through that layer's single
  barrel; reaching into its internal files directly defeats the boundary

## Don't Over-Structure Early (MEDIUM)

- Don't introduce a `features/` tree, a layered architecture, or a
  `services/` folder for an app that doesn't need it yet — start with
  `components/`, `hooks/`, and `utils/` (or `lib/`) and let real pain
  (duplication, merge conflicts, "where does this go" hesitation) justify
  the next layer
- Re-evaluate structure per feature as it grows, not on a fixed schedule —
  a structure decision made for the whole app up front tends to be wrong
  for at least half the features that come later
