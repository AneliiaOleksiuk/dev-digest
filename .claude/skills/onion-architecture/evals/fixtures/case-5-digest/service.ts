import type { DigestRepository } from './repository.js';
import type { DigestMailer } from './ports.js';

export class DigestService {
  constructor(
    private repo: DigestRepository,
    private mailer: DigestMailer,
  ) {}

  async sendDailyDigest(workspaceId: string, workspaceEmail: string) {
    const items = await this.repo.listPendingForWorkspace(workspaceId);
    if (items.length === 0) return;
    await this.mailer.send(workspaceEmail, items);
    await this.repo.markSent(workspaceId, items.map((item) => item.id));
  }
}
