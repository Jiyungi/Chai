import type { MomentumConfig } from "../config.js";
import type { Repo, Signal } from "../types.js";
import { getJson, getText } from "../lib/http.js";

/**
 * Discovery = the "trend radar". Pulls real-world signals related to a repo:
 *  - OSS: GitHub code search for similar, recently-active projects
 *  - Papers: arXiv API (live), newest first, matched to repo topics
 *  - Startups/Investors: curated sector map + optional live enrichment
 *
 * GitHub + arXiv are live whenever the network allows (no keys needed). The
 * startup/investor layer ships with a sector knowledge base and is designed to
 * be enriched by the AI gateway during synthesis.
 */
export class Discovery {
  constructor(private cfg: MomentumConfig) {}

  /** Build a compact query string from a repo's signals. */
  private repoQuery(repo: Repo): string {
    const parts = [repo.language, ...(repo.topics ?? [])].filter(Boolean);
    if (parts.length === 0 && repo.description) {
      parts.push(...repo.description.split(/\s+/).slice(0, 4));
    }
    return parts.slice(0, 6).join(" ");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "momentum-hackathon-tool",
    };
    if (this.cfg.github.token) h.Authorization = `Bearer ${this.cfg.github.token}`;
    return h;
  }

  /** Related, recently active open-source repos (excludes the repo itself). */
  async relatedOSS(repo: Repo, limit = 5): Promise<Signal[]> {
    const topics = (repo.topics ?? []).slice(0, 3);
    const langQ = repo.language ? `language:${repo.language}` : "";
    const topicQ = topics.length ? topics.map((t) => `topic:${t}`).join(" ") : repo.name;
    const q = encodeURIComponent(`${topicQ} ${langQ} pushed:>2025-01-01`.trim());
    const url = `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=${
      limit + 1
    }`;
    try {
      const data = await getJson<{ items: any[] }>(url, { headers: this.headers() });
      return (data.items ?? [])
        .filter((r) => r.full_name !== repo.fullName)
        .slice(0, limit)
        .map((r) => ({
          kind: "oss" as const,
          title: r.full_name,
          url: r.html_url,
          summary: r.description ?? "(no description)",
          source: "github",
          publishedAt: r.pushed_at,
          relevance: scoreOverlap(repo, r.description ?? "", r.topics ?? []),
        }));
    } catch {
      return [];
    }
  }

  /** Recent research papers from arXiv matched to the repo. */
  async relatedPapers(repo: Repo, limit = 5): Promise<Signal[]> {
    const query = this.repoQuery(repo) || repo.name;
    const search = encodeURIComponent(`all:${query}`);
    const url = `https://export.arxiv.org/api/query?search_query=${search}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
    try {
      const xml = await getText(url, {
        headers: { "User-Agent": "momentum-hackathon-tool" },
      });
      return parseArxiv(xml, repo).slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Startups + the investors who funded them, by sector. Curated knowledge base
   * keyed off repo topics/keywords; the synthesis step can enrich this further.
   */
  relatedStartups(repo: Repo, limit = 4): Signal[] {
    const hay = `${repo.description ?? ""} ${(repo.topics ?? []).join(" ")} ${repo.language ?? ""}`.toLowerCase();
    const matched: Signal[] = [];
    for (const entry of STARTUP_KB) {
      if (entry.match.some((m) => hay.includes(m))) {
        matched.push({
          kind: "startup",
          title: entry.name,
          url: entry.url,
          summary: entry.summary,
          source: "sector-kb",
          funding: { stage: entry.stage, amount: entry.amount, investors: entry.investors },
          relevance: entry.match.filter((m) => hay.includes(m)).length / entry.match.length,
        });
      }
    }
    matched.sort((a, b) => b.relevance - a.relevance);
    return matched.slice(0, limit);
  }
}

function scoreOverlap(repo: Repo, description: string, topics: string[]): number {
  const mine = new Set([...(repo.topics ?? []), ...(repo.description ?? "").toLowerCase().split(/\W+/)]);
  const theirs = new Set([...topics, ...description.toLowerCase().split(/\W+/)]);
  let overlap = 0;
  for (const t of theirs) if (t.length > 2 && mine.has(t)) overlap++;
  return Math.min(1, overlap / 6);
}

function parseArxiv(xml: string, repo: Repo): Signal[] {
  const entries = xml.split("<entry>").slice(1);
  const out: Signal[] = [];
  for (const e of entries) {
    const title = decode(pick(e, "title"));
    const summary = decode(pick(e, "summary")).replace(/\s+/g, " ").trim();
    const published = pick(e, "published");
    const idMatch = e.match(/<id>([^<]+)<\/id>/);
    const url = idMatch ? idMatch[1].trim() : "https://arxiv.org";
    if (!title) continue;
    out.push({
      kind: "paper",
      title,
      url,
      summary: summary.slice(0, 280),
      source: "arxiv",
      publishedAt: published,
      relevance: scoreOverlap(repo, `${title} ${summary}`, []),
    });
  }
  return out;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Curated sector knowledge base of startups + their investors. Intentionally
 * compact; the value is showing real funding relationships so a hacker can see
 * "who funds this space" and route a conversation. Extend freely.
 */
interface StartupEntry {
  name: string;
  url: string;
  summary: string;
  stage: string;
  amount: string;
  investors: string[];
  match: string[];
}

const STARTUP_KB: StartupEntry[] = [
  {
    name: "Mintlify",
    url: "https://mintlify.com",
    summary: "AI-native documentation platform.",
    stage: "Series A",
    amount: "$18.5M",
    investors: ["Andreessen Horowitz", "Bain Capital Ventures"],
    match: ["docs", "documentation", "developer-tools", "cli"],
  },
  {
    name: "LlamaIndex",
    url: "https://llamaindex.ai",
    summary: "Data framework for LLM apps and RAG.",
    stage: "Seed",
    amount: "$8.5M",
    investors: ["Greylock"],
    match: ["rag", "llm", "embeddings", "retrieval", "vector"],
  },
  {
    name: "Braintrust",
    url: "https://braintrust.dev",
    summary: "Evaluation and observability stack for AI products.",
    stage: "Series A",
    amount: "$36M",
    investors: ["Andreessen Horowitz"],
    match: ["evals", "eval", "prompt-engineering", "llm", "observability"],
  },
  {
    name: "AssemblyAI",
    url: "https://assemblyai.com",
    summary: "Speech-to-text and audio intelligence APIs.",
    stage: "Series C",
    amount: "$50M",
    investors: ["Accel", "Insight Partners"],
    match: ["transcription", "whisper", "speech", "audio", "diarization"],
  },
  {
    name: "Hugging Face",
    url: "https://huggingface.co",
    summary: "Open model hub and ML tooling.",
    stage: "Series D",
    amount: "$235M",
    investors: ["Sequoia", "Coatue", "Google"],
    match: ["computer-vision", "tflite", "cnn", "ml", "model", "classifier"],
  },
  {
    name: "Pinecone",
    url: "https://pinecone.io",
    summary: "Managed vector database for semantic search.",
    stage: "Series B",
    amount: "$100M",
    investors: ["Andreessen Horowitz", "ICONIQ Growth"],
    match: ["vector", "faiss", "embeddings", "semantic", "rag"],
  },
];
