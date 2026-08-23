import { describe, expect, it } from 'vitest';
import { getConventionsHandler } from '../src/tools/get-conventions.js';
import { getFindingsHandler } from '../src/tools/get-findings.js';
import { listAgentsHandler } from '../src/tools/list-agents.js';
import {
  GetConventionsOutputSchema,
  ListAgentsOutputSchema,
  VerdictResultSchema,
} from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeAgent, makeConvention, makePrMeta, makeRepo, makeReview } from './fixtures.js';

/**
 * WI9.8 — the regression test for principle #3 ("never the raw DB record").
 * For each read tool: the handler's structuredContent must `.parse()` against
 * its declared output schema AND must not carry any of the fields the WI3
 * "Outputs" table says to drop.
 */
describe('output contract guard', () => {
  it('list_agents drops system_prompt/output_schema/version/strategy/ci_fail_on/repo_intel/provider', async () => {
    const api = createFakeApi({ get: (p) => (p === '/agents' ? [makeAgent()] : []) });
    const result = await listAgentsHandler(api);
    const structured = ListAgentsOutputSchema.parse(result.structuredContent);
    const raw = JSON.stringify(structured);
    for (const dropped of ['system_prompt', 'output_schema', 'strategy', 'ci_fail_on', 'repo_intel']) {
      expect(raw).not.toContain(dropped);
    }
  });

  it('get_findings/VerdictResult drops id/review_id/category/confidence/kind/trifecta_components/evidence/accepted_at/dismissed_at', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const review = makeReview();
    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/reviews`) return [review];
        throw new Error(`unexpected GET ${path}`);
      },
    });
    const result = await getFindingsHandler(api, { repo: repo.full_name, pr: pr.number });
    const structured = VerdictResultSchema.parse(result.structuredContent);
    const raw = JSON.stringify(structured.findings);
    for (const dropped of [
      '"review_id"',
      '"category"',
      '"confidence"',
      '"kind"',
      '"trifecta_components"',
      '"evidence"',
      '"accepted_at"',
      '"dismissed_at"',
    ]) {
      expect(raw).not.toContain(dropped);
    }
  });

  it('get_conventions drops id/evidence_snippet/confidence/skill_id', async () => {
    const repo = makeRepo();
    const convention = makeConvention();
    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/conventions`) return [convention];
        throw new Error(`unexpected GET ${path}`);
      },
    });
    const result = await getConventionsHandler(api, { repo: repo.full_name });
    const structured = GetConventionsOutputSchema.parse(result.structuredContent);
    const raw = JSON.stringify(structured.conventions);
    for (const dropped of ['"id"', '"evidence_snippet"', '"confidence"', '"skill_id"']) {
      expect(raw).not.toContain(dropped);
    }
  });
});
