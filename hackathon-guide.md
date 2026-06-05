# Agentic AI SF Hackathon Guide

## Official Problem Statement

**Theme:** Building Production-Ready Agentic AI Applications with RocketRide, Butterbase, XTrace, and Photon

The next wave of AI is not just intelligent. It is operational. Agents should be able to reason, remember, persist data, reach users where they already are, and be trusted in production.

This hackathon challenges you to combine four complementary technologies to build agentic applications that can actually ship:

- Powerful pipelines
- Instant backends
- Observability and memory
- Messaging infrastructure for the interfaces people already use

## Core Challenge

Design and build an innovative agentic application that uses all four technologies:

| Technology | Required Role |
| --- | --- |
| RocketRide | Construct and orchestrate AI pipelines and multi-agent workflows directly inside your development environment. |
| Butterbase | Build the entire backend, including database, auth, storage, and AI model gateway, with zero DevOps. |
| XTrace | Provide a persistent, self-revising memory layer that extracts facts and reconciles contradictions over time. |
| Photon (Spectrum) | Deploy your agent to messaging platforms such as iMessage, WhatsApp, Slack, or similar platforms so users do not need to visit a separate website. |

## Mandatory Requirements

- **RocketRide Usage:** Use RocketRide for core data and AI pipelines or workflows. Pipelines must be meaningfully connected to product logic.
- **Butterbase Integration:** Provision and serve the backend with Butterbase, integrating database, auth, and the AI Model Gateway.
- **XTrace Integration:** Use the Memory API so agents can actively write to and read from persistent history.
- **Photon Integration:** Deliver the agent through at least one real messaging platform, such as iMessage, WhatsApp, or Slack.
- **Deep Integration:** All four technologies must be woven into the core product experience. Shallow or disconnected usage may result in disqualification.

## Technology Primers

### RocketRide

**AI Pipeline Infrastructure in Your IDE**

RocketRide is an open-source AI pipeline builder with a high-performance C++ core. It lets teams build visually in VS Code and ship to production. It supports 13 LLM providers and multi-agent orchestration.

### Butterbase

**Backend for AI Builders**

Butterbase is an AI-optimized Backend-as-a-Service. It automates database, auth, APIs, and file storage. It also includes an AI model gateway for unified access to GPT, Claude, and Gemini.

### XTrace

**One Brain Across Every Tool**

XTrace is a hosted memory platform that extracts durable facts from conversations and tracks artifacts. It automatically revises old beliefs when new information contradicts them.

### Photon (Spectrum)

**Bring Your Agents to Users**

Photon, also known as Spectrum, is an open-source framework that connects agents to iMessage, WhatsApp, Telegram, and more through a single API. It adapts message structures natively per platform with edge delivery.

## Suggested Problem Tracks

| Track | Problem | Solution Summary |
| --- | --- | --- |
| 1. Agentic Onboarding Assistant | New hires lose context across scattered docs and Slack. | RocketRide: ingestion pipeline. Butterbase: user profiles and progress. XTrace: company knowledge brain. Photon: daily check-ins via Slack or iMessage. |
| 2. Autonomous Code Review Agent | PR reviews are slow, and architectural context is lost. | RocketRide: static analysis pipeline. Butterbase: review history. XTrace: architectural memory. Photon: approval requests via Slack or Discord threads. |
| 3. Customer Support Co-Pilot | Reps hunt for answers across internal docs. | RocketRide: ticket routing pipeline. Butterbase: ticket records. XTrace: known workarounds. Photon: customer support over WhatsApp or iMessage. |
| 4. AI Research Synthesizer | Teams repeat research, and insights never resurface. | RocketRide: synthesis pipeline. Butterbase: research artifacts. XTrace: living research brain. Photon: topic digests via Telegram or Slack. |
| 5. Sales Intelligence Agent | Sales reps lack account context before meetings. | RocketRide: briefing aggregation. Butterbase: synced account data. XTrace: relationship memory. Photon: pre-meeting briefs via WhatsApp. |
| 6. AI Operations Monitor | Teams cannot diagnose production agent behavior. | RocketRide: anomaly detection. Butterbase: incident history. XTrace: incident pattern matching. Photon: alerts and interactive remediation via Slack. |
| 7. Adaptive Learning Tutor | Students need personalized, persistent support. | RocketRide: adaptive questioning. Butterbase: progress history. XTrace: knowledge gap memory. Photon: practice nudges via iMessage. |
| 8. Startup Due Diligence Agent | Manual research and data rooms are slow. | RocketRide: document ingestion. Butterbase: secure data room. XTrace: deal brain. Photon: instant summaries over Telegram between meetings. |
| 9. Async Team Intelligence Bot | Remote teams lose context in long threads. | RocketRide: blocker extraction. Butterbase: standup records. XTrace: decision memory. Photon: standup submissions via WhatsApp. |
| 10. Open Innovation Track | Developers cannot keep up with research and repositories. | RocketRide: research crawler. Butterbase: subscription storage. XTrace: evolving knowledge brain. Photon: curated updates via Discord. |

## Submission and Deliverables

### Setup

Connect to Butterbase before starting.

- Sign up: <https://dashboard.butterbase.ai>
- Promo code: `HAVEFUN0605`
- Redeem the promo code in billing.

### Final Submission

Paste the following into your AI agent:

```text
Submit my project to the hackathon. Submission code: havefun0605. Hackathon slug: agentic-ai-Hackathon
```

### Workshop

Join the 10:15am workshop via Zoom.

### Deliverables

- **Working Prototype:** Live or local demo.
- **Source Code:** Repository link.
- **Project Description:** Explain the problem, technology usage, and integration across RocketRide, Butterbase, XTrace, and Photon.
- **Pitch Deck or Video:** Optional.

