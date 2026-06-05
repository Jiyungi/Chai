import type { MomentumConfig } from "../config.js";
import type { Repo } from "../types.js";
import { getJson, getText, HttpError } from "../lib/http.js";

/**
 * GitHub inspection. Uses the public REST API; works anonymously (lower rate
 * limit) or with a token. Falls back to a built-in sample portfolio only when
 * the network is unavailable, so demos never hard-fail.
 */
export class GitHubInspector {
  constructor(private cfg: MomentumConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "momentum-hackathon-tool",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.cfg.github.token) h.Authorization = `Bearer ${this.cfg.github.token}`;
    return h;
  }

  /** List a user's repos, newest activity first, with light enrichment. */
  async listRepos(limit = 12): Promise<{ repos: Repo[]; live: boolean }> {
    // Sample mode: use the curated portfolio (great for demos / no GH account).
    if (
      process.env.CHAI_SAMPLE === "1" ||
      process.env.MOMENTUM_SAMPLE === "1" ||
      this.cfg.github.username === "sample"
    ) {
      return { repos: sampleRepos(), live: false };
    }
    const user = this.cfg.github.username;
    // When an explicit allow-list is set, fetch a wide page so named repos are
    // found even if they aren't among the most recently pushed.
    const perPage = this.cfg.github.repos.length ? 100 : limit;
    const url = `https://api.github.com/users/${encodeURIComponent(
      user,
    )}/repos?sort=pushed&per_page=${perPage}&type=owner`;
    try {
      const raw = await getJson<any[]>(url, { headers: this.headers() });
      const allow = this.cfg.github.repos;
      const repos: Repo[] = raw
        .filter((r) => !r.fork)
        .filter((r) => allow.length === 0 || allow.includes(r.name))
        .map((r) => ({
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          url: r.html_url,
          language: r.language,
          topics: r.topics ?? [],
          stars: r.stargazers_count ?? 0,
          forks: r.forks_count ?? 0,
          pushedAt: r.pushed_at,
          createdAt: r.created_at,
        }));
      return { repos, live: true };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new Error(`GitHub user "${user}" not found.`);
      }
      // Network/rate-limit failure → offline sample so the pipeline still runs.
      return { repos: sampleRepos(), live: false };
    }
  }

  /** Fetch + decode README (first ~4k chars) for deeper analysis. */
  async fetchReadme(repo: Repo): Promise<string> {
    if (repo.readme) return repo.readme;
    try {
      const url = `https://api.github.com/repos/${repo.fullName}/readme`;
      const raw = await getJson<{ content?: string; encoding?: string }>(url, {
        headers: this.headers(),
      });
      let text = "";
      if (raw.content && raw.encoding === "base64") {
        text = Buffer.from(raw.content, "base64").toString("utf8");
      }
      repo.readme = text.slice(0, 4000);
      return repo.readme;
    } catch {
      repo.readme = "";
      return "";
    }
  }

  /** Top languages across a repo, used for technical suggestions. */
  async languages(repo: Repo): Promise<string[]> {
    try {
      const url = `https://api.github.com/repos/${repo.fullName}/languages`;
      const data = await getJson<Record<string, number>>(url, { headers: this.headers() });
      return Object.entries(data)
        .sort((a, b) => b[1] - a[1])
        .map(([lang]) => lang);
    } catch {
      return repo.language ? [repo.language] : [];
    }
  }

  /**
   * Fetch the repo's file tree (paths only) so the Architect can reference real
   * files in a plan. Returns up to `limit` source-relevant paths.
   */
  async fileTree(repo: Repo, limit = 80): Promise<string[]> {
    const tryBranch = async (branch: string): Promise<string[] | null> => {
      try {
        const url = `https://api.github.com/repos/${repo.fullName}/git/trees/${branch}?recursive=1`;
        const data = await getJson<{ tree?: { path: string; type: string }[] }>(url, {
          headers: this.headers(),
        });
        if (!data.tree) return null;
        return data.tree
          .filter((n) => n.type === "blob")
          .map((n) => n.path)
          .filter((p) => !/node_modules\/|\.lock$|\.png$|\.jpg$|\.svg$|dist\//.test(p));
      } catch {
        return null;
      }
    };
    const paths = (await tryBranch("main")) ?? (await tryBranch("master")) ?? [];
    return paths.slice(0, limit);
  }

  /**
   * Open a GitHub issue with the implementation plan so the work lands in the
   * repo's tracker (and can be picked up by Copilot/agent workflows). Needs a
   * token with `repo`/`issues` write scope; returns the issue URL or null.
   */
  async createIssue(repoFullName: string, title: string, body: string): Promise<string | null> {
    if (!this.cfg.github.token) return null;
    try {
      const url = `https://api.github.com/repos/${repoFullName}/issues`;
      const res = await getJson<{ html_url?: string }>(url, {
        method: "POST",
        headers: this.headers(),
        body: { title, body },
      });
      return res.html_url ?? null;
    } catch {
      return null;
    }
  }
}

/** Offline sample portfolio: realistic, distinct hackathon projects. */
export function sampleRepos(): Repo[] {
  const now = new Date().toISOString();
  return [
    {
      name: "voxnote",
      fullName: "demo/voxnote",
      description:
        "Realtime meeting transcription with speaker diarization and a tiny RAG search over past calls.",
      url: "https://github.com/demo/voxnote",
      language: "Python",
      topics: ["whisper", "rag", "transcription", "fastapi"],
      stars: 42,
      forks: 6,
      pushedAt: now,
      createdAt: now,
      readme:
        "# VoxNote\nWhisper-based transcription, pyannote diarization, embeddings stored in FAISS, FastAPI backend. Search past meetings by semantic query.",
    },
    {
      name: "promptforge",
      fullName: "demo/promptforge",
      description:
        "A CLI to version, test, and A/B prompts against multiple LLM providers with eval scoring.",
      url: "https://github.com/demo/promptforge",
      language: "TypeScript",
      topics: ["llm", "evals", "prompt-engineering", "cli"],
      stars: 73,
      forks: 9,
      pushedAt: now,
      createdAt: now,
      readme:
        "# PromptForge\nStore prompts as files, run them across OpenAI/Anthropic, score with a rubric LLM, track regressions in a local SQLite db.",
    },
    {
      name: "leaflens",
      fullName: "demo/leaflens",
      description:
        "Mobile-first plant disease classifier with an on-device CNN and a community reporting map.",
      url: "https://github.com/demo/leaflens",
      language: "Dart",
      topics: ["flutter", "computer-vision", "tflite", "agriculture"],
      stars: 18,
      forks: 2,
      pushedAt: now,
      createdAt: now,
      readme:
        "# LeafLens\nFlutter app, TFLite MobileNet fine-tuned on PlantVillage, uploads anonymized reports to a Firebase map.",
    },
  ];
}
