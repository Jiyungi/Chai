import type { MomentumConfig } from "../config.js";
import { GitHubInspector } from "../integrations/github.js";
import { Butterbase } from "../integrations/butterbase.js";
import { Memory } from "../integrations/xtrace.js";
import { Discovery } from "../integrations/discovery.js";
import { RocketRide } from "../integrations/rocketride.js";
import { suggestImprovements, findFusions } from "./synthesis.js";
import { repoRadarPipe, fusionFinderPipe, digestPipe } from "./pipelines.js";
import type { Repo, Signal, RepoReport, FusionIdea, Digest } from "../types.js";

/**
 * The Momentum engine. Each public method runs a RocketRide pipeline whose
 * nodes are backed by the four required technologies:
 *   RocketRide  → orchestrates the DAG (this class registers node runners)
 *   Butterbase  → AI gateway (synthesis) + data API (persistence)
 *   XTrace      → durable, self-revising memory
 *   Spectrum    → delivery (handled by the caller / agent)
 */
export class MomentumEngine {
  readonly github: GitHubInspector;
  readonly bb: Butterbase;
  readonly memory: Memory;
  readonly discovery: Discovery;
  readonly rocket: RocketRide;

  constructor(public cfg: MomentumConfig) {
    this.github = new GitHubInspector(cfg);
    this.bb = new Butterbase(cfg);
    this.memory = new Memory(cfg);
    this.discovery = new Discovery(cfg);
    this.rocket = new RocketRide(cfg);
  }

  /** Write the canonical `.pipe` files so they open in the RocketRide canvas. */
  async exportPipelines(): Promise<string[]> {
    return Promise.all([
      this.rocket.writePipe(repoRadarPipe),
      this.rocket.writePipe(fusionFinderPipe),
      this.rocket.writePipe(digestPipe),
    ]);
  }

  /** Run the Repo Radar pipeline for a single repo. */
  async analyzeRepo(repo: Repo): Promise<RepoReport> {
    const rocket = new RocketRide(this.cfg)
      .register("github", async () => {
        await this.github.fetchReadme(repo);
        repo.topics = repo.topics ?? [];
        return repo;
      })
      .register("oss", async (_ctx, inputs) => this.discovery.relatedOSS(inputs.github as Repo))
      .register("papers", async (_ctx, inputs) => this.discovery.relatedPapers(inputs.github as Repo))
      .register("startups", async (_ctx, inputs) => this.discovery.relatedStartups(inputs.github as Repo))
      .register("synthesize", async (_ctx, inputs) => {
        const signals: Signal[] = [
          ...((inputs.oss as Signal[]) ?? []),
          ...((inputs.papers as Signal[]) ?? []),
          ...((inputs.startups as Signal[]) ?? []),
        ];
        const suggestions = await suggestImprovements(this.bb, repo, signals);
        return { signals, suggestions };
      })
      .register("memory", async (_ctx, inputs) => {
        const { signals, suggestions } = inputs.synthesize as {
          signals: Signal[];
          suggestions: any[];
        };
        const facts = [
          ...signals.slice(0, 6).map((s) => `[${s.kind}] ${s.title}: ${s.summary}`.slice(0, 240)),
          ...suggestions.slice(0, 3).map((s) => `[suggestion] ${s.area}: ${s.proposal}`.slice(0, 240)),
        ];
        const count = await this.memory.remember(repo.fullName, facts, `radar_${dateStamp()}`);
        return { remembered: count };
      })
      .register("store", async (_ctx, inputs) => {
        const { signals, suggestions } = inputs.synthesize as {
          signals: Signal[];
          suggestions: any[];
        };
        await this.bb.insert("reports", {
          repo: repo.fullName,
          signal_count: signals.length,
          suggestion_count: suggestions.length,
          generated_at: new Date().toISOString(),
        });
        return true;
      });

    const outputs = await rocket.run(repoRadarPipe, { repo });
    const { signals, suggestions } = outputs.synthesize as {
      signals: Signal[];
      suggestions: any[];
    };
    return { repo, signals, suggestions, generatedAt: new Date().toISOString() };
  }

  /** Analyze the whole portfolio. */
  async analyzePortfolio(limit = 8): Promise<{ reports: RepoReport[]; live: boolean }> {
    const { repos, live } = await this.github.listRepos(limit);
    const reports: RepoReport[] = [];
    for (const repo of repos) {
      reports.push(await this.analyzeRepo(repo));
    }
    return { reports, live };
  }

  /** Run the Fusion Finder pipeline across reports. */
  async findFusions(reports: RepoReport[]): Promise<FusionIdea[]> {
    const signalsByRepo = new Map<string, Signal[]>();
    for (const r of reports) signalsByRepo.set(r.repo.fullName, r.signals);

    const rocket = new RocketRide(this.cfg)
      .register("fuse", async () =>
        findFusions(this.bb, reports.map((r) => r.repo), signalsByRepo),
      )
      .register("rank", async (_ctx, inputs) => {
        const fusions = (inputs.fuse as FusionIdea[]) ?? [];
        return [...fusions].sort((a, b) => b.score - a.score);
      })
      .register("store", async (_ctx, inputs) => {
        const ranked = (inputs.rank as FusionIdea[]) ?? [];
        for (const f of ranked) {
          await this.bb.insert("fusions", {
            name: f.name,
            repos: f.repos.join(","),
            score: f.score,
            generated_at: new Date().toISOString(),
          });
        }
        return ranked;
      });

    const outputs = await rocket.run(fusionFinderPipe, { reports });
    return (outputs.rank as FusionIdea[]) ?? [];
  }

  /**
   * Run the Digest pipeline: recall prior facts, diff against the latest
   * reports to surface "what changed", and produce a deliverable digest.
   */
  async buildDigest(reports: RepoReport[], fusions: FusionIdea[]): Promise<Digest> {
    const rocket = new RocketRide(this.cfg)
      .register("recall", async () => {
        const recalls = new Map<string, string[]>();
        for (const r of reports) {
          const hits = await this.memory.recall(r.repo.fullName, "previous findings and suggestions", 5);
          recalls.set(r.repo.fullName, hits.map((h) => h.text));
        }
        return recalls;
      })
      .register("new", async () => reports)
      .register("diff", async (_ctx, inputs) => {
        const prior = inputs.recall as Map<string, string[]>;
        return computeChanges(reports, prior);
      })
      .register("deliver", async (_ctx, inputs) => {
        const changes = inputs.diff as Map<string, string[]>;
        return renderDigest(reports, fusions, changes);
      });

    const outputs = await rocket.run(digestPipe, { reports });
    return outputs.deliver as Digest;
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Diff current signals against recalled facts to find genuinely new items. */
function computeChanges(reports: RepoReport[], prior: Map<string, string[]>): Map<string, string[]> {
  const changes = new Map<string, string[]>();
  for (const r of reports) {
    const known = (prior.get(r.repo.fullName) ?? []).join(" \n ").toLowerCase();
    const fresh: string[] = [];
    for (const s of r.signals) {
      if (!known.includes(s.title.toLowerCase().slice(0, 24))) {
        fresh.push(`${iconFor(s.kind)} ${s.title}`);
      }
    }
    changes.set(r.repo.fullName, fresh.slice(0, 5));
  }
  return changes;
}

function iconFor(kind: string): string {
  return kind === "paper" ? "📄" : kind === "startup" ? "💸" : "🔧";
}

function renderDigest(
  reports: RepoReport[],
  fusions: FusionIdea[],
  changes: Map<string, string[]>,
): Digest {
  const sections = reports.map((r) => {
    const fresh = changes.get(r.repo.fullName) ?? [];
    const topSuggestion = r.suggestions[0];
    const bullets = [
      ...(fresh.length ? [`New since last check: ${fresh.join("  ·  ")}`] : ["No major changes since last check."]),
      ...(topSuggestion ? [`Top move: ${topSuggestion.proposal}`] : []),
    ];
    return { heading: r.repo.name, bullets };
  });

  if (fusions.length) {
    sections.push({
      heading: "💡 Fusion ideas",
      bullets: fusions.slice(0, 2).map((f) => `${f.name} (${f.score}/100): ${f.pitch}`),
    });
  }

  const text = [
    "📈 Momentum weekly digest",
    "",
    ...sections.flatMap((s) => [`${s.heading}`, ...s.bullets.map((b) => `  • ${b}`), ""]),
    "Reply with a repo name for details, or 'fuse' for startup ideas.",
  ].join("\n");

  return { title: "Momentum weekly digest", generatedAt: new Date().toISOString(), sections, text };
}
