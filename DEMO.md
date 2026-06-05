# Chai — Demo Runsheet (≈3 min)

Goal: show (1) it works on your **phone**, (2) the **four tools** are really wired in.

---

## Before you go on stage (do this ~5 min early)

1. **Start the RocketRide engine** (so the status line shows it live):
   ```bash
   docker start rocketride-engine   # already created earlier; just restart it
   ```
2. **Pre-start the agent** so the startup analysis finishes off-stage:
   ```bash
   npm run agent
   ```
   Wait until you see: `Spectrum live on [imessage]. Waiting for inbound messages…`
   (Startup runs the live analysis once; after this, replies are instant.)
3. Open **Messages** on your phone, ready to text the Chai line (the number assigned
   to project `chai` in your Spectrum dashboard).
4. Have a terminal visible too — judges should see both the phone and the code/logs.

---

## The 3-minute script

### 0:00 — The problem (1 sentence)
> "Every hackathon project dies on Sunday night. Chai keeps it alive — it watches the
> world around your repos and helps you turn one into a startup, all over iMessage."

### 0:20 — Phone: it knows your repos
Text the Chai number:
```
list
```
→ It replies with your analyzed repos (Yoshi, agent-failure-mode-wiki).

### 0:40 — Phone: trends + what people are saying
```
agent-failure-mode-wiki
```
→ Replies with recent papers, related OSS, **Hacker News discussion**, funded
startups + investors, and improvement suggestions — all live.

### 1:10 — Phone: the killer move (handoff to a coding agent)
```
plan agent-failure-mode-wiki
```
→ Replies with a 🟢 feasibility verdict + a **paste-ready prompt** that already knows
your real file tree. Say:
> "I paste this straight into Codex — no re-explaining my repo. That's the bridge
> from idea to shipped code."

### 1:50 — Phone: the startup angle
```
fuse
```
→ Replies with a cross-repo startup idea (pitch + wedge + **investors to talk to**).

### 2:20 — Tool implementation (point at the terminal/logs)
Say this while showing the startup banner:
> `mode: github=live  butterbase=live  xtrace=live  spectrum=live(imessage)`
> `rocketride: live engine`

Then the 20-second version of how each is wired (next section).

### 2:50 — Close
> "Four tools, each load-bearing. Remove any one and Chai loses a capability.
> It's not a dashboard — it texts you, so your hackathon idea actually has a future."

---

## Tool implementation — say this (the important part)

- **RocketRide** — "My product logic *is* RocketRide pipelines. They run on the real
  C++ engine in Docker. The synthesis node is an `llm_openai_api` node pointed at the
  Butterbase gateway — so two of the tools are wired together inside one pipeline node."

- **Butterbase** — "It's the backend, two ways: the OpenAI-compatible **AI gateway**
  (Claude Sonnet 4.6) generates every suggestion and plan, and the **database** (a real
  provisioned app) persists `reports`, `fusions`, and `plans` across runs."

- **XTrace** — "After each run I write durable facts to XTrace. Next run, I recall and
  diff them — that's how the digest knows *what changed since last week* instead of
  repeating itself."

- **Spectrum (Photon)** — "Everything you just saw on my phone is Spectrum. The agent
  runs once and reaches me on iMessage — `list`, `plan`, `fuse` all work as texts. No
  app to download."

---

## Fallback if Wi-Fi / iMessage is flaky

Run the same flow in the terminal (no phone dependency):
```bash
npm run analyze                              # full report for both repos
npx tsx src/index.ts plan agent-failure-mode-wiki   # the handoff prompt
npm run fuse                                 # startup idea
SPECTRUM_PROVIDERS=terminal npm run agent    # chat in the terminal
```

## If a judge asks "is this real or canned?"
- Text something off-script: `plan Yoshi` or ask `which repo has more momentum?`
- Show `pipelines/repo-radar.pipe` (real RocketRide graph) and the Butterbase row:
  ```bash
  curl -s "https://api.butterbase.ai/v1/$BUTTERBASE_APP_ID/plans?order=generated_at.desc&limit=3" \
    -H "Authorization: Bearer $BUTTERBASE_API_KEY"
  ```
