/** Tiny fetch wrapper with timeout + JSON helpers, no external deps. */

export class HttpError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, body, timeoutMs = 20_000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return text;
}
