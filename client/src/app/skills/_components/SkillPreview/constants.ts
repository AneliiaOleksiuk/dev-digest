import type { IconName } from "@devdigest/ui";

export const TYPE_OPTIONS = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
] as const;

export interface PreviewTab {
  key: "overview" | "history";
  labelKey: string;
  icon: IconName;
}

export const PREVIEW_TABS: readonly PreviewTab[] = [
  { key: "overview", labelKey: "preview.tabs.overview", icon: "FileText" },
  { key: "history", labelKey: "preview.tabs.history", icon: "History" },
];
