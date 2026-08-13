"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Markdown, TextInput } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { useAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import {
  useAgentContext,
  useContextDocument,
  useContextDocuments,
  useSetAgentContext,
  useSkillContexts,
} from "../../../../../../../lib/hooks/context";
import { buildInheritedMap, effectiveTotalTokens, matchesQuery } from "./helpers";
import { s } from "./styles";

/**
 * An agent's attached documents (AC-10, AC-11, AC-12, AC-13, E-7, E-8). Three
 * groups (UX-4 / WI11): documents inherited from the agent's ENABLED linked
 * skills (read-only, labelled with the source skill), documents attached
 * directly (editable, drag-to-reorder), and attachments this agent holds
 * against other repos of the workspace (read-only, not injected). Repo-scoped
 * to the active repo (`lib/repo-context.tsx`).
 */
export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: listing } = useContextDocuments(repoId);
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const { data: direct } = useAgentContext(agent.id, repoId);
  const setAgentContext = useSetAgentContext(agent.id);

  const skillsById = React.useMemo(
    () => new Map((allSkills ?? []).map((sk) => [sk.id, sk])),
    [allSkills],
  );

  // Enabled-only everywhere (UX-5, E-7) — a disabled skill's documents are
  // neither listed as inherited nor counted in the total, same rule the run
  // applies (AC-15).
  const enabledLinkedSkillIds = React.useMemo(
    () => (links ?? []).filter((l) => skillsById.get(l.skill_id)?.enabled).map((l) => l.skill_id),
    [links, skillsById],
  );
  const skillContexts = useSkillContexts(enabledLinkedSkillIds, repoId).map((q) => q.data);

  const [query, setQuery] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const { data: preview } = useContextDocument(repoId, previewPath);
  const draggedPath = React.useRef<string | null>(null);

  if (!repoId) return <p style={s.empty}>{t("context.noRepo")}</p>;
  if (!listing || !allSkills || !links || !direct) return <p style={s.empty}>{t("context.loading")}</p>;

  const docsByPath = new Map(listing.documents.map((d) => [d.path, d]));
  const inherited = buildInheritedMap(enabledLinkedSkillIds, skillContexts, skillsById);
  const directOrder = [...direct.documents].sort((a, b) => a.order - b.order).map((d) => d.path);
  const directSet = new Set(directOrder);
  const otherRepoDocs = direct.other_repo_documents ?? [];
  const totalTokens = effectiveTotalTokens(inherited.keys(), directSet, docsByPath);

  const persist = (paths: string[]) => setAgentContext.mutate({ repo_id: repoId, paths });

  const toggleDirect = (path: string) => {
    if (directSet.has(path)) persist(directOrder.filter((p) => p !== path));
    else persist([...directOrder, path]);
  };

  const reorderDirect = (targetPath: string) => {
    const dragged = draggedPath.current;
    if (!dragged || dragged === targetPath) return;
    if (!directSet.has(dragged) || !directSet.has(targetPath)) return;
    const next = directOrder.filter((p) => p !== dragged);
    next.splice(next.indexOf(targetPath), 0, dragged);
    persist(next);
  };

  // Inherited rows are attached via an enabled skill — AC-11 keeps them
  // visible even when the typed query does not match.
  const inheritedRows = [...inherited.entries()];
  const unattachedPaths = listing.documents.map((d) => d.path).filter((p) => !directSet.has(p));
  const directListPaths = [...directOrder, ...unattachedPaths].filter(
    (p) => directSet.has(p) || matchesQuery(docsByPath.get(p), p, query),
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h3 style={s.title}>{t("context.title")}</h3>
        <Badge color="var(--accent)">{t("context.attachedTotal", { tokens: totalTokens })}</Badge>
      </div>
      {/* NFR A04 — the attach surface states the outbound-data consequence. */}
      <p style={s.outboundNotice}>{t("context.outboundNotice")}</p>
      <p style={s.note}>{t("context.serializesAs")}</p>

      <TextInput value={query} onChange={setQuery} placeholder={t("context.searchPlaceholder")} />

      <div style={s.layout}>
        <div style={s.lists}>
          <div>
            <h4 style={s.groupTitle}>{t("context.inheritedGroup")}</h4>
            {inheritedRows.length === 0 && <p style={s.empty}>{t("context.noInherited")}</p>}
            <div style={s.list}>
              {inheritedRows.map(([path, skillName]) => (
                <div key={path} style={s.row}>
                  <span style={s.path} onClick={() => setPreviewPath(path)}>
                    {path}
                  </span>
                  <Badge>{t("context.viaSkill", { skill: skillName })}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 style={s.groupTitle}>{t("context.directGroup")}</h4>
            <div style={s.list}>
              {directListPaths.map((path) => {
                const doc = docsByPath.get(path);
                const linked = directSet.has(path);
                return (
                  <div
                    key={path}
                    draggable={linked}
                    onDragStart={() => (draggedPath.current = path)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => reorderDirect(path)}
                    style={s.row}
                  >
                    {linked && <Icon.Menu size={14} style={s.dragHandle} />}
                    <Checkbox checked={linked} onChange={() => toggleDirect(path)} />
                    <span style={s.path} onClick={() => setPreviewPath(path)}>
                      {path}
                    </span>
                    {doc && <Badge mono>{doc.type}</Badge>}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 style={s.groupTitle}>{t("context.otherRepoGroup")}</h4>
            <div style={s.list}>
              {otherRepoDocs.map((doc) => (
                <div key={`${doc.repo_id}:${doc.path}`} style={s.row}>
                  <span style={s.path}>{doc.path}</span>
                  <span style={s.otherRepoBadge}>{t("context.notInjected")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={s.preview}>
          {!previewPath ? (
            <p style={s.previewPlaceholder}>{t("context.previewPlaceholder")}</p>
          ) : (
            <Markdown>{preview?.content}</Markdown>
          )}
        </div>
      </div>
    </div>
  );
}
