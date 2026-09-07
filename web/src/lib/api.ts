/**
 * The backend, which is one process serving /identity, /documents, /intel and
 * the agent's /health — so one base URL, not one per concern.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Surfaces the backend's own `message` rather than an HTTP code. Its errors are
 * written to be read by a person ("sign in with the wallet being verified"),
 * and replacing them with "request failed" throws away the useful half.
 */
export async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;

  if (!res.ok) {
    throw new ApiError(
      body?.message ?? body?.error ?? `${res.status} ${res.statusText}`,
      res.status,
      body?.error,
    );
  }
  if (body === null) throw new ApiError("backend returned no body", res.status);
  return body;
}
