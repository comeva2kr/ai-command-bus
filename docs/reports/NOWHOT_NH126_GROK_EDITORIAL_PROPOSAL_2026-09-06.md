# NOWHOT NH126 자체 기사 운영 방식 독립 검토 (Grok)

- 작업자: Cursor Grok 4.6 (Orca 워커 `task_558f30fbac2f` / dispatch `ctx_9623d5f81ba0`).
- 범위: 의견 검토만. 코드·제품데이터·설정·운영·일정·스케줄 변경 0. 광역 테스트 없음.
- David 입력 분류: **의견·아이디어 + 질문**. “그록봇이 새소식을 수집하고 최신정보 기반 클로드가 기사를 써 지금핫에 기자들이 올리는 듯한 구성”은 실행 지시가 아니다. 현재 구현 승인은 콘텐츠품질 수리와 Safari 검증뿐이며 이 새 구조는 승인되지 않았다.
- 로컬 HEAD: 이 세션 시작 시 `codex/adfit-content-rescue-20260810`가 `origin/main`보다 30커밋 앞섬. 미추적 `.serena/`·`.superpowers/`만. 운영 바이트·활성 포인터는 열지 않음.

First Principles 게이트: PASS.

---

## 한 줄 결론

**HOLD — 새 수집기+기자형 집필 구조를 지금 만들지 말 것.** 지금핫 Today는 이미 RSS/공개 피드 수집 → 분류 → 사건 묶음 → 결정론 편집 → 슬롯 정본 동결 → 요청은 포인터 필터만 하는 경로이고, 현재 상세는 공개 원문 발췌·번역이지 Claude 기사 작성이 아니다. 기자처럼 보이게 하려면 그록봇 순찰이 아니라 이미 고른 핵심 사건에 기존 요약·검증 파이프라인을 소량으로 켜는 쪽이 최소 충분이다. 이 전환은 광고 승인이나 검색 순위를 보장하지 않는다.

---

## 판정

| 항목 | 판정 | 이유 |
|---|---|---|
| David 질문(“이게 자체콘텐츠 아니냐”) | 부분만 맞음 | 제품은 이미 아웃링크+자체 한국어 편집문 계약을 둔다. 기자 원취재가 아니고, 켜지지 않은 Claude 장문 요약도 원문 근거 요약이지 독점 기사 생산이 아니다. |
| 그록봇 수집 → Claude 집필을 새 운영 골격으로 | **HOLD** | 수집기는 이미 있고, 레포에 그록봇 프로세스는 없다. 전량 순찰·전량 LLM은 기존 비용·동결·요청 LLM0 계약과 충돌한다. |
| 가장 작은 다음 후보(승인 후) | 기존 후보 핵심 사건 소량 | 슬롯에 이미 들어간 이슈(또는 기존 canary 최대 3건)에만 `fetchPublicArticle` + 기존 Claude 요약·검증기를 쓰고, 요청 경로는 `filter_only` 유지. |
| 구현 착수 | **하지 않음** | 승인 범위 밖. Root가 콘텐츠 품질 diff를 따로 배정할 수 있다. |

이익 우선·과잉방어: **GO**로 아이디어를 검토하고, 구현은 **HOLD**. 이론적 광고 탈락만으로 편집 기능을 지우라는 뜻이 아니다. 반대로 LLM 기사를 켜면 광고·검색이 풀린다는 보장도 없다.

---

## 질문의 분해

David가 묶은 문장은 네 주장이다. 코드 기준으로 갈라야 한다.

1. **새소식 수집** — 이미 `FeedEngine._refresh` → `collect(sources)`가 15분 주기로 한다. 별도 그록봇을 가정하지 않는다. 이 레포·설정·스케줄에 `grokbot` 문자열은 0건이다. 지금핫에서 Grok는 Cursor 검수 워커로 쓰였고 수집기가 아니다.
2. **최신정보 기반 집필** — Today 정본은 슬롯 창의 풀 `savedAt`으로 한 번 얼린다. 사용자 GET은 그 파일을 읽는다. 요청 순간에 새 사실을 쓰지 않는다.
3. **기자들이 올리는 듯한 구성** — 이미 `EDITORIAL_READER_COPY_CONTRACT.mode = "response_only_press_style_projection"`이고 `llmCalls: 0`이다. 화면 문장은 규칙 투영이다.
4. **그게 자체콘텐츠다** — 법·제품 계약상 자체 *편집 파생물*일 수 있다. 광고 네트워크의 “자체 콘텐츠” 합격이나 검색 색인 우대와 같은 말이 아니다.

---

## 현재 실제 경로 (좁게)

```text
Live 수집 풀
  registry RSS/API → collect() → 풀 보존(firstSeenAt/lastSeenAt)
  → 교차보도 재집계 → URL 중복 접기 → 분류 → enrich(og) → 제목/발췌 번역
  → getFeed 핫/최신 (요청 LLM 없음)

Today 슬롯 정본
  같은 풀 스냅샷 + 분류 스냅샷
  → 사건 클러스터 → 분야 14×14 선별
  → (선택) 공개 원문 메모리 읽기 + Claude 요약·검증   [운영 기본 OFF]
  → 실패 시 excerpt_only 발췌/번역
  → 결정론 reader 문장 동결
  → SCE 파일 + 포인터 활성화
  → /api/today 는 pointer 읽기 + 분야 필터만 (llmCalls 0)
```

운영 compose는 `FEED_LIVE=1`, `FEED_REFRESH_MS=900000`, `FEED_TRANSLATE=1`, `NOWHOT_ARTICLE_SUMMARY` 기본 `0`이다. `NOWHOT_LOCAL_EDITORIAL_LLM`은 compose에 키 자체가 없다. 요청 경로 LLM0는 운영 기록이 아니라 현재 코드 계약이다.

---

## 재사용 가능한 구현 (source)

이미 있고, 새 그록봇/기자CMS를 대신한다.

| 단계 | 재사용 | 근거 |
|---|---|---|
| 수집 | `collect(sources)`가 소스별 기한 내 fetch, URL+정규화 제목으로 접고 교차보도를 남긴다 | `src/feed/content.js` 349–428행 |
| Live 주기 | `_refresh()`가 수집 → firstSeenAt 영속 → 소스 캡 → 풀 교차보도 → URL 중복 제거 → 분류 → enrich → 번역 | `src/feed/engine.js` 1608–1823행; compose `FEED_REFRESH_MS=900000` |
| 번역 | 해외 제목/≤200자 발췌만 Google gtx. 본문 전체 번역 아님. 실패 시 원문 유지 | `src/feed/translator.js` 1–18행; `deploy/docker-compose.yml` 19행 `FEED_TRANSLATE=1` |
| 공개 원문 | 최종 이슈만 메모리에서 HTML을 읽고 본문은 저장하지 않는다. Google News 1홉, DNS 고정, 제목 신원 불일치 거부 | `src/feed/enrich.js` `fetchPublicArticle` 711–788행; `legal.md` 21–30행 |
| 분류 | 사이클마다 학습+분류. Today 발행은 v2 스냅샷. 스냅샷이 오래되면 last-good. 발행 빌더는 `current_model`/`prior_exact_hash`/`deterministic_tier_policy`만 허용 | `engine.js` 1783–1802행; `category-routing.js` 11–14, 66–70행; `tools/build-slot-canonical-edition.mjs` `assertSemanticPublicationRouting` 98–106행 |
| 사건 | 결정론 클러스터. 강한 결합은 canonical URL·정규화 제목. 내용어 결합은 24시간 창. 오병합이 미병합보다 나쁜 실패 | `src/feed/event-cluster.js` 1–56행 |
| 오늘판 선별 | 분야별 단독 생성 후 합집합. `editorialMode: "deterministic_evidence_editor"`, `llmCalls: 0` | `engine.js` 3545–3593행 |
| 기자형 문장 | 제목·요약·왜중요·왜지금·변화·다음을 규칙으로 투영. LLM 0 | `editorial-reader-copy.js` 10–20, 605–615행 |
| 변화 | `changedSincePrevious`와 `changeState`(new/material_update/reaction_update/unchanged). 새 사실은 근거 델타가 있을 때만 | 같은 파일 457–506, 671–674행 |
| Claude 요약(꺼짐) | 앵커+보강 최대 3곳, 문장마다 원문 구절 ID, 독립 검증기, 거부 시 미적용. 원문 저장 금지 | `article-summary.js` 8–21, 115–137, 816–877행 |
| 발췌 폴백 | 공개 본문 또는 피드 발췌를 자르고, 한글이 부족하면 번역. `generationModel: null`, `status: "excerpt_only"` | `article-summary.js` 342–384, 1248–1256행 |
| 발행 전 준비 | 빌더는 `completeBeforePublish: true`. 키 없으면 `summaryBuildMode: "free_only"`. 미준비 상세는 후보 실패 | `build-slot-canonical-edition.mjs` 485–527행 |
| 시각 | `firstPublishedAt`은 소스 `publishedAt` 최소값. 기준 라벨은 `source_feed_timestamp`. 슬롯 as-of와 생성 시각을 섞지 않는다 | `slot-canonical-edition.js` 29–37, 206–207행; `engine.js` 3572–3576행 |
| 동결·요청 | 이슈 테이블을 SHA로 얼리고 포인터로 연다. 투영 응답 `llmCalls: 0`, `requestWork: "filter_only"` | `slot-canonical-edition.js` 204–247, 346–352, 398–450행 |
| 선택형 편집 LLM(꺼짐) | 계보 통과 이슈 최대 24건, 편집 1+검증 1, 실패는 결정론 유지. compose 키 없음 | `docs/14_NOWHOT_EDITORIAL_LINEAGE_AND_LLM_RUNTIME.md` 70–85행; `editorial-llm.js` 11–21행; `server.js` 596–598행 |
| 소량 canary | 분야 다른 이슈 최대 3, 호출 최대 2, `NOWHOT_LLM_CANARY_APPROVED=1` 없으면 실행 거부 | `docs/14` 133–147행; `editorial-llm.js` 24–31행 |
| 요청 무과금 | 사용자 조회에서 모델을 부르지 않고, inventory/사전발행만 요약을 준비한다 | `server.js` 1029–1033행 |
| 법률 모델 | 아웃링크 어그리게이터. 저장은 제목+≤200자 발췌+출처+링크. 장문 요약은 최종 이슈의 파생물만 | `src/feed/ingest.js` 1–16, 16행 `EXCERPT_MAX = 200`; `docs/legal.md` 1–4, 21–50행 |

Live `getFeed`는 같은 풀을 랭킹할 뿐 Today 정본 집필기가 아니다. 기자 CMS를 Live 순찰에 붙이면 Today 동결과 두 시계가 생긴다.

---

## 부족한 부분 (source) — 추측으로 메우지 말 것

| 공백 | 사실 | 새 그록봇이 메우지 못하는 이유 |
|---|---|---|
| 그록 수집 프로세스 | 코드/compose/스케줄에 없음 | 만들면 `collect()`와 15분 풀을 중복한다. 존재한다고 쓰지 않는다. |
| 운영 Claude 장문 요약 | `NOWHOT_ARTICLE_SUMMARY` 기본 0. 키 없으면 `enabled:false` | 꺼진 경로를 새 기자단으로 포장하면 현재 화면과 거짓이 된다. |
| 운영 편집 LLM | `NOWHOT_LOCAL_EDITORIAL_LLM` compose 미정의. 기본 OFF | 헤드라인/무슨일/왜중요만 고치고 본문 전체를 쓰지 않는다. |
| 실모델 품질 | 문서상 미관측. 과거 Anthropic 조직 한도로 요약 HOLD | `docs/14` 118–120행; 개발현황 NH81/NH87 기록. 이 워커는 키를 부르지 않음. |
| 정정 루프 | 활성 SCE는 `contentSha256` 불변. 증거 SHA에 묶인 요약 오버레이만 허용된 전례(NH111) | Claude가 슬롯 중에 다시 쓰면 정본이 깨진다. 다음 슬롯 또는 근거 묶인 교정만 맞다. |
| 원문 시각 vs 수집 시각 | 피드 `publishedAt` 없는 소스는 `firstSeenAt`으로 나이를 채운다 | `engine.js` 1690–1700행. 그록이 “지금”을 찍으면 발행시각과 관측시각이 더 섞인다. |
| 오병합/발췌 오염 | NH124가 사건 합침·번역 위젯 잔존을 실측 | 집필기를 키기 전에 같은 클러스터/발췌 수리가 먼저다. 이 검토는 그 diff를 구현하지 않는다. |
| 사람 검수 | 블라인드 패킷·canary는 있으나 사람 A/B PASS 미완료 | `docs/14` 119행. LLM 기사를 기자 품질로 승격할 증거 없음. |

현재 기사가 “발췌/번역 + 결정론 편집, LLM0”라는 전제는 코드와 맞다. `excerptSummary`는 모델을 호출하지 않고 `generationModel: null`이다. 서버 투영도 `llmCalls: 0`이다.

---

## 제안하는 최소 대안 (승인 후에만)

목표를 “기자처럼 읽히는 지금핫 문장”으로 두면, 새 수집망이 아니라 아래가 §11.1 최소다.

1. **수집은 기존 풀만.** 그록을 쓰더라도 새 프로세스·무제한 순찰·전체 소스 재크롤이 아니다. 1차 출처 URL, 발행/사건 시각, 원문 인용은 이미 고른 이슈에 `fetchPublicArticle`이 채운다. 그록 모델이 그 필드를 보강한다면 같은 공개 페이지의 추출 보조일 뿐, 수집 주인석을 가져가면 안 된다.
2. **선별은 기존 후보만.** 슬롯 유니온(분야당 최대 14, 활성화 최소 13) 또는 기본 Today 조합. 더 작게는 기존 editorial canary처럼 분야가 다른 최대 3이슈.
3. **Claude는 기존 두 계약만.**  
   - 본문: `makeArticleSummaryPipeline` — 사실 요약, 원문에 없는 정정·비교·인과 금지, 검증기 필수.  
   - 변화·영향: 이미 있는 `whyImportant`/`change`/`watchNext`와 (플래그 켜면) `editorial-llm`의 `headline`/`whatHappened`/`whyImportant`. canary 전용 `changedSince`는 운영 적용 금지(`editorial-llm.js` 266–270행, fallback “측정 전용”).
4. **발행 전 검증은 이미 있다.** 검증 거부·복사 과다·페이지 크롬(`looksLikePageChrome`)은 상세를 `source_unavailable`로 내린다 (`slot-canonical-edition.js` 196–202행). 새 기자 워크플로를 만들지 말고 이 게이트를 통과한 것만 포인터에 올린다.
5. **요청 경로는 그대로.** GET은 필터만. Live 15분 수집과 Today 07/12/19 동결을 한 실시간 기자단으로 합치지 않는다.
6. **프롬프트를 “원취재 기사”로 바꾸지 말 것.** 현재 시스템 프롬프트는 앵커 흐름 요약이고 입력에 없는 사실을 금지한다 (`article-summary.js` 115–126행). 기자 톤으로 바꾸면 환각과 전재 위험이 같이 커진다.

이 대안은 품질 실험이다. 광고 재신청이나 검색 정책 대응 티켓이 아니다.

---

## 반례 · 도전

### 비용·지연

- 편집 LLM은 신규 근거 판본당 최대 2회, 이슈 24개 상한 (`docs/14` 81–85행). 기사 요약 배치는 기본 8 (`article-summary.js` 825행, compose 미지정 시 동일).
- 전 풀 LLM은 15분 Live 수집 × 소스 상한 × 검증기까지 곱해진다. 과거에는 조직 사용 한도 HTTP 400으로 요약이 꺼졌다. 한도가 풀려도 사용자 GET에 붙이면 조회수에 비용이 비례한다. 그래서 저장 판 + 요청 0회가 먼저 설계됐다 (`llm.js` 16–18행은 하루 3회·디스크 저장을 전제로 한다).
- 사전발행은 슬롯 시각 전에 풀·패킷·라우팅을 고정한다 (`run-slot-canonical-prepublish.mjs` 46–64행, `build-slot-canonical-edition.mjs` `resolveSlotCanonicalBuildTarget` 50–65행). 발행 직전 그록 순찰을 끼우면 창을 놓치거나 스테이레 라우팅(`CATEGORY_ROUTING_MAX_AGE_MS` 30시간)과 충돌한다.

### 환각

- 요약 검증기는 고유명사·숫자·비교·인과가 원문에 없으면 거부한다 (`article-summary.js` 128–137행). `llm.js`도 입력에 없는 숫자가 있으면 규칙 문장으로 되돌린다 (26–30행).
- “최신정보로 기사를 쓴다”는 모델이 원문 밖 진행 상황을 보탠다는 뜻이면 이 게이트와 정면 충돌한다. 통과하려면 Claude는 가져온 구절만 재구성해야 한다. 그건 기자 취재가 아니라 지금 계약의 요약이다.

### 중복

- 수집 사이클 안과 48시간 풀에서 이미 제목 키·canonical URL로 접는다 (`content.js` 373–387행, `engine.js` 1763–1780행).
- 사건 계층은 같은 일을 두 번째 한다 (`event-cluster.js`). NH124는 약한 영문 토큰으로 다른 사건이 붙는 실측이 있다. 그록이 같은 뉴스를 다시 가져오면 멤버가 늘고 오병합 면적이 늘 수 있다.
- 커뮤니티와 기사는 의도적으로 안 합친다 (같은 파일 20–32행). 그록이 “관련 글”을 한 기사로 쓰면 이 가드를 우회한다.

### 오보·정정

- 얼린 판을 슬롯 중에 다시 쓰지 않는 것이 기본이다 (`docs/14` 96–97, 129–130행).
- NH111 전례는 선정·순서를 보존한 채 근거 SHA+원문 URL/원제에 묶인 `textKo` 교정만 허용했다. 임의 URL·추가 키는 거부.
- 모델이 오보를 “고쳐서” 쓰면 원문과 다른 사실이 지금핫 명의로 나간다. 검증기는 그걸 막도록 되어 있다. 정정이 필요하면 출처의 새 보도가 다음 슬롯 근거로 들어오거나, 증거 묶인 오버레이여야 한다.

### 갱신 시각 경계

슬롯은 07시(창 12시간), 12시(6시간), 19시(7시간)다 (`digest.js` 718–739행). 해외 아침 편향은 모닝만 1.6이다.

세 시각을 섞으면 독자 문장이 거짓이 된다.

| 시각 | 의미 | 주인 |
|---|---|---|
| 소스 `publishedAt` | 매체 표기 발행 | `firstPublishedAt`, `publicationTimeBasis: source_feed_timestamp` |
| `firstSeenAt` | 지금핫이 풀에서 처음 본 때 | 발행일 없는 소스의 나이 |
| 슬롯 as-of / `evidenceAsOfMs` | 이 판이 어떤 창의 풀을 썼는지 | 판 ID·사전발행 창 |
| 포인터 `updatedAt` | 파일이 활성화된 때 | 서빙 전환 |
| 모델 `generatedAt` | 요약/발췌를 만든 때 | 상세 캐시 24시간 (`READY_CACHE_MS`) |

그록 수집 시각을 기사 시각처럼 쓰면 “원문 표기 시각”과 어긋난다. 화면은 이미 원문 시각을 쓰도록 고정돼 있다.

### “기자처럼”의 제품 반례

- 결정론 투영도 내부 용어(“지금핫 수집”, “첫 저장 판”)를 기자체로 바꾼다 (`editorial-reader-copy.js` 46, 460–464행). 톤은 이미 목표다. 부족한 것은 원문 근거가 있는 장문이지, 새 봇이 아니다.
- NH123/NH124 상세는 `excerpt_only`가 사이트 크롬·번역 위젯을 본문으로 보여 기자 문장처럼 읽히지 않았다. 그 수리가 현재 승인 작업이다. 집필기를 올리면 같은 오염이 모델 입력으로 들어간다 (`cleanArticleTextChrome`이 요약 전에 돌지만, 꺼진 LLM 경로의 발췌가 곧 현재 독자 본문이다).

---

## 자체 콘텐츠 ≠ 광고 승인 ≠ 검색 정책

이 셋을 한 문장으로 묶지 않는다.

**제품/법률.** 지금핫은 원문을 재호스팅하지 않는 아웃링크 서비스이고, 통과한 이슈에 한해 한국어 파생 요약을 쓸 수 있다 (`legal.md`). `docs/14` 91–93행은 과학·패션 RSS를 “자체 콘텐츠가 아니라 계보가 붙은 편집 원료”로 명시한다. Claude가 그 원료를 다시 써도 원취재가 되지 않는다.

**광고.** NH123 Grok 광고 준비 검수는 AdSense/AdFit을 계정 판정이 아닌 제출 전 HOLD로 분리했다. Google Publisher Policies의 replicated-content는 **그 화면에 Google 광고가 있을 때**의 부가가치 규칙이다. AdFit 5.2는 API만의 구성·아웃링크 과다·타 사이트 글로만 구성된 매체를 문제 삼는다. 공식 원문: [Google Publisher Policies](https://support.google.com/adsense/answer/10502938), [AdFit 운영정책](https://adfit.kakao.com/web/html/use_kakao.html). Claude 기사 온은 이 심사를 통과시킨다는 증거가 없고, 이 파일이 그 승인을 예측하지도 않는다.

역사적 결합을 되풀이하지 말 것. `src/feed/llm.js` 1–14행은 애드핏 보류 사유로 해설 LLM을 도입했다고 적는다. 그 주석은 현재 승인 범위가 아니다. 편집 품질 실험과 광고 재신청을 한 티켓으로 열지 않는다.

**검색.** compose의 IndexNow는 새 URL을 검색엔진에 알리는 통보다 (`deploy/docker-compose.yml` 32–37행). 색인 핑이 원본성 점수가 아니다. 검색용 “자체 콘텐츠”와 광고 인벤토리 가치를 같은 합격선으로 쓰지 않는다. 이 검토는 검색 순위를 주장하지 않는다.

---

## 구현 승인과의 관계

현재 열린 구현은 콘텐츠 품질 수리와 Safari 검증이다. 사건 오병합·발췌 오염·번역 잔존은 그 레일이다. 이 문서는 그 diff를 대체하지 않는다.

Root는 이 보고 이후 실제 콘텐츠 수정 diff를 별도 배정할 수 있다. 그 배정은 그록봇·Claude 기자단 착수가 아니다.

---

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: 워커 프리앰블, Orca orchestration 계약, Mem0 설정 안내(이 작업에서 메모리 플러그인 미인증, 제품 판단에 미사용).
  - 직접 읽음: `START_HERE.md`; `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(13원칙 전문 + §11.1); `04_WRC_AI_CONTEXT_WIKI_RULES.md` 목적·SoT; `05_RULE_ENFORCEMENT_PROTOCOL.md` First Principles·최소변경·전용브라우저; `PMO_LIVE_BOARD.md` 상단(전용 창 격리, NowHot 현재 항목 없음); `REPORT_READ_INDEX.md` 상단; `docs/NOWHOT_DEVELOPMENT_STATUS.md` 현재 판정·NH113 LLM0 기록; `docs/legal.md`; `docs/14_NOWHOT_EDITORIAL_LINEAGE_AND_LLM_RUNTIME.md`; `docs/09_NOWHOT_LOCAL_EDITORIAL_EDITION.md` 관련 구간; `docs/02_NOWHOT_SELECTION_EDITORIAL_ENGINE.md` 파이프라인(설계상 LLM 단계는 런타임 OFF와 구분); `docs/monetization.md` 광고/편집 결합 주의; NH123 Grok 광고 준비 머리 판정; NH124 Grok 후보 검수(오병합 전례). 코드는 위 표의 수집·분류·사건·요약·정본·서버·compose.
  - 미읽음/불가: 운영 VM 포인터·실서비스 `/api/today` 바이트, AdSense/AdFit 콘솔, 실제 iPhone Safari, 유료 API, Ponytail 전용 SKILL 파일(세션에 경로 없음. §11.1 최소 보고서로 적용).
- 적용한 규칙: 입력 분류(의견·질문 → 분석 후 더 작은 대안), 13 First Principles, Canonical §11.1 최소 충분(보고서 1개), 이익 우선(기능 삭제 권고 없음, 거짓 광고 보장 없음), 읽기 전용, 그록봇 존재 추측 금지, 검색/자체콘텐츠/광고 승인 분리.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음. 제품 변경 레코드 없음. 안정 ID 제안만: `NOWHOT-NH126-GROK-EDITORIAL-PROPOSAL-001`. 채택은 PMO/David.
- 금지선 준수: 코드·테스트·env·포인터·스케줄·커밋·배포·유료 호출·광고 계정 0.
- David 행동 필요 여부: 이 구조를 구현하지 말 것. 콘텐츠 품질/Safari 레일을 계속. 나중에 요약 LLM을 실험하려면 기존 정본 이슈 소량 canary와 별도 승인 플래그만 검토.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO(검토) / 구현 HOLD. 근거: 수집·동결·검증기가 이미 있고 병목은 꺼진 요약과 발췌 품질이다. 덜 제한적 대안: 새 봇 없이 선정된 사건에 기존 파이프라인 소량. BLOCK 아님(위법 확정 없음).
- 하지 않은 일: 제품 수정, 광역 테스트, 운영 대조, 광고/검색 합격 예측, 그록봇 설계, Claude 프롬프트 변경.

Corridor analyzePlan: 코드 생성 없음. 호출하지 않음.
