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

**실제 식당을 위치 기반으로 검색**(카카오 로컬 API)하고 네이버지도로 연결하며, 그
위에 **찐맛집 판별(검증) 레이어**를 얹는 서비스입니다. 가짜·더미 데이터는 쓰지
않습니다 — 데이터 소스가 없으면 결과 대신 설정 안내를 표시합니다.

```bash
KAKAO_REST_KEY=발급받은키 npm run eats   # http://localhost:4173
```

- **1단계(구현됨)**: 실제 식당·위치검색·네이버 링크.
- **2단계(엔진 완성, 데이터 대기)**: 광고/담합/어뷰징을 걸러내는 판별 엔진은
  구현·테스트 완료됐으나, 실제 리뷰 데이터 파이프라인 연결 후 활성화됩니다.

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
