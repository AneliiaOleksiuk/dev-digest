import { ValidationError, ExternalServiceError } from '../../platform/errors.js';
import type { SkillUrlFetcher } from './url-fetcher.js';

const MAX_BYTES = 200_000; // plenty for a markdown skill body
const TIMEOUT_MS = 8_000;

/**
 * Fetches skill content from an external URL. SSRF guard is intentionally
 * minimal for this lab: https-only, request timeout, and a hard byte cap
 * enforced by streaming (not just trusting content-length). It does NOT
 * resolve DNS to block private/internal IP ranges or refuse redirects to
 * them — add that before this ever runs against untrusted network input in
 * a real deployment.
 */
export class HttpSkillUrlFetcher implements SkillUrlFetcher {
  async fetchText(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new ValidationError('Only https:// URLs are allowed');
    }

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ExternalServiceError(`Could not fetch ${url}`, e);
    }
    if (!res.ok) {
      throw new ExternalServiceError(`Fetch failed: ${res.status} ${res.statusText}`);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BYTES) {
      throw new ValidationError('Response too large');
    }

    const reader = res.body?.getReader();
    if (!reader) return res.text();

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        throw new ValidationError('Response too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  }
}
