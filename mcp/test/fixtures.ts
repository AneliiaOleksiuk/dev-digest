import type {
  Agent,
  BlastRadiusResponse,
  ConventionCandidate,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';

/** Test fixtures for the upstream `@devdigest/shared` record shapes. Every
 *  builder includes at least one field that this package's projections MUST
 *  drop (system_prompt, confidence, evidence_snippet, …) — see
 *  test/contract.test.ts. */

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Reviews PRs for security issues.',
    provider: 'openai',
    model: 'gpt-4.1',
    system_prompt: 'You are a meticulous security reviewer. '.repeat(200),
    output_schema: null,
    enabled: true,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'workspace-1',
    owner: 'acme',
    name: 'widgets-api',
    full_name: 'acme/widgets-api',
    default_branch: 'main',
    clone_path: '/clones/acme/widgets-api',
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

export function makePrMeta(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'octocat',
    branch: 'feat/rate-limit',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: 'open',
    opened_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'finding-1',
    review_id: 'review-1',
    severity: 'WARNING',
    category: 'security',
    title: 'Missing input validation',
    file: 'src/handler.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'User input reaches the DB without validation.',
    suggestion: 'Validate with zod before use.',
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

export function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'comment',
    summary: 'Looks fine, one warning.',
    score: 82,
    model: 'gpt-4.1',
    grounding: null,
    created_at: '2026-08-01T00:05:00.000Z',
    findings: [makeFinding()],
    ...overrides,
  };
}

export function makeReviewRunResponse(overrides: Partial<ReviewRunResponse> = {}): ReviewRunResponse {
  return {
    pr_id: 'pr-1',
    runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer' }],
    reviews: [],
    ...overrides,
  };
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-08-01T00:00:00.000Z',
    score: null,
    blockers: null,
    critical_count: null,
    warning_count: null,
    suggestion_count: null,
    ...overrides,
  };
}

export function makeBlastRadiusResponse(overrides: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    changed_symbols: [{ name: 'chargeCard', file: 'src/billing/charge.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'chargeCard',
        callers: [{ name: 'handleWebhook', file: 'src/billing/webhook.ts', line: 42 }],
        endpoints_affected: ['POST /webhooks/stripe'],
        crons_affected: [],
      },
    ],
    summary: '1 changed symbol reached by 1 caller across 1 file, affecting 1 endpoint.',
    status: 'full',
    reason: null,
    prior_prs: [],
    ...overrides,
  };
}

export function makeConvention(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'conv-1',
    category: 'style',
    rule: 'Use zod for all request body validation.',
    evidence_path: 'server/src/modules/repos/routes.ts',
    evidence_snippet: 'app.post(\'/repos\', { schema: { body: RepoInput } }, ...)'.repeat(3),
    evidence_line: 27,
    confidence: 0.87,
    status: 'accepted',
    skill_id: null,
    ...overrides,
  };
}
