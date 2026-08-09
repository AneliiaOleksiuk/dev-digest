import { rateLimit } from '../rateLimit';

/** Fixture Fastify-style public items route. */
export function registerPublicItems(app: {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
}) {
  app.get('/api/public/items', (req: { ip?: string; url?: string }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!rateLimit(req)) return reply.code(429).send({ error: 'rate_limited' });
    return { items: [] };
  });
}
