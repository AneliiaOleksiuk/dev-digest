"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn, Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@/lib/types";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import { githubBlobUrl } from "@/lib/github-urls";
import { parseListItems, parseRunLocallyCommands } from "./parseSection";
import { s } from "./styles";

/**
 * One collapsible tour section card (AC-38) — a deterministic fallback when
 * the body is empty rather than an empty card (E-9): a malformed `diagram`
 * renders nothing (`MermaidDiagram`'s own contract), but prose still shows.
 * Prose renders through the centralized `Markdown` (`@devdigest/ui`) — never
 * a second renderer, never `dangerouslySetInnerHTML` (AC-33).
 *
 * FIX-8: `first_tasks` renders a per-task card grid (bold title, monospace
 * path, a per-task complexity badge) instead of the markdown `body`, once
 * `section.tasks` is non-empty — the reference design's per-task badge,
 * which needs structured data the old single-header-badge design couldn't
 * carry. `hasBody`'s fallback still applies whenever `tasks` is empty/absent
 * (a degraded `first_tasks` section, AC-38) — never an empty card.
 *
 * `critical_paths`/`reading_path`/`run_locally` get the same treatment via
 * `parseSection.ts`: the server only ever sends these as markdown (a bullet/
 * numbered list, or a fenced shell block — see that file's header comment),
 * so the row/badge/copy-button layout the design calls for is recovered by
 * parsing `body` client-side, not by a new server field. A body that doesn't
 * parse into any rows (unexpected shape) falls back to the plain `Markdown`
 * render, same "never an empty card" contract as `hasBody`.
 */
export function SectionCard({
  section,
  title,
  defaultOpen,
  repoFullName,
  defaultBranch,
}: {
  section: OnboardingSection;
  title: string;
  defaultOpen: boolean;
  repoFullName: string | null;
  defaultBranch: string;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(defaultOpen);
  const hasBody = section.body.trim().length > 0;
  const isRunLocally = section.kind === "run_locally";
  const isFirstTasks = section.kind === "first_tasks";
  const isCriticalPaths = section.kind === "critical_paths";
  const isReadingPath = section.kind === "reading_path";
  const tasks = isFirstTasks ? (section.tasks ?? []) : [];
  const hasTasks = tasks.length > 0;
  const criticalPathRows = isCriticalPaths ? parseListItems(section.body) : [];
  const readingPathRows = isReadingPath ? parseListItems(section.body) : [];
  const runLocallyCommands = isRunLocally ? parseRunLocallyCommands(section.body) : [];
  // Each parsed row already carries its own "Open" link for its path — the
  // generic `links[]` list below would just repeat the same paths a second
  // time once the structured rows actually render.
  const rowsCoverLinks =
    (isCriticalPaths && criticalPathRows.length > 0) || (isReadingPath && readingPathRows.length > 0);

  return (
    <div style={s.card}>
      <div
        role="button"
        tabIndex={0}
        style={s.header}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <Icon.ChevronDown
          size={14}
          style={{ ...s.chevron, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        <span style={s.title}>{title}</span>
      </div>
      {open && (
        <div style={s.body}>
          {isFirstTasks && hasTasks ? (
            <div style={s.taskGrid}>
              {tasks.map((task, i) => (
                <div key={`${task.path}-${i}`} style={s.taskCard}>
                  <span style={s.taskTitle}>{task.title}</span>
                  <span className="mono" style={s.taskPath}>
                    {task.path}
                  </span>
                  <span title={t("section.taskComplexity.tooltip")} style={{ alignSelf: "flex-start" }}>
                    <Badge
                      color={task.complexity === "low" ? "var(--ok)" : "var(--warn)"}
                      bg={task.complexity === "low" ? "var(--ok-bg)" : "var(--warn-bg)"}
                      style={{
                        border: `1px solid color-mix(in srgb, ${
                          task.complexity === "low" ? "var(--ok)" : "var(--warn)"
                        } 45%, transparent)`,
                      }}
                    >
                      {t(`section.taskComplexity.${task.complexity}`)}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          ) : isCriticalPaths && criticalPathRows.length > 0 ? (
            <div style={s.rowList}>
              {criticalPathRows.map((row, i) => {
                const href = row.path && repoFullName ? githubBlobUrl(repoFullName, defaultBranch, row.path) : undefined;
                return (
                  <div key={`${row.path ?? row.description}-${i}`} style={s.fileRow}>
                    <Icon.FileText size={14} style={s.fileRowIcon} />
                    <span style={s.fileRowText}>
                      {row.path && (
                        <span className="mono" style={s.fileRowPath}>
                          {row.path}
                        </span>
                      )}
                      {row.path && row.description ? " — " : ""}
                      {row.description}
                    </span>
                    {href && (
                      <a href={href} target="_blank" rel="noreferrer" style={s.openButton} title={t("section.openAction")}>
                        <Icon.ExternalLink size={12} />
                        {t("actions.open")}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : isReadingPath && readingPathRows.length > 0 ? (
            <div style={s.rowList}>
              {readingPathRows.map((row, i) => (
                <div key={`${row.path ?? row.description}-${i}`} style={s.readingRow}>
                  <span style={s.readingBadge}>{i + 1}</span>
                  <div>
                    {row.path && (
                      <div className="mono" style={s.readingPath}>
                        {row.path}
                      </div>
                    )}
                    {row.description && <div style={s.readingDescription}>{row.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : isRunLocally && runLocallyCommands.length > 0 ? (
            <div style={s.rowList}>
              {runLocallyCommands.map((command, i) => (
                <div key={`${command}-${i}`} style={s.commandRow}>
                  <span style={s.commandIndex}>{i + 1}</span>
                  <span className="mono" style={s.commandText}>
                    {command}
                  </span>
                  <IconBtn
                    icon="Copy"
                    label={t("actions.copy")}
                    onClick={() => {
                      void navigator.clipboard?.writeText(command);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : hasBody ? (
            <Markdown>{section.body}</Markdown>
          ) : (
            <p style={s.fallback}>{t("section.emptyFallback")}</p>
          )}
          {/* `diagram` only renders for `architecture` — every other kind's
              diagram is already forced null server-side (grounding), and
              MermaidDiagram itself renders nothing on invalid input. */}
          {section.kind === "architecture" && section.diagram && (
            <MermaidDiagram chart={section.diagram} />
          )}
          {section.links.length > 0 && !rowsCoverLinks && (
            <div style={s.links}>
              {section.links.map((link) => {
                const href = repoFullName
                  ? githubBlobUrl(repoFullName, defaultBranch, link.path)
                  : undefined;
                return (
                  <a key={link.path} href={href} target="_blank" rel="noreferrer" style={s.link}>
                    <Icon.ExternalLink size={12} />
                    {link.label} <span className="mono">{link.path}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
