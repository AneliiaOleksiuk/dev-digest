/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Multi-agent batch review (L07, SPEC-04).
 */

/** p-queue concurrency for fanning out one `executeRuns` call per agent
 *  (OQ-4 default) — NOT a cap on how many agents a batch may contain. */
export const MULTI_AGENT_CONCURRENCY = 3;

/** Defensive upper bound on `POST /pulls/:id/multi-agent-run`'s `agent_ids`
 *  array length, enforced at the route's zod schema (before the handler
 *  runs) — a DoS/sanity cap, independent of OQ-4's real business rule ("max
 *  agents per batch = workspace's agent count"), which `MultiAgentService`
 *  enforces by verifying every id resolves to a real agent in the caller's
 *  workspace (a batch literally cannot contain more agents than exist). */
export const MAX_MULTI_AGENT_BATCH_SIZE = 50;
