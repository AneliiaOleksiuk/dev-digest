import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RunnerError } from './errors.js';

/**
 * Loads the checked-in `.devdigest/skills/<slug>.md` bodies referenced by the
 * manifest's `skills` slugs, in order. These are RESOLVED skill bodies (not
 * slugs) — `reviewPullRequest` (reviewer-core) takes strings, exactly like the
 * studio resolves slugs to DB rows before calling the same engine (AC-36
 * parity: both callers hand the engine already-resolved bodies).
 */
export function loadSkillBodies(
  devdigestDir: string,
  slugs: readonly string[],
  readFile: typeof readFileSync = readFileSync,
): string[] {
  const skillsDir = path.resolve(devdigestDir, 'skills');
  return slugs.map((slug) => {
    const skillPath = path.resolve(skillsDir, `${slug}.md`);
    const relative = path.relative(skillsDir, skillPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new RunnerError(`Skill slug '${slug}' resolves outside the skills directory`);
    }
    try {
      return readFile(skillPath, 'utf8') as unknown as string;
    } catch (err) {
      throw new RunnerError(
        `Skill file for slug '${slug}' not found at ${skillPath}: ${(err as Error).message}`,
      );
    }
  });
}
