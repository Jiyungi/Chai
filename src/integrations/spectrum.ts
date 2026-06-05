import type { MomentumConfig } from "../config.js";

export type MessageHandler = (text: string, reply: (out: string) => Promise<void>) => Promise<void>;

/**
 * Spectrum (Photon) = delivery. The agent runs once and reaches users on the
 * interfaces they already use. We support the real `spectrum-ts` providers
 * (iMessage, WhatsApp, terminal) when configured, and a built-in terminal REPL
 * fallback so the conversational agent is demoable without any account.
 */
export class Spectrum {
  private app: any | null = null;

  constructor(private cfg: MomentumConfig) {}

  get live(): boolean {
    return this.cfg.spectrum.live;
  }

  /** Push a one-off message (e.g. a weekly digest) to every space. */
  async broadcast(text: string): Promise<{ delivered: boolean; via: string }> {
    if (!this.cfg.spectrum.live) {
      // No credentials: render to stdout as the "terminal" provider would.
      console.log("\n══════════ Spectrum · terminal delivery ══════════\n");
      console.log(text);
      console.log("\n═══════════════════════════════════════════════════\n");
      return { delivered: true, via: "terminal" };
    }
    try {
      const app = await this.boot();
      // In a provisioned project you'd target known spaces; for the hackathon
      // we surface the API shape and log the payload.
      if (app?.broadcast) await app.broadcast(text);
      return { delivered: true, via: this.cfg.spectrum.providers.join("+") };
    } catch {
      console.log(text);
      return { delivered: false, via: "terminal-fallback" };
    }
  }

  /**
   * Run the interactive agent loop. Each inbound message is handed to
   * `handler`, which produces a reply. Live mode streams from real providers;
   * offline mode reads stdin so you can chat with the agent in your terminal.
   */
  async serve(handler: MessageHandler): Promise<void> {
    if (this.cfg.spectrum.live) {
      const app = await this.boot();
      if (app) {
        for await (const [space, message] of app.messages) {
          const text = message?.content?.type === "text" ? message.content.text : "";
          if (!text) continue;
          await app.responding?.(space, async () => {
            await handler(text, async (out) => {
              await space.send(out);
            });
          });
        }
        return;
      }
    }
    await this.terminalLoop(handler);
  }

  private async boot(): Promise<any | null> {
    if (this.app) return this.app;
    try {
      const mod: any = await import("spectrum-ts");
      const providersMod: any = await import("spectrum-ts/providers");
      const providers = this.cfg.spectrum.providers
        .map((name) => providersMod[name]?.config?.())
        .filter(Boolean);
      this.app = await mod.Spectrum({
        projectId: this.cfg.spectrum.projectId,
        projectSecret: this.cfg.spectrum.projectSecret,
        providers: providers.length ? providers : undefined,
      });
      return this.app;
    } catch {
      return null;
    }
  }

  /** Local stand-in for the Spectrum `terminal` provider. */
  private async terminalLoop(handler: MessageHandler): Promise<void> {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(
      "\nMomentum agent (terminal provider). Ask about your repos, trends, or fusions. Type 'exit' to quit.\n",
    );
    try {
      while (true) {
        const text = (await rl.question("you › ")).trim();
        if (!text) continue;
        if (["exit", "quit", ":q"].includes(text.toLowerCase())) break;
        await handler(text, async (out) => {
          console.log(`\nmomentum › ${out}\n`);
        });
      }
    } finally {
      rl.close();
    }
  }
}
