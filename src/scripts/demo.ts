import { loadConfig, describeMode } from "../config.js";
import { MomentumEngine } from "../core/engine.js";
import { MomentumAgent } from "../core/agent.js";
import { Spectrum } from "../integrations/spectrum.js";
import { renderReport, renderFusions } from "../lib/render.js";

/**
 * One-shot, non-interactive demo of the whole Momentum flow. Safe to run with
 * zero credentials (GitHub + arXiv stay live if the network allows).
 *
 *   1. RocketRide  — provision pipelines (.pipe files)
 *   2. Repo Radar  — inspect repos, gather OSS/startup/paper signals, synthesize
 *   3. XTrace      — durable facts written + recalled
 *   4. Fusion      — cross-repo startup ideas
 *   5. Digest      — built + delivered over Spectrum
 *   6. Agent       — a couple of scripted Q&A turns
 */
async function run() {
  const cfg = loadConfig();
  const engine = new MomentumEngine(cfg);

  header("Momentum demo");
  console.log(`mode: ${describeMode(cfg)}\nuser: ${cfg.github.username}\n`);

  // 1. RocketRide pipelines
  header("1 · RocketRide — provision pipelines");
  const pipes = await engine.exportPipelines();
  pipes.forEach((p) => console.log(`  wrote ${p}`));
  const reachable = await engine.rocket.engineReachable();
  console.log(`  engine @ ${cfg.rocketride.engineUrl}: ${reachable ? "reachable" : "not running (in-process DAG)"}`);

  // 2. Repo Radar
  header("2 · Repo Radar — inspect + gather signals + synthesize");
  const { reports, live } = await engine.analyzePortfolio(3);
  if (!live) console.log("  (GitHub offline — using sample portfolio)\n");
  reports.forEach((r) => console.log(renderReport(r)));

  // 3. XTrace recall
  header("3 · XTrace — durable memory recall");
  for (const r of reports.slice(0, 2)) {
    const hits = await engine.memory.recall(r.repo.fullName, "suggestions and trends", 3);
    console.log(`  ${r.repo.name}: recalled ${hits.length} prior fact(s)`);
    hits.slice(0, 2).forEach((h) => console.log(`     - ${h.text.slice(0, 90)}`));
  }

  // 4. Fusion
  header("4 · Fusion Finder — cross-repo startup ideas");
  const fusions = await engine.findFusions(reports);
  console.log(renderFusions(fusions));

  // 5. Digest over Spectrum
  header("5 · Spectrum — weekly digest delivery");
  const digest = await engine.buildDigest(reports, fusions);
  const spectrum = new Spectrum(cfg);
  await spectrum.broadcast(digest.text);

  // 6. Agent Q&A
  header("6 · Agent — scripted conversation");
  const agent = new MomentumAgent(engine, reports, fusions);
  for (const q of ["list", "fuse", "which project has the most VC interest?"]) {
    console.log(`\nyou › ${q}`);
    console.log(`momentum › ${await agent.handle(q)}`);
  }

  console.log("\n✓ Demo complete.\n");
}

function header(title: string) {
  console.log(`\n${"━".repeat(64)}\n${title}\n${"━".repeat(64)}`);
}

run().catch((err) => {
  console.error("Demo error:", err?.stack ?? err);
  process.exit(1);
});
