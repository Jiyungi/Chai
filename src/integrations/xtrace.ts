import type { MomentumConfig } from "../config.js";

interface IngestMessage {
  role: "user" | "assistant";
  content: string;
}

interface SearchHit {
  text: string;
  score?: number;
}

/**
 * XTrace = the self-revising memory layer. We write what we learn about each
 * repo (signals, suggestions, decisions) as conversation turns; XTrace extracts
 * durable facts and reconciles contradictions over time. On the next run we
 * recall prior facts to compute "what changed since last week".
 *
 * Uses @xtraceai/memory when a key is present; otherwise a local JSONL store
 * with naive keyword recall so the "memory" experience still works offline.
 */
export class Memory {
  private client: any | null = null;
  private localPath: string;
  private localFacts: { user_id: string; text: string; at: string }[] = [];
  private loaded = false;

  constructor(private cfg: MomentumConfig) {
    this.localPath = ".momentum-cache/memory.jsonl";
  }

  get live(): boolean {
    return this.cfg.xtrace.live;
  }

  private async ensureClient(): Promise<any | null> {
    if (!this.cfg.xtrace.live) return null;
    if (this.client) return this.client;
    try {
      const mod: any = await import("@xtraceai/memory");
      const MemoryClient = mod.MemoryClient ?? mod.default?.MemoryClient;
      this.client = new MemoryClient({
        apiKey: this.cfg.xtrace.apiKey!,
        orgId: this.cfg.xtrace.orgId,
      });
      return this.client;
    } catch {
      // SDK not installed → behave as offline.
      return null;
    }
  }

  private async loadLocal(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const fs = await import("node:fs/promises");
      const raw = await fs.readFile(this.localPath, "utf8");
      this.localFacts = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      this.localFacts = [];
    }
  }

  private async appendLocal(userId: string, text: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(".momentum-cache", { recursive: true });
    const rec = { user_id: userId, text, at: new Date().toISOString() };
    this.localFacts.push(rec);
    await fs.appendFile(this.localPath, JSON.stringify(rec) + "\n", "utf8");
  }

  /** Ingest a set of facts about a repo as a conversation turn. */
  async remember(userId: string, facts: string[], convId: string): Promise<number> {
    if (facts.length === 0) return 0;
    const client = await this.ensureClient();
    const summary = facts.map((f) => `- ${f}`).join("\n");
    const messages: IngestMessage[] = [
      { role: "user", content: `New findings for ${userId}:\n${summary}` },
      { role: "assistant", content: "Noted and stored as durable facts." },
    ];
    if (client) {
      try {
        const job = await client.memories.ingest({ messages, user_id: userId, conv_id: convId });
        await client.memories.jobs.pollUntilDone(job.id);
        return facts.length;
      } catch {
        /* fall through to local */
      }
    }
    await this.loadLocal();
    for (const f of facts) await this.appendLocal(userId, f);
    return facts.length;
  }

  /** Recall prior facts relevant to a query (used for change detection + Q&A). */
  async recall(userId: string, query: string, limit = 8): Promise<SearchHit[]> {
    const client = await this.ensureClient();
    if (client) {
      try {
        const res = await client.memories.search({ query, user_id: userId, limit });
        return (res?.data ?? []).map((m: any) => ({ text: m.text, score: m.score }));
      } catch {
        /* fall through */
      }
    }
    await this.loadLocal();
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    return this.localFacts
      .filter((f) => f.user_id === userId)
      .map((f) => {
        const hay = f.text.toLowerCase();
        const score = terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0) / (terms.length || 1);
        return { text: f.text, score };
      })
      .filter((h) => (h.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }
}
