import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { run } from '../src/cli.js';
import type { GitRunner } from '../src/cli/repo.js';

/**
 * Hermetic end-to-end tests for the pre-push CLI's `run()` pipeline
 * (WI14): a fake `GitRunner` (no real git repo) + a fake `LLMProvider` (no
 * network) exercise `git diff HEAD` → `parseUnifiedDiff` → `reviewPullRequest`
 * → `countBlockers` → the exit-code contract, exactly the way `mcp/test/
 * server.test.ts` proves the MCP tool path without touching a real process.
 */

// A tiny, real unified diff: one added line (new line 2) in src/app.ts.
const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 line1
+const secret = 'sk_live_xxx';
 line2
 line3
`;

function fakeGit(responses: Record<string, string>): GitRunner {
  return async (args) => {
    const key = args.join(' ');
    if (key in responses) return responses[key]!;
    throw new Error(`unexpected git invocation: git ${key}`);
  };
}

function fakeLlm(review: unknown): LLMProvider {
  return {
    id: 'openrouter',
    async completeStructured<T>(): Promise<StructuredResult<T>> {
      return {
        data: review as T,
        model: 'test-model',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        raw: JSON.stringify(review),
        attempts: 1,
      };
    },
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('not used');
    },
    async embed() {
      return [];
    },
  };
}

function collectOutput() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    out,
    err,
  };
}

const BASE_GIT_RESPONSES = {
  'rev-parse --show-toplevel': '/repo\n',
  'diff HEAD': DIFF,
  'ls-files --others --exclude-standard': '',
};

describe('devdigest review --mode working (hermetic)', () => {
  it('diff -> findings -> exit 0 when nothing is blocking', async () => {
    const review = {
      verdict: 'comment',
      summary: 'minor issue',
      score: 90,
      findings: [
        {
          id: 'f1',
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Consider renaming this variable',
          file: 'src/app.ts',
          start_line: 2,
          end_line: 2,
          rationale: 'A more descriptive name would help.',
          confidence: 0.5,
          kind: 'finding',
        },
      ],
    };
    const io = collectOutput();
    const code = await run(['review', '--mode', 'working'], {
      git: fakeGit(BASE_GIT_RESPONSES),
      llm: fakeLlm(review),
      ...io,
    });

    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('SUGGESTION');
    expect(io.out.join('\n')).toContain('src/app.ts:2');
  });

  it('a blocking (CRITICAL) finding -> exit 1', async () => {
    const review = {
      verdict: 'request_changes',
      summary: 'hardcoded secret',
      score: 20,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/app.ts',
          start_line: 2,
          end_line: 2,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
      ],
    };
    const io = collectOutput();
    const code = await run(['review', '--mode', 'working'], {
      git: fakeGit(BASE_GIT_RESPONSES),
      llm: fakeLlm(review),
      ...io,
    });

    expect(code).toBe(1);
    expect(io.out.join('\n')).toContain('CRITICAL');
  });

  it('an engine/LLM failure -> exit 2, no stack trace on stderr', async () => {
    const io = collectOutput();
    const failingLlm: LLMProvider = {
      id: 'openrouter',
      async completeStructured() {
        throw new Error('OpenRouter returned no choices for Review');
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const code = await run(['review', '--mode', 'working'], {
      git: fakeGit(BASE_GIT_RESPONSES),
      llm: failingLlm,
      ...io,
    });

    expect(code).toBe(2);
    expect(io.err.join('\n')).toContain('Review failed');
    expect(io.err.join('\n')).not.toContain('at ');
  });

  it('--mode staged is registered but not implemented -> non-zero + a clear message', async () => {
    const io = collectOutput();
    const code = await run(['review', '--mode', 'staged'], {
      git: fakeGit({ 'rev-parse --show-toplevel': '/repo\n' }),
      llm: fakeLlm({ verdict: 'approve', summary: '', score: 100, findings: [] }),
      ...io,
    });

    expect(code).toBe(2);
    expect(io.err.join('\n')).toMatch(/not implemented yet/i);
  });

  it('warns on stderr (naming the files) when untracked files exist', async () => {
    const io = collectOutput();
    const code = await run(['review', '--mode', 'working'], {
      git: fakeGit({
        ...BASE_GIT_RESPONSES,
        'ls-files --others --exclude-standard': 'scratch.txt\nnotes/todo.md\n',
      }),
      llm: fakeLlm({ verdict: 'approve', summary: '', score: 100, findings: [] }),
      ...io,
    });

    expect(code).toBe(0);
    const stderr = io.err.join('\n');
    expect(stderr).toContain('untracked');
    expect(stderr).toContain('scratch.txt');
    expect(stderr).toContain('notes/todo.md');
  });

  it('an empty git diff HEAD -> exit 2, clear message, no LLM call attempted', async () => {
    const io = collectOutput();
    let called = false;
    const code = await run(['review', '--mode', 'working'], {
      git: fakeGit({ ...BASE_GIT_RESPONSES, 'diff HEAD': '' }),
      llm: {
        id: 'openrouter',
        async completeStructured() {
          called = true;
          throw new Error('should not be called');
        },
        async listModels() {
          return [];
        },
        async complete() {
          throw new Error('not used');
        },
        async embed() {
          return [];
        },
      },
      ...io,
    });

    expect(code).toBe(2);
    expect(called).toBe(false);
    expect(io.err.join('\n')).toMatch(/no changes/i);
  });

  it('--json prints machine-readable output instead of the human report', async () => {
    const review = { verdict: 'approve', summary: '', score: 100, findings: [] };
    const io = collectOutput();
    const code = await run(['review', '--mode', 'working', '--json'], {
      git: fakeGit(BASE_GIT_RESPONSES),
      llm: fakeLlm(review),
      ...io,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join('\n'));
    expect(parsed.summary.total).toBe(0);
    expect(parsed.summary.blockers).toBe(0);
  });

  it('--help prints usage (incl. the exit-code contract) and exits 0 without touching git', async () => {
    const io = collectOutput();
    const code = await run(['--help'], {
      git: fakeGit({}), // any invocation here would throw — proves help never calls git
      ...io,
    });

    expect(code).toBe(0);
    const help = io.out.join('\n');
    expect(help).toContain('devdigest review');
    expect(help).toMatch(/exit codes/i);
    expect(help).toMatch(/untracked/i);
  });
});
