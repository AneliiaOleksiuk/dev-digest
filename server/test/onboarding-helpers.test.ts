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
  groundBulletItemPaths,
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

// ---------------------------------------------------------- FIX-2 (AC-7/AC-10)
// `groundBulletItemPaths` grounds SECTION-BODY bullet items (not only
// `links[]`) for critical_paths/reading_path/first_tasks — an invented path
// named inline inside prose must be dropped in code (AC-7), and a
// critical-path row must name a file from the real chains (AC-10).

describe('groundBulletItemPaths — FIX-2 body grounding (AC-7, AC-10)', () => {
  it('drops a bullet item naming an inline-code path NOT in the known-paths allowlist', () => {
    const paths = new Set(['src/server.ts']);
    const body = [
      '1. `src/server.ts` — the real entry point',
      '2. `src/does-not-exist.ts` — an invented file the model made up',
    ].join('\n');
    const grounded = groundBulletItemPaths(body, paths);
    expect(grounded).toContain('src/server.ts');
    expect(grounded).not.toContain('does-not-exist');
  });

  it('keeps a bullet item naming a real path present in the facts', () => {
    const paths = new Set(['src/server.ts']);
    const body = '- `src/server.ts` — see the whole request lifecycle in one file';
    const grounded = groundBulletItemPaths(body, paths);
    expect(grounded).toContain('src/server.ts');
    expect(grounded.trim().length).toBeGreaterThan(0);
  });

  it('drops a multi-line bullet item (continuation lines) together with its heading line', () => {
    const paths = new Set(['src/server.ts']);
    const body = ['- `src/does-not-exist.ts`', '  a continuation line explaining why', '- `src/server.ts` — real'].join(
      '\n',
    );
    const grounded = groundBulletItemPaths(body, paths);
    expect(grounded).not.toContain('does-not-exist');
    expect(grounded).not.toContain('continuation line');
    expect(grounded).toContain('src/server.ts');
  });

  it('non-list prose above/around the bullets is left untouched even if it names a path-shaped token', () => {
    // This function only owns BULLET-ITEM grounding; a plain sentence outside
    // any list item is out of its scope by design (its own docblock: "Applied
    // to critical_paths, reading_path and first_tasks" bullet items).
    const paths = new Set(['src/server.ts']);
    const body = ['An intro sentence mentioning `src/nope.ts` in passing.', '- `src/server.ts` — real'].join('\n');
    const grounded = groundBulletItemPaths(body, paths);
    expect(grounded).toContain('An intro sentence mentioning `src/nope.ts` in passing.');
  });

  it('groundAndCapSection applies this grounding to critical_paths, reading_path and first_tasks bodies', () => {
    const facts = baseFacts();
    for (const kind of ['critical_paths', 'reading_path', 'first_tasks'] as const) {
      const section: OnboardingSection = {
        kind,
        title: kind,
        body: '- `src/does-not-exist.ts` — invented',
        diagram: null,
        links: [],
      };
      const grounded = groundAndCapSection(section, facts);
      expect(grounded.body).not.toContain('does-not-exist');
    }
  });

  it('FIX-2 stated scope: architecture and run_locally bodies are NOT passed through groundBulletItemPaths — an invented bullet-item path in an architecture body survives THIS function untouched (architecture has no body-grounding pass; run_locally has its own separate verbatim-match grounding via groundRunLocallyBody)', () => {
    const facts = baseFacts();
    const archSection: OnboardingSection = {
      kind: 'architecture',
      title: 'Architecture',
      body: '- `src/does-not-exist.ts` — invented',
      diagram: null,
      links: [],
    };
    const grounded = groundAndCapSection(archSection, facts);
    // Documented, deliberate scope limit per the fix plan's own FIX-2 text —
    // NOT a claim that this is the ideal reading of AC-7's literal "a section
    // body ... names a file path" wording, which is not kind-scoped. See the
    // Test Report's "Behavior mismatches found".
    expect(grounded.body).toContain('does-not-exist');
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

  // ---------------------------------------------------------------- FIX-5/AC-34
  it('FIX-5/AC-34: a verbatim-matched command line carries its source-path attribution', () => {
    const body = '```bash\nnpm run vite\n```';
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded).toContain('npm run vite  # from package.json');
  });

  it('FIX-5: a DROPPED (unmatched) command carries no attribution — attribution only ever survives on a real, matched command', () => {
    const body = '```bash\nnpm run does-not-exist\n```';
    const grounded = groundRunLocallyBody(body, sources);
    expect(grounded).not.toContain('# from');
    expect(grounded).not.toContain('does-not-exist');
  });

  it('FIX-5: each command is attributed to ITS OWN matching source when multiple sources are present', () => {
    const multiSources = [
      { path: 'package.json', content: '{"scripts":{"dev":"npm run vite"}}' },
      { path: 'README.md', content: '```bash\nnpm run e2e\n```' },
    ];
    const body = '```bash\nnpm run vite\nnpm run e2e\n```';
    const grounded = groundRunLocallyBody(body, multiSources);
    expect(grounded).toContain('npm run vite  # from package.json');
    expect(grounded).toContain('npm run e2e  # from README.md');
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

  // -------------------------------------------------------------------- FIX-4
  it("FIX-4: a walk BOUNDED at MAX_INDEXED_FILES reports partial_index even though IndexState.status is 'full' — a full-status index can still be an alphabetically-truncated slice (E-5, AC-15)", () => {
    const { status, reason } = deriveStatus(
      fakeIndexState({ status: 'full', bounded: true, filesIndexed: 5000 }),
      baseFacts(),
    );
    expect(status).toBe('partial_index');
    expect(reason).toContain('5000');
    expect(reason.toLowerCase()).toContain('partial');
  });

  it('FIX-4: a full, non-bounded index is NOT partial_index — bounded is the ONLY thing that downgrades a full-status index', () => {
    const { status } = deriveStatus(fakeIndexState({ status: 'full', bounded: false, filesIndexed: 50 }), baseFacts());
    expect(status).toBe('ok');
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
