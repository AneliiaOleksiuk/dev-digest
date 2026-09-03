import { rateLimit, bucketKey } from './rateLimit';
import { registerPublicItems } from './public/index';
import { registerPublicWebhooks } from './public/webhooks';
import { registerPublicHealth } from './public/health';

/** Fixture app entry — wires public routes that call rateLimit(). */
export function createPublicApi(app: {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
  post: (path: string, handler: (...args: unknown[]) => unknown) => void;
}) {
  registerPublicItems(app);
  registerPublicWebhooks(app);
  registerPublicHealth(app);

  // Extra direct caller of rateLimit (matches blast mock's src/server.ts:88).
  app.get('/api/public/ping', (req: { ip?: string; url?: string }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!rateLimit(req)) return reply.code(429).send({ error: 'rate_limited' });
    return { pong: true, key: bucketKey(req.ip ?? '0.0.0.0', '/api/public/ping') };
  });
}

/** Hourly bucket reset — picked up by extractCrons. */
export function scheduleRateBucketReset(cron: { schedule: (expr: string, fn: () => void) => void }) {
  cron.schedule('0 * * * *', () => {
    // reset-rate-buckets (hourly)
    void bucketKey('reset', 'all');
  });
}
