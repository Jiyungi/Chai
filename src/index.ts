import { loadConfig, describeMode } from "./config.js";
import { MomentumEngine } from "./core/engine.js";
import { MomentumAgent } from "./core/agent.js";
import { Spectrum } from "./integrations/spectrum.js";
import { renderReport, renderFusions, renderPlan } from "./lib/render.js";
import type { ImplementationPlan } from "./types.js";

/**
 * Chai CLI.
 *   analyze            inspect repos → trends + suggestions
 *   fuse               cross-repo startup ideas
 *   plan <repo> [n]    feasibility + file-level plan + coding-agent handoff
 *   digest             build + deliver a weekly digest over Spectrum
 *   agent              interactive Q&A over Spectrum (terminal/iMessage/WhatsApp)
 *   provision          write the RocketRide .pipe files
 */
async function main() {
  const cmd = process.argv[2] ?? "analyze";
  const cfg = loadConfig();
  const engine = new MomentumEngine(cfg);
  await engine.init();

  console.log(`\nChai · keep your hackathon ideas alive`);
  console.log(`mode: ${describeMode(cfg)}  ·  user: ${cfg.github.username}`);
  const rrStatus = engine.engineSynthesis
    ? "live engine (synthesis routed through llm_openai_api → Butterbase)"
    : engine.engineReachable
      ? "live engine (orchestration; set ROCKETRIDE_SYNTHESIS=1 to route LLM through it)"
      : "in-process DAG (engine not running)";
  console.log(`rocketride: ${rrStatus}\n`);

  switch (cmd) {
    case "provision": {
      const paths = await engine.exportPipelines();
      console.log("Wrote RocketRide pipelines:");
      paths.forEach((p) => console.log(`  • ${p}`));
      break;
    }

    case "analyze": {
      const { reports, live } = await engine.analyzePortfolio(8);
      if (!live) console.log("(GitHub offline — using sample portfolio)\n");
      reports.forEach((r) => console.log(renderReport(r)));
      console.log(`\nAnalyzed ${reports.length} repos.`);
      break;
    }

    case "fuse": {
      const { reports } = await engine.analyzePortfolio(8);
      const fusions = await engine.findFusions(reports);
      console.log(renderFusions(fusions));
      break;
    }

    case "plan": {
      // chai plan <repoName> [suggestionIndex] [--issue]
      const repoArg = process.argv[3];
      const idx = Number(process.argv[4] ?? "0") || 0;
      const wantIssue = process.argv.includes("--issue");
      const { reports } = await engine.analyzePortfolio(8);
      const report = repoArg
        ? reports.find((r) => r.repo.name.toLowerCase() === repoArg.toLowerCase())
        : reports[0];
      if (!report) {
        console.log(`Repo "${repoArg}" not found. Available: ${reports.map((r) => r.repo.name).join(", ")}`);
        break;
      }
      const plan = await engine.planFor(report, idx);
      if (!plan) {
        console.log("No suggestion at that index to plan.");
        break;
      }
      console.log(renderPlan(plan));
      const file = await savePlan(plan);
      console.log(`\n💾 Saved handoff to ${file}`);
      if (wantIssue) {
        const url = await engine.github.createIssue(
          report.repo.fullName,
          `[Chai] ${plan.suggestion.slice(0, 60)}`,
          issueBody(plan),
        );
        console.log(url ? `🔗 Opened GitHub issue: ${url}` : "⚠️  Could not open issue (token needs issues:write).");
      }
      break;
    }

    case "digest": {
      const { reports } = await engine.analyzePortfolio(8);
      const fusions = await engine.findFusions(reports);
      const digest = await engine.buildDigest(reports, fusions);
      const spectrum = new Spectrum(cfg);
      const res = await spectrum.broadcast(digest.text);
      console.log(`\nDelivered via: ${res.via}`);
      break;
    }

    case "agent": {
      const { reports } = await engine.analyzePortfolio(8);
      const fusions = await engine.findFusions(reports);
      const agent = new MomentumAgent(engine, reports, fusions);
      const spectrum = new Spectrum(cfg);
      await spectrum.serve(async (text, reply) => {
        const out = await agent.handle(text);
        await reply(out);
      });
      break;
    }

    default:
      console.log(`Unknown command: ${cmd}`);
      console.log("Usage: chai <analyze|fuse|plan|digest|agent|provision>");
      await engine.shutdown();
      process.exit(1);
  }

  await engine.shutdown();
}

/** Save the coding-agent handoff prompt + plan as a markdown file. */
async function savePlan(plan: ImplementationPlan): Promise<string> {
  const fs = await import("node:fs/promises");
  await fs.mkdir("plans-out", { recursive: true });
  const slug = plan.repo.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const path = `plans-out/${slug}-${Date.now()}.md`;
  await fs.writeFile(path, issueBody(plan), "utf8");
  return path;
}

function issueBody(plan: ImplementationPlan): string {
  return [
    `# ${plan.suggestion}`,
    ``,
    `**Feasibility:** ${plan.feasibility} · **Estimate:** ${plan.estimate}`,
    ``,
    plan.verdict,
    ``,
    `## Steps`,
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    ...(plan.filesToTouch.length ? [`## Files to touch`, ...plan.filesToTouch.map((f) => `- \`${f}\``), ``] : []),
    ...(plan.risks.length ? [`## Risks`, ...plan.risks.map((r) => `- ${r}`), ``] : []),
    ...(plan.references.length ? [`## Grounded in`, ...plan.references.map((r) => `- ${r}`), ``] : []),
    `## Hand off to a coding agent`,
    "```",
    plan.agentPrompt,
    "```",
    ``,
    `_Generated by Chai._`,
  ].join("\n");
}

main().catch((err) => {
  console.error("Chai error:", err?.message ?? err);
  process.exit(1);
});
