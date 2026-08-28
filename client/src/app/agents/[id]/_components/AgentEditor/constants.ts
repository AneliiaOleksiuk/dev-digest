import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Part-0 ships Config only; later lessons add the rest. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "Folder" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "GitBranch" },
];

/** URL `?tab=` allow-list — MUST stay in sync with `TABS` or a new tab
 *  is visible in the bar but clicking it snaps back to Config
 *  (`agents/[id]/page.tsx`). Derived, not a second handwritten list. */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);
