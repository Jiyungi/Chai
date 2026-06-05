import type { RepoReport, FusionIdea } from "../types.js";

/** Pretty terminal rendering for CLI commands. */

const line = "─".repeat(64);

export function renderReport(r: RepoReport): string {
  const out: string[] = [];
  out.push(line);
  out.push(`📦 ${r.repo.fullName}  ★${r.repo.stars}  ${r.repo.language ?? ""}`);
  if (r.repo.description) out.push(`   ${r.repo.description}`);
  out.push("");

  const groups: Array<["paper" | "oss" | "startup", string]> = [
    ["paper", "📄 Recent research"],
    ["oss", "🔧 Related open source"],
    ["startup", "💸 Funded startups + investors"],
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
