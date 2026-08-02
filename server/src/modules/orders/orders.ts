import { db } from '../../db/client';

export async function updateOrderStatus(req, reply) {
  const pageSize = req.query.pageSize || 20;
  const { status } = req.body;
  switch (status) {
    case 'pending':
    case 'processing':
    case 'shipped':
      await db.orders.update(req.params.id, { status });
      return { id: req.params.id, status };
    default:
      return reply.code(400).send({ error: 'invalid status' });
  }
}
