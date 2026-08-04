# client — `@devdigest/web`

Next.js 15 studio: import repos, browse PRs, run/read AI reviews, author
agents. See [README.md](README.md) for the UI route map.

**Before starting work:** read [INSIGHTS.md](INSIGHTS.md) — treat its
entries as high-confidence guidance unless this file says otherwise.

**Stack:** next 15.1 (App Router), react 19, `@tanstack/react-query` 5.62,
`next-intl` 3.26, tailwindcss 4, `recharts`, `mermaid` 11.15,
`react-markdown` 9 + `remark-gfm`, vitest 2.1 + jsdom + RTL.

**Commands:** `pnpm dev` (`:3000`) · `build` · `start` · `typecheck` · `test`.

## Map

- `src/app/**/page.tsx` — routes (`/`, `/repos/:repoId/pulls`,
  `/pulls/:number`, `/agents`, `/agents/:id`, `/settings/:section`,
  `/onboarding`).
- `src/components/app-shell` — nav, breadcrumbs, `g`-then-key shortcuts.
- `src/lib/hooks/*` — every data hook (wraps `src/lib/api.ts`); pages/feature
  components never call `fetch` directly.
- `src/vendor/ui` (`@devdigest/ui`) — vendored design system, own
  [README](src/vendor/ui/README.md).
- `src/vendor/shared` (`@devdigest/shared`) — vendored Zod contracts.
- `src/i18n/request.ts` — next-intl config; messages in
  `messages/<locale>/*.json`.

## Non-default conventions

- Import UI **only** from the `@devdigest/ui` barrel — never reach into a
  `src/vendor/ui/<layer>/*` file directly.
- All data fetching goes through `src/lib/hooks/*`, never ad hoc `fetch` in
  components.
- `react-markdown` usage is centralized in
  `src/vendor/ui/primitives/Markdown.tsx` — don't add a second instance
  elsewhere.
- Feature logic lives in colocated `_components/<Name>/` folders next to the
  page that uses it, each with its own `*.test.tsx`; pages stay thin.

## Gotchas

- Mermaid must be validated with `mermaid.parse(src, {suppressErrors:true})`
  **before** rendering (`components/mermaid-diagram/MermaidDiagram.tsx`) —
  otherwise a bad diagram string renders as an injected error SVG instead of
  throwing.
- `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001`
  (`src/lib/api.ts`).
- `src/test/smoke.test.tsx` mounts the `/showcase` route, which renders every
  vendored UI component — it fails CI if any component's export or render
  breaks, even ones unrelated to your change.

## Do-not-touch

- `src/vendor/ui/**`, `src/vendor/shared/**` — hand-mirrored, no sync script.

## Docs

- [README.md](README.md) — UI route map.
- [src/vendor/ui/README.md](src/vendor/ui/README.md) — design-system layers
  and theming; read before touching anything under `src/vendor/ui`.
- [TESTING.md](../TESTING.md) — test strategy.
- [INSIGHTS.md](INSIGHTS.md) — the "why" behind the decisions above.

**Before ending a session:** update INSIGHTS.md with anything non-obvious
you learned — don't skip this step (`engineering-insights` skill).
