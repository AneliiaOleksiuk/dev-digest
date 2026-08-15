"use client";

import React from "react";
import type {
  FindingRecord,
  PrFile,
  SmartDiffFile,
  SmartDiffGroup,
  SmartDiffResponse,
  SmartDiffRole,
} from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { FocusDiffLineOptions, FocusFindingsOptions } from "@/lib/types";
import { RoleGroup, defaultFileOpen } from "./_components/RoleGroup";
import { SplitSuggestionBanner } from "./_components/SplitSuggestionBanner";
import { s } from "./styles";

function withCoverageFallback(groups: SmartDiffGroup[], files: PrFile[]): SmartDiffGroup[] {
  const covered = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
  const missing = files.filter((f) => !covered.has(f.path));
  if (missing.length === 0) return groups;

  const extras: SmartDiffFile[] = missing.map((f) => ({
    path: f.path,
    pseudocode_summary: null,
    additions: f.additions,
    deletions: f.deletions,
    finding_lines: [],
  }));

  const next = groups.map((g) => ({ ...g, files: [...g.files] }));
  const core = next.find((g) => g.role === "core");
  if (core) {
    core.files.push(...extras);
    return next;
  }
  return [{ role: "core" as SmartDiffRole, files: extras }, ...next];
}

function initialOpenMap(groups: SmartDiffGroup[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const group of groups) {
    for (const file of group.files) {
      map[file.path] = defaultFileOpen(group.role, file);
    }
  }
  return map;
}

/** Core + wiring start expanded; only boilerplate starts collapsed. Lives
 *  here (not in RoleGroup) so onJumpToLine/externalFocus can force a
 *  collapsed group open before scrolling to a file inside it (AC-30). */
function defaultGroupOpen(role: SmartDiffRole): boolean {
  return role === "core" || role === "wiring";
}

function initialGroupOpenMap(groups: SmartDiffGroup[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const group of groups) {
    map[group.role] = defaultGroupOpen(group.role);
  }
  return map;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  findings,
  commenting,
  onFocusFindings,
  showSplitBanner = true,
  externalFocus,
}: {
  smartDiff: SmartDiffResponse;
  files: PrFile[];
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
  /** When false, DiffTab owns the banner (both order modes). */
  showSplitBanner?: boolean;
  /** A `path:line` to expand-then-scroll to (SPEC-03 AC-30) — drives the
   *  SAME `onJumpToLine` this viewer already uses internally for its own
   *  finding-badge clicks. `null`/`undefined` — no pending focus. */
  externalFocus?: FocusDiffLineOptions | null;
}) {
  const groups = React.useMemo(
    () => withCoverageFallback(smartDiff.groups, files),
    [smartDiff.groups, files],
  );
  const fileByPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>(() => initialOpenMap(groups));
  const [groupOpenMap, setGroupOpenMap] = React.useState<Record<string, boolean>>(() =>
    initialGroupOpenMap(groups),
  );
  const roleByPath = React.useMemo(() => {
    const map = new Map<string, SmartDiffRole>();
    for (const group of groups) {
      for (const file of group.files) map.set(file.path, group.role);
    }
    return map;
  }, [groups]);

  // Re-seed defaults when the smart-diff payload identity changes (new review / re-fetch).
  const groupsKey = React.useMemo(
    () =>
      groups
        .map((g) => `${g.role}:${g.files.map((f) => `${f.path}@${f.finding_lines.join(",")}`).join("|")}`)
        .join(";"),
    [groups],
  );
  React.useEffect(() => {
    setOpenMap(initialOpenMap(groups));
    setGroupOpenMap(initialGroupOpenMap(groups));
    // groupsKey is the stable identity; groups is derived from the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);

  const setFileOpen = (path: string, open: boolean) => {
    setOpenMap((prev) => ({ ...prev, [path]: open }));
  };

  const setGroupOpen = (role: SmartDiffRole, open: boolean) => {
    setGroupOpenMap((prev) => ({ ...prev, [role]: open }));
  };

  const onJumpToLine = (path: string, line: number) => {
    setFileOpen(path, true);
    // A file's own FileCard never mounts while its enclosing RoleGroup is
    // collapsed (e.g. boilerplate, or any group the user collapsed by hand)
    // — force the group open too, or the querySelector below finds nothing
    // and scrollIntoView silently no-ops (AC-30).
    const role = roleByPath.get(path);
    if (role) setGroupOpen(role, true);
    // Wait for FileCard controlled-open to commit before querying the line.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-diff-line="${path}:${line}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  };

  // AC-30/E-22 — jump on mount and whenever the external focus target
  // changes; no-op when the path isn't part of this PR's loaded files.
  React.useEffect(() => {
    if (!externalFocus) return;
    if (!fileByPath.has(externalFocus.path)) return;
    onJumpToLine(externalFocus.path, externalFocus.line);
    // onJumpToLine is a stable closure over setOpenMap; keying on the focus
    // value itself is what should re-trigger the jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFocus?.path, externalFocus?.line, fileByPath]);

  const { too_big, total_lines, proposed_splits } = smartDiff.split_suggestion;

  return (
    <div style={s.root}>
      {showSplitBanner && too_big && (
        <SplitSuggestionBanner totalLines={total_lines} proposedSplits={proposed_splits} />
      )}
      {groups.map((group) => (
        <RoleGroup
          key={group.role}
          role={group.role}
          files={group.files}
          fileByPath={fileByPath}
          findings={findings}
          commenting={commenting}
          onFocusFindings={onFocusFindings}
          openMap={openMap}
          setFileOpen={setFileOpen}
          onJumpToLine={onJumpToLine}
          groupOpen={groupOpenMap[group.role] ?? defaultGroupOpen(group.role)}
          setGroupOpen={(open) => setGroupOpen(group.role, open)}
        />
      ))}
    </div>
  );
}
