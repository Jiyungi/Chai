import type { MomentumConfig } from "../config.js";

export type MessageHandler = (text: string, reply: (out: string) => Promise<void>) => Promise<void>;

const PROVIDER_ALIASES: Record<string, string> = {
  whatsapp: "whatsappBusiness",
  "whatsapp-business": "whatsappBusiness",
  imsg: "imessage",
};

/**
 * Spectrum (Photon) = delivery. The agent runs once and reaches users on the
 * interfaces they already use. Uses the real `spectrum-ts` SDK (iMessage,
 * WhatsApp Business, Slack, terminal). A terminal REPL fallback keeps the agent
 * demoable when no project credentials are present.
 */
export class Spectrum {
  private app: any | null = null;
  private imessageFn: any | null = null;

  constructor(private cfg: MomentumConfig) {}

  get live(): boolean {
    return this.cfg.spectrum.live;
  }

  /**
   * Proactively deliver a message (e.g. the weekly digest) to one recipient.
   * Spectrum has no "send to everyone" primitive — you resolve a user on a
   * platform, open/get a space (DM), and send. We target SPECTRUM_DIGEST_TO
   * (phone or email for iMessage). Without it, we render to the terminal.
   */
  async broadcast(text: string): Promise<{ delivered: boolean; via: string }> {
    const recipient = this.cfg.spectrum.digestTo;
    if (this.cfg.spectrum.live && recipient) {
      try {
        const app = await this.boot();
        if (app && this.imessageFn) {
          const im = this.imessageFn(app);
          const user = await im.user(recipient);
          const dm = await im.space(user);
          await dm.send(text);
          return { delivered: true, via: `imessage:${recipient}` };
        }
      } catch (err) {
        // fall through to terminal render
      }
    }
    console.log("\n══════════ Spectrum · terminal delivery ══════════\n");
    console.log(text);
    console.log("\n═══════════════════════════════════════════════════\n");
    return {
      delivered: true,
      via: this.cfg.spectrum.live && !recipient ? "terminal (set SPECTRUM_DIGEST_TO to send via iMessage)" : "terminal",
    };
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
        console.log(
          `Spectrum live on [${this.cfg.spectrum.providers.join(", ")}]. Waiting for inbound messages…`,
        );
        for await (const [space, message] of app.messages) {
          const content = message?.content;
          const text = content?.type === "text" ? content.text : "";
          if (!text) continue;
          await app.responding(space, async () => {
            await handler(text, async (out) => {
              await space.send(out);
            });
          });
        }
        return;
      }
      console.log("Spectrum failed to start with provided credentials; falling back to terminal.\n");
    }
    await this.terminalLoop(handler);
  }

  private async boot(): Promise<any | null> {
    if (this.app) return this.app;
    try {
      const mod: any = await import("spectrum-ts");
      const providersMod: any = await import("spectrum-ts/providers");
      const imessageMod: any = await import("spectrum-ts/providers/imessage");
      this.imessageFn = imessageMod.imessage;
      const providers = this.cfg.spectrum.providers
        .map((name) => {
          const key = PROVIDER_ALIASES[name] ?? name;
          return providersMod[key]?.config?.();
        })
        .filter(Boolean);
      this.app = await mod.Spectrum({
        projectId: this.cfg.spectrum.projectId,
        projectSecret: this.cfg.spectrum.projectSecret,
        providers: providers.length ? providers : [providersMod.terminal.config()],
      });
      return this.app;
    } catch (err) {
      console.error("Spectrum boot error:", (err as any)?.message ?? err);
      return null;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.app?.stop?.();
    } catch {
      /* ignore */
    }
  }

  /** Local stand-in for the Spectrum `terminal` provider. */
  private async terminalLoop(handler: MessageHandler): Promise<void> {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(
      "\nChai agent (terminal provider). Ask about your repos, trends, or fusions. Type 'exit' to quit.\n",
    );
    try {
      while (true) {
        const text = (await rl.question("you › ")).trim();
        if (!text) continue;
        if (["exit", "quit", ":q"].includes(text.toLowerCase())) break;
        await handler(text, async (out) => {
          console.log(`\nchai › ${out}\n`);
        });
      }
    } finally {
      rl.close();
    }
  }
}
