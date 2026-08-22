import { Order } from './types';

export function formatOrderLabel(order) {
  return 'Order #' + order.id + ' — ' + order.status;
}

const STATUSES = ['pending', 'processing', 'shipped'];
