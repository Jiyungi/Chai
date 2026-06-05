import type { MomentumConfig } from "../config.js";

/**
 * RocketRide = pipeline orchestration, using the REAL RocketRide engine + SDK.
 *
 * Momentum's product logic is expressed as RocketRide pipelines (portable
 * `.pipe` JSON: a graph of `components` wired by `input` lanes). Two execution
 * modes:
 *
 *   1. LIVE engine — when a RocketRide engine is reachable (local Docker on
 *      ws://localhost:5565, auth "api_key", or cloud), we connect with the
 *      official `rocketride` SDK, `use()` the pipeline, and `send()`/`chat()`
 *      data through the real C++ runtime. Notably, our synthesis pipeline runs
 *      an `llm_openai_api` node pointed at the Butterbase AI gateway — so two
 *      required technologies are wired together *inside the engine*.
 *
 *   2. In-process DAG — if no engine is reachable, we execute the same pipeline
 *      graph in-process (topological order) using registered node runners. The
 *      product still behaves identically; only the runtime differs.
 *
 * Either way the product logic IS the pipeline.
 */

export interface PipeComponent {
  id: string;
  /** RocketRide node provider, e.g. "webhook", "response", "llm_openai_api". */
  provider: string;
  /** Logical category for the canvas / our in-process executor. */
  category: string;
  label: string;
  config?: Record<string, unknown>;
  /** Upstream lanes feeding this component. */
  input?: { lane: string; from: string }[];
}

export interface Pipe {
  name: string;
  description: string;
  /** id of the source component. */
  source: string;
  components: PipeComponent[];
}

/** A node implementation for the in-process executor. */
export type NodeRunner = (
  ctx: Record<string, unknown>,
  inputs: Record<string, unknown>,
) => Promise<unknown>;

export class RocketRide {
  private runners = new Map<string, NodeRunner>();
  private client: any | null = null;
  private connected = false;
  /** Cache of long-lived pipeline tasks (chat sources support multi-turn). */
  private tasks = new Map<string, string>();

  constructor(private cfg: MomentumConfig) {}

  register(nodeId: string, runner: NodeRunner): this {
    this.runners.set(nodeId, runner);
    return this;
  }

  /** Convert our Pipe to the engine's portable `.pipe` document shape. */
  toPipeDoc(pipe: Pipe, uniqueProject = false): Record<string, unknown> {
    return {
      version: 1,
      name: pipe.name,
      description: pipe.description,
      source: pipe.source,
      project_id: uniqueProject ? `momentum-${pipe.name}-${Date.now()}` : `momentum-${pipe.name}`,
      components: pipe.components.map((c) => ({
        id: c.id,
        provider: c.provider,
        config: c.config ?? {},
        ...(c.input && c.input.length ? { input: c.input } : {}),
      })),
    };
  }

  /** Persist a `.pipe` file (opens in the RocketRide VS Code canvas). */
  async writePipe(pipe: Pipe, dir = "pipelines"): Promise<string> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    const path = `${dir}/${pipe.name}.pipe`;
    await fs.writeFile(path, JSON.stringify(this.toPipeDoc(pipe), null, 2), "utf8");
    return path;
  }

  // ── Live engine connection ────────────────────────────────────────────────

  /** Try to connect the real SDK to the engine. Returns null if unreachable. */
  private async ensureClient(): Promise<any | null> {
    if (this.connected) return this.client;
    try {
      const { RocketRideClient }: any = await import("rocketride");
      const uri = this.cfg.rocketride.engineUrl.replace(/^http/, "ws");
      const client = new RocketRideClient({
        uri,
        auth: this.cfg.rocketride.apiKey,
        requestTimeout: 30000,
      });
      // Bound the connect so a missing engine fails fast instead of hanging.
      await withTimeout(client.connect(), 4000);
      this.client = client;
      this.connected = true;
      return client;
    } catch {
      try {
        await this.client?.disconnect?.();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.connected = false;
      return null;
    }
  }

  async engineReachable(): Promise<boolean> {
    return (await this.ensureClient()) !== null;
  }

  /**
   * Run a single prompt through a chat-source LLM pipeline on the engine.
   * The pipeline task is started once and reused across calls (chat sources are
   * multi-turn), which avoids ~18s of per-call task setup under emulation.
   */
  async runOnEngine(pipe: Pipe, prompt: string): Promise<string | null> {
    const client = await this.ensureClient();
    if (!client) return null;
    try {
      const { Question }: any = await import("rocketride");
      let token = this.tasks.get(pipe.name);
      if (!token) {
        const used = await client.use({ pipeline: this.toPipeDoc(pipe, true) });
        token = used.token as string;
        this.tasks.set(pipe.name, token);
      }
      const question = new Question();
      question.addQuestion(prompt);
      const out = await client.chat({ token, question });
      const answers = out?.answers;
      if (Array.isArray(answers)) return answers.join("\n").trim();
      if (typeof answers === "string") return answers.trim();
      const firstArray = out && Object.values(out).find((v) => Array.isArray(v));
      if (Array.isArray(firstArray)) return firstArray.join("\n").trim();
      return null;
    } catch {
      // Drop a possibly-dead task so the next call re-creates it.
      this.tasks.delete(pipe.name);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      for (const token of this.tasks.values()) {
        try {
          await this.client.terminate(token);
        } catch {
          /* ignore */
        }
      }
      this.tasks.clear();
      try {
        await this.client.disconnect();
      } catch {
        /* ignore */
      }
      this.connected = false;
      this.client = null;
    }
  }

  // ── In-process DAG executor (fallback) ────────────────────────────────────

  async run(pipe: Pipe, ctx: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const order = topoSort(pipe.components);
    const outputs: Record<string, unknown> = {};
    for (const node of order) {
      const runner = this.runners.get(node.id);
      const deps = (node.input ?? []).map((i) => i.from);
      const inputs: Record<string, unknown> = {};
      for (const dep of deps) inputs[dep] = outputs[dep];
      if (!runner) {
        outputs[node.id] = deps.length === 1 ? inputs[deps[0]] : inputs;
        continue;
      }
      outputs[node.id] = await runner(ctx, inputs);
    }
    return outputs;
  }
}

/** Kahn's algorithm; throws on cycles. */
function topoSort(components: PipeComponent[]): PipeComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const indeg = new Map<string, number>(components.map((c) => [c.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const c of components) {
    for (const dep of (c.input ?? []).map((i) => i.from)) {
      indeg.set(c.id, (indeg.get(c.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), c.id]);
    }
  }
  const queue = components.filter((c) => (indeg.get(c.id) ?? 0) === 0).map((c) => c.id);
  const ordered: PipeComponent[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const d of dependents.get(id) ?? []) {
      indeg.set(d, (indeg.get(d) ?? 1) - 1);
      if ((indeg.get(d) ?? 0) === 0) queue.push(d);
    }
  }
  if (ordered.length !== components.length) {
    throw new Error("RocketRide pipeline has a cycle; cannot execute.");
  }
  return ordered;
}

/** Resolve a promise or reject after `ms` so a missing engine fails fast. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
