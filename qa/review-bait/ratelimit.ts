/** Demo rate limiter for the review-bait fixture — minor issues on purpose
 *  (SUGGESTION-tier bait), do not copy into real code. */
interface Req {
  ip: string;
}
interface Res {
  status: (code: number) => { end: () => void };
}
interface Redis {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<void>;
}

const redis: Redis = {
  incr: async () => 1,
  expire: async () => {},
};

function bucketKey(req: Req): string {
  return `ratelimit:${req.ip}`;
}

export async function rateLimit(req: Req, res: Res, next: () => void) {
  const key = bucketKey(req);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);

  if (count > 100) {
    // No Retry-After header, so a well-behaved client has no idea when to
    // retry — worth adding for the 429 response.
    return res.status(429).end();
  }
  return next();
}
