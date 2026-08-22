/**
 * Shared rate-limit helpers for the payments-api fixture.
 * Blast Radius demo target: change this file → callers + HTTP endpoints light up.
 */

/** Per-bucket key used by public routes and the hourly reset job. */
export function bucketKey(ip: string, route: string): string {
  return `${ip}::${route}`;
}

/**
 * Returns true when the request is within quota.
 * Called from every public route registration below.
 */
export function rateLimit(req: { ip?: string; url?: string }): boolean {
  const key = bucketKey(req.ip ?? '0.0.0.0', req.url ?? '/');
  // Fixture only — always allow; real limiter would consult Redis.
  void key;
  return true;
}
