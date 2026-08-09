/**
 * Thin fetch wrapper over the local Fastify API (`@devdigest/api`, :3001).
 * This is the ONLY module in `mcp/` that talks to the network — see
 * docs/plans/mcp-server.md WI2 for why this is HTTP-only, not an in-process
 * import of `server/src`. No credentials: the API has no route-level auth
 * (LocalNoAuthProvider), so this client sends none.
 */

/** Thrown when `fetch` itself rejects (connection refused, DNS, etc). */
export class ApiUnreachableError extends Error {
  constructor(public readonly baseUrl: string) {
    super(`Cannot reach the DevDigest API at ${baseUrl}`);
    this.name = 'ApiUnreachableError';
  }
}

/**
 * Thrown for a non-2xx HTTP response. Carries only the parsed
 * `{error:{code,message}}` envelope (`server/src/app.ts`'s `setErrorHandler`)
 * — never the raw response body, which could contain stack traces or
 * upstream provider errors.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  readonly baseUrl: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

const DEFAULT_BASE_URL = 'http://localhost:3001';

/**
 * @param baseUrl Defaults to `DEVDIGEST_API_BASE`, then `http://localhost:3001`
 *   (mirrors `client/.env.example`'s `NEXT_PUBLIC_API_BASE`).
 * @param fetchImpl Injectable for tests — avoids global `fetch` stubbing.
 */
export function createApiClient(
  baseUrl: string = process.env.DEVDIGEST_API_BASE ?? DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
    } catch {
      throw new ApiUnreachableError(baseUrl);
    }
    if (!res.ok) {
      let code = 'unknown_error';
      let message = `Request failed with status ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body?.error?.code) code = body.error.code;
        if (body?.error?.message) message = body.error.message;
      } catch {
        // Non-JSON body — never forward the raw text, it may leak internals.
      }
      throw new ApiError(res.status, code, message);
    }
    return (await res.json()) as T;
  }

  return {
    baseUrl,
    get: (path) => request(path),
    post: (path, body) =>
      request(path, {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
  };
}
