import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { NotificationRepository, type NotificationRow } from './repository.js';
import { notificationToDto, type NotificationDto } from './helpers.js';

export class NotificationService {
  private repo: NotificationRepository;

  constructor(private container: Container) {
    this.repo = new NotificationRepository(container.db);
  }

  async listForWorkspace(workspaceId: string): Promise<NotificationDto[]> {
    const rows = await this.repo.listForWorkspace(workspaceId);
    return rows.map(notificationToDto);
  }

  async markRead(workspaceId: string, id: string): Promise<NotificationDto> {
    const row = await this.repo.markRead(workspaceId, id);
    if (!row) throw new NotFoundError('Notification not found');
    return notificationToDto(row);
  }

  async create(workspaceId: string, message: string): Promise<NotificationDto> {
    const row = await this.repo.insert({ workspaceId, message, createdAt: new Date() });
    return notificationToDto(row);
  }
}
