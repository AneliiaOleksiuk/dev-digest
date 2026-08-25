import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSkillBodies } from './skills.js';
import { RunnerError } from './errors.js';

describe('loadSkillBodies (checked-in .devdigest/skills/<slug>.md resolution)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-skills-'));
    mkdirSync(path.join(dir, 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads skill bodies for each slug, in order', () => {
    writeFileSync(path.join(dir, 'skills', 'a.md'), 'Body A');
    writeFileSync(path.join(dir, 'skills', 'b.md'), 'Body B');

    expect(loadSkillBodies(dir, ['a', 'b'])).toEqual(['Body A', 'Body B']);
  });

  it('throws a clear RunnerError when a skill file is missing', () => {
    expect(() => loadSkillBodies(dir, ['missing'])).toThrow(RunnerError);
  });

  it('rejects a slug that traverses outside the skills directory', () => {
    // A manifest is a checked-in file in the TARGET repo — anyone with write
    // access to it could tamper with a slug to try to read files outside
    // `.devdigest/skills/` (e.g. a secrets file elsewhere in the checkout).
    expect(() => loadSkillBodies(dir, ['../../etc/passwd'])).toThrow(
      /resolves outside the skills directory/,
    );
  });
});
