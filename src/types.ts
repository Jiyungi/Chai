/** Shared domain types for Momentum. */

export interface Repo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  pushedAt: string;
  createdAt: string;
  /** README excerpt, populated on demand. */
  readme?: string;
}

/** A normalized "thing happening in the world" related to a repo. */
export interface Signal {
  kind: "oss" | "startup" | "paper";
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt?: string;
  /** Startups only: funding + investors when known. */
  funding?: {
    stage?: string;
    amount?: string;
    investors: string[];
  };
  /** 0..1 heuristic relevance to the repo. */
  relevance: number;
}

export interface ImprovementSuggestion {
  area: string;
  current: string;
  proposal: string;
  reason: string;
  /** What in the world prompted this (paper/OSS/startup links). */
  evidence: string[];
  effort: "low" | "medium" | "high";
}

export interface RepoReport {
  repo: Repo;
  signals: Signal[];
  suggestions: ImprovementSuggestion[];
  generatedAt: string;
}

/** A proposed fusion of 2+ repos into a single startup-worthy idea. */
export interface FusionIdea {
  repos: string[];
  name: string;
  pitch: string;
  why: string;
  wedge: string;
  /** Investors/startups in this space worth talking to. */
  goToMarket: string;
  relevantInvestors: string[];
  score: number;
}

export interface DigestSection {
  heading: string;
  bullets: string[];
}

export interface Digest {
  title: string;
  generatedAt: string;
  sections: DigestSection[];
  /** Plain-text rendering suitable for a messaging platform. */
  text: string;
}
