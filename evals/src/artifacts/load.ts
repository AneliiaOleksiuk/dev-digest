/**
 * Load a skill / agent artifact from disk as text, to inject as a system prompt. This is what
 * makes skillTask/agentTask measure the artifact's CONTENT in isolation.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, AGENTS_DIR, EVALS_DIR } from "./paths.js";

/**
 * Resolve an agent's .md file: the real `.claude/agents/<name>.md` first, else
 * `evals/agents/<name>/fixtures/<name>.md` — for agents that are eval-only fixtures, never
 * registered as a live subagent (e.g. architecture-reviewer, retired into plan-verifier's Phase 2
 * on 2026-08-07 — see root INSIGHTS.md). Keeps agentTask able to grade a retired persona's content
 * without resurrecting it as a dispatchable agent in the real .claude/agents/ roster.
 */
function resolveAgentFile(agentName: string): string {
  const real = join(AGENTS_DIR, `${agentName}.md`);
  if (existsSync(real)) return real;
  const fixture = join(EVALS_DIR, "agents", agentName, "fixtures", `${agentName}.md`);
  if (existsSync(fixture)) return fixture;
  throw new Error(`agent not found: ${real} (also checked ${fixture})`);
}

function stripFrontmatter(md: string): string {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) return md.slice(end + 4).replace(/^\n+/, "");
  }
  return md;
}

/**
 * SKILL.md plus every *.md under its sub-doc folder(s) — the full payload the harness would
 * assemble. Skills in this repo use two folder names interchangeably for the same purpose
 * (references/ and rules/ — no documented convention picks one), so both are inlined; a real
 * Claude Code session would Read whichever SKILL.md links to regardless of folder name, and
 * skillTask has no tools to do that itself, so this static inline has to cover both.
 */
export function skillContent(skillName: string): string {
  const dir = join(SKILLS_DIR, skillName);
  const skillMd = join(dir, "SKILL.md");
  if (!existsSync(skillMd)) throw new Error(`SKILL.md not found: ${skillMd}`);
  const parts = [readFileSync(skillMd, "utf8")];
  for (const folder of ["references", "rules"]) {
    const dirPath = join(dir, folder);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath).filter((f) => f.endsWith(".md")).sort()) {
      parts.push(`\n\n## ${folder}/${f}\n\n${readFileSync(join(dirPath, f), "utf8")}`);
    }
  }
  return parts.join("\n");
}

/** An agent definition with its frontmatter stripped (the behavioral prompt only). */
export function agentContent(agentName: string): string {
  return stripFrontmatter(readFileSync(resolveAgentFile(agentName), "utf8"));
}

// Tools the eval refuses to hand a subagent: evals run with bypassPermissions against the LIVE
// repo, so a mutating tool could take real actions. An agent that declares these still runs — it
// just runs read-only, which is all an eval ever needs.
const MUTATING_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);
const READONLY_FALLBACK = ["Read", "Grep", "Glob"];

/**
 * The tools an agent DECLARES in its frontmatter (`tools: Read, Glob, Grep`), so the eval can run
 * a tool-using agent the way production does instead of crippling it to content-only. Derived per
 * agent from its own declaration — no per-agent wiring. Returns [] when the agent declares no
 * tools (genuine content-only agent). Mutating tools are stripped for safety; a `*` / "All tools"
 * grant collapses to the read-only fallback rather than handing over Write/Bash on the live repo.
 */
export function agentTools(agentName: string): string[] {
  const md = readFileSync(resolveAgentFile(agentName), "utf8");
  const fmEnd = md.startsWith("---") ? md.indexOf("\n---", 3) : -1;
  const frontmatter = fmEnd !== -1 ? md.slice(0, fmEnd) : "";
  const line = frontmatter.match(/^tools:\s*(.+)$/m);
  if (!line) return [];
  const raw = line[1].trim();
  if (raw === "*" || /all tools/i.test(raw)) return [...READONLY_FALLBACK];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !MUTATING_TOOLS.has(t));
}
