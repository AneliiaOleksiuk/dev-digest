/**
 * Deterministic one-line summary from an imported unified-diff patch.
 * Uses the first added lines — no LLM. Returns null when there's nothing useful.
 */
export function summaryFromPatch(patch: string | null | undefined, maxLen = 160): string | null {
  if (!patch) return null;
  const snippets: string[] = [];
  for (const raw of patch.split("\n")) {
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    const text = raw.slice(1).trim();
    if (!text || text === "{" || text === "}" || text === "};") continue;
    snippets.push(text.replace(/\s+/g, " "));
    if (snippets.length >= 3) break;
  }
  if (snippets.length === 0) return null;
  const joined = snippets.join(" · ");
  return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
}
