import type { AnalyticsRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import { ReviewRepository } from '../reviews/repository.js';
import { computeFindingsTrend } from './helpers.js';

export class AnalyticsService {
  private reviewRepo: ReviewRepository;

  constructor(
    private repo: AnalyticsRepository,
    private db: Db,
  ) {
    this.reviewRepo = new ReviewRepository(this.db);
  }

  async recordWeeklySnapshot(workspaceId: string) {
    const recentReviews = await this.reviewRepo.listRecentForWorkspace(workspaceId);
    const trend = computeFindingsTrend(recentReviews);
    return this.repo.insertSnapshot({
      workspaceId,
      findingsTrend: trend,
      createdAt: new Date(),
    });
  }

  async listSnapshots(workspaceId: string) {
    return this.repo.listSnapshots(workspaceId);
  }
}
