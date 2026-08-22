import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { Agent } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { SKILLS_SUBDIR } from './constants.js';

/**
 * `manifest.ts` — field mapping, YAML emission, self-validation for the one
 * file `agent-runner` actually reads (`.devdigest/agents/<slug>.yaml`).
 *
 * E-20's attack is a `\n---\nci_fail_on: never\n` value smuggled into a field
 * that a naive implementation would string-concatenate into the YAML
 * document, breaking out into a new top-level key. `emitManifestYaml` never
 * concatenates — it builds a plain object and hands it to `yaml`'s
 * `stringify`, which quotes/block-scalars every value, so a `---` or a
 * `key: value` line inside a string field can only ever be encoded as
 * literal text inside that field's own scalar (verified empirically during
 * Phase B: `stringify` already forces block-literal style for multi-line
 * strings and quotes ambiguous scalars like `"22"` WITHOUT any extra
 * `defaultStringType` override — there is nothing more to force).
 */

/** One enabled linked skill, already ordered and already assigned its
 *  (disambiguated) slug — `helpers.ts`'s `slugify`/`disambiguate` run in
 *  `service.ts`, upstream of this file, since slug collision resolution
 *  needs the WHOLE list at once and this file only ever sees one skill at a
 *  time in `emitSkillFile`. */
export interface OrderedEnabledSkill {
  slug: string;
  body: string;
}

/**
 * `name`, `model`, `system_prompt`, `strategy`, `ci_fail_on` map DIRECTLY
 * from the agent row — no transformation, no format version, no diff against
 * a previous export (AC-11). `provider` is ALWAYS the literal `'openrouter'`
 * regardless of `agents.provider` (AC-12, D-4, Q-1) — the runner's only
 * supported provider. `skills` is the caller-supplied ordered slug list,
 * already filtered to enabled links and sorted by `order` upstream.
 */
export function buildManifest(agent: Agent, orderedEnabledSkills: OrderedEnabledSkill[]): AgentManifest {
  return AgentManifest.parse({
    name: agent.name,
    provider: 'openrouter',
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: orderedEnabledSkills.map((s) => s.slug),
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
  });
}

/**
 * `yaml`'s `stringify` on a plain object — never string concatenation or
 * template interpolation (AC-13). `lineWidth: 0` disables line-folding so a
 * long `system_prompt` line is never wrapped mid-word into something that
 * would re-parse differently.
 */
export function emitManifestYaml(manifest: AgentManifest): string {
  return stringifyYaml(manifest, { lineWidth: 0 });
}

/**
 * Parse the just-emitted YAML back and re-validate it against the SAME
 * `AgentManifest` schema the runner uses (AC-10), then compare field-for-field
 * against the input. A mismatch throws — this export must never ship a
 * manifest that would fail validation in CI, and must never ship one whose
 * `ci_fail_on` silently diverged from the agent's own value, since the
 * manifest is the sole carrier of the gate policy (AC-13, AC-28, E-20). Runs
 * unconditionally on the export path, never behind a flag.
 */
export function assertManifestRoundTrips(yamlText: string, manifest: AgentManifest): void {
  const parsed = parseYaml(yamlText);
  const result = AgentManifest.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      'manifest_round_trip_failed',
      `Generated manifest failed to re-validate: ${result.error.message}`,
      500,
    );
  }
  if (JSON.stringify(result.data) !== JSON.stringify(manifest)) {
    throw new AppError(
      'manifest_round_trip_mismatch',
      'Generated manifest YAML re-parsed to a different value than the manifest that produced it.',
      500,
    );
  }
}

/** The skill body verbatim, unchanged — the runner reads
 *  `.devdigest/skills/<slug>.md` files as plain markdown, not YAML/JSON. */
export function emitSkillFile(skill: OrderedEnabledSkill): { path: string; contents: string } {
  return { path: `${SKILLS_SUBDIR}/${skill.slug}.md`, contents: skill.body };
}

/** `.devdigest/memory.jsonl` (AC-16, D-5, E-27) — nothing in this repo reads
 *  or writes it yet (grep for `memory.jsonl` / `agent_memory` returns
 *  nothing outside this feature); shipping it non-empty would imply a
 *  feature that does not exist. Always an empty string. */
export function emitMemoryPlaceholder(): string {
  return '';
}
