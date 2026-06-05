# Verified integration facts (do not guess — these are confirmed by live tests)

## Butterbase (LIVE, tested)
- Gateway base: `https://api.butterbase.ai/v1` ; auth `Bearer bb_sk_...`
- Personal key works in gateway mode (no app_id). OpenAI-compatible.
- Model id `anthropic/claude-3.5-sonnet` is GONE → use `anthropic/claude-sonnet-4.6`.
- `GET /v1/public/models` lists current ids (unauth).
- `response_format: json_object` not relied upon (Claude-backed). We prompt for JSON + parse defensively.

## XTrace (LIVE)
- SDK `@xtraceai/memory`, named export `MemoryClient`.
- `new MemoryClient({ apiKey: xtk_..., orgId })`
- `client.memories.ingest({ messages:[{role,content}], user_id, conv_id })` → job
- `client.memories.jobs.pollUntilDone(job.id)`
- `client.memories.search({ query, user_id, limit })` → `{ data: [{text, score}] }`

## Spectrum / Photon (creds present, tested API shape)
- SDK `spectrum-ts`. `import { Spectrum } from "spectrum-ts"`.
- Providers: `spectrum-ts/providers/imessage` (also slack, terminal, whatsappBusiness).
- `const app = await Spectrum({ projectId, projectSecret, providers:[imessage.config()] })`
- Inbound: `for await (const [space, message] of app.messages)` ; `message.content.type==='text'` → `message.content.text`
- Reply: `await space.send(text)` ; typing: `await app.responding(space, fn)` or `space.responding(fn)`
- Proactive send (NO app.broadcast): `const im = imessage(app); const u = await im.user("+1555..."); const dm = await im.space(u); await dm.send(text)`
  - cloud mode required for space() creation; imessage.config() defaults to cloud.
- `await app.stop()` to shut down.

## RocketRide (LIVE engine running in Docker, pipeline executed)
- npm package: `rocketride` (v1.2.0). `import { RocketRideClient, Question, Answer } from "rocketride"`.
- Engine image: `ghcr.io/rocketride-org/rocketride-engine:latest` (amd64 only → `--platform linux/amd64` on Apple Silicon).
- Run: `docker run -d --platform linux/amd64 --name rocketride-engine -p 5565:5565 -v rrdata:/opt/data <image>`
  - then `docker exec -u root rocketride-engine sh -lc 'mkdir -p /opt/data/data && chown -R rocketride:rocketride /opt/data'`
  - first boot bootstraps a python env (~30s). Wait for "Application startup complete".
- Connect: `new RocketRideClient({ uri: "ws://localhost:5565", auth: "api_key" })` then `await client.connect()`.
  - LOCAL AUTH KEY IS THE LITERAL STRING `"api_key"` (from engine constants.py).
  - The HTTP `/ping` 401 is just the docker healthcheck; real protocol is WebSocket DAP.
- Real `.pipe` schema (NOT nodes/lanes):
  ```json
  {
    "components": [
      { "id": "webhook_1", "provider": "webhook",
        "config": { "hideForm": true, "mode": "Source", "parameters": {}, "type": "webhook" } },
      { "id": "response_text_1", "provider": "response_text",
        "config": { "laneName": "text" },
        "input": [{ "lane": "text", "from": "webhook_1" }] }
    ],
    "project_id": "...",
    "source": "webhook_1",
    "version": 1
  }
  ```
- Run a pipeline:
  ```ts
  const { token } = await client.use({ pipeline });           // pass config directly, NOT { pipeline: {...} }
  const out = await client.send(token, "text", { name: "input.txt" }, "text/plain");
  await client.terminate(token);
  ```
  - `client.send()` for webhook/dropper sources; `client.chat({token, question})` for chat sources.
- LLM node provider in engine nodes dir: there are 85 node dirs incl. agents (crewai/langchain/rocketride), llm providers, etc. Webhook node classType=source.
- Confirmed output round-trip: send "Hello from Momentum" → response_text returns it.

## Verified end-to-end (this session)
- LLM synthesis through engine: chat SOURCE node `provider:"chat"` → `llm_openai_api`
  (lanes: input `questions`, output `answers`) → `response` (config laneName `answers`).
  Use `client.chat({token, question})` with `new Question(); q.addQuestion(prompt)`.
  Raw output arrives as `{ answers: [text], ... }`.
- `client.use({ pipeline })` — pass the pipeline config DIRECTLY (not `{pipeline:{...}}`).
  Reuse the returned token across calls (chat is multi-turn) to avoid ~18s setup each time.
- Butterbase synthesis MUST use enough max_tokens: rich JSON suggestions exceed 1200 tokens
  and get truncated → set 1600+ (default raised to 2400). safeParseJson now salvages truncation.
- Engine synthesis is gated behind ROCKETRIDE_SYNTHESIS=1 (slow under amd64 emulation:
  ~16-18s first call, ~2.4s reused). Default = direct gateway (fast) while engine still
  orchestrates the DAGs and reports as reachable.
- Spectrum: confirmed boot against project "chai" (slug chai); app.messages iterable live;
  app.stop() clean. Proactive send = imessage(app).user(phone/email) → im.space(user) → send.
  Set SPECTRUM_DIGEST_TO to a phone/email to actually send the digest over iMessage.

## Local commands
- Start engine (see above). Default model: anthropic/claude-sonnet-4.6.
- `npm run provision|analyze|fuse|digest|agent`  ·  `MOMENTUM_SAMPLE=1` for the curated portfolio.
- `ROCKETRIDE_SYNTHESIS=1 npm run analyze` to route LLM through the engine.

## Butterbase persistence (NOW LIVE — real database)
- App created via MCP `init_app`: name `chai-hackathon`, app_id `app_zq90bmv2slsj`.
- Tables applied via MCP `manage_schema` (action apply): `reports`, `fusions` (see scripts/schema.json).
- Data API path is `/v1/{app_id}/{table}` — NOT `/v1/{app_id}/data/{table}` (fixed in butterbase.ts).
  - POST to insert, GET (with ?order=, ?limit=, filters col=op.value) to read, DELETE /{id}.
  - Auth: Bearer bb_sk_... = service role (bypasses RLS). Returns bare JSON array on GET.
- With BUTTERBASE_APP_ID set, chat() uses app-scoped `/v1/{app_id}/chat/completions` (verified working).
- The Butterbase MCP server (api.butterbase.ai/mcp) is for SETUP via Claude Code / assistants
  (43 tools: init_app, manage_schema, insert_row, prep_and_submit_hackathon_entry, ...).
  Chai's RUNTIME uses the REST API directly. `claude mcp add butterbase ...` registers the MCP
  with Claude Code, not with Chai — different surface, same key.
- There is a `prep_and_submit_hackathon_entry` MCP tool = official submission path.
