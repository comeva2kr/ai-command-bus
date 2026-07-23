# 주간 바이럴 유형테스트 파이프라인

매주 커뮤니티 핫토픽으로 AI가 유형테스트(심리테스트류)를 만들어, 사람 승인을
거쳐 공유 최적화된 페이지로 발행하는 파이프라인. 트래픽 → 광고 수익 모델을
겨냥한 기능으로, 기존 피드의 수집기와 명령 버스의 승인 게이트를 재사용한다.

## 흐름

```text
핫토픽 수집(피드 수집기/JSON) → 브랜드 세이프 필터 + hotness 랭킹
  → AI 퀴즈 생성 (Claude API, 키 없으면 템플릿 폴백)
  → drafts/ 초안 저장 + publish 작업을 decision_queue로 라우팅
  → 사람 승인 (approve) → published/ 발행
  → /q/<slug> 퀴즈 페이지 → /q/<slug>/r/<유형> 결과 공유 페이지 (바이럴 루프)
```

## 사용법

```bash
# 1) 초안 생성 — 핫아이템 JSON을 넣으면 토픽 선별 → 퀴즈 초안 → 승인 대기열
node src/quiz/weekly.js run examples/hot_items.json

# 2) 승인 대기 확인
node src/quiz/weekly.js queue

# 3) 사람이 초안을 검토한 뒤 발행 승인
node src/quiz/weekly.js approve <slug>

# 4) 서빙 — 피드 서버가 /q 라우트로 발행분만 서빙
npm run feed   # http://localhost:4000/q
```

`ANTHROPIC_API_KEY`가 설정돼 있으면 Claude(`claude-opus-4-8`, structured
outputs)로 생성하고, 없으면 결정적 템플릿으로 폴백해 오프라인에서도 전체
파이프라인이 돈다. 모델은 `QUIZ_MODEL`, 저장 위치는 `QUIZ_DIR`(기본
`data/quiz`)로 바꿀 수 있다.

주간 자동화는 cron 한 줄이면 된다:

```cron
0 9 * * 1  cd /path/to/ai-command-bus && node src/quiz/weekly.js run data/hot_items.json
```

핫아이템 JSON은 피드가 쓰는 normalized item 형태
(`{title, url, source, score, commentCount, publishedAt}`)를 그대로 받는다 —
`FEED_LIVE=1` 수집 결과를 덤프해서 물리면 된다.

## 안전 규칙과의 접점

- **발행은 승인 게이트 필수.** `runWeekly()`는 초안만 만들고, `publish quiz:`
  작업을 `routeTask()`에 태워 `decision_queue`로 보낸다 (제목의 "publish"가
  승인 규칙에 걸리고, `requiresHumanApproval`도 명시). 서버는 `published/`만
  서빙하므로 승인 없이 대중에게 노출될 경로가 없다.
- **브랜드 세이프티.** 토픽 선별 단계에서 기존 분류기(`classifyTopics`)의
  politics/religion/adult 태그가 붙은 소재를 제외한다 — 광고 계정 정지
  리스크가 있는 소재로는 테스트를 만들지 않는다.
- **생성 거절 처리.** 모델이 소재를 거절하면(`stop_reason: "refusal"`) 그대로
  에러로 올려 사람이 토픽을 바꾸게 한다.

## 바이럴/수익화 설계

- **결과 페이지가 공유 단위.** `/q/<slug>/r/<유형>`마다 고유 OG 타이틀
  ("나는 ○○!")이 달려 카톡/SNS 미리보기에서 결과가 보이고, CTA("나도 테스트
  해보기")가 새 방문자를 퀴즈 입구로 되돌린다.
- **한 문항당 한 화면** 구조로 체류 중 광고 노출 기회를 늘렸다. 광고 위치는
  `.ad-slot` 플레이스홀더로 표시돼 있어 배포 시 애드센스 등 스니펫으로
  교체하면 된다.
- 결과 계산은 서버(`src/quiz/engine.js`)와 클라이언트가 같은 결정적 규칙
  (동점이면 앞 순서 유형)을 쓴다.

## 파일 맵

| 파일 | 역할 |
|---|---|
| `src/quiz/topics.js` | 핫아이템 → 브랜드 세이프 토픽 선별 (hotness 랭킹) |
| `src/quiz/generate.js` | Claude 생성 + 템플릿 폴백 + 스키마/검증 |
| `src/quiz/engine.js` | 결정적 결과 계산 |
| `src/quiz/store.js` | drafts/published 저장, 승인 게이트 |
| `src/quiz/render.js` | 퀴즈/결과/인덱스 HTML (OG, 공유, 광고 슬롯) |
| `src/quiz/weekly.js` | 주간 파이프라인 CLI (run/queue/approve) |
| `src/feed/server.js` | `/q`, `/q/<slug>`, `/q/<slug>/r/<id>`, `/api/quiz` 라우트 |
