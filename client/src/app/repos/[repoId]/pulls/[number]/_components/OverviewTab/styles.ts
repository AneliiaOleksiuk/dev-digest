import type { CSSProperties } from "react";

export const s = {
  // Intent | Blast Radius, side by side (WI13 layout rule: 1fr 1fr, stacking
  // under ~900px). `auto-fit`/`minmax` gives that breakpoint from pure CSS —
  // no JS media-query hook needed for a two-column-or-stack row.
  intentBlastRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
} as const;
