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

## Documentation

- [Architecture](docs/architecture.md)
- [맛집 통합 커뮤니티 (Restaurant Discovery Platform)](docs/restaurant-platform.md)
- [Example task queue](examples/task_queue.json)
- [Example worker submission](examples/submission.json)

## 맛집 통합 커뮤니티

여러 소스(SNS·유튜브·네이버·커뮤니티)에서 맛집을 모아 **광고/협찬을 자동 제외**하고
교차검증된 곳만 남긴 뒤, **위치(반경·차로 N분·"OO 근처") + 생활밀착 다중조건(장소
스타일·음식·메뉴·아이 동반·프랜차이즈 제외·파티션·가격대…)**으로 필터링하는 검색
엔진과 웹 UI가 포함되어 있습니다.

```bash
npm run eats   # http://localhost:4173
```

자세한 내용은 [docs/restaurant-platform.md](docs/restaurant-platform.md).

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
