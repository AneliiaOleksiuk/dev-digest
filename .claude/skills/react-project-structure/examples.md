# React Project Structure — Examples

Good/bad patterns for each rule in [SKILL.md](SKILL.md).

---

## Feature-First vs. Type-First

```
BAD (type-first, scattered across an unrelated feature)
src/
  components/PullRequestRow.tsx
  components/FindingsPreview.tsx
  hooks/usePullRequestRow.ts
  hooks/useFindingsPreview.ts
  utils/pullRequestRowHelpers.ts
  utils/findingsPreviewHelpers.ts

GOOD (feature-first, colocated)
src/app/repos/[repoId]/pulls/
  _components/PRRow/
    PRRow.tsx
    helpers.ts
    constants.ts
    index.ts
    _components/FindingsPreview/
      FindingsPreview.tsx
      helpers.ts
      index.ts
```

Nothing here is shared yet, so nothing lives outside the feature that owns
it.

---

## Promoting to Shared Only on Second Use

```
BAD: created shared/ for a component with one consumer
src/components/severity-badge-button/   // only PRRow uses this

GOOD: colocated until a second consumer exists
src/app/repos/[repoId]/pulls/_components/PRRow/_components/SeverityBadgeButton/

// once FindingCard also needs it →
src/components/severity-badge-button/   // now promoted, 2 consumers
```

---

## Utils vs. Helpers vs. Business Logic vs. Hooks

```ts
// BAD: business logic, application logic, and fetching all mixed in a hook
function useFindingsSummary(prId: string) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    fetch(`/api/prs/${prId}/findings`)
      .then((r) => r.json())
      .then((findings) => {
        // business logic inlined into the hook
        const bySeverity = findings.reduce((acc, f) => {
          acc[f.severity] = (acc[f.severity] ?? 0) + 1;
          return acc;
        }, {});
        setSummary(bySeverity);
      });
  }, [prId]);
  return summary;
}
```

```ts
// GOOD: business logic extracted to a pure, independently testable function
// helpers.ts (colocated with the feature — feature-specific, not generic)
export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  return findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<Severity, number>);
}
```

```ts
// GOOD: application logic (orchestration + fetching) stays in the hook,
// delegates the actual computation to the pure helper
// lib/hooks/reviews.ts — the one centralized data-fetching layer
export function useFindingsSummary(prId: string) {
  const { data: findings } = useApiQuery(['findings', prId], () => api.getFindings(prId));
  return findings ? countBySeverity(findings) : undefined;
}
```

`countBySeverity` is tested with plain input/output assertions. The hook is
tested (if at all) through `renderHook`, because it's application logic, not
business logic.

---

## Generic Utils vs. Feature-Specific Helpers

```ts
// GOOD: generic, project-agnostic — top-level utils, reusable anywhere
// src/helpers/format.ts
export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

```ts
// GOOD: feature-specific pure logic — colocated helpers.ts, not hoisted
// src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/helpers.ts
export function severityToColor(severity: Severity): string {
  // knows about this feature's severity domain — not reusable elsewhere
  return SEVERITY_COLOR_MAP[severity];
}
```

```ts
// BAD: feature-specific logic dumped into the generic top-level utils file
// src/helpers/format.ts
export function severityToColor(severity: Severity): string { /* ... */ }
// now format.ts has domain knowledge it shouldn't, and every consumer of
// "generic" formatting helpers pulls in feature-specific code
```

---

## Next.js Private Folders for Colocation

```
BAD: route-specific components hoisted to a global folder just to "keep
app/ clean" — but now they're findable only if you already know they exist
src/components/pr-detail-header/
src/components/verdict-banner/
src/app/repos/[repoId]/pulls/[number]/page.tsx

GOOD: colocated in a private folder next to the route that uses them —
still fully organized, but discoverable from the route itself
src/app/repos/[repoId]/pulls/[number]/
  page.tsx
  _components/PrDetailHeader/
  _components/VerdictBanner/
```
