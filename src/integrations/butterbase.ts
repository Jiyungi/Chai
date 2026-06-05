import type { MomentumConfig } from "../config.js";
import { getJson, request, HttpError } from "../lib/http.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Butterbase = the backend. Two roles here:
 *  1. AI Model Gateway (OpenAI-compatible) for all synthesis/suggestions.
 *  2. Data API for persisting repos, signals, reports, and digests.
 *
 * Both fall back gracefully: no key → a deterministic local LLM stub + an
 * in-memory store, so the whole product still demonstrates end-to-end.
 */
export class Butterbase {
  private memTables = new Map<string, any[]>();

  constructor(private cfg: MomentumConfig) {}

  get live(): boolean {
    return this.cfg.butterbase.live;
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.butterbase.apiKey}` };
  }

  // ── AI Model Gateway (OpenAI-compatible) ──────────────────────────────────

  /** Chat completion via Butterbase. Returns assistant text. */
  async chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
    if (!this.cfg.butterbase.live) {
      return localCompletion(messages, opts.json ?? false);
    }
    const base = this.cfg.butterbase.apiUrl.replace(/\/$/, "");
    const url = this.cfg.butterbase.appId
      ? `${base}/v1/${this.cfg.butterbase.appId}/chat/completions`
      : `${base}/v1/chat/completions`;
    try {
      const res = await getJson<any>(url, {
        method: "POST",
        headers: this.authHeader(),
        body: {
          model: this.cfg.butterbase.model,
          messages,
          max_tokens: opts.maxTokens ?? 1200,
          temperature: 0.4,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        },
        timeoutMs: 60_000,
      });
      return res?.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      // Never let a gateway hiccup kill a demo.
      return localCompletion(messages, opts.json ?? false);
    }
  }

  /** Convenience: ask for JSON and parse it defensively. */
  async chatJson<T>(messages: ChatMessage[], fallback: T): Promise<T> {
    const raw = await this.chat(messages, { json: true });
    return safeParseJson<T>(raw, fallback);
  }

  // ── Data API (persistence) ────────────────────────────────────────────────

  /** Insert a row into a table. Live → Butterbase Data API; else in-memory. */
  async insert(table: string, row: Record<string, unknown>): Promise<void> {
    if (!this.cfg.butterbase.live || !this.cfg.butterbase.appId) {
      const arr = this.memTables.get(table) ?? [];
      arr.push({ id: arr.length + 1, ...row });
      this.memTables.set(table, arr);
      return;
    }
    const base = this.cfg.butterbase.apiUrl.replace(/\/$/, "");
    const url = `${base}/v1/${this.cfg.butterbase.appId}/data/${table}`;
    try {
      await request(url, { method: "POST", headers: this.authHeader(), body: row });
    } catch (err) {
      if (err instanceof HttpError) {
        // Table may not exist yet during a demo; keep going.
        return;
      }
      throw err;
    }
  }

  /** Read rows back (used by the agent / digest). */
  async select(table: string): Promise<any[]> {
    if (!this.cfg.butterbase.live || !this.cfg.butterbase.appId) {
      return this.memTables.get(table) ?? [];
    }
    const base = this.cfg.butterbase.apiUrl.replace(/\/$/, "");
    const url = `${base}/v1/${this.cfg.butterbase.appId}/data/${table}`;
    try {
      const data = await getJson<any>(url, { headers: this.authHeader() });
      return Array.isArray(data) ? data : data?.rows ?? data?.data ?? [];
    } catch {
      return this.memTables.get(table) ?? [];
    }
  }
}

// ── Local fallback "LLM": deterministic, structured, good enough to demo ─────

function localCompletion(messages: ChatMessage[], json: boolean): string {
  const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (json) {
    // The callers each supply their own fallback object via chatJson, so a
    // valid-but-empty object keeps the pipeline flowing.
    return "{}";
  }
  const topic = user.slice(0, 120).replace(/\s+/g, " ").trim();
  return (
    `[offline synthesis] Based on the provided context (${topic}…), the key opportunities are to ` +
    `adopt newer retrieval/eval techniques, watch the closest funded startups for positioning, and ` +
    `consider combining overlapping projects. Add a Butterbase API key to enable full AI synthesis.`
  );
}

export function safeParseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  // Strip markdown fences if a model wrapped the JSON.
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) {
      return fallback;
    }
    return parsed as T;
  } catch {
    // Try to extract the first {...} or [...] block.
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return fallback;
  }
}
