# Momentum

**Don't let your hackathon project die on Sunday night.**

Momentum is an agentic tool that keeps your projects — and your ideas — alive after the demo. It inspects your GitHub repos and, for each one, continuously tracks the world around it:

- 🔧 **Related open-source projects** that are active right now
- 💸 **Funded startups + the VCs that backed them** in the same space
- 📄 **Fresh research papers** (live from arXiv), including brand-new releases
- 🚀 **Concrete suggestions** to replace or improve your implementation, each backed by evidence
- 💡 **Cross-repo fusion ideas** — how to combine 2+ of your projects into one startup-worthy product
- 📈 **"What changed since last week"** — a self-revising memory means it tells you when a paper it recommended got superseded, or a new competitor got funded

Then it reaches you where you already are — iMessage, WhatsApp, or your terminal — so tracking your ideas is zero-friction, and turning one into a startup (with the right investor to talk to) becomes the default instead of throwing it away.

> Built for the **Agentic AI SF Hackathon** — Track 10, Open Innovation: *"Developers cannot keep up with research and repositories."*

---

## The four required technologies, deeply integrated

Momentum's product logic *is* a set of RocketRide pipelines, and every node is backed by one of the four stack technologies. None of them are decorative — remove any one and the product loses a core capability.

| Technology | Role in Momentum | Where in code |
| --- | --- | --- |
| **RocketRide** | Orchestrates the product as portable `.pipe` DAGs: Repo Radar, Fusion Finder, Weekly Digest. Each run executes a pipeline node-by-node in topological order. | `src/integrations/rocketride.ts`, `src/core/pipelines.ts`, `pipelines/*.pipe` |
| **Butterbase** | The backend. Its **AI Model Gateway** (OpenAI-compatible) powers all synthesis — improvement suggestions, fusion ideas, agent answers. Its **Data API** persists reports and fusions. | `src/integrations/butterbase.ts` |
| **XTrace** | The self-revising memory layer. Momentum writes durable facts about each repo after every run; on the next run it recalls them to compute *what actually changed*. | `src/integrations/xtrace.ts` |
| **Photon (Spectrum)** | Delivery. The agent runs once and reaches users over iMessage / WhatsApp / terminal. Powers the weekly digest broadcast and the interactive Q&A agent. | `src/integrations/spectrum.ts` |

### The pipelines

```
Repo Radar (repo-radar.pipe)
  src ─► github ─┬─► oss ──────┐
                 ├─► papers ───┼─► synthesize ─┬─► memory ─┐
                 └─► startups ─┘   (Butterbase  │ (XTrace)  ├─► store
                                    AI gateway)  └───────────┘   (Butterbase data API)

Fusion Finder (fusion-finder.pipe)
  reports ─► fuse (LLM) ─► rank ─► store

Weekly Digest (weekly-digest.pipe)
  recall (XTrace) ─┐
                   ├─► diff (what changed) ─► deliver (Spectrum)
  new reports ─────┘
```

Run `npm run provision` to (re)generate the `.pipe` files — they open in the RocketRide VS Code canvas.

---

## Quickstart

```bash
npm install
cp .env.example .env     # optional — fill in what you have

# See the whole thing end-to-end (works with zero credentials):
npm run demo

# Or use the richest curated portfolio for a demo without a GitHub account:
MOMENTUM_SAMPLE=1 npm run demo
```

> **Runs offline by design.** Every keyed service degrades gracefully, so the full flow is always demoable. **GitHub repo inspection and arXiv paper search stay live whenever you have network access — no keys required.** Add keys to light up live AI synthesis (Butterbase), hosted memory (XTrace), and real messaging delivery (Spectrum).

### Commands

```bash
npm run analyze     # inspect repos → trends + improvement suggestions
npm run fuse        # cross-repo startup ideas + investors to talk to
npm run digest      # build a weekly digest and deliver it via Spectrum
npm run agent       # chat with the agent (terminal, or iMessage/WhatsApp if configured)
npm run provision   # write the RocketRide .pipe files
```

---

## Configuration

All keys are optional. See `.env.example` for the full list. The startup banner prints which subsystems are live:

```
mode: github=live(anon)  butterbase=offline  xtrace=offline  spectrum=terminal
```

| Variable | Enables |
| --- | --- |
| `GITHUB_USERNAME` / `GITHUB_TOKEN` | Which repos to inspect; token raises rate limits + private repos |
| `BUTTERBASE_API_KEY` / `BUTTERBASE_APP_ID` | Live AI synthesis + persistence |
| `XTRACE_API_KEY` / `XTRACE_ORG_ID` | Hosted self-revising memory |
| `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` / `SPECTRUM_PROVIDERS` | Real messaging delivery (e.g. `imessage`, `whatsapp`) |
| `ROCKETRIDE_ENGINE_URL` | Hand pipelines to a running RocketRide engine |

---

## How the "what changed since last week" loop works

1. **Repo Radar** gathers signals and writes them to XTrace as conversation turns. XTrace extracts durable facts and reconciles contradictions over time.
2. On the next run, the **Weekly Digest** pipeline recalls prior facts and diffs them against the latest signals.
3. You get a digest that highlights only what's genuinely new — a freshly funded competitor, a paper that supersedes one you were going to implement, a new OSS project worth forking.

This is the difference between a one-shot report and a living tracker: the memory layer is what lets Momentum tell you what *moved*.

---

## Architecture

```
src/
  config.ts                 # env → typed config; live/offline detection
  types.ts                  # Repo, Signal, ImprovementSuggestion, FusionIdea, Digest
  index.ts                  # CLI entrypoint
  lib/
    http.ts                 # tiny fetch wrapper (timeout + JSON)
    render.ts               # terminal rendering
  integrations/
    github.ts               # repo inspection (live REST + sample portfolio)
    discovery.ts            # trend radar: GitHub search, arXiv, startup/investor KB
    butterbase.ts           # AI gateway + data API (+ offline fallbacks)
    xtrace.ts               # durable memory (SDK + local JSONL fallback)
    spectrum.ts             # messaging delivery + interactive agent loop
    rocketride.ts           # .pipe generation + in-process DAG executor
  core/
    pipelines.ts            # canonical RocketRide pipeline definitions
    synthesis.ts            # LLM prompts for suggestions + fusions (+ heuristics)
    engine.ts               # wires integrations into pipeline node runners
    agent.ts                # conversational brain behind Spectrum
  scripts/
    demo.ts                 # one-shot end-to-end showcase
pipelines/                  # generated .pipe files (RocketRide canvas)
```

---

## Security notes

- API keys are read from environment only; nothing is logged or transmitted to third parties beyond the four configured services + the public GitHub/arXiv APIs.
- The local memory fallback (`.momentum-cache/`) is git-ignored.
- GitHub access is read-only.

---

## Hackathon submission

```
Submit my project to the hackathon. Submission code: havefun0605. Hackathon slug: agentic-ai-Hackathon
```
