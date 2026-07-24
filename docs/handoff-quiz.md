# 인수인계서 — 주간 바이럴 유형테스트 워크스트림

> 새(로컬) 세션은 이 문서를 먼저 읽고 이어서 작업한다.
> 브랜치: `claude/high-traffic-website-ideas-exgau1` (PR #7, draft, CI green).
> 이전 담당: 원격(Claude Code on the web) 세션 — 세션 간 어댑터가 없어
> WRC 워크플로우 게이트 세션과의 소통을 완결하지 못했다. **그게 이 문서를
> 넘기는 이유이자 새 세션의 1순위 임무다.**

## 목적 (한 줄)

매주 커뮤니티 핫토픽으로 AI가 유형테스트를 생성하되, 루프게이트로 "바이럴
조건 충족 + AI 티 제거"를 강제하고, 사람 승인을 거쳐 공유 최적화 페이지로
발행한다 — 트래픽 → 광고 수익 모델.

## 현재 상태 (2026-07-24)

- **PR #7** (draft): https://github.com/comeva2kr/ai-command-bus/pull/7 — CI(`test.yml`, node --test) 초록불, 리뷰 코멘트 없음. 커밋 3개:
  1. `1ad25a5` 파이프라인 최초 구축 (수집→생성→승인→발행→공유)
  2. `0f49285` 딥리서치 기반 축-스펙트럼 설계로 재구축 (리서치 요약: `docs/quiz-design.md`)
  3. `2563791` 루프게이트 G1~G4 + 재생성 피드백 루프 (`docs/quiz-loopgate.md`, `src/quiz/gates.js`)
- **테스트 137개 전부 통과** (`npm test`). 퀴즈 단독은 `node --test test/quiz.test.js` (27개).
- **main과의 병합**: main이 앞서갔지만(`2e78270`까지 — 피드 랭킹/번역/UI 대개편) `git merge-tree --write-tree origin/main HEAD` 기준 **충돌 없음**. 단, main의 `src/feed/server.js` 대규모 리팩터와 이 브랜치의 퀴즈 라우트 추가가 같은 파일이라 병합 후 `/q` 라우트 동작을 테스트로 재확인할 것.
- 데모: `npm run quiz:weekly` → `node src/quiz/weekly.js approve <slug>` → `npm run feed` → http://localhost:4000/q

## 1순위 임무: WRC 워크플로우 게이트 세션과 소통 완결

David 지시: 루프게이트 플로우차트 팩을 WRC 세션의 표준 형식에 맞춰야 함.
원격 세션에서 불가능했던 이유와 룰:

- 세션 통신 룰(main `docs/handoff.md`, 커밋 `2e78270`): 비활성인 것은
  `create_trigger(persistent_session_id)`뿐. **검증된 세션 관리 어댑터
  (`list_sessions` → `send_message`)가 있으면 사용하고 receipt/ACK를
  확인**한다. 어댑터가 없거나 UI 승인이 필요하면 전송 공백을 보고하고 승인을
  요청한다. 문서·PR 코멘트는 보조 증거일 뿐 ACK를 대신하지 않는다.
- 원격 세션 시도 결과: `list_sessions`/`send_message` 어댑터 부재,
  `list_triggers`는 UI 승인 벽 2회. PR #7에 문의 코멘트만 남긴 상태
  (**ACK 미수신 — 소통 미완**).

**로컬 세션이 할 일:**
1. 로컬 도구함에서 세션 관리 어댑터(`list_sessions` → `send_message`)로 WRC
   워크플로우 게이트 세션을 찾아 아래 문의 3건을 1회 전달하고 ACK를 받는다.
2. 문의 내용:
   - 루프게이트 팩 표준 형식(스키마/파일 구조/네이밍)이 따로 있는가?
     현재는 자기서술형(mermaid + 조건표 + 코드 매핑, `docs/quiz-loopgate.md`).
   - 게이트 ID 체계(G0~G6)·재시도 예산(3회)이 WRC 컨벤션과 충돌하는가?
   - 하네스가 게이트를 직접 구동할 진입점: `runGates(quiz)`
     (`src/quiz/gates.js`), `runWeekly(items, opts)` (`src/quiz/weekly.js`).
3. 회신을 받으면 팩을 그 형식으로 변환하고 PR #7에 반영. PR #7의 문의
   코멘트(2026-07-23)에 결과를 기록해 보조 증거를 닫는다.

## 아키텍처 요약

```text
핫아이템(피드 수집기/JSON) → G0 토픽 게이트(정치·종교·성인 제외, hotness 랭킹)
  → AI 생성 (claude-opus-4-8, structured outputs / 키 없으면 템플릿 폴백)
  → 루프게이트 G1 구조 · G2 바이럴 · G3 AI-티 · G4 채점 무결성
     └ 실패 시 [게이트ID] 사유를 프롬프트에 주입해 재생성 (최대 3회, 이력 저장)
  → drafts/ 초안 + publish 작업 → decision_queue (G5 사람 승인, routeTask)
  → approve → published/ → /q/<slug> (문항당 한 화면, 광고 슬롯)
  → /q/<slug>/r/<코드> 결과 페이지 (축 퍼센트 바 · 응답자 중 N% · 강점80:약점20
     · 케미 · 유형색 결과 카드 · 면책 라벨) → 공유 → 재유입 (G6 루프)
```

퀴즈 포맷은 **축 기반 스펙트럼**(2~4축 × 극 코드 → 2^축수 유형, argmax 금지).
설계 근거와 케이스 레퍼런스는 `docs/quiz-design.md`, 리서치 원 출처 URL은
PR #7 코멘트(2026-07-23 "리서치 기록")에 있다.

## 파일맵

| 파일 | 역할 |
|---|---|
| `src/quiz/topics.js` | G0: 핫아이템 → 브랜드 세이프 토픽 선별 |
| `src/quiz/generate.js` | 스키마·프롬프트(피드백 주입 지원)·Claude 호출·템플릿 폴백·validateQuiz(G1) |
| `src/quiz/gates.js` | G1~G4 정의 + `runGates` — **게이트 단일 원본** |
| `src/quiz/engine.js` | 축 스펙트럼 채점 (50:50은 left, 결정적) |
| `src/quiz/store.js` | drafts/published 저장, 승인 게이트, 응답 통계(라플라스 스무딩) |
| `src/quiz/render.js` | 퀴즈/결과/인덱스 HTML — 신뢰 장치 전부 여기서 렌더 |
| `src/quiz/weekly.js` | CLI(run/queue/approve) + 루프게이트 루프 |
| `src/feed/server.js` | `/q*` 라우트, `POST /api/quiz/:slug/response` |
| `test/quiz.test.js` | 27개 테스트 (게이트 반려/피드백 루프/재시도 소진 포함) |

## 다음 작업 후보 (WRC 소통 완결 후, 순서 제안)

1. **main 병합** — 충돌 없음 확인됨. 병합 후 전체 테스트 + `/q` 라우트 수동 확인.
2. **유형별 OG 결과 카드 이미지 동적 생성** — 리서치상 공유율에 가장 효과 큼
   (케이테스트 퍼스널컬러의 승부처). 현재는 공용 `icon.svg`.
3. 일관성 배지(유사 문항 2회 → "응답 일관성 높음"), 프레임 네이밍(주차별
   고유 모델명), Wrapped형("내 피드 취향 리포트") — `docs/quiz-design.md`
   "향후 확장" 참고.
4. 실데이터 연결: `FEED_LIVE=1` 수집 결과를 `weekly.js run`에 물리는 덤프
   스크립트 + cron (주 1회, 월요일 오전 제안).

## 주의사항 (기존 세션 규칙 승계)

- 커밋 메시지·PR·코드에 모델 ID(claude-fable-* 등) 넣지 말 것 (main handoff.md 규칙).
- 발행은 반드시 G5 사람 승인 경유 — 어떤 자동화도 `approve`를 대신 호출하지 않는다.
- 광고 세이프티: 정치·종교·성인 소재 금지는 G0에서 강제, 프롬프트에도 명시됨.
- PR #7은 이 원격 세션이 구독 중 — CI 실패/리뷰 코멘트는 원격 세션도 반응할
  수 있으니, 로컬 세션이 푸시하면 중복 대응하지 않도록 PR 코멘트로 선점 선언 권장.
