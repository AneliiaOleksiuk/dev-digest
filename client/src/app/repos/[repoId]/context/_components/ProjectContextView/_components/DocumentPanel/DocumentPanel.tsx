"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Markdown, Skeleton, Textarea } from "@devdigest/ui";
import { useContextDocument, useSaveContextDocument } from "@/lib/hooks/context";
import { ApiError } from "@/lib/api";
import { ds } from "./styles";

type Mode = "preview" | "edit";

/**
 * Preview/Edit panel for one selected document (AC-33/AC-34/AC-37/AC-39/
 * AC-40, WI8). Owns its own data fetching (`useContextDocument`/
 * `useSaveContextDocument`) — the parent only passes which path is
 * selected, matching this repo's "components never call fetch directly,
 * hooks own it" rule.
 */
export function DocumentPanel({
  repoId,
  path,
  onDirtyChange,
}: {
  repoId: string | null | undefined;
  path: string | null;
  /** Lets the parent gate switching to a different document while this
   *  panel has unsaved edits (UX-13). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations("context");
  const [mode, setMode] = React.useState<Mode>("preview");
  const [draft, setDraft] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [saveError, setSaveError] = React.useState(false);

  const { data: doc, isLoading, isError, refetch } = useContextDocument(repoId, path);
  const save = useSaveContextDocument(repoId);

  const dirty = mode === "edit" && doc != null && draft !== doc.content;

  // Selecting a different document always resets edit state — never carry a
  // stale draft or a stale conflict banner across documents.
  React.useEffect(() => {
    setMode("preview");
    setDraft("");
    setConflict(false);
    setSaveError(false);
  }, [path]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // UX-13 — guard leaving the page (tab close/navigate away) with unsaved
  // edits still in the textarea.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function enterEdit() {
    setConflict(false);
    setSaveError(false);
    // AC-33 — populate the editor from a FRESH read, never the cached body.
    const fresh = await refetch();
    setDraft(fresh.data?.content ?? "");
    setMode("edit");
  }

  function cancelEdit() {
    if (dirty && !window.confirm(t("edit.discardConfirm"))) return;
    setMode("preview");
  }

  async function handleSave() {
    if (!doc) return;
    setConflict(false);
    setSaveError(false);
    try {
      await save.mutateAsync({ path: doc.path, content: draft, revision: doc.revision });
      setMode("preview");
    } catch (err) {
      // AC-37 vs AC-39 — a stale save (409) is a distinct, retriable-by-
      // reloading message, never the generic write-failure message.
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
      } else {
        setSaveError(true);
      }
    }
  }

  if (!path) {
    return <p style={ds.placeholder}>{t("preview.placeholder")}</p>;
  }
  if (isLoading) {
    return <Skeleton height={200} />;
  }
  if (isError || !doc) {
    return <ErrorState body={t("preview.loadError")} />;
  }

  return (
    <>
      <div style={ds.header}>
        <div style={ds.headerLeft}>
          <span className="mono" style={ds.path}>
            {doc.path}
          </span>
          {dirty && <span style={ds.dirtyDot} title={t("edit.dirty")} />}
        </div>
        {mode === "preview" ? (
          <Button size="sm" kind="secondary" icon="Edit" onClick={() => void enterEdit()}>
            {t("edit.toggleEdit")}
          </Button>
        ) : (
          <Button size="sm" kind="secondary" icon="Eye" onClick={cancelEdit}>
            {t("edit.toggleView")}
          </Button>
        )}
      </div>

      {mode === "preview" ? (
        <div style={ds.body}>
          <Markdown>{doc.content}</Markdown>
        </div>
      ) : (
        <div style={ds.editStack}>
          {conflict && <p style={ds.banner}>{t("edit.conflict")}</p>}
          {saveError && <p style={ds.banner}>{t("edit.saveError")}</p>}
          <Textarea value={draft} onChange={setDraft} rows={16} mono />
          {/* UX-14 — say plainly that Save writes a file and does not commit it. */}
          <p style={ds.writeNotice}>{t("edit.writeNotice")}</p>
          <div style={ds.actions}>
            <Button size="sm" kind="secondary" onClick={cancelEdit}>
              {t("edit.cancel")}
            </Button>
            <Button
              size="sm"
              kind="primary"
              icon="Check"
              disabled={!dirty || save.isPending}
              loading={save.isPending}
              onClick={() => void handleSave()}
            >
              {t("edit.save")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
