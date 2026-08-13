/**
 * Onboarding WI7/WI8 — pure helper unit tests (no DB, no I/O): grounding
 * (AC-7/AC-8/D-8), capping (AC-14), the AC-19 below-minimum gate, and the
 * AC-17/AC-16 status enumeration.
 *
 * Oracle: WI7's DoD ("a stub response citing `src/does-not-exist.ts`
 * yielding a tour without that item (AC-7); a stub containing a script
 * absent from the fixture's `package.json` being dropped (AC-8); an
 * over-long stub being cut to each cap (AC-14); a `../../etc/passwd`-shaped
 * path never surviving grounding (AC-35's server half)") and WI8's DoD
 * ("one case per status (AC-17), one per `degradedReason` (AC-16)").
 */
import { describe, it, expect } from 'vitest';
import type { OnboardingSection } from '@devdigest/shared';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { CollectedFacts } from '../src/modules/onboarding/facts.js';
import {
  buildSkeletonSections,
  capBulletItems,
  deriveStatus,
  groundAndCapSection,
  groundRunLocallyBody,
  isBelowMinimum,
  knownPaths,
} from '../src/modules/onboarding/helpers.js';
import { MAX_READING_PATH_ENTRIES, MAX_RUN_LOCALLY_STEPS } from '../src/modules/onboarding/constants.js';

function fakeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'sha-1',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseFacts(overrides: Partial<CollectedFacts> = {}): CollectedFacts {
  return {
    indexState: fakeIndexState(),
    repoMapText: '',
    repoMapDegraded: false,
    rankedFiles: ['src/server.ts', 'src/db.ts'],
    rankedExcerpts: [],
    droppedForBudget: [],
    flatRank: false,
    fileRankByPath: new Map(),
    criticalPathChains: [['src/server.ts', 'src/db.ts']],
    runLocallySources: [{ path: 'package.json', content: '{"scripts":{"dev":"npm run vite"}}' }],
    noClone: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------- AC-7/D-8

describe('groundAndCapSection — AC-7 path grounding', () => {
  it('drops a link path NOT present in the collected facts', () => {
    const facts = baseFacts();
    const section: OnboardingSection = {
      kind: 'architecture',
      title: 'Architecture',
      body: 'prose',
      diagram: null,
      links: [
        { label: 'server', path: 'src/server.ts' }, // known — survives
        { label: 'invented', path: 'src/does-not-exist.ts' }, // unknown — dropped
      ],
    };
    const grounded = groundAndCapSection(section, facts);
    expect(grounded.links).toEqual([{ label: 'server', path: 'src/server.ts' }]);
  });

  it('AC-35 server half: a ../../etc/passwd-shaped path never survives — it can never be a member of the known-paths allowlist', () => {
    const facts = baseFacts();
    const section: OnboardingSection = {
      kind: 'reading_path',
      title: 'Reading path',
      body: '- entry',
      diagram: null,
      links: [{ label: 'escape', path: '../../etc/passwd' }],
    };
    expect(knownPaths(facts).has('../../etc/passwd')).toBe(false);
    expect(groundAndCapSection(section, facts).links).toEqual([]);
  });

  it('knownPaths includes ranked files, run-locally sources, and every file in a critical-path chain', () => {
    const facts = baseFacts();
    const paths = knownPaths(facts);
    expect(paths.has('src/server.ts')).toBe(true);
    expect(paths.has('src/db.ts')).toBe(true);
    expect(paths.has('package.json')).toBe(true);
  });

  it('diagram is forced to null for every kind but architecture, regardless of what the model returned', () => {
    const facts = baseFacts();
    const section: OnboardingSection = {
      kind: 'critical_paths',
      title: 'Critical paths',
      body: '- a',
      diagram: 'flowchart TD\nA-->B',
      links: [],
    };
    expect(groundAndCapSection(section, facts).diagram).toBeNull();

    const archSection: OnboardingSection = { ...section, kind: 'architecture' };
    expect(groundAndCapSection(archSection, facts).diagram).toBe('flowchart TD\nA-->B');
  });
});

// ---------------------------------------------------------------- AC-8/E-10

describe('groundRunLocallyBody — AC-8 verbatim shell-command matching', () => {
  const sources = [{ path: 'package.json', content: '{"scripts":{"dev":"npm run vite"}}\nnpm run vite' }];

  it('keeps a fenced command line that IS a verbatim substring of a real source file', () => {
    const body = '```bash\nnpm run vite\n```';
    expect(groundRunLocallyBody(body, sources)).toContain('npm run vite');
  });

  it('drops a fenced command absent from every source file (E-10 — model invents a plausible command)', () => {
    const body = '```bash\nnpm run does-not-exist\n```';
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded).not.toContain('does-not-exist');
  });

  it('close-but-not-exact: a command differing only in internal whitespace is dropped (strict verbatim, not fuzzy)', () => {
    const body = '```bash\nnpm  run vite\n```'; // double space — not a verbatim substring
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded).not.toContain('npm  run vite');
  });

  it('close-but-not-exact: a command differing only in quoting is dropped', () => {
    const quotedSources = [{ path: 'README.md', content: "```\nnpm run 'vite'\n```" }];
    const body = '```bash\nnpm run "vite"\n```'; // double quotes vs single in the source
    const grounded = groundRunLocallyBody(body, quotedSources);
    expect(grounded).not.toContain('npm run "vite"');
  });

  it('a fence left with nothing but dropped lines is removed entirely, not rendered empty', () => {
    const body = '```bash\nnpm run does-not-exist\n```';
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded.trim()).toBe('');
  });

  it('blank lines and comment lines survive without needing a source match', () => {
    const body = '```bash\n# comment\n\nnpm run vite\n```';
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded).toContain('# comment');
    expect(grounded).toContain('npm run vite');
  });
});

// -------------------------------------------------------------------- AC-14

describe('capBulletItems — AC-14 deterministic render caps', () => {
  it('keeps exactly the first N top-level bullet items, dropping the rest', () => {
    const body = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n');
    const capped = capBulletItems(body, 12);
    const kept = capped.split('\n').filter((l) => l.trim().startsWith('-'));
    expect(kept).toHaveLength(12);
    expect(capped).toContain('item 11');
    expect(capped).not.toContain('item 12');
  });

  it('leaves non-list prose above the cap untouched', () => {
    const body = 'An intro sentence.\n' + Array.from({ length: 5 }, (_, i) => `- item ${i}`).join('\n');
    const capped = capBulletItems(body, 2);
    expect(capped).toContain('An intro sentence.');
  });
});

describe('groundAndCapSection — AC-14 applies the right cap per kind', () => {
  it('reading_path is capped at MAX_READING_PATH_ENTRIES', () => {
    const facts = baseFacts({ rankedFiles: [] });
    const body = Array.from({ length: MAX_READING_PATH_ENTRIES + 5 }, (_, i) => `${i + 1}. entry ${i}`).join('\n');
    const section: OnboardingSection = { kind: 'reading_path', title: 't', body, diagram: null, links: [] };
    const grounded = groundAndCapSection(section, facts);
    const lines = grounded.body.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    expect(lines).toHaveLength(MAX_READING_PATH_ENTRIES);
  });

  it('run_locally caps total fenced-code steps at MAX_RUN_LOCALLY_STEPS', () => {
    const many = Array.from({ length: MAX_RUN_LOCALLY_STEPS + 5 }, (_, i) => `npm run vite # step-${i}`).join('\n');
    const facts = baseFacts({ runLocallySources: [{ path: 'README.md', content: many }] });
    const body = '```bash\n' + many + '\n```';
    const section: OnboardingSection = { kind: 'run_locally', title: 't', body, diagram: null, links: [] };
    const grounded = groundAndCapSection(section, facts);
    const stepLines = grounded.body
      .split('\n')
      .filter((l) => l.trim().length > 0 && !l.trim().startsWith('#') && !l.startsWith('```'));
    expect(stepLines).toHaveLength(MAX_RUN_LOCALLY_STEPS);
  });

  it('links are capped at MAX_LINKS_PER_SECTION even when every link is known', () => {
    const rankedFiles = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const facts = baseFacts({ rankedFiles });
    const links = rankedFiles.map((path) => ({ label: path, path }));
    const section: OnboardingSection = { kind: 'architecture', title: 't', body: 'x', diagram: null, links };
    const grounded = groundAndCapSection(section, facts);
    expect(grounded.links.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------- AC-19 gate

describe('isBelowMinimum — AC-19', () => {
  it('true when there is no clone', () => {
    expect(isBelowMinimum(baseFacts({ noClone: true, rankedFiles: [] }))).toBe(true);
  });

  it('true when there are no ranked files AND no readable package.json/README', () => {
    const facts = baseFacts({ rankedFiles: [], runLocallySources: [{ path: 'compose.yml', content: 'x' }] });
    expect(isBelowMinimum(facts)).toBe(true);
  });

  it('false when ranked files exist, even with no readable package.json/README', () => {
    const facts = baseFacts({ rankedFiles: ['src/a.ts'], runLocallySources: [] });
    expect(isBelowMinimum(facts)).toBe(false);
  });

  it('false when no ranked files but package.json IS readable', () => {
    const facts = baseFacts({ rankedFiles: [], runLocallySources: [{ path: 'package.json', content: '{}' }] });
    expect(isBelowMinimum(facts)).toBe(false);
  });

  it('false when no ranked files but README.md IS readable', () => {
    const facts = baseFacts({ rankedFiles: [], runLocallySources: [{ path: 'README.md', content: '# hi' }] });
    expect(isBelowMinimum(facts)).toBe(false);
  });
});

// -------------------------------------------------------------- AC-17/AC-16

describe('deriveStatus — AC-17 status enumeration + AC-16 distinct degraded reasons', () => {
  it('no_clone', () => {
    const { status } = deriveStatus(fakeIndexState(), baseFacts({ noClone: true, rankedFiles: [] }));
    expect(status).toBe('no_clone');
  });

  it("not_indexed with degradedReason 'repo_too_large' reads differently from plain not_indexed", () => {
    const tooLarge = deriveStatus(
      fakeIndexState({ degradedReason: 'repo_too_large' }),
      baseFacts({ rankedFiles: [] }),
    );
    const notIndexed = deriveStatus(
      fakeIndexState({ status: 'degraded', degradedReason: 'no_data' }),
      baseFacts({ rankedFiles: [] }),
    );
    expect(tooLarge.status).toBe('not_indexed');
    expect(notIndexed.status).toBe('not_indexed');
    expect(tooLarge.reason).not.toBe(notIndexed.reason);
    expect(tooLarge.reason.toLowerCase()).toContain('large');
  });

  it('partial_index — reason states the indexed file count, never a claim about the true repo file count (AC-15)', () => {
    const { status, reason } = deriveStatus(fakeIndexState({ status: 'partial', filesIndexed: 1842 }), baseFacts());
    expect(status).toBe('partial_index');
    expect(reason).toContain('1842');
    expect(reason).toContain('partial');
  });

  it('ok — a full index with sufficient facts', () => {
    const { status, reason } = deriveStatus(fakeIndexState({ status: 'full', filesIndexed: 50 }), baseFacts());
    expect(status).toBe('ok');
    expect(reason).toContain('50');
  });
});

// -------------------------------------------------------------- AC-22/UX-13

describe('buildSkeletonSections — AC-22 model-free skeleton, never an empty body dressed as success', () => {
  it('every one of the five sections has a non-empty body even with zero facts', () => {
    const empty = baseFacts({ rankedFiles: [], criticalPathChains: [], runLocallySources: [] });
    const sections = buildSkeletonSections(empty);
    expect(sections).toHaveLength(5);
    for (const s of sections) {
      expect(s.body.trim().length).toBeGreaterThan(0);
      expect(s.links).toEqual([]);
      expect(s.diagram).toBeNull();
    }
  });

  it('sections are in the fixed AC-4 order', () => {
    const sections = buildSkeletonSections(baseFacts());
    expect(sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
  });

  it('run_locally skeleton surfaces verified package.json scripts, attributed to their source file', () => {
    const facts = baseFacts({ runLocallySources: [{ path: 'package.json', content: '{"scripts":{"dev":"npm run vite"}}' }] });
    const runLocally = buildSkeletonSections(facts).find((s) => s.kind === 'run_locally')!;
    expect(runLocally.body).toContain('npm run dev');
    expect(runLocally.body).toContain('package.json');
  });
});
