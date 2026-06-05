import { loadConfig, describeMode } from "./config.js";
import { MomentumEngine } from "./core/engine.js";
import { MomentumAgent } from "./core/agent.js";
import { Spectrum } from "./integrations/spectrum.js";
import { renderReport, renderFusions } from "./lib/render.js";

/**
 * Momentum CLI.
 *   analyze   inspect repos → trends + suggestions
 *   fuse      cross-repo startup ideas
 *   digest    build + deliver a weekly digest over Spectrum
 *   agent     interactive Q&A over Spectrum (terminal/iMessage/WhatsApp)
 *   provision write the RocketRide .pipe files
 */
async function main() {
  const cmd = process.argv[2] ?? "analyze";
  const cfg = loadConfig();
  const engine = new MomentumEngine(cfg);

  console.log(`\nMomentum · keep your hackathon ideas alive`);
  console.log(`mode: ${describeMode(cfg)}  ·  user: ${cfg.github.username}\n`);

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
      console.log("Usage: momentum <analyze|fuse|digest|agent|provision>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Momentum error:", err?.message ?? err);
  process.exit(1);
});
