import { describe, it, expect } from 'vitest';
import { slugify, disambiguate, deriveNamespace } from '../src/modules/ci/helpers.js';

/**
 * SPEC-05 `specs/SPEC-05-multi-agent-ci-per-repo.md` — oracle for
 * `deriveNamespace` derived from AC-1/AC-2/E-6 and the plan's Recommendation
 * 3 (`docs/plans/spec-05-multi-agent-ci-per-repo.md`) BEFORE reading
 * `helpers.ts`'s own implementation comments beyond wiring facts (export
 * names/signatures).
 *
 * `slugify`/`disambiguate` are SPEC-04-era functions with zero prior test
 * coverage (this module has none) — AC-1 explicitly requires `deriveNamespace`
 * to inherit `slugify`'s hostile-input guarantees "verbatim", so those
 * guarantees are exercised here too, as the baseline this SPEC-05 behavior
 * builds on.
 */

describe('slugify — AC-1: deriveNamespace inherits every hostile-input guarantee verbatim', () => {
  it('lowercases and collapses non [a-z0-9-] runs to a single dash', () => {
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
    expect(slugify('API_Contract Reviewer!!')).toBe('api-contract-reviewer');
  });

  it('is idempotent on an already-slug-shaped name (E-2)', () => {
    expect(slugify('security-reviewer')).toBe('security-reviewer');
  });

  it('strips a path separator rather than passing it through', () => {
    expect(slugify('../../etc/passwd')).not.toContain('/');
    expect(slugify('a/b\\c')).not.toMatch(/[/\\]/);
  });

  it('never lets a ".." segment survive', () => {
    const out = slugify('..');
    expect(out).not.toContain('..');
  });

  it('never leaves a leading dot', () => {
    expect(slugify('.hidden-name')).not.toMatch(/^\./);
  });

  it('escapes a Windows reserved device name case-insensitively (E-6)', () => {
    expect(slugify('CON')).toBe('con-file');
    expect(slugify('con')).toBe('con-file');
    expect(slugify('Lpt1')).toBe('lpt1-file');
  });

  it('falls back to a non-empty default for an all-punctuation name (E-6)', () => {
    expect(slugify('!!!???')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });

  it('caps length and trims a trailing dash produced by truncation', () => {
    const longName = 'a'.repeat(100);
    const out = slugify(longName);
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('disambiguate — untouched by SPEC-05 (Recommendation 3: "do not change disambiguate itself")', () => {
  it('keeps the first occurrence of a slug unsuffixed and suffixes later ones -2, -3, …', () => {
    expect(disambiguate(['a', 'a', 'a'])).toEqual(['a', 'a-2', 'a-3']);
  });

  it('leaves distinct slugs alone', () => {
    expect(disambiguate(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('deriveNamespace — SPEC-05 AC-1', () => {
  it('returns the bare slug when it is not already taken on this repo', () => {
    expect(deriveNamespace('Security Reviewer', [])).toBe('security-reviewer');
  });

  it('inherits slugify\'s hostile-input guarantees (charset, reserved names, fallback)', () => {
    expect(deriveNamespace('CON', [])).toBe('con-file');
    expect(deriveNamespace('!!!', [])).toBe('untitled');
  });
});

describe('deriveNamespace — SPEC-05 AC-2/E-2: disambiguates against namespaces already taken on this repo', () => {
  it('suffixes -2 when the candidate slug is already taken', () => {
    expect(deriveNamespace('Security Reviewer', ['security-reviewer'])).toBe('security-reviewer-2');
  });

  it('increments past multiple existing suffixes to find the first free one', () => {
    expect(
      deriveNamespace('Security Reviewer', ['security-reviewer', 'security-reviewer-2']),
    ).toBe('security-reviewer-3');
  });

  it('two agents whose names slugify identically ("Security Reviewer" and "security-reviewer") land on two distinct namespaces', () => {
    const first = deriveNamespace('Security Reviewer', []);
    const second = deriveNamespace('security-reviewer', [first]);
    expect(first).not.toBe(second);
    expect(new Set([first, second]).size).toBe(2);
  });

  it(
    'Plan Recommendation 3\'s exact counter-example: taken = [sec, sec-2], candidate "sec" must NOT collide with the ' +
      'already-taken "sec-2" the way disambiguate([...taken, candidate]) would (disambiguate would count the SECOND ' +
      '"sec" occurrence in that combined list and also emit "sec-2")',
    () => {
      const taken = ['sec', 'sec-2'];
      const result = deriveNamespace('sec', taken);
      expect(result).not.toBe('sec-2'); // would collide with the ALREADY-TAKEN sec-2
      expect(taken).not.toContain(result); // must be genuinely free
      expect(result).toBe('sec-3');
    },
  );
});
