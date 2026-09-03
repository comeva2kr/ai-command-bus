# NH94 소스 수집·카테고리 라우팅 감사 (read-only)

- Date: 2026-08-31 (Asia/Seoul)
- Auditor: Claude Code (Fable 5), dispatched worker, task_f71d2f388ec4
- Scope: `/Users/hyundonghwang/Documents/NowHot-Local-Dev` working tree (branch `codex/adfit-content-rescue-20260810`, HEAD `e79856c` + uncommitted diff). 코드 읽기만. 수정·테스트 실행·제품 API 호출·Keychain·커밋·배포·포인터 변경 없음.
- 방법: 레지스트리는 스크립트 집계(node 원라이너), 라우팅·분류·LLM 경로는 파일 직접 읽기. 공식 애그리게이터 문서는 웹 검색으로 원문 URL 확인.
- 사실(FACT)과 권고(RECOMMENDATION)를 분리해 적는다. NH91 좌표(2,198 분류 시도가 4콜 후 중단, 복구 스냅샷 2,199 admitted 중 모델 242, strict면 news 8건)는 코디네이터 제공 사실로, 여기서 재측정하지 않았다.

---

## A. FACT — 소스 수집 현황

### A1. 레지스트리 집계 (`src/feed/communities.json`, 3,094줄)

| 구분 | 값 |
|---|---|
| 등록 소스 | **137** |
| enabled | **107** (비활성 30 = seed 더미·robots 차단·David 제외 확정) |
| enabled 어댑터별 | **rss 87 · list 17 · json 2 · store 1** |
| enabled 계층별 | **specialist 51 · community 29 · aggregate 27** |
| enabled kind별 | news 77 · community 30 |
| enabled 언어별 | ko 71 · en 35 · ja 1 |
| 카테고리 | 14개 (`src/feed/taxonomy.js:7-33`) |

- `list` = 커뮤니티 베스트 게시판 정규식 파싱(제목·URL·시각·공개 반응수만, 본문·이미지 미수집 — `communities.json:2` `_comment`). 소스별 정규식·창 크기·검증일이 레지스트리에 실측 기록으로 남아 있다(예: bobae `communities.json:20-31`, clien `:87-98`).
- `json` = hackernews(Algolia front_page API 디스패치, `communities.json:696-699`) + devto. `store` = nowhot-deal(자체 저장소). reddit 어댑터 타입은 존재하나 enabled 0.
- 특수 플래그: `mixed:true`(종합 베스트 — 등록 카테고리를 물려주지 않음), `mainFeed:false`(inven_hot — 수집하되 통합 피드 제외, `communities.json:264-265`), `feedGroup`(gnews 8개 섹션을 다양성 계산에서 한 몫), `lean`(언론 성향 -2~+2), `operatorGroup`/`ownershipGroup`.
- robots.txt 판단 기록이 소스별로 남아 있고 차단 확인 시 비활성화한 사례(humoruniv `:285`, mlbpark `:397`, pann `:630`)와 David 결정으로 유지한 예외(etoland `:457`, slrclub `:550`) 둘 다 존재한다.

### A2. 딜(핫딜) 소스

ppomppu-deal, ppomppu-deal-os, ruliweb-deal, clien-jirum, dealbada(list) + nowhot-deal(store). 딜은 게시판 자체가 분류라 별도 판별 불요(엔진에서 registry category 강제, Grok 리뷰 path 7).

---

## B. FACT — 카테고리 라우팅의 실제 동작

### B1. 두 모드가 공존하고, 기본값은 v1이다

- `src/feed/server.js:631-632`: `NOWHOT_CATEGORY_ROUTING || "v1"`. **v2는 opt-in**이고, v1이면 스냅샷 라우터가 아예 안 붙는다(`engine.js:1050` status `{mode:"v1", state:"legacy"}`).
- v1 = 인프로세스 결정적 분류(`engine.js:1267` → `_classifyItems`, `engine.js:1289+`): 딜→registry, mixed 폴백, `definiteCategory`(키워드+게시판 URL), NB 교정/재분류. **LLM 0회.**
- v2 = 스냅샷 라우터(`server.js:633-640` → `src/feed/category-routing.js` `createReloadingCategoryRouter`). 스냅샷은 오프라인 CLI가 LLM 분류 결과로 빌드한다.

### B2. declared_section 동작 (`src/feed/category-routing.js:115-117,132,148`)

- 레지스트리에 `categoryRouting:"declared_section"`을 가진 enabled 소스는 **14곳, 전부 specialist/news**: yna-society, khan-society, donga-national, bbc-technology, techcrunch, the-verge, engadget, ars-technica, bbc-world, guardian-world, nyt-world, cnbc-economy, bbc-business, marketwatch-top.
- 발동 조건: 아이템이 **스냅샷에 없을 때만**(`!entry`) + kind news + tier specialist + 유효 category. 그때 `meta.category`를 basis `declared_specialist_section`으로 투영한다. 스냅샷 엔트리가 있으면 선언이 아니라 스냅샷(모델) 결과가 이긴다.
- 즉 declared_section은 "스냅샷 사이에 새로 들어온 전문지 기사"를 위한 결정적 통로다. 전문지 섹션 피드는 발행자가 이미 분류한 것이므로 이 통로 자체는 정당하다(§D 비교 참조).

### B3. legacy/strict 스냅샷 충돌 — 현재 상태

1. **배포 중인 스냅샷은 구형 포맷이다.** `src/feed/category-routing.snapshot.json`: snapshotId `routing-1787543418289`, generatedAt **2026-08-24T04:48:53Z**, 1,983 엔트리(1,873 classified / 110 withheld), `routingBasis` 필드 전무, `recoveryPolicy` 없음 — 기본 빌더(`tools/build-category-routing-snapshot.mjs:18-60`) 산출물이다.
2. **그 스냅샷은 이미 만료다.** `CATEGORY_ROUTING_MAX_AGE_MS = 30h`(`category-routing.js:7`) → 2026-08-25 오전 이후 `snapshot_stale_last_good_v2`. stale이면 엔트리 없는 아이템은 `staleFallback`(기존 admittedCategories 또는 `item.category`, `category-routing.js:120-122,133`)으로 흐른다 — 즉 v2를 켜도 지금은 사실상 v1 분류 결과(엔진이 써 둔 `item.category`)가 투영된다.
3. **복구 빌더에 strict/legacy 두 모드가 있다** (`tools/build-category-routing-snapshot.mjs:97-141,175-177`): strict = `current_model → prior_exact_hash → withheld`; `--allow-legacy-fallback` = 추가로 `target.legacyCategory`(= v1 엔진 분류값)를 admitted로 승격. 코디네이터 사실: NH91에서 legacy 모드가 2,199건을 admitted로 만들었고 그중 모델 행은 242건, strict면 news 레인이 8건.
4. **라우터가 legacy 행을 다시 두 번 재분류한다**: URL 경로 토큰 사전(`LEGACY_SECTION_CATEGORIES`, `category-routing.js:14-40`)과 gnews 발행사 라벨 유일성(`:125-131`). 이는 스냅샷 계약 위에 얹힌 별도 결정적 분류기 2개다(NH91 counter-review P0-1과 일치).
5. 정합성 부스러기: `ROUTING_BASES`에 아무도 생산하지 않는 `specialist_registry_default`가 남아 있고(`category-routing.js:11-13`), 복구 빌더 영수증이 `classifiedArticles := admittedArticles`로 기록된다(`build-category-routing-snapshot.mjs:183-184`) — legacy 행이 "classified"로 집계된다.

**충돌의 실체(사실 판정)**: strict는 안전하지만 공급이 무너지고(news 8), legacy는 공급을 채우지만 그 채움의 89%(1,957/2,199)가 모델이 아닌 v1 휴리스틱 값이다. 어느 쪽이든 "LLM 분류가 발행 게이트"라는 v2의 명분이 현재 성립하지 않는다 — 게다가 운영 기본값은 애초에 v1이다.

### B4. LLM이 실제로 도는 곳 (전수)

| 경로 | 파일 | 모델 | 게이트 | 런타임/오프라인 |
|---|---|---|---|---|
| 브리핑 해설 문장 | `src/feed/llm.js:31-48` | sonnet-5 | API 키, 하루 3회, 숫자 금지+검증 실패 시 규칙 문장 폴백 | 런타임(저빈도) |
| 편집 증거 파이프라인 | `src/feed/editorial-llm.js:424-425`, `server.js:648-672` | sonnet-5 + haiku-4-5 검증기 | `NOWHOT_LOCAL_EDITORIAL_LLM=1` + 카나리 승인 계약 | 런타임(로컬 편집판) |
| 기사 요약 | `src/feed/article-summary.js:804-805` | sonnet-5 ×2 | `NOWHOT_ARTICLE_SUMMARY=1` | 런타임(로컬 편집판) |
| 번역 | `src/feed/translator.js:185-187` | haiku-4-5 | 키 있을 때 | 런타임 |
| **카테고리 분류(v2 스냅샷 원료)** | `src/feed/selection-classifier-lab.js` + `tools/run-selection-shadow-canary.mjs` | packet의 requestedModel | CLI 수동 실행, evidenceHash 캐시 | **오프라인 전용** |
| 상품 블루프린트 | `src/feed/product-blueprint.js` | — | 별도 | 오프라인성 |

**핵심 사실**: 런타임 요청 경로의 카테고리 판별에는 LLM이 0회다. LLM 분류는 오프라인 배치(스냅샷 빌드)에만 존재하고, 그 스냅샷조차 기본 모드(v1)에서는 소비되지 않는다.

### B5. 검증·필터 레이어 전수 (겹침 목록)

1. `classify.js` — NB(균등 사전확률+기권) + leave-one-out + AUTO_KEYWORDS/AUTO_FINANCE_GUARD + INCIDENT_GUARD/INCIDENT_CONTEXT + CATEGORY_GUARDS(8종) + 단건 대응 정규식 약 28개(`classify.js:431-458`) + CATEGORY_KEYWORDS 11카테고리 사전 + BOARD_CATEGORY_RULES + MIXED_BEST_FALLBACK/MIXED_NEUTRAL_CATEGORY
2. `promotion.js` LOW_VALUE_PATTERNS (`promotable()`에 실제로 걸림)
3. `category-admission-policy.json`(102줄) + `category-policy.js`
4. 스냅샷 계약: evidenceHash/sha256 4종(packet·predictions·registry·policy) 영수증, 30h 만료, 리로드 상태 머신
5. 라우터 내부 재분류 2종(URL 토큰·발행사 라벨)
6. `editorial-quality.js:426-469` — 사람 이중 리뷰 합의(strictConsensusPass) 상태 머신
7. 판 조립층: edition-candidates 지오 예약, digest 13층 채움, slot-canonical assertion(개수만 검사)
8. `categoryGuardReason`은 NB 교정·편집 초안 평가에만 쓰이고 **발행 필터(레인 선정)에는 안 걸린다**(Grok P1-1과 동일 확인)

---

## C. FACT — 공식 애그리게이터 1차 문서와의 대조 (직접 문서화된 것만)

- **Google News (공식 문서 있음)**: 스토리 선별은 알고리즘이 한다고 명시 — [How Google News stories are selected](https://support.google.com/googlenews/answer/9005749) ("Computer algorithms determine which stories show up"). 랭킹 요인(관련성·저명성·권위·신선도·위치·언어)도 공식 문서에 있다 — [Ranking within Google News](https://support.google.com/news/publisher-center/answer/9606702). 두 문서 어디에도 아이템당 생성형 분류가 요구된다는 내용은 없다. 이 저장소가 학습 라벨로 쓰는 gnews 섹션 RSS(`communities.json:1020-1025`)는 바로 그 알고리즘 분류의 산출물을 받는 것이므로 "발행자/애그리게이터가 이미 분류한 신호를 신뢰"하는 패턴 자체는 공식 문서와 부합한다.
- **Apple News**: Top Stories를 사람 에디터가 고르고 Trending을 알고리즘이 채운다는 것은 보도·학술 감사([ICWSM 2020 감사 논문](https://ojs.aaai.org/index.php/ICWSM/article/download/7277/7131/10507))로 알려져 있으나, **Apple 공식 지원문서에 그 메커니즘이 직접 문서화된 페이지는 확인하지 못했다**. 과업 지침("directly documented only")에 따라 Apple News는 비교 근거로 쓰지 않는다.
- 대조 결론(사실 범위): 주요 애그리게이터의 문서화된 패턴은 ① 발행자 섹션/피드 메타데이터 신뢰 ② 알고리즘(비생성형) 랭킹 ③ 사람 큐레이션 소량이다. "풀 전체를 매 사이클 LLM으로 분류"하는 패턴은 어느 공식 문서에도 없다.

---

## D. RECOMMENDATION — 결정적/LLM 분담과 최소 제품 안전 설계

### D1. 결정적으로 처리해야 하는 것 (전체의 약 80%)

- **specialist 51곳 전부**: 단일 주제 피드는 피드 자체가 분류다. declared_section 14곳을 넘어, 등록 카테고리가 곧 정답인 소스(gamemeca=gaming, sciencedaily=science, motorgraph=auto, hypebeast=fashion…)는 선언을 그대로 쓰는 게 Google 문서화 패턴과 일치하고, 실측으로도 분류기가 이를 덮어써 틀렸다(`classify.js:295-308` UNTRAINED_CATEGORIES 주석의 hypebeast→culture, hankyung-realestate→auto 사례).
- **aggregate 27곳 중 섹션 피드**: gnews-biz/sports/ent/science/tech, mk/hankyung/chosunbiz 섹션 등 — 발행자·구글이 이미 분류.
- **딜 소스**: 게시판=분류.
- **politics**: 고유명사 사전(topics.js) — 이미 결정적이고 설명 가능.
- **게시판 URL 규칙**(BOARD_CATEGORY_RULES): 글쓴이가 고른 게시판은 제목 추정보다 강한 신호. 유지.

### D2. LLM이 필요한 모호 부분집합 (전체의 약 20%, 그리고 그중 상위만)

- `mixed:true` 커뮤니티 종합 베스트(bobae, clien, ppomppu, theqoo, instiz, etoland, todayhumor, slrclub, damoang, ruliweb 등 list 17곳의 대부분) + 종합 뉴스에서 키워드·NB가 **기권한** 아이템. 제목뿐인 증거로 주제가 진짜 섞이는 곳은 여기뿐이다.
- 단, **발행 가능한 것만** 분류한다: 슬롯당 레인 후보 상위 N(예: 카테고리당 상위 ~20, 랭크순)만 LLM 배치에 넣고 evidenceHash 캐시. NH91의 2,198건 전풀 분류는 과잉이었고 4콜 중단으로 그 과잉이 실증됐다. 모델은 이 난도면 haiku-4-5급으로 충분하며 검증은 스키마+taxonomy id 검사로 결정적으로 한다.
- 미분류·미기권 잔여는 withheld — humor 중립 버킷이 아니라 **발행 보류**가 기본값이어야 레인이 오염되지 않는다(현 MIXED_NEUTRAL_CATEGORY는 v1 폴백으로는 유지 가능하나 발행 게이트로는 부적격).

### D3. 현 검증·필터는 과잉인가 — 부분적으로 그렇다

- **과잉인 것**: ① `classify.js`의 단건 대응 정규식 벨트(~28개 SUBJECT/CONTEXT 정규식 + CATEGORY_GUARDS 확장) — 지난 오탐 제목의 목록이지 일반해가 아니고, 정작 발행 필터에 안 걸려 있다. ② 라우터 내부 URL 토큰·발행사 라벨 재분류 2종 — 스냅샷 계약을 스스로 부정하는 3중 분류. ③ sha256 4종·카나리 계약·사람 이중 리뷰 합의 머신 등 증명 장치의 무게 대비, 정작 핵심 게이트(레인별 classified coverage preflight)가 없다. ④ v1/v2 이중 스택 자체가 유지비다.
- **과잉이 아닌 것**: robots/약관 실사 기록, list 파서 실측 검증 필드, NB 기권 설계, 정치 사전, promotion 저가치 필터(발행 경로에 실재), 딜 게시판 규칙. 이들은 제거하면 품질·법적 안전이 실제로 깎인다.

### D4. 최소 제품 안전 설계 (요약)

1. **라우팅 단일화**: 결정적 3원(소스 선언 단일주제 / 게시판·딜 규칙 / 정치 사전) + 모호분(mixed·기권)만 LLM 배치 분류(캐시·오프라인·상위 N) + 그 외 withheld.
2. **발행 게이트 하나만 fail-closed로**: 레인 채움은 {model, prior_exact_hash, 단일주제 선언} basis만. 13 미만이면 legacy로 채우지 말고 HOLD/축소 — Grok P0-2와 같은 결론이며, 이 게이트 하나가 정규식 벨트 대부분을 대체한다.
3. **삭제 후보**: 라우터 URL/발행사 재분류, `--allow-legacy-fallback`의 발행 경로 사용, `specialist_registry_default` 사어, `classifiedArticles:=admittedArticles` 영수증, (David 지시 "해외 최소선 없음"과 상충하는) 후보층 KR/US 좌석 예약.
4. **LLM 지출 상한은 구조로**: 상위 N×카테고리×슬롯만 부르면 NH91식 2,198건 러너웨이가 구조적으로 불가능해진다.

---

## WRC 보고 필드

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: `docs/reports/NOWHOT_NH91_GROK_COUNTER_REVIEW_2026-08-31.md`
  - 미읽음/불가: WRC_MANUS_HANDOFF 스타트 게이트 6종(코디네이터 TASK 블록이 범위·금지선을 완결 지정한 dispatched 감사라 저장소 내 근거를 우선 읽음)
  - 이번 작업 전용 파일: `src/feed/communities.json`, `src/feed/category-routing.js`, `src/feed/classify.js`, `src/feed/engine.js`, `src/feed/server.js`, `src/feed/llm.js`, `src/feed/editorial-llm.js`, `src/feed/article-summary.js`, `src/feed/translator.js`, `src/feed/taxonomy.js`, `src/feed/editorial-quality.js`, `src/feed/promotion.js`, `tools/build-category-routing-snapshot.mjs`, `tools/prepare-selection-shadow.mjs`, `tools/run-selection-shadow-canary.mjs`, `src/feed/category-routing.snapshot.json`
- 적용한 규칙: 13 First Principles 게이트, 수정·개발 범위 법칙(read-only 준수), 이익 우선·default-GO
- First Principles 게이트: PASS
- 금지선 준수: 수정·테스트·제품 API·Keychain·커밋·배포·포인터 변경 없음(본 보고서 신규 파일 1건만 생성 — NH91 선례와 동일한 산출물 관행)
- David 행동 필요 여부: 있음 — D4 설계(특히 발행 게이트 단일화·legacy 발행 차단)는 David 승인 사안
- Telegram 알림 필요 여부: 코디네이터 판단 위임
- 이익 우선·과잉방어 점검: LLM 전풀 분류 대신 상위 N 배치로 비용 상한 구조화 권고 — 기능 축소 아닌 지출 구조 개선
- 하지 않은 일: npm test, 라이브 fetch 재검증, NH91 수치 재측정, Apple News 비공식 자료 기반 비교, 코드 수정
