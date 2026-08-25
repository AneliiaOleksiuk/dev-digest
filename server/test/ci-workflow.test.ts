import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildWorkflow, emitWorkflowYaml, type BuildWorkflowInput } from '../src/modules/ci/workflow.js';
import {
  RUN_COMMAND,
  PERMISSIONS_POST,
  PERMISSIONS_NO_POST,
  FORK_GUARD_EXPR,
  NODE_VERSION,
  FORBIDDEN_EVENTS,
} from '../src/modules/ci/constants.js';

/**
 * Oracle: specs/SPEC-05-multi-agent-ci-per-repo.md AC-16, AC-18, AC-19,
 * AC-20, AC-21, AC-22, AC-23, derived from the spec text and the plan's WI3
 * ("Namespaced variant emits a top-level name: … legacy emits NO name: key
 * at all … Review step gains DEVDIGEST_DIR: .devdigest/<ns> … Reporting
 * step's INGEST_TOKEN references the derived secret name … run: stays
 * RUN_COMMAND, byte-identical, for both") BEFORE reading `workflow.ts`'s own
 * implementation beyond `BuildWorkflowInput`'s shape.
 */

const BASE_INPUT: Omit<BuildWorkflowInput, 'namespace'> = {
  triggers: ['opened', 'synchronize', 'reopened'],
  postAs: 'github_review',
  ingestUrl: 'https://studio.example.com/ci/ingest',
};

function build(namespace: string | null) {
  const doc = buildWorkflow({ ...BASE_INPUT, namespace });
  return doc.toJSON() as any;
}

describe('AC-21/AC-16: top-level name: — namespaced only, never for legacy', () => {
  it('a namespaced workflow declares name: derived from the namespace', () => {
    const wf = build('security-reviewer');
    expect(wf.name).toBe('devdigest-review-security-reviewer');
  });

  it('a legacy workflow (namespace: null) emits NO name: key at all', () => {
    const wf = build(null);
    expect(wf).not.toHaveProperty('name');
  });

  it('two agents on one repo emit two DISTINCT workflow names', () => {
    const a = build('security-reviewer').name;
    const b = build('api-contract-reviewer').name;
    expect(a).not.toBe(b);
  });
});

describe('AC-19: DEVDIGEST_DIR — review step env only, namespaced vs legacy', () => {
  function reviewStep(wf: any) {
    return wf.jobs.review.steps.find((s: any) => s.id === 'review');
  }

  it('a namespaced workflow sets DEVDIGEST_DIR: .devdigest/<ns> on the review step env', () => {
    const wf = build('security-reviewer');
    expect(reviewStep(wf).env.DEVDIGEST_DIR).toBe('.devdigest/security-reviewer');
  });

  it('a legacy workflow emits NO DEVDIGEST_DIR key at all (leaves the runner default in force)', () => {
    const wf = build(null);
    expect(reviewStep(wf).env).not.toHaveProperty('DEVDIGEST_DIR');
  });
});

describe('AC-20: run: stays exactly RUN_COMMAND, byte-identical, for both variants', () => {
  it('the review step run: equals RUN_COMMAND for a namespaced workflow', () => {
    const wf = build('security-reviewer');
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    expect(reviewStep.run).toBe(RUN_COMMAND);
  });

  it('the review step run: equals RUN_COMMAND for a legacy workflow — no subcommand, no namespace argument', () => {
    const wf = build(null);
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    expect(reviewStep.run).toBe(RUN_COMMAND);
  });
});

describe('AC-22: the reporting step references THIS installation\'s own ingest secret', () => {
  function reportStep(wf: any) {
    return wf.jobs.review.steps.find((s: any) => s.name === 'Report result to DevDigest');
  }

  it('a namespaced workflow references DEVDIGEST_INGEST_TOKEN_<NAMESPACE>', () => {
    const wf = build('security-reviewer');
    expect(reportStep(wf).env.INGEST_TOKEN).toBe(
      '${{ secrets.DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER }}',
    );
  });

  it('a legacy workflow keeps the bare DEVDIGEST_INGEST_TOKEN', () => {
    const wf = build(null);
    expect(reportStep(wf).env.INGEST_TOKEN).toBe('${{ secrets.DEVDIGEST_INGEST_TOKEN }}');
  });
});

describe('AC-23: every SPEC-04 generator invariant holds unchanged for BOTH variants', () => {
  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: pull_request-only trigger, no forbidden event',
    (_label, namespace) => {
      const wf = build(namespace);
      expect(Object.keys(wf.on)).toEqual(['pull_request']);
      for (const forbidden of FORBIDDEN_EVENTS) {
        expect(wf.on).not.toHaveProperty(forbidden);
      }
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: exact two-key permissions map for post_as github_review',
    (_label, namespace) => {
      const wf = build(namespace);
      expect(wf.permissions).toEqual(PERMISSIONS_POST);
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: read-only pull-requests permission when post_as is "none"',
    (_label, namespace) => {
      const doc = buildWorkflow({ ...BASE_INPUT, postAs: 'none', namespace });
      const wf = doc.toJSON() as any;
      expect(wf.permissions).toEqual(PERMISSIONS_NO_POST);
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: full-40-hex SHA-pinned actions',
    (_label, namespace) => {
      const wf = build(namespace);
      for (const step of wf.jobs.review.steps) {
        if (typeof step.uses === 'string') {
          expect(step.uses).toMatch(/^[^/@]+\/[^/@]+@[0-9a-f]{40}$/);
        }
      }
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: the fork guard if: expression is present job-level',
    (_label, namespace) => {
      const wf = build(namespace);
      expect(wf.jobs.review.if).toBe(FORK_GUARD_EXPR);
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: Node floor matches NODE_VERSION',
    (_label, namespace) => {
      const wf = build(namespace);
      const setupNode = wf.jobs.review.steps.find((s: any) => s.name === 'Set up Node');
      expect(setupNode.with['node-version']).toBe(NODE_VERSION);
    },
  );

  it.each([['namespaced', 'security-reviewer'], ['legacy', null]] as const)(
    '%s: no ${{ github.event.* }} or ${{ secrets.* }} expression inside any run: body',
    (_label, namespace) => {
      const wf = build(namespace);
      for (const step of wf.jobs.review.steps) {
        if (typeof step.run === 'string') {
          expect(step.run).not.toMatch(/\$\{\{\s*github\.event\./);
          expect(step.run).not.toMatch(/\$\{\{\s*secrets\./);
        }
      }
    },
  );

  it('emitWorkflowYaml parses back to valid YAML for both variants', () => {
    for (const namespace of ['security-reviewer', null] as const) {
      const text = emitWorkflowYaml({ ...BASE_INPUT, namespace });
      expect(() => parseYaml(text)).not.toThrow();
    }
  });
});
