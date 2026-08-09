# References

## Origin / theory

- [Jeffrey Palermo — The Onion Architecture: part 1 (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) —
  the original article; coins the dependency rule ("all code can depend on
  layers more central, but code cannot depend on layers further out") and
  "the database is not the center, it is external."
- [Jeffrey Palermo — onion-architecture tag (full series)](https://jeffreypalermo.com/tag/onion-architecture/)
- [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) —
  clear layer breakdown; argues repository **interfaces** belong in the
  application layer, not the domain (the domain has only entities/value
  objects).
- [Herberto Graça — DDD, Hexagonal, Onion, Clean, CQRS... how I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) —
  how the patterns relate; useful for explaining to teammates why "onion"
  and "ports & adapters" are the same shape with different vocabulary.
- [Clean vs Onion vs Hexagonal — practical guide](https://medium.com/@rup.singh88/stop-confusing-clean-onion-hexagonal-architecture-heres-when-to-use-each-692079e56267) —
  short comparison; "onion strongly protects the domain, hexagonal makes
  external dependencies fully swappable" (this skill leans onion: protect the
  domain first, swappability is a side effect, not the goal).
- [Hexagonal architecture — Wikipedia](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)) —
  background on ports & adapters terminology used throughout this skill.

## Node.js / TypeScript specific

- [nodebestpractices (goldbergyoni)](https://github.com/goldbergyoni/nodebestpractices) —
  general Node.js architecture guidance, component/layer separation.
- [Sankhadip Samanta — Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
- [onion-architecture · GitHub topics (TypeScript)](https://github.com/topics/onion-architecture?l=typescript) —
  reference implementations for structural comparison.

## Fastify

- [Effortless File Structure Setup for Node.js Fastify Projects](https://mbebars.medium.com/effortless-file-structure-setup-for-node-js-fastify-projects-481561df51a1)
- [borjatur — Yet another vision of Clean Architecture (Fastify + Mongo template)](https://borjatur.com/2023/03/07/yet-another-vision-of-clean-architecture/) —
  core layer (entities/use-cases) vs. infrastructure layer (Fastify
  controllers/routes/plugins) split.

## Drizzle / repository pattern

- [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) —
  abstracting Drizzle behind a repository interface.
- [Hexagonal Architecture (Ports and Adapters) — Complete Guide with TypeScript Example (2026)](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide) —
  worked TypeScript example of a persistence port + adapter swap.

## Enforcement tooling

- [dependency-cruiser (docs)](https://github.com/sverweij/dependency-cruiser) —
  the tool this skill's `enforcement.md` config is built on; already a
  `server` dependency in this repo (used for the repo-intel dep-graph
  feature), reused here as an architecture-boundary check.
- [eslint-plugin-boundaries (npm)](https://www.npmjs.com/package/eslint-plugin-boundaries) —
  considered as an alternative; not used because this repo has no ESLint
  config in any package and dependency-cruiser needed no new dependency.
- [Taking Frontend Architecture Serious With Dependency-cruiser (Xebia)](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [Avoid Cross Module Dependencies with Dependency Cruiser (dev.to)](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b) —
  pattern for `forbidden` rules matching layer-crossing imports, the basis
  for `server/.dependency-cruiser.cjs`.
