import type { Pipe } from "../integrations/rocketride.js";

/**
 * Canonical RocketRide pipeline definitions for Momentum. These are the product
 * logic: each run executes one of these DAGs. They're also written to disk as
 * `.pipe` files so they open in the RocketRide VS Code canvas.
 */

/** Repo Radar: inspect a repo → gather signals → synthesize → remember → store. */
export const repoRadarPipe: Pipe = {
  name: "repo-radar",
  description:
    "Inspect a GitHub repo, gather related OSS + startups + papers, synthesize improvement suggestions, write to memory, and persist.",
  nodes: [
    {
      id: "src",
      type: "source.webhook",
      category: "Source",
      label: "Repo input",
      inputs: [],
    },
    {
      id: "github",
      type: "tool.github",
      category: "Tool",
      label: "Inspect repo (README, languages)",
      inputs: ["src"],
    },
    {
      id: "oss",
      type: "search.web",
      category: "Search",
      label: "Related OSS (GitHub search)",
      inputs: ["github"],
    },
    {
      id: "papers",
      type: "tool.http",
      category: "Tool",
      label: "Related papers (arXiv)",
      inputs: ["github"],
    },
    {
      id: "startups",
      type: "tool.http",
      category: "Tool",
      label: "Startups + investors (sector KB)",
      inputs: ["github"],
    },
    {
      id: "synthesize",
      type: "llm.anthropic",
      category: "LLM",
      label: "Suggest improvements (Butterbase AI gateway)",
      config: { model: "anthropic/claude-3.5-sonnet" },
      inputs: ["github", "oss", "papers", "startups"],
    },
    {
      id: "memory",
      type: "memory.persistent",
      category: "Memory",
      label: "Write durable facts (XTrace)",
      inputs: ["synthesize"],
    },
    {
      id: "store",
      type: "infra.export",
      category: "Infrastructure",
      label: "Persist report (Butterbase data API)",
      inputs: ["synthesize", "memory"],
    },
  ],
};

/** Fusion Finder: take all reports → propose cross-repo startup ideas. */
export const fusionFinderPipe: Pipe = {
  name: "fusion-finder",
  description:
    "Read the full portfolio of repo reports and propose 2+ project fusions worth turning into a startup.",
  nodes: [
    { id: "reports", type: "source.dropper", category: "Source", label: "All repo reports", inputs: [] },
    {
      id: "fuse",
      type: "llm.anthropic",
      category: "LLM",
      label: "Cross-pollinate into startup ideas",
      config: { model: "anthropic/claude-3.5-sonnet" },
      inputs: ["reports"],
    },
    { id: "rank", type: "text.transform", category: "Text", label: "Rank by venture potential", inputs: ["fuse"] },
    {
      id: "store",
      type: "infra.export",
      category: "Infrastructure",
      label: "Persist fusions (Butterbase)",
      inputs: ["rank"],
    },
  ],
};

/** Digest: recall what changed → build digest → deliver via Spectrum. */
export const digestPipe: Pipe = {
  name: "weekly-digest",
  description:
    "Recall prior facts, diff against new signals to find what changed, build a digest, and deliver it over messaging.",
  nodes: [
    { id: "recall", type: "memory.persistent", category: "Memory", label: "Recall prior facts (XTrace)", inputs: [] },
    { id: "new", type: "source.dropper", category: "Source", label: "Latest reports", inputs: [] },
    {
      id: "diff",
      type: "llm.anthropic",
      category: "LLM",
      label: "What changed since last week",
      inputs: ["recall", "new"],
    },
    {
      id: "deliver",
      type: "tool.http",
      category: "Tool",
      label: "Deliver digest (Spectrum / Photon)",
      inputs: ["diff"],
    },
  ],
};
