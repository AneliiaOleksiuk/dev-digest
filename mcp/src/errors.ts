import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodType } from 'zod';
import { ApiError, ApiUnreachableError } from './api-client.js';

/**
 * The one and only way a tool handler reports failure. Never a thrown
 * protocol-level error — always a normal CallToolResult with `isError: true`
 * and one text block naming a concrete next step (principle #4: "error that
 * leads forward"). See the case table in docs/plans/mcp-server.md, WI6.
 */
export function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/**
 * Maps a thrown api-client error into the right `toolError`. Never forwards
 * a raw upstream response body or status code — only the parsed
 * `{code, message}` envelope (or a generic message when even that isn't
 * available), per the security constraint in docs/plans/mcp-server.md.
 */
export function apiFailureToolError(err: unknown, baseUrl: string): CallToolResult {
  if (err instanceof ApiUnreachableError) {
    return toolError(
      `Cannot reach the DevDigest API at ${baseUrl}. Start it with ./scripts/dev.sh (or cd server && pnpm dev), then retry.`,
    );
  }
  if (err instanceof ApiError) {
    return toolError(
      `The DevDigest API returned an error (${err.code}): ${err.message}. Fix the underlying issue, then retry.`,
    );
  }
  return toolError(
    'An unexpected error occurred while calling the DevDigest API. Check the API logs, then retry.',
  );
}

/**
 * Validates `value` against `schema` and builds the tool's success
 * `CallToolResult`. A schema mismatch (upstream API drifted, a version skew
 * between this package and the server) is reported through `toolError`
 * instead of letting the `ZodError` escape as a thrown protocol-level error —
 * same "never throw" contract as the rest of WI6.
 */
export function buildResult<T extends Record<string, unknown>>(
  schema: ZodType<T>,
  value: unknown,
  text: (structured: T) => string,
): CallToolResult {
  let structured: T;
  try {
    structured = schema.parse(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return toolError(
      `Internal error: the DevDigest API response did not match the expected shape (${detail}). This likely means the MCP server and API are out of sync — update both, then retry.`,
    );
  }
  return {
    content: [{ type: 'text', text: text(structured) }],
    structuredContent: structured,
  };
}
