import type { RepoReport, FusionIdea, ImplementationPlan } from "../types.js";

/** Pretty terminal rendering for CLI commands. */

const line = "─".repeat(64);

export function renderReport(r: RepoReport): string {
  const out: string[] = [];
  out.push(line);
  out.push(`📦 ${r.repo.fullName}  ★${r.repo.stars}  ${r.repo.language ?? ""}`);
  if (r.repo.description) out.push(`   ${r.repo.description}`);
  out.push("");

  const groups: Array<["paper" | "oss" | "startup" | "social", string]> = [
    ["paper", "📄 Recent research"],
    ["oss", "🔧 Related open source"],
    ["startup", "💸 Funded startups + investors"],
    ["social", "🗣️ What people are saying (Hacker News)"],
  ];
  for (const [kind, title] of groups) {
    const items = r.signals.filter((s) => s.kind === kind);
    if (!items.length) continue;
    out.push(`${title}`);
    for (const s of items.slice(0, 4)) {
      if (kind === "startup") {
        out.push(
          `   • ${s.title} [${s.funding?.stage ?? "?"} ${s.funding?.amount ?? ""}] — ${
            s.funding?.investors.join(", ") ?? ""
          }`,
        );
      } else if (kind === "social") {
        out.push(`   • ${s.title} (${s.engagement?.points ?? 0} pts · ${s.engagement?.comments ?? 0} comments)`);
        out.push(`     ${s.url}`);
      } else {
        out.push(`   • ${s.title}`);
        out.push(`     ${s.url}`);
      }
    }
    out.push("");
  }

  if (r.suggestions.length) {
    out.push("🚀 Suggestions to improve / replace");
    for (const s of r.suggestions) {
      out.push(`   • [${s.effort}] ${s.area}: ${s.proposal}`);
      out.push(`     why: ${s.reason}`);
      if (s.evidence?.length) out.push(`     evidence: ${s.evidence.join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderFusions(fusions: FusionIdea[]): string {
  if (!fusions.length) return "No fusion ideas (need at least two repos).";
  const out: string[] = [line, "💡 Cross-repo startup ideas", ""];
  fusions.forEach((f, i) => {
    out.push(`${i + 1}. ${f.name}  (${f.score}/100)`);
    out.push(`   repos:  ${f.repos.join(" + ")}`);
    out.push(`   pitch:  ${f.pitch}`);
    out.push(`   why:    ${f.why}`);
    out.push(`   wedge:  ${f.wedge}`);
    out.push(`   GTM:    ${f.goToMarket}`);
    if (f.relevantInvestors.length) out.push(`   talk to: ${f.relevantInvestors.join(", ")}`);
    out.push("");
  });
  return out.join("\n");
}

const FEAS_ICON: Record<string, string> = { high: "🟢", medium: "🟡", low: "🔴" };

export function renderPlan(p: ImplementationPlan): string {
  const out: string[] = [line];
  out.push(`🏗️  Implementation plan — ${p.repo}`);
  out.push(`   suggestion: ${p.suggestion}`);
  out.push("");
  out.push(`${FEAS_ICON[p.feasibility] ?? "•"} Feasibility: ${p.feasibility.toUpperCase()}  ·  estimate: ${p.estimate}`);
  out.push(`   ${p.verdict}`);
  out.push("");
  out.push("Steps:");
  p.steps.forEach((s, i) => out.push(`   ${i + 1}. ${s}`));
  if (p.filesToTouch.length) {
    out.push("");
    out.push("Files to touch:");
    p.filesToTouch.forEach((f) => out.push(`   • ${f}`));
  }
  if (p.risks.length) {
    out.push("");
    out.push("Risks:");
    p.risks.forEach((r) => out.push(`   • ${r}`));
  }
  if (p.references.length) {
    out.push("");
    out.push("Grounded in:");
    p.references.forEach((r) => out.push(`   • ${r}`));
  }
  out.push("");
  out.push("📋 Hand off to your coding agent (copy this):");
  out.push("┄".repeat(64));
  out.push(p.agentPrompt);
  out.push("┄".repeat(64));
  return out.join("\n");
}
