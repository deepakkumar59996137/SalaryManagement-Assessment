import { z } from 'zod';
import { ValidationError } from './errors';
import { toErrorResponse } from './errors';

/**
 * Helpers shared by every route handler.
 *
 * Route handlers stay thin: parse, delegate to a service, serialise. This
 * module holds the parsing and the error mapping so none of it is repeated.
 */

/** Wrap a handler so any thrown AppError becomes the right status code. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** Parse a JSON body, turning a schema failure into a 400 with field details. */
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Request body is not valid JSON');
  }

  return parse(body, schema);
}

/** Parse URL search params against a schema. */
export function parseQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const params = new URL(request.url).searchParams;
  // Repeated keys collapse to the last value; no query parameter here is a list.
  return parse(Object.fromEntries(params.entries()), schema);
}

export function parse<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));

  throw new ValidationError(details[0]?.message ?? 'Request is not valid', details);
}
