# Chai

**Don't let your hackathon project die on Sunday night.**

## The problem

Every hackathon ends the same way. You build something genuinely interesting in 24–48 hours, you demo it, maybe you win an award — and then it dies. The repo goes stale, the idea fades, and three months later someone launches a funded startup doing exactly what you prototyped. The graveyard of abandoned hackathon projects is enormous, and most of them died not because the idea was bad, but because there was no bridge from "weekend demo" to "thing worth pursuing."

The two things that bridge usually requires are exhausting to do by hand:

1. **Staying current.** To know whether your idea still has legs you'd have to continuously track new open-source projects, funded startups (and who funded them), fresh research papers, and what practitioners are actually saying — for *every* project you've ever built.
2. **Acting on it.** Even when you spot a real improvement or a startup angle, turning it into shipped code or an investor conversation is enough friction that it never happens.

**Chai is the bridge.** It treats your hackathon repos as living ideas, not finished artifacts. It watches the world around each one, tells you what changed, proposes how to improve or combine them into something startup-worthy, hands you a ready-to-run plan for your coding agent, and reaches you on iMessage so none of it requires opening a dashboard. The goal: turn "throw it away after the hackathon" into "keep the momentum and maybe build the company."

> Built for the **Agentic AI SF Hackathon** — Track 10, Open Innovation: *"Developers cannot keep up with research and repositories."*

## What it does

For each of your GitHub repos, Chai tracks the world around it and helps you act:

- 🔧 **Related open-source projects** that are active right now (live GitHub search)
- 💸 **Funded startups + the VCs that backed them** in the same space, so you know who to talk to
- 📄 **Fresh research papers** (live from arXiv), including brand-new releases
- 🗣️ **What people are saying** — relevant, high-engagement Hacker News discussion (live, no key)
- 🚀 **Concrete improvement suggestions**, each tied to a specific paper / repo / discussion
- 🏗️ **A feasibility check + file-level implementation plan** (the *Architect* agent) with a ready-to-paste prompt for Codex / Claude Code / Cursor
- 💡 **Cross-repo fusion ideas** — how to combine 2+ of your projects into one startup-worthy product, with a pitch, wedge, GTM, and investors to approach
- 📈 **"What changed since last week"** — self-revising memory means it tells you when a paper it recommended got superseded, or a new competitor got funded

Then it reaches you where you already are — **iMessage** — so tracking your ideas (and shipping the next improvement) is zero-friction.

## Two agents

Chai is built around two cooperating agents:

- **Radar** — scans the world for each repo and produces evidence-backed suggestions and cross-repo fusion ideas.
- **Architect** — takes one suggestion, reads the repo's *real file tree* + README and the cited research, and produces a feasibility verdict, file-level steps, risks, an estimate, and a self-contained prompt you can hand to a coding agent. With `--issue` it files a GitHub issue so the work lands in your tracker.

The Architect is what closes the loop from "good idea" to "shipped code": you don't copy a vague one-liner into Codex and re-explain your repo — Chai hands the coding agent a complete, repo-aware work order.

---

## The four required technologies, deeply integrated

Chai's product logic *is* a set of RocketRide pipelines, and every node is backed by one of the four stack technologies. None of them are decorative — remove any one and the product loses a core capability.

### RocketRide — pipeline orchestration (real C++ engine)

Chai's three workflows are defined as portable `.pipe` DAGs and executed on the **real RocketRide engine** via the official `rocketride` npm SDK (WebSocket/DAP protocol). The `.pipe` files open in the RocketRide VS Code canvas.

- **Repo Radar** — `src → github → {oss, papers, startups, social} → synthesize → memory → store`
- **Fusion Finder** — `reports → fuse → rank → store`
- **Weekly Digest** — `recall + new → diff (what changed) → deliver`

Deepest integration: with `ROCKETRIDE_SYNTHESIS=1`, LLM synthesis runs **inside the engine** on an `llm_openai_api` node whose `base_url`/`apikey` point at the Butterbase gateway — so two required technologies are wired together in a single node. When no engine is running, Chai executes the same DAG in-process so nothing breaks.
*Code:* `src/integrations/rocketride.ts`, `src/core/pipelines.ts`, `pipelines/*.pipe`

### Butterbase — backend (AI gateway + database)

Used two ways, both live:

- **AI Model Gateway** (OpenAI-compatible, `anthropic/claude-sonnet-4.6`) powers all synthesis: Radar suggestions, Architect plans, fusion ideas, and the conversational agent's answers.
- **Data API** (real provisioned app `chai-hackathon`) persists every run into three tables — `reports`, `fusions`, and `plans` — so the portfolio's history survives across runs and feeds the "what changed" loop.

*Code:* `src/integrations/butterbase.ts`. App provisioned and schema applied via the Butterbase MCP server (`init_app`, `manage_schema`); the running app uses the REST API directly.

### XTrace — self-revising memory

After every run, Chai writes durable facts about each repo (signals, suggestions, and plan decisions) to XTrace via `@xtraceai/memory`. On the next run it recalls them and diffs against fresh signals to surface *only what genuinely changed* — a newly funded competitor, a paper that supersedes one it recommended, a plan you haven't acted on yet. This is the difference between a one-shot report and a living tracker.
*Code:* `src/integrations/xtrace.ts`

### Photon (Spectrum) — delivery

The agent runs once and reaches users on the interfaces they already use, via the real `spectrum-ts` SDK (connected to iMessage project `chai`). It powers two things: the **weekly digest send**, and a **conversational agent** you can text. From iMessage you can say `list`, a repo name for its trends, `plan <repo>` to get a paste-ready coding-agent prompt, or `fuse` for startup ideas — all without leaving Messages.
*Code:* `src/integrations/spectrum.ts`

### The pipelines

```
Repo Radar (repo-radar.pipe)
  src ─► github ─┬─► oss ───────┐
                 ├─► papers ────┤
                 ├─► startups ──┼─► synthesize ─┬─► memory ─┐
                 └─► social ────┘   (Butterbase  │ (XTrace)  ├─► store
                                     AI gateway)  └───────────┘   (Butterbase DB)

Fusion Finder (fusion-finder.pipe)
  reports ─► fuse (LLM) ─► rank ─► store (Butterbase DB)

Weekly Digest (weekly-digest.pipe)
  recall (XTrace) ─┐
                   ├─► diff (what changed) ─► deliver (Spectrum)
  new reports ─────┘
```

Run `npm run provision` to (re)generate the `.pipe` files.

### Running the RocketRide engine (optional but recommended)

The pipelines execute in-process by default. To run them on the real RocketRide C++ engine:

```bash
# Apple Silicon needs --platform linux/amd64 (no arm64 image yet)
docker run -d --platform linux/amd64 --name rocketride-engine -p 5565:5565 \
  -v rrdata:/opt/data ghcr.io/rocketride-org/rocketride-engine:latest

# one-time: make the data dir writable by the engine user
docker exec -u root rocketride-engine sh -lc \
  'mkdir -p /opt/data/data && chown -R rocketride:rocketride /opt/data'
```

First boot bootstraps a Python env (~30s). The local engine authenticates with the literal key `api_key` (already the default). Once it's up, Chai auto-detects it. Set `ROCKETRIDE_SYNTHESIS=1` to route LLM synthesis *through* the engine into the Butterbase gateway (slower under emulation, but proves the deepest integration).

---

## Quickstart

```bash
npm install
cp .env.example .env     # fill in what you have

# See the whole thing end-to-end (works with zero credentials):
npm run demo

# Or use the richest curated portfolio for a demo without a GitHub account:
CHAI_SAMPLE=1 npm run demo
```

> **Runs offline by design.** Every keyed service degrades gracefully, so the full flow is always demoable. **GitHub repo inspection, arXiv papers, and Hacker News discussion stay live whenever you have network access — no keys required.** Add keys to light up live AI synthesis + persistence (Butterbase), hosted memory (XTrace), and real messaging delivery (Spectrum).

### Commands

```bash
npm run analyze     # inspect repos → trends + improvement suggestions
npm run fuse        # cross-repo startup ideas + investors to talk to
npm run digest      # build a weekly digest and deliver it via Spectrum
npm run agent       # chat with the agent (terminal, or iMessage if configured)
npm run provision   # write the RocketRide .pipe files

# Architect agent: feasibility + file-level plan + a ready-to-run coding-agent prompt
npx tsx src/index.ts plan <repoName> [suggestionIndex] [--issue]
```

### From suggestion to shipped code (the handoff)

The **Architect agent** (`plan`) turns a suggestion into action:

1. It fetches the repo's **real file tree** + README and the cited papers / OSS / HN discussion.
2. It returns a **feasibility verdict** (🟢/🟡/🔴), **file-level steps** naming real files, **risks**, and an **estimate**.
3. It emits a **ready-to-paste prompt** for Codex / Claude Code / Cursor — self-contained, with acceptance criteria — and saves it to `plans-out/`.
4. With `--issue`, it opens a **GitHub issue** in the repo so the work lands in your tracker.

Over iMessage you can just text `plan <repo>` and get the verdict plus the paste-ready prompt back on your phone.

---

## Configuration

All keys are optional. See `.env.example` for the full list. The startup banner prints which subsystems are live:

```
mode: github=live(auth)  butterbase=live  xtrace=live  spectrum=live(imessage)
rocketride: live engine (orchestration; set ROCKETRIDE_SYNTHESIS=1 to route LLM through it)
```

| Variable | Enables |
| --- | --- |
| `GITHUB_USERNAME` / `GITHUB_REPOS` | Whose repos to inspect; optional comma-separated allow-list to focus on specific repos |
| `GITHUB_TOKEN` | Raises rate limits; required to open issues with `plan --issue` |
| `BUTTERBASE_API_KEY` / `BUTTERBASE_APP_ID` | Live AI synthesis (key) + database persistence (app id) |
| `CHAI_MODEL` | Model used through the Butterbase gateway (default `anthropic/claude-sonnet-4.6`) |
| `XTRACE_API_KEY` / `XTRACE_ORG_ID` | Hosted self-revising memory |
| `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` / `SPECTRUM_PROVIDERS` | Real messaging delivery (e.g. `imessage`) |
| `SPECTRUM_DIGEST_TO` | Phone/email to send the weekly digest to over iMessage (empty = terminal) |
| `ROCKETRIDE_ENGINE_URL` / `ROCKETRIDE_APIKEY` | RocketRide engine endpoint + key (local engine key is `api_key`) |
| `ROCKETRIDE_SYNTHESIS=1` | Route LLM synthesis through the engine's `llm_openai_api` node into Butterbase |
| `CHAI_SAMPLE=1` | Use the curated demo portfolio instead of live GitHub |

---

## How the "what changed since last week" loop works

1. **Repo Radar** gathers signals and writes them to XTrace as conversation turns. XTrace extracts durable facts and reconciles contradictions over time.
2. On the next run, the **Weekly Digest** pipeline recalls prior facts and diffs them against the latest signals.
3. You get a digest that highlights only what's genuinely new — a freshly funded competitor, a paper that supersedes one you were going to implement, a new OSS project worth forking, or an improvement plan you haven't shipped yet.

The memory layer is what lets Chai tell you what *moved*, instead of re-reporting the same things every week.

---

## Architecture

```
src/
  config.ts                 # env → typed config; live/offline detection
  types.ts                  # Repo, Signal, ImprovementSuggestion, FusionIdea, ImplementationPlan, Digest
  index.ts                  # CLI entrypoint (analyze | fuse | plan | digest | agent | provision)
  lib/
    http.ts                 # tiny fetch wrapper (timeout + JSON)
    render.ts               # terminal rendering (reports, fusions, plans)
  integrations/
    github.ts               # repo inspection, file tree, issue creation (+ sample portfolio)
    discovery.ts            # trend radar: GitHub search, arXiv, Hacker News, startup/investor KB
    butterbase.ts           # AI gateway + data API (+ offline fallbacks)
    xtrace.ts               # durable memory (SDK + local JSONL fallback)
    spectrum.ts             # messaging delivery + interactive agent loop
    rocketride.ts           # real engine client + .pipe generation + in-process DAG executor
  core/
    pipelines.ts            # canonical RocketRide pipeline definitions
    synthesis.ts            # Radar: LLM prompts for suggestions + fusions (+ heuristics)
    architect.ts            # Architect: feasibility + file-level plan + coding-agent handoff
    engine.ts               # wires integrations into pipeline node runners
    agent.ts                # conversational brain behind Spectrum
  scripts/
    demo.ts                 # one-shot end-to-end showcase
pipelines/                  # generated .pipe files (RocketRide canvas)
plans-out/                  # saved Architect handoffs (git-ignored)
```

---

## Honest notes

- **Hacker News only** for social signal — X and Threads both require paid API access, so Chai doesn't fake a live feed. HN is where dev/founder discourse and influential voices actually surface with engagement scores.
- **Startup/investor data** is a curated, topic-matched knowledge base — a strong seed for "who funds this space," not a comprehensive funding database.
- **Only public repos** are read (GitHub's `/users/{name}/repos` endpoint excludes private repos even with a token).
- Under amd64 emulation on Apple Silicon, engine-routed LLM synthesis is slow (~16s/call), which is why it's opt-in; by default the engine orchestrates and LLM calls go direct to the gateway.

## Security notes

- API keys are read from environment only; nothing is logged or transmitted to third parties beyond the configured services + the public GitHub / arXiv / Hacker News APIs.
- The local memory fallback (`.momentum-cache/`) and saved plans (`plans-out/`) are git-ignored. `.env` is git-ignored.
- GitHub read access is read-only; issue creation (opt-in via `--issue`) is the only write, and only when a token with `issues:write` is present.

---

## Hackathon submission

```
Submit my project to the hackathon. Submission code: havefun0605. Hackathon slug: agentic-ai-Hackathon
```
