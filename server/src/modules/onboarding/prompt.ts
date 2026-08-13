/**
 * Prompt assembly for the single onboarding structured call. This call does
 * NOT go through `reviewer-core`'s `assemblePrompt` (that's review-path
 * only), so `wrapUntrusted` is NOT inherited automatically — every
 * repo-derived block gets its own explicit `wrapUntrusted` call here
 * (AC-32, E-12). Do NOT follow `conventions/service.ts:168-183`'s pattern of
 * concatenating its sample unwrapped — the Spec names that as the wrong
 * precedent.
 *
 * Prompt *instruction* text stays in `src/prompts/onboarding.system.md`,
 * loaded via `renderPrompt` (`platform/prompts.ts`) — never hardcoded here.
 */
import type { ChatMessage } from '@devdigest/shared';
import { ONBOARDING_SECTION_KINDS, type OnboardingSectionKind } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { CollectedFacts } from './facts.js';

/** Output language — the literal `English`, matching the only shipped
 *  message bundle (`client/messages/en`), per D-11/E-18. Not configurable
 *  per-request; a Development Plan choice, not invented here. */
const LANGUAGE = 'English';

const SECTION_DESCRIPTIONS: Record<OnboardingSectionKind, string> = {
  architecture: 'high-level overview of how the codebase is structured and its main pieces',
  critical_paths:
    'key dependency chains from the most important files, each as an ordered list of real paths',
  run_locally: 'how to run this project locally, using ONLY commands verified against the provided facts',
  reading_path: 'an ordered list of files to read first, each with a one-line reason',
  first_tasks: 'a few concrete first tasks for a new contributor, scoped to files present in the facts',
};

function sectionsBlock(): string {
  return ONBOARDING_SECTION_KINDS.map((kind) => `- \`${kind}\` — ${SECTION_DESCRIPTIONS[kind]}`).join('\n');
}

/** Load + render the system prompt template. No repo-derived text ever
 *  reaches this message (AC-32) — only the fixed section list + language. */
export async function buildOnboardingSystemPrompt(): Promise<string> {
  return renderPrompt('onboarding.system.md', { sections: sectionsBlock(), language: LANGUAGE });
}

/**
 * Build the user message: every repo-derived block — repo map, each file
 * excerpt, the ranked-file list, critical-path chains, each run-locally
 * source — individually wrapped with `wrapUntrusted` (AC-32). Nothing here
 * reaches the system message.
 */
export function buildOnboardingUserMessage(facts: CollectedFacts, repoFullName: string): string {
  const sections: string[] = [`Write the onboarding tour for ${repoFullName}.`];

  if (facts.repoMapText.trim().length > 0) {
    sections.push(`## Repo map\n${wrapUntrusted('repo-map', facts.repoMapText)}`);
  }

  if (facts.rankedFiles.length > 0) {
    const rankedList = facts.rankedFiles.map((p, i) => `${i + 1}. ${p}`).join('\n');
    const flatNote = facts.flatRank
      ? ' — NOTE: this repo has no usable import-graph signal; this order is NOT an importance ranking'
      : '';
    sections.push(`## Ranked files (reading-path order${flatNote})\n${wrapUntrusted('ranked-files', rankedList)}`);
  }

  for (const excerpt of facts.rankedExcerpts) {
    sections.push(`## File: ${excerpt.path}\n${wrapUntrusted(`excerpt:${excerpt.path}`, excerpt.content)}`);
  }

  if (facts.criticalPathChains.length > 0) {
    const chainsText = facts.criticalPathChains.map((chain) => chain.join(' -> ')).join('\n');
    sections.push(`## Critical paths (dependency chains)\n${wrapUntrusted('critical-paths', chainsText)}`);
  }

  for (const source of facts.runLocallySources) {
    sections.push(
      `## Run-locally source: ${source.path}\n${wrapUntrusted(`run-locally:${source.path}`, source.content)}`,
    );
  }

  return sections.join('\n\n');
}

export async function buildOnboardingMessages(
  facts: CollectedFacts,
  repoFullName: string,
): Promise<ChatMessage[]> {
  const system = await buildOnboardingSystemPrompt();
  const user = buildOnboardingUserMessage(facts, repoFullName);
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
