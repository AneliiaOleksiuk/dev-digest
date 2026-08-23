/**
 * Pure functions only — no I/O (the `no-helpers-to-io` dependency-cruiser
 * rule applies). Slugs used here become file paths written into a repository
 * DevDigest does not own (A05 path injection), so every hostile input named
 * below is handled by an explicit branch, not incidentally.
 */

// ---- slugify (AC-14) --------------------------------------------------------

/** Windows reserved device names — blocked as a bare filename regardless of
 *  extension (`con.md` is just as reserved as `con`). */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Deterministic, non-empty fallback for an input that slugifies to nothing
 *  (an all-punctuation name) — never an empty string. */
const SLUG_FALLBACK = 'untitled';

const SLUG_MAX_LENGTH = 48;

/**
 * Lowercase, `[a-z0-9-]` only, collapsed/trimmed dashes, length-capped.
 * Rejects/rewrites rather than passing through:
 *  - a path separator (`/`, `\`) — not in the allowed charset, becomes `-`.
 *  - `..` — `.` is not in the allowed charset either; any run of dots
 *    collapses to `-` and is then trimmed, so no `..` segment can survive.
 *  - a leading dot — same mechanism: a leading `.` becomes a leading `-`,
 *    which the trim step removes.
 *  - a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`,
 *    `LPT1`-`LPT9`) — matched case-insensitively AFTER lowercasing, and
 *    escaped with a `-file` suffix.
 *  - an all-punctuation name — collapses to the empty string, which falls
 *    back to `SLUG_FALLBACK` rather than shipping an empty path segment.
 */
export function slugify(name: string): string {
  const lowered = name.toLowerCase();
  const collapsed = lowered.replace(/[^a-z0-9]+/g, '-');
  const trimmed = collapsed.replace(/^-+|-+$/g, '');
  const capped = trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
  const base = capped.length > 0 ? capped : SLUG_FALLBACK;
  return RESERVED_DEVICE_NAMES.has(base) ? `${base}-file` : base;
}

// ---- disambiguate (AC-15, E-5) ----------------------------------------------

/**
 * Deterministic suffixing for slugs that collide (`Secret Leakage Gate` and
 * `secret-leakage-gate` both slugify to `secret-leakage-gate`, E-5) — stable
 * ordering in, stable suffixes out, so exporting the same agent twice
 * produces the same filenames. The FIRST occurrence of a slug keeps it
 * unsuffixed; every later occurrence gets `-2`, `-3`, …
 */
export function disambiguate(slugs: string[]): string[] {
  const seenCount = new Map<string, number>();
  return slugs.map((slug) => {
    const seen = seenCount.get(slug) ?? 0;
    seenCount.set(slug, seen + 1);
    return seen === 0 ? slug : `${slug}-${seen + 1}`;
  });
}

// ---- deriveNamespace (SPEC-05 AC-1, AC-2) -----------------------------------

/**
 * Derive a per-agent namespace, unique among the namespaces already taken on
 * this repository (SPEC-05 AC-1, AC-2). `slugify(agentName)` inherits every
 * hostile-input guarantee above verbatim (charset, `..`, leading dot,
 * reserved device names, non-empty fallback, length cap) — this function
 * adds only the collision-suffix step.
 *
 * NOT `disambiguate([...taken, slugify(agentName)])` — `disambiguate` counts
 * occurrences WITHIN one list, so `taken = ['sec', 'sec-2']` and a candidate
 * `sec` would yield `sec-2` (the count-based suffix for the second `sec`
 * occurrence), colliding with the ALREADY-TAKEN `sec-2`. This instead
 * increments a numeric suffix until the result is absent from `taken`,
 * reusing `disambiguate`'s `-2`/`-3` suffix SHAPE without reusing its
 * count-within-one-list semantics. `disambiguate` itself is untouched — the
 * skill-slug path depends on its current behavior.
 */
export function deriveNamespace(agentName: string, taken: readonly string[]): string {
  const base = slugify(agentName);
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 2;
  while (takenSet.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ---- parseRepoRef (AC-4) -----------------------------------------------------

/** Exactly two `[A-Za-z0-9._-]+` segments separated by exactly one `/` — a
 *  three-segment path (`owner/name/extra`) cannot match since `/` is not in
 *  either segment's own character class. */
const REPO_REF_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * Strict `owner/name` parse. Every API path, branch name, commit message and
 * file path this module produces derives from the RETURNED value, never from
 * the raw string — refuses (`null`) rather than sanitizing on any hostile
 * shape: extra segments, a `..` in either segment, or a segment starting
 * with `.`.
 */
export function parseRepoRef(repo: string): RepoRef | null {
  const match = REPO_REF_RE.exec(repo);
  if (!match) return null;
  const [, owner, name] = match as unknown as [string, string, string];
  if (owner.includes('..') || name.includes('..')) return null;
  if (owner.startsWith('.') || name.startsWith('.')) return null;
  return { owner, name };
}

// ---- needsModelIdNotice (Q-1) ------------------------------------------------

export interface ModelIdNotice {
  /** The manifest always writes `provider: 'openrouter'` regardless of what
   *  `agents.provider` actually is (D-4) — true when the agent's OWN provider
   *  isn't already openrouter, so the wizard can warn that the model id might
   *  not resolve there unchanged. */
  providerMismatch: boolean;
  /** True when `model` has no `/` — the shape most likely to fail at
   *  OpenRouter (e.g. a bare `gpt-4.1` rather than `openai/gpt-4.1`). */
  bareModelId: boolean;
}

/**
 * Q-1's resolution: warn, never map. No network call, no lookup table, no
 * namespacing heuristic — just the two honest flags above.
 */
export function needsModelIdNotice(provider: string, model: string): ModelIdNotice {
  return {
    providerMismatch: provider !== 'openrouter',
    bareModelId: !model.includes('/'),
  };
}
