/**
 * Pure markdown parsers for `OnboardingSection.body` — no I/O, no React.
 *
 * The server never sends structured rows for `critical_paths`, `reading_path`,
 * or `run_locally` (only `first_tasks` gets a dedicated `tasks[]` field) — it
 * sends plain markdown (bullet/numbered lists, or a fenced shell block), same
 * shape whether it came from the LLM (`groundBulletItemPaths` /
 * `groundRunLocallyBody` in server/src/modules/onboarding/helpers.ts) or the
 * deterministic skeleton fallback. These parsers recover the per-row
 * structure the design needs directly from that markdown, client-side.
 */

export interface ParsedListItem {
  /** First inline-code (`` `path` ``) token in the item, if any. */
  path: string | null;
  /** Remaining item text with the path token and stray backticks removed. */
  description: string;
}

const BULLET_MARKER_RE = /^\s*(?:[-*]|\d+\.)\s+/;

/** Strips markdown bold/italic markers, keeping their text — descriptions
 *  render as plain text (not through `Markdown`), so `**Server entry**`
 *  must not show its literal asterisks. Deliberately skips single-underscore
 *  emphasis (`_word_`) since this codebase's paths/identifiers are commonly
 *  snake_case (`run_logger.ts`) and a false-positive strip would corrupt them. */
function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

/**
 * Splits a markdown body into its top-level bullet/numbered items (a line
 * belongs to the preceding item until the next top-level marker — same
 * grouping rule as the server's own `capBulletItems`), and pulls the first
 * inline-code span out of each as its `path`.
 */
export function parseListItems(body: string): ParsedListItem[] {
  const lines = body.split("\n");
  const items: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (BULLET_MARKER_RE.test(line)) {
      if (current) items.push(current.join(" ").trim());
      current = [line.replace(BULLET_MARKER_RE, "")];
    } else if (current && line.trim().length > 0) {
      current.push(line.trim());
    }
  }
  if (current) items.push(current.join(" ").trim());

  return items
    .map((text) => {
      const match = text.match(/`([^`\n]+)`/);
      const path = match ? match[1]!.trim() : null;
      const withoutPath = match ? text.replace(match[0]!, "") : text;
      const description = stripMarkdownEmphasis(
        withoutPath
          .replace(/`([^`\n]+)`/g, "$1")
          .replace(/^[\s—–\-:→]+/, "")
          .trim(),
      ).trim();
      return { path, description };
    })
    .filter((item) => item.path !== null || item.description.length > 0);
}

const FENCE_RE = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;

/**
 * Real, copyable shell commands from a `run_locally` body: one entry per
 * surviving fenced-code line (blank/comment-only lines dropped, an inline
 * trailing comment kept verbatim — it's still valid shell). Falls back to
 * reading commands out of a bullet list when no fenced block is present —
 * the deterministic skeleton (`buildSkeletonSections`) never fences its
 * commands, it inlines them as `` - `command` (from `path`) ``.
 */
export function parseRunLocallyCommands(body: string): string[] {
  const commands: string[] = [];
  for (const match of body.matchAll(FENCE_RE)) {
    for (const line of match[1]!.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      commands.push(trimmed);
    }
  }
  if (commands.length > 0) return commands;

  return parseListItems(body)
    .map((item) => item.path)
    .filter((path): path is string => path !== null);
}
