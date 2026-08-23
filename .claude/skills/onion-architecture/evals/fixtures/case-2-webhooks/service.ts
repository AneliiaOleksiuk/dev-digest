import type { Container } from '../../platform/container.js';
import type { WebhookRepository } from './repository.js';
import { SlackNotifier } from '../../adapters/slack/slack.js';
import { formatAndNotify } from './helpers.js';

export class WebhookService {
  private notifier: SlackNotifier;

  constructor(
    private repo: WebhookRepository,
    private container: Container,
  ) {
    this.notifier = new SlackNotifier(container.config.slackWebhookUrl);
  }

  async listForWorkspace(workspaceId: string) {
    return this.repo.listForWorkspace(workspaceId);
  }

  async register(workspaceId: string, targetUrl: string) {
    return this.repo.insert({ workspaceId, targetUrl, createdAt: new Date() });
  }

  async broadcastReviewCompleted(workspaceId: string, reviewId: string, findingCount: number) {
    const subs = await this.repo.listForWorkspace(workspaceId);
    for (const sub of subs) {
      await formatAndNotify(this.notifier, sub.targetUrl, reviewId, findingCount);
    }
  }
}
