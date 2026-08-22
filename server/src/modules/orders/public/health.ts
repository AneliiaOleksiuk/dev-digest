import { rateLimit } from '../rateLimit';

/** Fixture public health route (rate-limited on purpose for blast demo). */
export function registerPublicHealth(app: {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
}) {
  app.get('/api/public/health', (req: { ip?: string; url?: string }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!rateLimit(req)) return reply.code(429).send({ error: 'rate_limited' });
    return { status: 'ok' };
  });
}
