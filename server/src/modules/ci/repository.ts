/**
 * CI module data-access port. Interface + plain types only — no Drizzle
 * imports (mirrors `modules/blast/repository.ts`, `modules/eval/repository.ts`).
 * `repository.drizzle.ts` is the only file in this module that touches
 * `db/schema`.
 *
 * Phase B (this commit) only needs the module wired into the DI container so
 * `service.ts` compiles and `routes.ts` can construct `CiService` — the
 * Preview path (WI11) makes ZERO repository calls (AC-2: no
 * `ci_installations` row, no read, no write). The real CRUD methods
 * (installation upsert/list/delete, CI run insert/list — WI12, Phase C) are
 * deliberately not guessed at here; adding them now, ahead of the Install/
 * ingest work that actually needs them, risks shaping the port around a
 * guess rather than the real call sites.
 */
export interface CiRepository {}
