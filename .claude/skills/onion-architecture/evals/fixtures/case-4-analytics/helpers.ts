import type { ReviewRow } from '../../db/rows.js';

export function computeFindingsTrend(reviews: ReviewRow[]): number {
  if (reviews.length < 2) return 0;
  const sorted = [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = sorted[0].findingsCount ?? 0;
  const last = sorted[sorted.length - 1].findingsCount ?? 0;
  return last - first;
}
