import type {
  ApiErrorBody,
  HealthResponse,
  OverviewResponse,
  QueryResponse,
  SchemaResponse,
} from "./types";

/**
 * Public base URL of the DataPulse API. This is NOT a secret: the browser
 * talks to the backend directly, and the backend holds every credential.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, {
      statusCode: 0,
      code: "NETWORK_ERROR",
      message: `Cannot reach the DataPulse API at ${API_BASE_URL}. Make sure the backend is running.`,
    });
  } finally {
    clearTimeout(timer);
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body =
      data && typeof data === "object" && "code" in data
        ? (data as ApiErrorBody)
        : { statusCode: res.status, code: "HTTP_ERROR", message: `Request failed (${res.status}).` };
    throw new ApiError(res.status, body);
  }
  return data as T;
}

export const api = {
  query: (prompt: string, signal?: AbortSignal) =>
    request<QueryResponse>("/analytics/query", {
      method: "POST",
      body: JSON.stringify({ prompt }),
      signal,
      timeoutMs: 90_000,
    }),
  schema: () => request<SchemaResponse>("/analytics/schema"),
  overview: () => request<OverviewResponse>("/analytics/overview"),
  health: () => request<HealthResponse>("/health", { timeoutMs: 8_000 }),
};
