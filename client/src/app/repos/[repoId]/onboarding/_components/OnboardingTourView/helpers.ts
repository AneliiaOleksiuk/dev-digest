/* Pure helpers for the Onboarding Tour view — no I/O, no hooks. */
import type { OnboardingSection, OnboardingTourResponse } from "@/lib/types";

export const SECTION_ORDER = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
] as const;

/** The tour's sections in the FIXED AC-4 order — never the order the API
 *  happened to return them in (defense in depth on top of server-side
 *  validation). A missing kind (e.g. a degraded skeleton with no sections)
 *  is simply absent, not an empty placeholder. */
export function orderedSections(tour: OnboardingTourResponse | undefined): OnboardingSection[] {
  if (!tour) return [];
  const byKind = new Map(tour.sections.map((s) => [s.kind, s] as const));
  return SECTION_ORDER.map((kind) => byKind.get(kind)).filter((s): s is OnboardingSection => !!s);
}

/** A stored tour exists — Regenerate then needs the AC-6 confirmation (it
 *  would overwrite the shared tour). `generated_at` is only ever non-null
 *  when a real persisted row exists (`ok`/`partial_index`). */
export function hasStoredTour(tour: OnboardingTourResponse | undefined): boolean {
  return !!tour && tour.generated_at != null;
}

/** Coarse relative-age label ("3h ago") — good enough for a header
 *  attribute; no i18n date library in this codebase for onboarding yet. */
export function formatAge(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Client-side Markdown export (D-10, AC-39) — built ONLY from the tour data
 * the page already holds, no network request. Carries the SAME status line
 * the page shows (E-19), so a skeleton never exports as though it were a
 * complete tour.
 */
export function toMarkdown(
  tour: OnboardingTourResponse,
  repoName: string,
  sectionTitle: (kind: string) => string,
): string {
  const lines: string[] = [`# ${repoName} — Onboarding Tour`, ''];
  lines.push(`Status: ${tour.status}${tour.stale ? ' (stale)' : ''} — ${tour.reason}`, '');

  for (const section of orderedSections(tour)) {
    lines.push(`## ${sectionTitle(section.kind)}`, '');
    const hasTasks = section.kind === "first_tasks" && (section.tasks?.length ?? 0) > 0;
    if (hasTasks) {
      // FIX-8: first_tasks' value now lives in structured `tasks`, not
      // `body` — export those, not the (possibly empty) prose intro.
      lines.push(
        ...section.tasks!.map((task) => `- **${task.title}** — \`${task.path}\` (${task.complexity} complexity)`),
        '',
      );
    } else {
      lines.push(section.body.trim().length > 0 ? section.body : '_No content available for this section yet._', '');
    }
    if (section.diagram) {
      lines.push('```mermaid', section.diagram, '```', '');
    }
    if (section.links.length > 0) {
      lines.push(...section.links.map((l) => `- [${l.label}](${l.path})`), '');
    }
  }

  return lines.join('\n');
}

/** Trigger a client-side download of `content` as `filename` — no network
 *  request (D-10/AC-39). */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
