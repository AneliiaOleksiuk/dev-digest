# React Project Structure — References and Sources

Sources used to build this skill, organized by category. Kept from the
research pass that preceded this skill so rules can be traced back to their
rationale.

---

## Official Documentation

- **Getting Started: Project Structure — Next.js**: https://nextjs.org/docs/app/getting-started/project-structure
  Official page (Next.js 16, updated 2026-07-22). Private folders (`_folder`),
  route groups (`(group)`), colocation inside `app/`, three example
  strategies for file placement. Explicitly unopinionated — "choose a
  strategy and be consistent."
- **Understanding Your UI as a Tree — react.dev**: https://react.dev/learn/understanding-your-ui-as-a-tree
  Official React docs; component-tree mental model underlying the
  colocation/promotion rules in this skill.
- **Routing: Project Organization (colocation) — Next.js 13 docs**: https://nextjs.org/docs/13/app/building-your-application/routing/colocation
  Older but more detailed colocation-specific wording, kept for reference.
- **Data Fetching Patterns and Best Practices — Next.js 14 docs**: https://nextjs.org/docs/14/app/building-your-application/data-fetching/patterns
  Fetch-placement and waterfall-avoidance patterns; boundary with
  `next-best-practices`' own data-patterns.md.

## Next.js Server/Client Components & Performance

- **Next.js 16 Server Components: Performance Best Practices**: https://www.c-sharpcorner.com/article/next-js-16-server-components-performance-best-practices/
- **Next.js Client Components Best Practices**: https://www.javascriptdoctor.blog/2026/07/nextjs-client-components-best-practices.html
- **Next.js Performance Optimization: The 2026 Complete Guide**: https://dev.to/bean_bean/nextjs-performance-optimization-the-2026-complete-guide-1a9k
- **Server Components vs. Client Components: Best Practices**: https://medium.com/@jigsz6391/next-js-server-components-vs-client-components-best-practices-2e735f4ad27c

## Feature-Based & Alternative Methodologies

- **bulletproof-react — project-structure.md**: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
  Reference feature-first structure (`src/features/<feature>/{api,components,hooks,stores,types,utils,index.ts}`);
  closest published match to this skill's colocation model.
- **bulletproof-react — project-standards.md**: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
- **bulletproof-react repo**: https://github.com/alan2207/bulletproof-react
- **Feature-Sliced Design — Overview**: https://feature-sliced.design/docs/get-started/overview
- **Feature-Sliced Design — Layers reference**: https://feature-sliced.design/docs/reference/layers
  Source for the "shared layer has no dependencies on other layers,
  dependencies flow one direction" rule generalized in this skill's
  "Shared Contracts & Vendor Boundaries" section.
- **Feature-Sliced Design — Tutorial**: https://feature-sliced.design/docs/get-started/tutorial
- **Atomic Design Methodology — Brad Frost, Chapter 2**: https://atomicdesign.bradfrost.com/chapter-2/
  Source for the atoms/molecules/organisms vocabulary, scoped in this skill
  to UI-kit primitives only, not feature components.

## Authority Blogs on Structure & Colocation

- **Colocation — Kent C. Dodds**: https://kentcdodds.com/blog/colocation
  Core principle: "place code as close to where it's relevant as possible" —
  the basis for this skill's feature-first default.
- **State Colocation will make your React app faster — Kent C. Dodds**: https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
- **React Folder Structure Best Practices [2026] — Robin Wieruch**: https://www.robinwieruch.de/react-folder-structure/
  Source for the "don't over-structure early" progressive-growth rule
  (start with `components/`, `hooks/`, `utils/`; add layers only under real
  pain).
- **Delightful React File/Directory Structure — Josh W. Comeau**: https://www.joshwcomeau.com/react/file-structure/
  Source for the per-component folder split (`Name.tsx` + `index.ts` barrel
  + colocated helpers/constants) and the helpers-vs-utils distinction
  (project-specific vs. generic/reusable).
- **Practical React Query — TkDodo**: https://tkdodo.eu/blog/practical-react-query
  Source for centralizing query hooks in one layer with unexported,
  colocated query keys/fetchers and the hook as the only public surface.

## Utils vs. Helpers vs. Services vs. Business Logic

- **Business vs. Application Logic: How to Separate and Test Your ReactJS Code — Antony Leme**: https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1
  Primary source for this skill's core distinction: business logic
  (conditionals/calculations/validation/API shaping) → pure functions;
  application logic (hooks, state, effects) → custom hooks; UI → components.
- **Services vs. Utils: What is the difference?**: https://dev.to/moshfiqrony/services-vs-utils-what-is-the-difference-between-services-and-utils-5fh6
- **React Custom Hooks vs. Helper Functions — When to Use Both**: https://medium.com/@priyankadaida/react-custom-hooks-vs-helper-functions-when-to-use-both-e40167325479

## Style/Lint Conventions

- **Airbnb React/JSX Style Guide (GitHub)**: https://github.com/airbnb/javascript/tree/master/react
  Source for "one component per file" (`react/no-multi-comp`).
- **Airbnb React/JSX Style Guide (official site)**: https://javascript.airbnb.tech/react/

---

*Compiled during the research pass preceding this skill's authoring, 2026-08-01.*
