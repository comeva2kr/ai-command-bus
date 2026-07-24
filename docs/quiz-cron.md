# 주간 유형테스트 파이프라인 — 주간 예약 실행

이 문서는 **실데이터 수집 → 퀴즈 생성 → 루프게이트 통과 → 승인 대기열
등록**까지, Claude Code 예약 세션이 무인으로 수행하는 주간 실행의 구조와
절차를 다룬다. 게이트 설계 자체(QG0~QG6)는 [quiz-loopgate.md](quiz-loopgate.md)가
정본이고, 이 문서는 "누가 어떻게 돌리는가"만 다룬다.

> **생성 주체가 바뀌었다.** 예전에는 launchd cron이 macOS Keychain에서
> `ANTHROPIC_API_KEY`를 읽어 `src/quiz/generate.js`가 API를 직접 호출했다.
> **지금은 Claude Code 예약 세션이 자신의 모델로 퀴즈 JSON을 직접 생성해
> 파이프라인에 "제출"한다.** API 키/launchd/Keychain 킷은 철거했다 — 과금은
> 세션의 구독으로 처리되고, 이 저장소 어디에도 API 키가 필요 없다. (키를
> 쓰는 수동/테스트 경로는 `weekly.js run`으로 옵션 존치 — 아래 [부록](#부록-api-키수동-run-경로) 참고.)

## 구조

- **생성기 = Claude Code 예약 세션.** 세션이 `weekly.js prompt`로 생성
  프롬프트(토픽 + 설계 규칙, `buildPrompt()`가 단일 원본)를 받아 자기 모델로
  퀴즈 JSON을 만들고, `weekly.js submit`으로 게이트 루프에 제출한다.
- **게이트 루프는 그대로다.** `submit`은 `run`이 쓰던 것과 **동일한 계약**
  (`runGates` → PASS면 `saveDraft` + `routeTask('publish quiz')`
  → `decision_queue`, 아니면 반려)을 CLI 왕복 형태로 노출할 뿐이다 —
  `src/quiz/gates.js`·`manifest.js`·`topics.js`·`generate.js`의 게이트 로직은
  단 한 줄도 바뀌지 않았다.
- **재시도는 세션이 프로세스 밖에서 돈다.** `run`이 in-process 루프
  (생성 → 게이트 → 실패 시 프롬프트에 사유 주입 → 재생성)를 돌리던 것을,
  예약 세션은 `submit`이 exit 2로 반려하면 저장된 reasons 파일을
  `prompt --feedback`으로 되먹여 자기 턴에서 재생성한다. 예산은 동일하게
  매니페스트 `pack_contract.retry_budget`(현재 3)이 정본이다.
- **과금/키**: 세션은 David의 Claude 구독으로 실행된다 — 이 저장소는
  `ANTHROPIC_API_KEY`도, launchd/Keychain 설정도 요구하지 않는다.

## 예약 세션이 따를 절차 (사람이 읽는 계약서)

예약 세션은 매주 아래 순서를 그대로 따른다. 각 단계의 실패 처리까지 계약의
일부다 — 임의로 순서를 바꾸거나 단계를 생략하지 않는다.

1. **`git pull`** — 이 저장소의 영구 클론 경로에서 최신 상태로 갱신한다.
2. **덤프**: `node scripts/quiz-dump-hot-items.js` — 실데이터 소스에서
   핫아이템을 수집해 `data/quiz/hot_items-<weekLabel>.json`에 저장한다.
   수집 0건이면 이 스크립트가 exit 1로 실패한다 — 세션은 여기서 멈추고
   실패로 보고한다(다음 단계로 진행하지 않는다).
3. **프롬프트 받기**: `node src/quiz/weekly.js prompt <dump.json>` — stdout에
   찍히는 프롬프트를 그대로 자신의 생성 입력으로 쓴다. stderr에는 이번 주
   통과 토픽 요약이 참고용으로 나온다.
4. **세션이 퀴즈 JSON을 생성**한다 — 프롬프트의 설계 규칙(축 2~4개 톱다운
   설계, 문항 8~15개, 유형 = 극 조합 전체, 80:20 서술 등)을 그대로 따르고,
   퀴즈 스키마(`QUIZ_SCHEMA`, `src/quiz/generate.js`)와 일치하는 JSON 파일로
   저장한다.
5. **제출**: `node src/quiz/weekly.js submit <quiz.json> <dump.json>`
   - **exit 0** — 루프게이트(QG1~QG4) 통과. 초안이 `data/quiz/drafts/`에
     저장되고 발행 작업이 `decision_queue`로 라우팅됐다는 뜻. 세션은
     `osascript`로 "주간 퀴즈 초안 — 승인 대기: <제목> (<slug>)" 알림을
     띄우고 종료한다.
   - **exit 2** — 게이트 반려. stderr에 `[QG…] 사유`가 한 줄씩 찍히고,
     동일한 사유가 `data/quiz/last_reject_reasons.json`(기본 경로,
     `--reasons-out`로 변경 가능)에 JSON 배열로 저장된다. 세션은 그 파일을
     `--feedback`으로 4번 단계(프롬프트 재수신)에 되먹여 재생성한다.
6. **재시도 예산**: 4~5단계를 **최대 3회**(매니페스트
   `pack_contract.retry_budget`)까지 반복한다. 3회 모두 반려되면 **fail-loud
   실패로 종료** — 조용히 템플릿으로 대체 발행하지 않는다. `osascript`로
   "주간 퀴즈 생성 실패 — 예산 소진, 사람이 토픽 교체 판단" 알림을 띄운다.

의사코드로 요약하면:

```
git pull
dump = quiz-dump-hot-items.js
prompt = weekly.js prompt dump
for attempt in 1..3:
  quiz = <세션이 prompt(+feedback)로 생성>
  result = weekly.js submit quiz dump --attempt attempt
  if result.exit == 0: notify(성공, slug); break
  if result.exit == 2:
    feedback = read(reasons_file)
    prompt = weekly.js prompt dump --feedback reasons_file
    continue
else:
  notify(실패, "예산 소진")
```

## 경계 (반드시 지킬 것)

- **`approve`는 세션이 절대 호출하지 않는다.** QG5는 매니페스트에
  `no_go: external_publish`로 고정돼 있다. 초안이 쌓이면 David가 직접
  검토 후 `node src/quiz/weekly.js approve <slug>`를 실행해야 `/q/<slug>`로
  공개된다.
- **`git push`도 세션이 하지 않는다.** 예약 세션의 산출물(덤프 파일, 초안,
  reasons 파일)은 로컬 데이터 디렉토리(`data/quiz/`)에만 쓰인다 — 저장소
  코드를 커밋/푸시하는 동작은 이 계약에 없다.
- **우회 인자 없음.** `submit`에 게이트를 건너뛰는 옵션은 없다 — 반려는
  항상 exit 2 + reasons 파일로만 처리된다.
- **예산 소진은 성공으로 위장하지 않는다.** 템플릿 폴백으로 대체 발행하지
  않고 실패로 끝낸다(`pack_contract.generation.scheduled_policy_ko`).

## 수동 실행법

launchd 스케줄이 없으므로, 지금 당장 한 번 돌려보고 싶으면 위 절차를
터미널에서 그대로 따라 하면 된다:

```sh
cd "${REPO_DIR}"                                   # 이 저장소의 클론 경로
node scripts/quiz-dump-hot-items.js                # 1) 실데이터 덤프
node src/quiz/weekly.js prompt data/quiz/hot_items-<주label>.json   # 2) 프롬프트 확인
# 3) 프롬프트를 사람이 직접 모델에 넣어 퀴즈 JSON을 만들고 파일로 저장 (quiz.json)
node src/quiz/weekly.js submit quiz.json data/quiz/hot_items-<주label>.json  # 4) 제출
```

반려되면(exit 2) 안내된 대로 재생성:

```sh
node src/quiz/weekly.js prompt data/quiz/hot_items-<주label>.json \
  --feedback data/quiz/last_reject_reasons.json
```

승인 대기 목록 확인:

```sh
cd "${REPO_DIR}" && node src/quiz/weekly.js queue
```

승인(사람만 실행):

```sh
cd "${REPO_DIR}" && node src/quiz/weekly.js approve <slug>
```

## 부록: API 키/수동 `run` 경로

`node src/quiz/weekly.js run <hot_items.json>`은 예전 in-process 경로를
그대로 보존한다 — `ANTHROPIC_API_KEY` 환경변수가 있으면 API를 직접 호출해
생성하고, 없으면 결정적 템플릿 퀴즈로 폴백해 루프게이트를 자체적으로
통과시킨 뒤 초안을 저장한다. 이 경로는 **수동 실행·테스트 전용**이며,
정본 주간 실행 경로가 아니다. 키를 넣고 싶다면 터미널 세션 환경변수로만
export하고(셸 히스토리에 평문으로 남지 않도록 인자로 넘기지 말 것),
launchd/Keychain 같은 상시 저장 킷은 두지 않는다.
