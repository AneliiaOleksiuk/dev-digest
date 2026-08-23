import type { DigestItemRow } from '../../db/rows.js';

export function renderDigestSummary(items: DigestItemRow[]): string {
  return items.map((item) => `<li>${item.title}</li>`).join('\n');
}
