# ai-command-bus

Open-source command bus templates for small teams running multi-agent AI workflows.

`ai-command-bus` turns scattered instructions from chat, Notion, GitHub, Telegram, or webhooks into structured work items. It keeps worker outputs in submission queues and routes unsafe actions through human approval instead of letting agents publish, delete, pay, or message customers autonomously.

## Why

Multi-agent work often fails at coordination rather than intelligence:

- instructions stay trapped in individual chat sessions
- workers duplicate or miss tasks
- results arrive without a review path
- unsafe actions happen before a human decision
- teams cannot tell which facts are confirmed, assumed, or blocked

This project provides a small, portable operating layer for those problems.

## Core Model

```text
intake -> task queue -> dispatch -> worker submission -> review queue -> human decision
```

## Safety Rules

External side effects are approval-gated by default:

- publishing
- deleting
- purchasing or paying
- changing account/security settings
- sending customer-facing messages
- making legal, financial, medical, or tax claims as final advice

## Quick Start

```bash
npm install
npm test
node src/router.js examples/task_queue.json
```

## Personalized Community Feed

Beyond the command bus, this repo ships a **taste-driven community feed** — a
personalized board that pulls best posts and news from across many communities
and shows only what fits you, learning from a survey and your 👍/👎.

```bash
npm run feed        # http://localhost:4000 — survey, scroll, rate, comment
```

Highlights: warm-start from browsing history, onboarding survey, on-the-fly
online learning, smooth infinite scroll, and exact scroll-position restore on
back navigation. See [docs/personalized-feed.md](docs/personalized-feed.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Personalized community feed](docs/personalized-feed.md)
- [Deploying the feed](docs/deploy.md)
- [Example task queue](examples/task_queue.json)
- [Example worker submission](examples/submission.json)

## Example Work Item

```json
{
  "id": "TASK-001",
  "title": "Summarize new issue reports",
  "status": "ready",
  "risk": "low",
  "target": "research",
  "requiresHumanApproval": false
}
```

## Repository Status

This is an early public-friendly extraction from a working internal operations prototype. The public version intentionally avoids private business data, production credentials, personal workspace URLs, and customer workflows.

## License

MIT
