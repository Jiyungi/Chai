import type { MomentumEngine } from "./engine.js";
import type { RepoReport, FusionIdea } from "../types.js";
import type { ChatMessage } from "../integrations/butterbase.js";

/**
 * The conversational agent that sits behind Spectrum. It answers questions
 * about the user's repos, trends, and fusion ideas, grounding every answer in
 * the analyzed reports + XTrace memory. This is what users actually talk to on
 * iMessage / WhatsApp / terminal.
 */
export class MomentumAgent {
  constructor(
    private engine: MomentumEngine,
    private reports: RepoReport[],
    private fusions: FusionIdea[],
  ) {}

  /** Handle one inbound message, returning the reply text. */
  async handle(text: string): Promise<string> {
    const q = text.trim();
    const lower = q.toLowerCase();

    if (["help", "?", "menu"].includes(lower)) {
      return this.helpText();
    }
    if (lower === "list" || lower === "repos") {
      return this.reports.map((r) => `• ${r.repo.name} — ${r.repo.description ?? ""}`).join("\n");
    }
    if (lower.startsWith("fuse") || lower.includes("combine") || lower.includes("startup idea")) {
      return this.renderFusions();
    }

    // Repo-specific deep dive?
    const match = this.reports.find((r) => lower.includes(r.repo.name.toLowerCase()));
    if (match) {
      return this.renderRepo(match);
    }

    // General question → ground in memory + reports via the AI gateway.
    return this.answer(q);
  }

  private helpText(): string {
    return [
      "I track your hackathon projects and the world around them. Try:",
      "  • 'list'         — your analyzed repos",
      "  • '<repo name>'  — trends + suggestions for that repo",
      "  • 'fuse'         — startup ideas combining your projects",
      "  • or ask anything, e.g. 'which project has the most VC interest?'",
    ].join("\n");
  }

  private renderRepo(r: RepoReport): string {
    const papers = r.signals.filter((s) => s.kind === "paper").slice(0, 2);
    const startups = r.signals.filter((s) => s.kind === "startup").slice(0, 2);
    const oss = r.signals.filter((s) => s.kind === "oss").slice(0, 2);
    const lines = [`📦 ${r.repo.name} — ${r.repo.description ?? ""}`, ""];
    if (papers.length) {
      lines.push("📄 Recent papers:");
      papers.forEach((p) => lines.push(`   • ${p.title}`));
    }
    if (oss.length) {
      lines.push("🔧 Related OSS:");
      oss.forEach((o) => lines.push(`   • ${o.title}`));
    }
    if (startups.length) {
      lines.push("💸 Funded startups nearby:");
      startups.forEach((s) =>
        lines.push(`   • ${s.title} (${s.funding?.stage} ${s.funding?.amount}) — ${s.funding?.investors.join(", ")}`),
      );
    }
    if (r.suggestions.length) {
      lines.push("", "🚀 Suggested moves:");
      r.suggestions.slice(0, 3).forEach((s) => lines.push(`   • [${s.effort}] ${s.proposal}`));
    }
    return lines.join("\n");
  }

  private renderFusions(): string {
    if (!this.fusions.length) return "No fusion ideas yet — analyze at least two repos first.";
    return this.fusions
      .slice(0, 3)
      .map((f, i) => {
        const inv = f.relevantInvestors.length ? `\n   investors to watch: ${f.relevantInvestors.join(", ")}` : "";
        return `${i + 1}. ${f.name} (${f.score}/100)\n   ${f.pitch}\n   wedge: ${f.wedge}${inv}`;
      })
      .join("\n\n");
  }

  private async answer(question: string): Promise<string> {
    // Ground the answer in memory across all repos.
    const memos: string[] = [];
    for (const r of this.reports) {
      const hits = await this.engine.memory.recall(r.repo.fullName, question, 3);
      memos.push(...hits.map((h) => `(${r.repo.name}) ${h.text}`));
    }
    const portfolio = this.reports
      .map((r) => {
        const investors = [
          ...new Set(
            r.signals.filter((s) => s.kind === "startup").flatMap((s) => s.funding?.investors ?? []),
          ),
        ];
        return `${r.repo.name}: ${r.repo.description ?? ""}${
          investors.length ? ` (investors nearby: ${investors.join(", ")})` : ""
        }`;
      })
      .join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are Momentum, a concise hacker-mentor. Answer using ONLY the portfolio and memory provided. " +
          "Be specific, reference repo names, and keep it under 120 words. If unknown, say so.",
      },
      {
        role: "user",
        content: `PORTFOLIO:\n${portfolio}\n\nMEMORY:\n${memos.join("\n") || "(none)"}\n\nQUESTION: ${question}`,
      },
    ];
    const reply = await this.engine.bb.chat(messages, { maxTokens: 400 });
    return reply.trim() || "I don't have enough analyzed data to answer that yet. Try 'list' or run an analysis.";
  }
}
