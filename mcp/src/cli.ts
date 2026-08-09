#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { parseUnifiedDiff, reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';
import { REVIEW_MODES, MODES, type ReviewMode } from './cli/modes.js';
import { getRepoRoot, runGit, type GitRunner } from './cli/repo.js';
import { loadAgent, InvalidAgentFileError } from './cli/agent.js';
import { resolveLlm, MissingApiKeyError } from './cli/llm.js';
import { renderReport, renderJson } from './cli/report.js';

/**
 * `devdigest review --mode working` — a pre-push CLI that runs the SAME
 * reviewer (`reviewPullRequest` from `@devdigest/reviewer-core`) against the
 * local working tree, with no API server and no database required.
 *
 * This is a SEPARATE, additive entry point from `src/index.ts` (the MCP
 * stdio server) — not reachable over the MCP protocol, and NOT bound by
 * `src/index.ts`'s "stdout is the protocol channel" rule: stdout here is the
 * human-readable report; diagnostics/warnings go to stderr. See
 * `mcp/AGENTS.md` for the documented, deliberate exception this represents
 * (in-process `@devdigest/reviewer-core`, secrets-file read, real LLM calls —
 * all scoped to this file + `cli/*`, never the 5 MCP tools).
 *
 * Exit codes:
 *   0 = the review ran and produced no blocking findings
 *   1 = the review ran and produced >=1 blocking finding (severity >= the
 *       agent's ci_fail_on)
 *   2 = the review could not run (not a git repo, no diff, missing API key,
 *       LLM/network failure, unimplemented mode)
 */

const HELP = `devdigest — DevDigest pre-push review CLI

USAGE
  devdigest review [--mode <mode>] [--agent-file <path.json>] [--json]
  devdigest --help

MODES
  working   (default) review staged + unstaged changes to TRACKED files
            (\`git diff HEAD\`). Untracked files are excluded — see below.
  staged    not implemented yet.
  branch    not implemented yet.

OPTIONS
  --mode <${REVIEW_MODES.join('|')}>   which diff to review (default: working)
  --agent-file <path.json>       override the default review agent; JSON
                                  validated against the AgentManifest schema
                                  (name, provider, model, system_prompt,
                                  skills, strategy, ci_fail_on)
  --json                         print machine-readable JSON instead of the
                                  human-readable report
  --help                         show this help and exit 0

EXIT CODES
  0   review ran, no blocking findings
  1   review ran, >=1 blocking finding (severity >= the agent's ci_fail_on)
  2   could not run (not a git repo, no diff, missing API key, LLM/network
      failure, unimplemented mode)

UNTRACKED FILES
  \`git diff HEAD\` only covers tracked files (staged + unstaged). Untracked
  files (per \`git ls-files --others --exclude-standard\`) are NOT included
  in the review; if any exist, a warning naming them is printed to stderr.

API KEY
  Reads OPENROUTER_API_KEY from ~/.devdigest/secrets.json (stored value wins)
  or falls back to the OPENROUTER_API_KEY environment variable. No API server
  and no database are required to run this command.
`;

export interface RunDeps {
  git?: GitRunner;
  llm?: LLMProvider;
  secretsPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

/**
 * Runs the CLI end to end and returns the process exit code. Pure enough to
 * unit-test: every side effect (git, LLM, secrets file, output) is
 * injectable via `deps`, so `mcp/test/cli-*.test.ts` never touches a real
 * git repo or the network. `main()` below wires the real implementations.
 */
export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(`${s}\n`));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const git = deps.git ?? runGit;

  let values: { mode: string; 'agent-file'?: string; json: boolean; help: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        mode: { type: 'string', default: 'working' },
        'agent-file': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
    values = parsed.values as typeof values;
    positionals = parsed.positionals;
  } catch (err) {
    stderr(`Invalid arguments: ${(err as Error).message}`);
    stderr(HELP);
    return 2;
  }

  if (values.help) {
    stdout(HELP);
    return 0;
  }

  const command = positionals[0];
  if (command !== 'review') {
    stderr(`Unknown command "${command ?? ''}" — expected "review".\n`);
    stderr(HELP);
    return 2;
  }

  const mode = values.mode as ReviewMode;
  if (!REVIEW_MODES.includes(mode)) {
    stderr(`Unknown --mode "${values.mode}" — expected one of: ${REVIEW_MODES.join(', ')}.`);
    return 2;
  }

  // ---- 1. Repo root -------------------------------------------------------
  let repoRoot: string;
  try {
    repoRoot = await getRepoRoot(git);
  } catch (err) {
    stderr(`Not a git repository (or git is not installed): ${(err as Error).message}`);
    return 2;
  }

  // ---- 2. Collect the diff for the requested mode -------------------------
  const collector = MODES[mode];
  const collected = await collector(git, deps.cwd ?? repoRoot);
  if (!collected.ok) {
    stderr(collected.message);
    return 2;
  }
  if (collected.untracked.length > 0) {
    stderr(
      `Warning: ${collected.untracked.length} untracked file(s) are NOT included in this review ` +
        `(\`git diff HEAD\` only covers tracked files):\n` +
        collected.untracked.map((f) => `  - ${f}`).join('\n'),
    );
  }

  // ---- 3. Parse the diff (the SAME parser the server uses, WI11) ----------
  const diff = parseUnifiedDiff(collected.raw);
  if (diff.files.length === 0) {
    stderr('The diff did not parse to any files — nothing to review.');
    return 2;
  }

  // ---- 4. Resolve the agent config -----------------------------------------
  let agent;
  try {
    agent = await loadAgent(values['agent-file']);
  } catch (err) {
    if (err instanceof InvalidAgentFileError) {
      stderr(err.message);
      return 2;
    }
    stderr(`Failed to load agent config: ${(err as Error).message}`);
    return 2;
  }

  // ---- 5. Resolve the LLM provider -----------------------------------------
  let llm: LLMProvider;
  try {
    llm = deps.llm ?? (await resolveLlm(deps.secretsPath, deps.env));
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      stderr(err.message);
      return 2;
    }
    stderr(`Failed to resolve the LLM provider: ${(err as Error).message}`);
    return 2;
  }

  // ---- 6. Run the SAME engine the server + CI runner use --------------------
  let outcome;
  try {
    outcome = await reviewPullRequest({
      systemPrompt: agent.system_prompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy,
      ...(agent.skills.length > 0 ? { skills: agent.skills } : {}),
      task: `Pre-push review of the local working tree (${diff.files.length} changed file(s)).`,
    });
  } catch (err) {
    stderr(`Review failed: ${(err as Error).message}`);
    return 2;
  }

  const findings = outcome.review.findings;
  const blockers = countBlockers(findings, agent.ci_fail_on);

  stdout(values.json ? renderJson(findings, blockers) : renderReport(findings));

  return blockers > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}

// Only run when executed directly (not when imported by tests). Compares
// native OS paths (not raw file:// URL strings) — see server/INSIGHTS.md's
// note on the same Windows import.meta.url vs argv[1] pitfall.
import { fileURLToPath } from 'node:url';
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error('[devdigest] fatal error:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
