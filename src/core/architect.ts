import type { Butterbase, ChatMessage } from "../integrations/butterbase.js";
import type { Repo, Signal, ImprovementSuggestion, ImplementationPlan } from "../types.js";

/**
 * The Architect agent. Where the Radar agent says "what to change," the
 * Architect says "is this actually feasible, and here's the exact plan."
 *
 * It grounds its plan in three things:
 *   1. the specific suggestion,
 *   2. the cited evidence (papers / OSS / HN discussion), and
 *   3. the repo's REAL file tree + README (so steps name real files).
 *
 * Output is a feasibility verdict, file-level steps, risks, an estimate, and —
 * crucially — a ready-to-paste prompt that hands the work to a coding agent
 * (Codex / Claude Code / Cursor). That prompt is the "easy handoff."
 */

const SYSTEM = `You are Chai's Architect: a pragmatic staff engineer.
You assess whether a proposed improvement is feasible for THIS repo right now,
then write a concrete, file-level implementation plan. You are honest about
risk and effort. You reference real files from the provided tree. You never
invent APIs. When you cite a technique, tie it to the provided evidence.`;

export async function planImprovement(
  bb: Butterbase,
  repo: Repo,
  suggestion: ImprovementSuggestion,
  signals: Signal[],
  fileTree: string[],
): Promise<ImplementationPlan> {
  const evidence = signals
    .filter((s) => suggestion.evidence?.some((e) => e.includes(s.title) || e.includes(s.url)))
    .slice(0, 6);
  // Fall back to the most relevant signals if evidence didn't match by string.
  const refs = (evidence.length ? evidence : signals.slice(0, 5)).map(
    (s) => `- [${s.kind}] ${s.title} :: ${s.url}`,
  );

  const ctx = [
    `REPO: ${repo.fullName}`,
    `Description: ${repo.description ?? "(none)"}`,
    `Language: ${repo.language ?? "?"}`,
    repo.readme ? `README excerpt:\n${repo.readme.slice(0, 1200)}` : "",
    "",
    `FILE TREE (${fileTree.length} files):`,
    fileTree.join("\n") || "(unavailable)",
    "",
    "SUGGESTION TO ASSESS:",
    `area: ${suggestion.area}`,
    `proposal: ${suggestion.proposal}`,
    `reason: ${suggestion.reason}`,
    `claimed effort: ${suggestion.effort}`,
    "",
    "EVIDENCE (papers / OSS / discussion):",
    ...refs,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content:
        `${ctx}\n\nReturn ONLY compact JSON (no markdown):\n` +
        `{"feasibility":"high"|"medium"|"low","verdict":string,"steps":[string],` +
        `"filesToTouch":[string],"risks":[string],"references":[string],"estimate":string,` +
        `"agentPrompt":string}\n\n` +
        `Rules: "steps" = 3-7 concrete actions naming real files from the tree. ` +
        `"filesToTouch" = real paths (or new paths that fit the structure). ` +
        `"verdict" = 1-2 sentences on feasibility for THIS repo. "estimate" e.g. "~3 hours". ` +
        `"agentPrompt" = a self-contained instruction a coding agent can run in this repo ` +
        `without extra context: state the goal, the files, the approach, and acceptance criteria. ` +
        `Keep agentPrompt under 180 words.`,
    },
  ];

  const fallback = heuristicPlan(repo, suggestion, refs);
  const parsed = await bb.chatJson<Partial<ImplementationPlan>>(messages, fallback, {
    maxTokens: 1800,
  });

  return {
    repo: repo.fullName,
    suggestion: suggestion.proposal,
    feasibility: parsed.feasibility ?? fallback.feasibility,
    verdict: parsed.verdict ?? fallback.verdict,
    steps: parsed.steps?.length ? parsed.steps : fallback.steps,
    filesToTouch: parsed.filesToTouch?.length ? parsed.filesToTouch : fallback.filesToTouch,
    risks: parsed.risks?.length ? parsed.risks : fallback.risks,
    references: parsed.references?.length ? parsed.references : suggestion.evidence ?? [],
    estimate: parsed.estimate ?? fallback.estimate,
    agentPrompt: parsed.agentPrompt ?? fallback.agentPrompt,
  };
}

function heuristicPlan(
  repo: Repo,
  suggestion: ImprovementSuggestion,
  refs: string[],
): ImplementationPlan {
  const prompt =
    `In the repo ${repo.fullName} (${repo.language ?? "unknown"}), implement: ` +
    `${suggestion.proposal}\n\nContext: ${suggestion.reason}\n` +
    `References:\n${refs.join("\n")}\n\n` +
    `Make a focused change with tests, keep it minimal, and explain the diff.`;
  return {
    repo: repo.fullName,
    suggestion: suggestion.proposal,
    feasibility: suggestion.effort === "high" ? "medium" : "high",
    verdict: `Plausible for this repo. Add a Butterbase key for a file-level plan grounded in the tree.`,
    steps: [
      "Read the relevant module(s) and identify the integration point.",
      `Implement: ${suggestion.proposal}`,
      "Add a test that proves the new behavior.",
      "Run the build/tests and iterate until green.",
    ],
    filesToTouch: [],
    risks: ["Scope creep", "Missing tests around the changed path"],
    references: refs,
    estimate: suggestion.effort === "high" ? "~1-2 days" : "~half a day",
    agentPrompt: prompt,
  };
}
