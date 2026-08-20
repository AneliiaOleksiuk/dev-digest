import type { NotificationRow } from './repository.js';

export interface NotificationDto {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function notificationToDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    message: row.message,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
