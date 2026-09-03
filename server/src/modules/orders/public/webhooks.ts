import { rateLimit } from '../rateLimit';

/** Fixture public webhooks route. */
export function registerPublicWebhooks(app: {
  post: (path: string, handler: (...args: unknown[]) => unknown) => void;
}) {
  app.post('/api/public/webhooks', (req: { ip?: string; url?: string }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!rateLimit(req)) return reply.code(429).send({ error: 'rate_limited' });
    return { ok: true };
  });
}
