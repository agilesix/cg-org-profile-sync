/**
 * The CommonGrants response envelope.
 *
 * Every successful body carries the HTTP status and a human-readable message
 * alongside the payload, so a client that logs one response has enough to say
 * what happened without the transport context.
 */

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** A single resource, wrapped as `Responses.OkT<T>`. */
export function ok<T>(data: T, message = "Success", status = 200): Response {
  return new Response(JSON.stringify({ status, message, data }), {
    status,
    headers: JSON_HEADERS,
  });
}

/** A page of results, wrapped as `Responses.PaginatedT<T>`. */
export function paginated<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  totalItems: number,
  message = "Success",
): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      message,
      items,
      paginationInfo: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

/** An error, wrapped as `Responses.Error`. */
export function failure(status: number, message: string, errors: unknown[] = []): Response {
  return new Response(JSON.stringify({ status, message, errors }), {
    status,
    headers: JSON_HEADERS,
  });
}

export const badRequest = (message: string, errors: unknown[] = []) =>
  failure(400, message, errors);

export const unauthorized = (message = "This request needs a valid access token.") =>
  failure(401, message);

export const notFound = (message = "The server cannot find the requested resource.") =>
  failure(404, message);

export const unsupportedMediaType = (message: string) => failure(415, message);
