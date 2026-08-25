/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

/** A save whose on-disk state moved since the caller's read (AC-37) — a
 *  distinct 4xx from `ValidationError`'s 422 (Rec-2) so the client can tell
 *  "reload and retry" (409) apart from "never retriable" (422/AC-36/AC-43)
 *  without inspecting the error code string. */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('conflict', message, 409, details);
  }
}

/** Failed/missing bearer-style credential on a non-session-authenticated
 *  route (currently only `POST /ci/ingest`, SPEC-04 AC-51) — 401, and the
 *  message must never carry the presented token, its hash, or any other
 *  secret material (A09). */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super('unauthorized', message, 401, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}
