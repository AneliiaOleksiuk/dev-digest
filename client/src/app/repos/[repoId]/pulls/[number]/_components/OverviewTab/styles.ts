import type { CSSProperties } from "react";

export const s = {
  // Intent | Blast side-by-side on desktop; stacks under ~380px (design mock).
  intentBlastRow: {
    display: "grid",
    // min(..., 100%) lets columns shrink below 380px so long mono paths
    // don't force the Blast card wider than the viewport.
    gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
} as const;
