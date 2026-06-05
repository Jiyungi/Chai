import type { Butterbase, ChatMessage } from "../integrations/butterbase.js";
import type { Repo, Signal, ImprovementSuggestion, FusionIdea } from "../types.js";

/**
 * Synthesis turns raw signals into the things a hacker actually wants:
 * concrete improvement suggestions, and cross-repo fusion ideas. All LLM calls
 * route through the Butterbase AI gateway and degrade to strong heuristics
 * offline, so output is always useful.
 */

const SYSTEM = `You are Chai, an expert hacker-mentor and startup scout.
You read a developer's project plus current open-source, startup, and research
signals, and you give sharp, concrete, non-generic advice. You prefer specific
techniques, named tools, and paper titles over vague platitudes. Be honest
about effort and tradeoffs.`;

export async function suggestImprovements(
  bb: Butterbase,
  repo: Repo,
  signals: Signal[],
): Promise<ImprovementSuggestion[]> {
  const papers = signals.filter((s) => s.kind === "paper");
  const oss = signals.filter((s) => s.kind === "oss");
  const startups = signals.filter((s) => s.kind === "startup");
  const social = signals.filter((s) => s.kind === "social");

  const ctx = [
    `PROJECT: ${repo.fullName}`,
    `Description: ${repo.description ?? "(none)"}`,
    `Language: ${repo.language ?? "?"}  Topics: ${(repo.topics ?? []).join(", ") || "(none)"}`,
    repo.readme ? `README excerpt:\n${repo.readme.slice(0, 1500)}` : "",
    "",
    "RECENT PAPERS:",
    ...papers.map((p) => `- ${p.title} (${p.url}) :: ${p.summary}`),
    "",
    "RELATED OSS:",
    ...oss.map((o) => `- ${o.title} (${o.url}) :: ${o.summary}`),
    "",
    "FUNDED STARTUPS IN THIS SPACE:",
    ...startups.map(
      (s) => `- ${s.title} [${s.funding?.stage} ${s.funding?.amount}] backers: ${s.funding?.investors.join(", ")}`,
    ),
    "",
    "WHAT PEOPLE ARE SAYING (Hacker News):",
    ...social.map((s) => `- ${s.title} (${s.engagement?.points ?? 0} pts) :: ${s.url}`),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content:
        `${ctx}\n\nReturn ONLY compact JSON (no markdown): {"suggestions":[{"area":string,` +
        `"current":string,"proposal":string,"reason":string,"evidence":[string],"effort":"low"|"medium"|"high"}]}. ` +
        `Give exactly 3 suggestions. Keep each field under 30 words. "evidence" must cite the ` +
        `paper/OSS/startup names or URLs above. "proposal" must be a concrete change to THIS repo.`,
    },
  ];

  const fallback = heuristicSuggestions(repo, signals);
  const parsed = await bb.chatJson<{ suggestions: ImprovementSuggestion[] }>(
    messages,
    { suggestions: fallback },
    { maxTokens: 1600 },
  );
  const out = (parsed.suggestions ?? []).filter((s) => s && s.proposal);
  return out.length ? out : fallback;
}

export async function findFusions(
  bb: Butterbase,
  repos: Repo[],
  signalsByRepo: Map<string, Signal[]>,
): Promise<FusionIdea[]> {
  if (repos.length < 2) return [];
  const portfolio = repos
    .map((r) => {
      const startups = (signalsByRepo.get(r.fullName) ?? []).filter((s) => s.kind === "startup");
      const investors = [...new Set(startups.flatMap((s) => s.funding?.investors ?? []))];
      return (
        `- ${r.fullName}: ${r.description ?? ""} [${r.language ?? "?"}; topics: ${(r.topics ?? []).join(", ")}]` +
        (investors.length ? ` (active investors nearby: ${investors.join(", ")})` : "")
      );
    })
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content:
        `Here is a developer's project portfolio:\n${portfolio}\n\n` +
        `Find 2-3 ways to COMBINE two or more of these projects into a single, ` +
        `startup-worthy product. Return JSON: {"fusions":[{"repos":[string],"name":string,` +
        `"pitch":string,"why":string,"wedge":string,"goToMarket":string,` +
        `"relevantInvestors":[string],"score":number}]}. score is 0-100 (venture potential). ` +
        `"repos" must reference the full names above. Be specific and ambitious but realistic.`,
    },
  ];

  const fallback = heuristicFusions(repos, signalsByRepo);
  const parsed = await bb.chatJson<{ fusions: FusionIdea[] }>(messages, { fusions: fallback });
  const out = (parsed.fusions ?? []).filter((f) => f && f.repos?.length >= 2);
  return out.length ? out : fallback;
}

// ── Heuristic fallbacks (offline / gateway failure) ──────────────────────────

function heuristicSuggestions(repo: Repo, signals: Signal[]): ImprovementSuggestion[] {
  const out: ImprovementSuggestion[] = [];
  const papers = signals.filter((s) => s.kind === "paper").slice(0, 2);
  const oss = signals.filter((s) => s.kind === "oss").slice(0, 2);

  if (papers.length) {
    out.push({
      area: "Algorithm / approach",
      current: `${repo.name} uses its current baseline approach.`,
      proposal: `Evaluate techniques from "${papers[0].title}" and benchmark against the current pipeline.`,
      reason: "Recent research may offer accuracy or efficiency gains over the original implementation.",
      evidence: papers.map((p) => p.url),
      effort: "medium",
    });
  }
  if (oss.length) {
    out.push({
      area: "Reuse vs. rebuild",
      current: "Custom components maintained in-repo.",
      proposal: `Consider adopting/forking ${oss[0].title} instead of maintaining equivalent code.`,
      reason: "An actively maintained project can reduce maintenance burden and add features.",
      evidence: oss.map((o) => o.url),
      effort: "low",
    });
  }
  out.push({
    area: "Productionization",
    current: "Hackathon-grade backend and delivery.",
    proposal:
      "Move persistence + auth onto a managed backend and expose the agent over a messaging channel users already have.",
    reason: "Lowers the barrier from demo to real users — the gap most hackathon projects die in.",
    evidence: [],
    effort: "medium",
  });
  return out;
}

function heuristicFusions(repos: Repo[], signalsByRepo: Map<string, Signal[]>): FusionIdea[] {
  // Pair the two most topically adjacent repos.
  let best: { a: Repo; b: Repo; overlap: number } | null = null;
  for (let i = 0; i < repos.length; i++) {
    for (let j = i + 1; j < repos.length; j++) {
      const overlap = topicOverlap(repos[i], repos[j]);
      if (!best || overlap > best.overlap) best = { a: repos[i], b: repos[j], overlap };
    }
  }
  if (!best) return [];
  const investors = [
    ...new Set(
      [best.a, best.b].flatMap((r) =>
        (signalsByRepo.get(r.fullName) ?? [])
          .filter((s) => s.kind === "startup")
          .flatMap((s) => s.funding?.investors ?? []),
      ),
    ),
  ];
  return [
    {
      repos: [best.a.fullName, best.b.fullName],
      name: `${cap(best.a.name)}${cap(best.b.name)}`,
      pitch: `Combine ${best.a.name} and ${best.b.name} into one product that pairs ${
        best.a.description ?? best.a.name
      } with ${best.b.description ?? best.b.name}.`,
      why: "Shared users and overlapping infrastructure make the combination stronger than either alone.",
      wedge: "Start with the workflow where both projects' users already overlap.",
      goToMarket: "Ship the merged agent on a messaging platform for instant distribution.",
      relevantInvestors: investors,
      score: Math.round(50 + best.overlap * 40),
    },
  ];
}

function topicOverlap(a: Repo, b: Repo): number {
  const sa = new Set([...(a.topics ?? []), a.language ?? ""].filter(Boolean));
  const sb = new Set([...(b.topics ?? []), b.language ?? ""].filter(Boolean));
  let n = 0;
  for (const t of sa) if (sb.has(t)) n++;
  return n / Math.max(1, Math.min(sa.size, sb.size));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
