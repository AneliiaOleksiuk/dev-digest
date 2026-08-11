import type { ApiClient } from '../src/api-client.js';

/**
 * Hermetic stand-in for `ApiClient` — no `fetch`, no API, no DB, no Docker
 * (per TESTING.md's philosophy). GET/POST are backed by plain functions so
 * each test can script exactly the sequence of responses it needs (e.g. a
 * poll loop's running → running → done).
 */
export function createFakeApi(handlers: {
  get?: (path: string) => unknown;
  post?: (path: string, body?: unknown) => unknown;
  baseUrl?: string;
}): ApiClient {
  return {
    baseUrl: handlers.baseUrl ?? 'http://localhost:3001',
    get: async <T>(path: string): Promise<T> => {
      if (!handlers.get) throw new Error(`Unexpected GET ${path}`);
      return (await handlers.get(path)) as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      if (!handlers.post) throw new Error(`Unexpected POST ${path}`);
      return (await handlers.post(path, body)) as T;
    },
  };
}
