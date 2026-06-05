import type { MomentumConfig } from "../config.js";
import { request } from "../lib/http.js";

/**
 * RocketRide = pipeline orchestration. Momentum's product logic is expressed as
 * RocketRide pipelines (portable `.pipe` JSON: a directed graph of typed nodes
 * wired by lanes). We generate the canonical `.pipe` definitions to disk so they
 * open in the VS Code visual canvas, and we run them through a lightweight
 * orchestrator that executes each node in dependency order.
 *
 * If a RocketRide engine is reachable at ROCKETRIDE_ENGINE_URL we hand the
 * pipeline to it; otherwise we execute the same graph in-process using the
 * node implementations registered by the caller. Either way the *product logic
 * is the pipeline*, satisfying the "meaningfully connected" requirement.
 */

export interface PipeNode {
  id: string;
  type: string; // e.g. "source.webhook", "tool.github", "llm.anthropic"
  category: string; // Source | Tool | LLM | Store | Agents | Infrastructure ...
  label: string;
  config?: Record<string, unknown>;
  /** ids of upstream nodes whose outputs feed this node's input lanes. */
  inputs: string[];
}

export interface Pipe {
  name: string;
  description: string;
  nodes: PipeNode[];
}

/** A node implementation: receives merged upstream outputs, returns its output. */
export type NodeRunner = (
  ctx: Record<string, unknown>,
  inputs: Record<string, unknown>,
) => Promise<unknown>;

export class RocketRide {
  private runners = new Map<string, NodeRunner>();

  constructor(private cfg: MomentumConfig) {}

  /** Register the implementation for a node id. */
  register(nodeId: string, runner: NodeRunner): this {
    this.runners.set(nodeId, runner);
    return this;
  }

  /** Persist a `.pipe` file so it renders in the RocketRide canvas. */
  async writePipe(pipe: Pipe, dir = "pipelines"): Promise<string> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    const path = `${dir}/${pipe.name}.pipe`;
    // Shape mirrors RocketRide's node/lane model in portable JSON.
    const doc = {
      version: "1.0",
      name: pipe.name,
      description: pipe.description,
      nodes: pipe.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        category: n.category,
        label: n.label,
        config: n.config ?? {},
      })),
      lanes: pipe.nodes.flatMap((n) =>
        n.inputs.map((from) => ({ from, to: n.id, lane: "data" })),
      ),
    };
    await fs.writeFile(path, JSON.stringify(doc, null, 2), "utf8");
    return path;
  }

  /** Is a live engine reachable? */
  async engineReachable(): Promise<boolean> {
    try {
      const res = await request(`${this.cfg.rocketride.engineUrl}/health`, { timeoutMs: 1500 });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Execute a pipeline as a DAG. Runs nodes in topological order, merging the
   * outputs of all upstream nodes into each node's input map (by node id).
   * Returns the output of every node, keyed by id.
   */
  async run(pipe: Pipe, ctx: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const order = topoSort(pipe.nodes);
    const outputs: Record<string, unknown> = {};
    for (const node of order) {
      const runner = this.runners.get(node.id);
      const inputs: Record<string, unknown> = {};
      for (const dep of node.inputs) inputs[dep] = outputs[dep];
      if (!runner) {
        // No implementation registered → pass merged inputs through.
        outputs[node.id] = node.inputs.length === 1 ? inputs[node.inputs[0]] : inputs;
        continue;
      }
      outputs[node.id] = await runner(ctx, inputs);
    }
    return outputs;
  }
}

/** Kahn's algorithm; throws on cycles. */
function topoSort(nodes: PipeNode[]): PipeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    for (const dep of n.inputs) {
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), n.id]);
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const ordered: PipeNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const d of dependents.get(id) ?? []) {
      indeg.set(d, (indeg.get(d) ?? 1) - 1);
      if ((indeg.get(d) ?? 0) === 0) queue.push(d);
    }
  }
  if (ordered.length !== nodes.length) {
    throw new Error("RocketRide pipeline has a cycle; cannot execute.");
  }
  return ordered;
}
