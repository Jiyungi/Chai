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
   * What people are saying — Hacker News discussion related to the repo, via
   * the free Algolia HN Search API (no key). Returns the highest-engagement
   * stories/comments matching the repo's topics. This is where dev + founder
   * discourse and influential voices actually surface.
   */
  async relatedSocial(repo: Repo, limit = 4): Promise<Signal[]> {
    const query = this.socialQuery(repo);
    if (!query) return [];
    // Try the focused query; if HN has nothing, broaden to the single most
    // salient concept word so we still surface relevant discourse when possible.
    let hits = await this.hnSearch(query, limit);
    if (hits.length === 0) {
      const broad = query.split(" ").find((w) => GENERAL_CONCEPTS.has(w));
      if (broad) hits = await this.hnSearch(broad, limit);
    }
    return hits.map((h) => ({
      kind: "social" as const,
      title: h.title as string,
      url: (h.url as string) || `https://news.ycombinator.com/item?id=${h.objectID}`,
      summary: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments on Hacker News`,
      source: "hackernews",
      publishedAt: h.created_at,
      engagement: {
        points: h.points ?? 0,
        comments: h.num_comments ?? 0,
        author: h.author,
      },
      relevance: scoreOverlap(repo, h.title ?? "", []),
    }));
  }

  /** Raw HN Algolia search for stories with at least minimal engagement. */
  private async hnSearch(query: string, limit: number): Promise<any[]> {
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=${limit + 4}`;
    try {
      const data = await getJson<{ hits: any[] }>(url, {
        headers: { "User-Agent": "momentum-hackathon-tool" },
      });
      return (data.hits ?? []).filter((h) => h.title && (h.points ?? 0) >= 5).slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Build a topical HN query. Prefers topics, then description, then a few
   * salient keywords from the README. Falls back to the repo name only if it
   * looks descriptive (>4 chars and not a single common word), since bare repo
   * names (e.g. "Yoshi") return irrelevant chatter.
   */
  private socialQuery(repo: Repo): string {
    const topics = (repo.topics ?? []).slice(0, 2).join(" ");
    if (topics) return topics;
    if (repo.description) {
      const concept = conceptWords(repo.description);
      if (concept) return concept;
      return keywordsFromText(repo.description, 4);
    }
    if (repo.readme) {
      // Prefer recognized tech concepts so we match real HN discourse, not
      // project-specific proper nouns.
      const concept = conceptWords(repo.readme);
      if (concept) return concept;
      const fromReadme = keywordsFromText(repo.readme, 4);
      if (fromReadme) return fromReadme;
    }
    return "";
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

/** General tech concepts worth broadening a social search to (must be real
 *  discourse topics, not project-specific proper nouns). */
const GENERAL_CONCEPTS = new Set([
  "agent", "agents", "rag", "memory", "llm", "embeddings", "vector", "retrieval",
  "transcription", "diarization", "classifier", "vision", "eval", "evals", "prompt",
  "filter", "filtering", "moderation", "feed", "browser", "extension", "automation",
  "pipeline", "diffusion", "attention", "inference", "scraper",
]);

/** Stopword set for crude keyword extraction. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "that", "this", "from", "into", "are",
  "was", "has", "have", "not", "but", "can", "will", "any", "all", "out", "its", "it's",
  "each", "one", "use", "uses", "using", "run", "runs", "across", "own", "new", "post",
  "posts", "read", "reads", "reason", "place", "session", "sessions", "decide", "decides",
  "whether", "mark", "mute", "author", "feed", "tab", "browser", "client", "side",
]);

/**
 * Extract the top-N salient lowercase keywords from free text (README/desc).
 * Used to build a meaningful social-search query when topics are missing.
 */
function keywordsFromText(text: string, n: number): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    const w = raw.trim();
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w)
    .join(" ");
}

/**
 * Pull the most frequent recognized tech-concept words from text, so the social
 * query targets real discourse (e.g. "agent memory") instead of project nouns.
 */
function conceptWords(text: string, n = 2): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    const w = raw.trim();
    if (GENERAL_CONCEPTS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w)
    .join(" ");
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
