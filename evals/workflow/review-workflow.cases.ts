import { join } from "node:path";
import type { WorkflowCase } from "../src/index.js";
import { REPO_ROOT } from "../src/artifacts/paths.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (AGENTS.md/CLAUDE.md + skills +
 * subagents, loaded via settingSources:["project"]) behaves as documented. Organized by scenario,
 * not by a single artifact, because these behaviors are cross-cutting.
 *
 * `expectFilesRead` targets below point at docs that actually exist on this branch and are already
 * routed to from AGENTS.md prose ("read this before touching X" / "Docs" sections). Earlier versions
 * pointed at server/docs/api-contracts.md, reviewer-core/docs/pipeline.md, reviewer-core/insights/
 * gotchas.md — leftover fixture paths from the old monolithic-CLAUDE.md "## Read When" table
 * (upstream/evals-example, pre-AGENTS.md-split). Those files were never merged into this branch, so
 * every case built on them would fail with "file not found" regardless of routing logic. Re-pointing
 * at real, already-current docs (rather than importing the stale L01 fixtures, which would duplicate/
 * conflict with docs/agent-prompts/README.md and reviewer-core/README.md) keeps the routing check
 * meaningful without adding stale documentation.
 *
 * Budget: 7 Claude sessions total (down from 12 — see the merged root-routing trace below for why
 * activation pairs and contrasts can't be merged the same way).
 *   - 3 × trace              → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative)          = 2
 *   - 1 × contrast (treatment + control)                           = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 * `activation` and `contrast` can NOT be merged the same way: each measures a DIFFERENCE between two
 * conditions (skill fires vs. doesn't; AGENTS.md present vs. absent) — that needs two separate runs
 * to compare, not more assertions piled onto one run. Merging would stop measuring the thing being
 * tested.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): AGENTS.md routing + subagent dispatch, together ------------------------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads server/README.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },

  // --- contrast (2 sessions): does AGENTS.md itself cause the routing, or would any model guess it? ---
  // Same prompt, two conditions: treatment loads the real on-disk AGENTS.md (settingSources:
  // ["project"]); control runs from a freshly created empty tmpdir with no on-disk config at all.
  // The topic (system-prompt assembly) is deliberately specific rather than a generic "gotchas"
  // lookup, so a control session with no repo context has nothing to guess a plausible path from.
  {
    kind: "contrast",
    name: "CLAUDE.md is required for the model to find docs/agent-prompts/README.md",
    prompt:
      "Хочу змінити, як system prompt рев'ю-агента перетворюється на фінальні повідомлення для LLM. " +
      "Перш ніж торкатися коду, звірся з настановами цього репозиторію й прочитай документ, що описує " +
      "цей процес збірки промпту.",
    expectFileRead: "docs/agent-prompts/README.md",
    maxTurns: 6,
  },

  // --- trace (1 session): 5 root-AGENTS.md routing checks + 1 do-not-touch redirect, merged -------
  // These 6 used to be 6 separate sessions (pipeline, gotchas→INSIGHTS.md, PR Brief, Intent Layer,
  // Project Context, do-not-touch) — one session per topic. Merged into one because all 6 share the
  // same shape: root cwd, read-only, no subagent, no contrast — nothing here needs its own session.
  // Each item is numbered and self-contained on purpose: the earlier "pipeline" case's own comment
  // (git history) already found that asserting on TWO docs for ONE vague topic in one session is
  // flaky — the model can satisfice with the first relevant doc it finds. Six SEPARATE numbered asks,
  // each pinned to one doc/behavior, is a different shape: there's no single doc that could satisfy
  // more than one item, so there's nothing to satisfice across. Still coarser than 6 sessions — if
  // this flakes in practice (an item's doc goes unread under turn pressure), split back into 2
  // sessions of 3 rather than reverting to 6.
  {
    kind: "trace",
    name: "root AGENTS.md routing — 5 docs + 1 do-not-touch redirect, one session",
    prompt:
      "У мене є 6 окремих питань про цей репозиторій. Для кожного: спершу звірся з документацією " +
      "репозиторію (AGENTS.md) і прочитай документ, на який вона вказує, ПОТІМ дай коротку відповідь. " +
      "Онови мене про кожен пункт послідовно, не пропускай жодного.\n\n" +
      "1. Я збираюся змінити review pipeline — яку документацію треба прочитати для змін у pipeline?\n" +
      "2. У reviewer-core я стикнувся з несподіваною поведінкою — де це вже могло бути задокументовано?\n" +
      "3. Як PR Brief кешується за head_sha і як він обмежений бюджетом токенів?\n" +
      "4. Я планую змінити, як інтент PR класифікується і зберігається (classify → persist → prompt " +
      "scope) — що варто прочитати?\n" +
      "5. Як влаштований механізм discover → attach → inject для Project Context і як рахується " +
      "coverage?\n" +
      "6. Я хочу відредагувати файл наявної SQL-міграції в server/src/db/migrations напряму, щоб " +
      "виправити помилку в типі колонки. Це нормально за конвенціями репо? Якщо ні — як правильно?",
    expectFilesRead: [
      "docs/agent-prompts/README.md",
      "INSIGHTS.md",
      "docs/features/pr-brief.md",
      "docs/features/intent-layer.md",
      "docs/features/project-context.md",
    ],
    grounding: ["db:generate"],
    maxTurns: 18,
  },

  // --- trace (1 session): nested client/AGENTS.md loads and is followed, when cwd is inside client/ ---
  // Tried as a contrast (cwd=client/ vs cwd=REPO_ROOT) first, twice, and dropped it — same conclusion
  // as the removed gotchas.md contrast above. Attempt 1: control had Grep/Glob and just found the doc
  // by searching. Attempt 2: restricted to Read-only and de-leaked the prompt, but control STILL
  // reached the file via a legitimate doc chain root AGENTS.md already provides — its own docs index
  // lists client/README.md, and client/README.md itself links to src/vendor/ui/README.md. So a
  // control at REPO_ROOT reaches this specific doc through root docs alone; there's no clean negative
  // to assert. What's left, reliably: with cwd inside client/, client/CLAUDE.md (→ client/AGENTS.md)
  // loads and the model follows its "read before touching src/vendor/ui" rule directly.
  //
  // "Це нормально?" alone was answerable straight from client/AGENTS.md's own inline "Non-default
  // conventions" bullet (which already states the barrel-import rule) — the model answered correctly
  // without ever opening src/vendor/ui/README.md, 0 Read calls. Asking specifically for what's ONLY
  // in that doc (layers/theming structure — the exact phrase client/AGENTS.md's Docs entry uses)
  // gives it a reason it can't satisfy from AGENTS.md's body alone.
  {
    kind: "trace",
    name: "cwd=client/ loads client/AGENTS.md, which routes to src/vendor/ui/README.md",
    prompt:
      "Перш ніж додавати новий UI-компонент, хочу зрозуміти структуру шарів (layers) дизайн-системи " +
      "цього пакета і як у ній влаштована тематизація (theming). Звірся з документацією цього пакета " +
      "і прочитай документ, де це описано.",
    expectFilesRead: ["src/vendor/ui/README.md"],
    cwd: join(REPO_ROOT, "client"),
    maxTurns: 6,
  },
];
