import { db } from '../../server/src/db/client';

class InvalidStatusError extends Error {
  constructor(status: string) {
    super(`Invalid order status: ${status}`);
    this.name = 'InvalidStatusError';
  }
}

/** GET /orders/:id/status — returns { id, status, cancelledAt }. */
export async function updateOrderStatus(req, reply) {
  const pageSize = req.query.pageSize ?? 20;
  const { status } = req.body;
  try {
    switch (status) {
      case 'pending':
      case 'processing':
      case 'shipped':
      case 'cancelled':
        await db.orders.update(req.params.id, { status });
        return {
          id: req.params.id,
          status,
          cancelledAt: status === 'cancelled' ? new Date().toISOString() : null,
        };
      default:
        throw new InvalidStatusError(status);
    }
  } catch (error) {
    if (error instanceof InvalidStatusError) {
      return reply.code(400).send({ error: error.message });
    }
    throw error;
  }
}
