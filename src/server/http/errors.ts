/**
 * Errors services throw, and how they become HTTP responses.
 *
 * Services throw these; they know nothing about Response objects. The mapping
 * to status codes happens once, here, at the boundary — so a service can signal
 * "that employee does not exist" without importing anything web-shaped.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_FAILED', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 404, 'NOT_FOUND');
  }
}

/** The request was well formed but conflicts with the current state of the data. */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

/**
 * Turn any thrown value into a JSON response.
 *
 * Known errors keep their message, because it was written to be read by the HR
 * Manager. Anything else becomes a generic 500 and is logged — an unexpected
 * error message can carry a SQL fragment or a file path, and neither belongs
 * in a response body.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const body: ErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    return Response.json(body, { status: error.status });
  }

  console.error('Unhandled error in route handler:', error);
  const body: ErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  };
  return Response.json(body, { status: 500 });
}
