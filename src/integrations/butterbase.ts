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
  /** Optional transport that routes chat through another runtime (e.g. the
   *  RocketRide engine's llm_openai_api node). When set, chat() uses it. */
  private llmTransport: ((messages: ChatMessage[]) => Promise<string | null>) | null = null;

  constructor(private cfg: MomentumConfig) {}

  get live(): boolean {
    return this.cfg.butterbase.live;
  }

  /** Inject an alternate LLM transport (used to route via RocketRide). */
  setLlmTransport(fn: ((messages: ChatMessage[]) => Promise<string | null>) | null): void {
    this.llmTransport = fn;
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.butterbase.apiKey}` };
  }

  // ── AI Model Gateway (OpenAI-compatible) ──────────────────────────────────

  /** Chat completion via Butterbase. Returns assistant text. */
  async chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
    // If a RocketRide-backed transport is wired, prefer it so the call runs
    // through the engine's llm_openai_api node (RocketRide + Butterbase).
    if (this.llmTransport) {
      try {
        const viaEngine = await this.llmTransport(messages);
        if (viaEngine && viaEngine.trim()) return viaEngine;
      } catch {
        /* fall through to direct gateway call */
      }
    }
    if (!this.cfg.butterbase.live) {
      return localCompletion(messages, opts.json ?? false);
    }
    const base = this.cfg.butterbase.apiUrl.replace(/\/$/, "");
    const url = this.cfg.butterbase.appId
      ? `${base}/v1/${this.cfg.butterbase.appId}/chat/completions`
      : `${base}/v1/chat/completions`;
    const body = {
      model: this.cfg.butterbase.model,
      messages,
      max_tokens: opts.maxTokens ?? 2400,
      temperature: 0.4,
    };
    // One retry with backoff smooths over transient 402/429/5xx blips that can
    // happen under load on a low balance — keeps the demo on the real model.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await getJson<any>(url, {
          method: "POST",
          headers: this.authHeader(),
          body,
          timeoutMs: 60_000,
        });
        return res?.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        warnGatewayOnce((err as any)?.message ?? String(err));
        return localCompletion(messages, opts.json ?? false);
      }
    }
    return localCompletion(messages, opts.json ?? false);
  }

  /** Convenience: ask for JSON and parse it defensively. */
  async chatJson<T>(
    messages: ChatMessage[],
    fallback: T,
    opts: { maxTokens?: number } = {},
  ): Promise<T> {
    const raw = await this.chat(messages, { json: true, maxTokens: opts.maxTokens });
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
    const url = `${base}/v1/${this.cfg.butterbase.appId}/${table}`;
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
    const url = `${base}/v1/${this.cfg.butterbase.appId}/${table}`;
    try {
      const data = await getJson<any>(url, { headers: this.authHeader() });
      return Array.isArray(data) ? data : data?.rows ?? data?.data ?? [];
    } catch {
      return this.memTables.get(table) ?? [];
    }
  }
}

// ── Local fallback "LLM": deterministic, structured, good enough to demo ─────

let gatewayWarned = false;
/** Print a one-time, visible warning when the live gateway call fails. */
function warnGatewayOnce(message: string): void {
  if (gatewayWarned) return;
  gatewayWarned = true;
  const credits = /insufficient credits|402/i.test(message);
  console.warn(
    `\n⚠️  Butterbase AI gateway call failed — falling back to offline heuristics.` +
      (credits ? `\n   Reason: insufficient credits. Top up or switch BUTTERBASE_API_KEY.` : `\n   Reason: ${message.slice(0, 160)}`) +
      `\n`,
  );
}

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
    // Salvage a truncated object/array (e.g. max_tokens cutoff) by trimming to
    // the last complete element and closing open brackets.
    const salvaged = salvageJson(cleaned);
    if (salvaged) {
      try {
        return JSON.parse(salvaged) as T;
      } catch {
        /* fall through */
      }
    }
    return fallback;
  }
}

/** Best-effort repair of JSON truncated mid-stream. */
function salvageJson(s: string): string | null {
  if (!s) return null;
  // Cut to the last complete object boundary "}" that ends an array element.
  const lastClose = s.lastIndexOf("}");
  if (lastClose === -1) return null;
  let core = s.slice(0, lastClose + 1);
  // Balance brackets by appending the needed closers.
  const opens = (core.match(/[\[{]/g) ?? []).length;
  const closes = (core.match(/[\]}]/g) ?? []).length;
  let deficit = opens - closes;
  // Close arrays/objects; we don't know exact order, so close objects then arrays.
  while (deficit-- > 0) core += core.includes('"suggestions"') || core.includes('"fusions"') ? "]" : "}";
  // Ensure outer object closer if we opened one.
  if (core.trimStart().startsWith("{") && !core.trimEnd().endsWith("}")) core += "}";
  return core;
}
