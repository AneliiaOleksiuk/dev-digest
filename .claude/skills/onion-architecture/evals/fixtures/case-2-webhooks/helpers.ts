import type { SlackNotifier } from '../../adapters/slack/slack.js';

export function formatMessage(reviewId: string, findingCount: number): string {
  return `Review \`${reviewId}\` finished with ${findingCount} finding(s).`;
}

// Bundles formatting + delivery in one call so callers don't have to
// remember both steps every time a review finishes.
export async function formatAndNotify(
  notifier: SlackNotifier,
  channel: string,
  reviewId: string,
  findingCount: number,
): Promise<void> {
  await notifier.send({ channel, text: formatMessage(reviewId, findingCount) });
}
