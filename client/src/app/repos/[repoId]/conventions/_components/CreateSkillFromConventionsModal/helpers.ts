import type { ConventionCandidate } from "@devdigest/shared";

/** Merge accepted candidates into one skill body, grouped by category. */
export function buildDraftSkillBody(candidates: ConventionCandidate[]): string {
  const sections = candidates.map((candidate) => {
    const heading = candidate.category?.trim() || "Convention";
    return [
      `## ${heading}`,
      candidate.rule,
      "",
      `Detected in \`${candidate.evidence_path}\`:`,
      "```",
      candidate.evidence_snippet,
      "```",
    ].join("\n");
  });
  return ["# Repo conventions", "", sections.join("\n\n")].join("\n");
}

export function buildDraftSkillName(repoName: string): string {
  const slug = repoName
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "repo"}-conventions`;
}
