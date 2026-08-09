import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ReviewRecord, ReviewRunResponse, RunSummary } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { apiFailureToolError, buildResult, toolError } from '../errors.js';
import { toVerdictResult } from '../project.js';
import { resolveAgent, resolvePr, resolveRepo } from '../resolve.js';
import { RunAgentOnPrInputShape, type RunAgentOnPrInput, VerdictResultSchema, VerdictResultShape } from '../schemas.js';

const DESCRIPTION =
  'Run a code review on a pull request using the given agent, wait for it to finish, and return the verdict with findings. Args: repo (owner/name), pr (PR number), agent (id from list_agents).';

const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function getTimeoutMs(): number {
  const raw = process.env.DEVDIGEST_MCP_RUN_TIMEOUT_MS;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

async function reportProgress(extra: ToolExtra, elapsedMs: number, status: string): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  // Progress resets the MCP client's own per-call timeout window — required
  // because this tool can legitimately run for minutes (WI4 mitigation).
  // Best-effort: a client that rejects/doesn't support progress notifications
  // must not abort the poll loop over it.
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: Math.round(elapsedMs / 1000),
        message: `Review run ${status} (${Math.round(elapsedMs / 1000)}s elapsed)`,
      },
    });
  } catch {
    // ignored — see comment above
  }
}

export async function runAgentOnPrHandler(
  api: ApiClient,
  input: RunAgentOnPrInput,
  extra: ToolExtra,
): Promise<CallToolResult> {
  const repoResolved = await resolveRepo(api, input.repo);
  if (!repoResolved.ok) return repoResolved.result;
  const repo = repoResolved.value;

  const prResolved = await resolvePr(api, repo, input.pr);
  if (!prResolved.ok) return prResolved.result;
  const pull = prResolved.value;

  const agentResolved = await resolveAgent(api, input.agent);
  if (!agentResolved.ok) return agentResolved.result;
  const agent = agentResolved.value;

  let runResponse: ReviewRunResponse;
  try {
    runResponse = await api.post<ReviewRunResponse>(`/pulls/${pull.id}/review`, { agentId: agent.id });
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }

  const target = runResponse.runs[0];
  if (!target) {
    return toolError(
      'The DevDigest API did not start a review run. Retry run_agent_on_pr, or open the run in the DevDigest UI.',
    );
  }
  const runId = target.run_id;
  const timeoutMs = getTimeoutMs();
  const startedAt = Date.now();

  let run: RunSummary | undefined;
  while (true) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return toolError(
        `Review still running after ${Math.round(elapsedMs / 1000)}s. It keeps running server-side — call get_findings(repo, pr, agent) in a minute to collect the result.`,
      );
    }

    let runs: RunSummary[];
    try {
      runs = await api.get<RunSummary[]>(`/pulls/${pull.id}/runs`);
    } catch (err) {
      return apiFailureToolError(err, api.baseUrl);
    }
    run = runs.find((r) => r.run_id === runId);
    const status = run?.status ?? 'running';
    await reportProgress(extra, elapsedMs, status);

    if (TERMINAL_STATUSES.has(status)) break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (run?.status === 'failed' || run?.status === 'cancelled') {
    return toolError(
      `Review run ${run.status}: ${run.error ?? 'no error detail available'}. Retry run_agent_on_pr, or open the run in the DevDigest UI.`,
    );
  }

  let reviews: ReviewRecord[];
  try {
    reviews = await api.get<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }
  const review = reviews.find((r) => r.run_id === runId);
  if (!review) {
    return toolError(
      'Review run finished but no review record was found for it. Retry run_agent_on_pr, or open the run in the DevDigest UI.',
    );
  }

  return buildResult(VerdictResultSchema, toVerdictResult(review), (structured) => structured.summary ?? '(no summary)');
}

export function registerRunAgentOnPr(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      description: DESCRIPTION,
      inputSchema: RunAgentOnPrInputShape,
      outputSchema: VerdictResultShape,
      annotations: {
        title: 'Run a review on a pull request',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input, extra) => runAgentOnPrHandler(api, input, extra),
  );
}
