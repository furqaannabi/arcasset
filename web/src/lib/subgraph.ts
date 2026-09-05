import { SUBGRAPH_URL } from "./chain";

/**
 * The subgraph is the only read path for the UI — docs/01-architecture.md.
 * Do not add direct-RPC reads here for anything the subgraph indexes.
 */

export class SubgraphError extends Error {
  constructor(message: string, readonly errors?: unknown) {
    super(message);
    this.name = "SubgraphError";
  }
}

export async function query<T>(
  document: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!SUBGRAPH_URL) {
    throw new SubgraphError("NEXT_PUBLIC_SUBGRAPH_URL is not set");
  }

  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    signal,
  });

  if (!res.ok) {
    // Surface the real failure — docs/05-web.md forbids "something went wrong".
    throw new SubgraphError(`subgraph HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) {
    const first = json.errors[0] as { message?: string };
    throw new SubgraphError(first?.message ?? "subgraph query failed", json.errors);
  }
  if (!json.data) throw new SubgraphError("subgraph returned no data");
  return json.data;
}

/** Blocks of indexer lag we tolerate before warning the user. Matches the agent's rail. */
export const MAX_LAG_BLOCKS = 200;

export const META_QUERY = `
  query Meta {
    _meta { block { number timestamp } hasIndexingErrors }
  }
`;

export type Meta = {
  _meta: {
    block: { number: number; timestamp: number | null };
    hasIndexingErrors: boolean;
  } | null;
};

export async function fetchMeta(signal?: AbortSignal) {
  return query<Meta>(META_QUERY, {}, signal);
}
