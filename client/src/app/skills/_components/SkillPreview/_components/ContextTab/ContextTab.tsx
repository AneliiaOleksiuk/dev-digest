"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Markdown, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import {
  useContextDocument,
  useContextDocuments,
  useSetSkillContext,
  useSkillContext,
} from "../../../../../../lib/hooks/context";
import { buildOrderedPaths, matchesQuery } from "./helpers";
import { s } from "./styles";

/**
 * A skill's attached documents (AC-9, AC-11, AC-12, AC-13). Repo-scoped —
 * uses the active repo (`lib/repo-context.tsx`), same as the standalone
 * Project Context page and the Agent Context tab (E-8).
 */
export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: listing } = useContextDocuments(repoId);
  const { data: attached } = useSkillContext(skill.id, repoId);
  const setSkillContext = useSetSkillContext(skill.id);

  const [query, setQuery] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const { data: preview } = useContextDocument(repoId, previewPath);
  const draggedPath = React.useRef<string | null>(null);

  if (!repoId) return <p style={s.empty}>{t("context.noRepo")}</p>;
  if (!listing || !attached) return <p style={s.empty}>{t("context.loading")}</p>;

  const docsByPath = new Map(listing.documents.map((d) => [d.path, d]));
  const attachedSet = new Set(attached.documents.map((a) => a.path));
  const orderedPaths = buildOrderedPaths(listing.documents, attached.documents);
  const visiblePaths = orderedPaths.filter(
    (p) => attachedSet.has(p) || matchesQuery(docsByPath.get(p), p, query),
  );

  const persist = (paths: string[]) => {
    // Only ever attached paths that still resolve against the current
    // listing — an escaped/garbage path never reaches the server (AC-16 is
    // enforced there too, this is just avoiding a doomed round trip).
    setSkillContext.mutate({ repo_id: repoId, paths });
  };

  const attachedOrder = [...attached.documents].sort((a, b) => a.order - b.order).map((a) => a.path);

  const toggle = (path: string) => {
    if (attachedSet.has(path)) persist(attachedOrder.filter((p) => p !== path));
    else persist([...attachedOrder, path]);
  };

  const reorder = (targetPath: string) => {
    const dragged = draggedPath.current;
    if (!dragged || dragged === targetPath) return;
    if (!attachedSet.has(dragged) || !attachedSet.has(targetPath)) return;
    const next = attachedOrder.filter((p) => p !== dragged);
    next.splice(next.indexOf(targetPath), 0, dragged);
    persist(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h3 style={s.title}>{t("context.title")}</h3>
        <Badge color="var(--accent)">{t("context.attachedTotal", { tokens: attached.total_tokens })}</Badge>
      </div>
      <p style={s.note}>{t("context.inheritNote")}</p>
      {/* NFR A04 — the attach surface states the outbound-data consequence. */}
      <p style={s.outboundNotice}>{t("context.outboundNotice")}</p>
      <p style={s.note}>{t("context.serializesAs")}</p>

      <TextInput value={query} onChange={setQuery} placeholder={t("context.searchPlaceholder")} />

      <div style={s.layout}>
        <div style={s.list}>
          {visiblePaths.length === 0 && <p style={s.empty}>{t("context.empty")}</p>}
          {visiblePaths.map((path) => {
            const doc = docsByPath.get(path);
            const linked = attachedSet.has(path);
            return (
              <div
                key={path}
                draggable={linked}
                onDragStart={() => (draggedPath.current = path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorder(path)}
                style={s.row}
              >
                {linked && <Icon.Menu size={14} style={s.dragHandle} />}
                <Checkbox checked={linked} onChange={() => toggle(path)} />
                <span style={s.path} onClick={() => setPreviewPath(path)}>
                  {path}
                </span>
                {doc && <Badge mono>{doc.type}</Badge>}
                {doc && <Badge>{t("context.tokens", { tokens: doc.tokens })}</Badge>}
              </div>
            );
          })}
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
