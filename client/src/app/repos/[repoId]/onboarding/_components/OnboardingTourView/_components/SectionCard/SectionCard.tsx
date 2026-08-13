"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn, Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@/lib/types";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

/**
 * One collapsible tour section card (AC-38) — a deterministic fallback when
 * the body is empty rather than an empty card (E-9): a malformed `diagram`
 * renders nothing (`MermaidDiagram`'s own contract), but prose still shows.
 * Prose renders through the centralized `Markdown` (`@devdigest/ui`) — never
 * a second renderer, never `dangerouslySetInnerHTML` (AC-33).
 */
export function SectionCard({
  section,
  title,
  defaultOpen,
  repoFullName,
  defaultBranch,
  firstTasksBadge,
}: {
  section: OnboardingSection;
  title: string;
  defaultOpen: boolean;
  repoFullName: string | null;
  defaultBranch: string;
  firstTasksBadge?: boolean;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(defaultOpen);
  const hasBody = section.body.trim().length > 0;
  const isRunLocally = section.kind === "run_locally";

  return (
    <div style={s.card}>
      <button type="button" style={s.header} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon.ChevronDown
          size={14}
          style={{ ...s.chevron, transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        <span style={s.title}>{title}</span>
        {firstTasksBadge && (
          <span title={t("section.firstTasksBadgeTooltip")}>
            <Badge>{t("section.firstTasksBadge")}</Badge>
          </span>
        )}
        {isRunLocally && hasBody && (
          <span onClick={(e) => e.stopPropagation()}>
            <IconBtn
              icon="Copy"
              label={t("actions.export")}
              onClick={() => {
                void navigator.clipboard?.writeText(section.body);
              }}
            />
          </span>
        )}
      </button>
      {open && (
        <div style={s.body}>
          {hasBody ? (
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
          {section.links.length > 0 && (
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
