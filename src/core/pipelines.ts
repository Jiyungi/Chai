import type { Pipe } from "../integrations/rocketride.js";
import type { MomentumConfig } from "../config.js";

/**
 * Canonical RocketRide pipeline definitions for Momentum, in the engine's real
 * `.pipe` schema (components + input lanes + source). These are the product
 * logic and also render in the RocketRide VS Code canvas.
 */

/** Repo Radar: inspect a repo → gather signals → synthesize → remember → store. */
export const repoRadarPipe: Pipe = {
  name: "repo-radar",
  description:
    "Inspect a GitHub repo, gather related OSS + startups + papers + social chatter, synthesize improvement suggestions, write to memory, and persist.",
  source: "src",
  components: [
    { id: "src", provider: "webhook", category: "Source", label: "Repo input", config: { mode: "Source", type: "webhook" } },
    { id: "github", provider: "tool_github", category: "Tool", label: "Inspect repo (README, languages)", input: [{ lane: "data", from: "src" }] },
    { id: "oss", provider: "search", category: "Search", label: "Related OSS (GitHub search)", input: [{ lane: "data", from: "github" }] },
    { id: "papers", provider: "tool_http", category: "Tool", label: "Related papers (arXiv)", input: [{ lane: "data", from: "github" }] },
    { id: "startups", provider: "tool_http", category: "Tool", label: "Startups + investors (sector KB)", input: [{ lane: "data", from: "github" }] },
    { id: "social", provider: "tool_http", category: "Tool", label: "What people are saying (Hacker News)", input: [{ lane: "data", from: "github" }] },
    {
      id: "synthesize",
      provider: "llm_openai_api",
      category: "LLM",
      label: "Suggest improvements (LLM node → Butterbase gateway)",
      input: [
        { lane: "data", from: "github" },
        { lane: "data", from: "oss" },
        { lane: "data", from: "papers" },
        { lane: "data", from: "startups" },
        { lane: "data", from: "social" },
      ],
    },
    { id: "memory", provider: "tool_http", category: "Memory", label: "Write durable facts (XTrace)", input: [{ lane: "data", from: "synthesize" }] },
    { id: "store", provider: "response", category: "Infrastructure", label: "Persist report (Butterbase data API)", input: [{ lane: "data", from: "synthesize" }, { lane: "data", from: "memory" }] },
  ],
};

/** Fusion Finder: take all reports → propose cross-repo startup ideas. */
export const fusionFinderPipe: Pipe = {
  name: "fusion-finder",
  description: "Read the full portfolio of repo reports and propose 2+ project fusions worth turning into a startup.",
  source: "reports",
  components: [
    { id: "reports", provider: "webhook", category: "Source", label: "All repo reports", config: { mode: "Source", type: "webhook" } },
    { id: "fuse", provider: "llm_openai_api", category: "LLM", label: "Cross-pollinate into startup ideas", input: [{ lane: "data", from: "reports" }] },
    { id: "rank", provider: "tool_http", category: "Text", label: "Rank by venture potential", input: [{ lane: "data", from: "fuse" }] },
    { id: "store", provider: "response", category: "Infrastructure", label: "Persist fusions (Butterbase)", input: [{ lane: "data", from: "rank" }] },
  ],
};

/** Digest: recall what changed → build digest → deliver via Spectrum. */
export const digestPipe: Pipe = {
  name: "weekly-digest",
  description: "Recall prior facts, diff against new signals to find what changed, build a digest, and deliver it over messaging.",
  source: "new",
  components: [
    { id: "new", provider: "webhook", category: "Source", label: "Latest reports", config: { mode: "Source", type: "webhook" } },
    { id: "recall", provider: "tool_http", category: "Memory", label: "Recall prior facts (XTrace)", input: [{ lane: "data", from: "new" }] },
    { id: "diff", provider: "llm_openai_api", category: "LLM", label: "What changed since last week", input: [{ lane: "data", from: "recall" }, { lane: "data", from: "new" }] },
    { id: "deliver", provider: "tool_http", category: "Tool", label: "Deliver digest (Spectrum / Photon)", input: [{ lane: "data", from: "diff" }] },
  ],
};

/**
 * A real, engine-executable synthesis pipeline: webhook source → llm_openai_api
 * node pointed at the Butterbase gateway → response. Used to run actual LLM
 * inference *through the RocketRide engine* (wiring RocketRide + Butterbase).
 */
export function butterbaseLlmPipe(cfg: MomentumConfig, systemPrompt: string): Pipe {
  return {
    name: "momentum-synthesis",
    description: "LLM synthesis executed on the RocketRide engine via an OpenAI-compatible node pointed at the Butterbase gateway.",
    source: "in",
    components: [
      { id: "in", provider: "chat", category: "Source", label: "Prompt input", config: { mode: "Source", type: "chat" } },
      {
        id: "llm",
        provider: "llm_openai_api",
        category: "LLM",
        label: "Butterbase gateway (OpenAI-compatible)",
        config: {
          base_url: `${cfg.butterbase.apiUrl.replace(/\/$/, "")}/v1`,
          apikey: cfg.butterbase.apiKey ?? "",
          model: cfg.butterbase.model,
          system: systemPrompt,
          modelTotalTokens: 32768,
        },
        input: [{ lane: "questions", from: "in" }],
      },
      { id: "out", provider: "response", category: "Infrastructure", label: "Return completion", config: { laneName: "answers" }, input: [{ lane: "answers", from: "llm" }] },
    ],
  };
}
