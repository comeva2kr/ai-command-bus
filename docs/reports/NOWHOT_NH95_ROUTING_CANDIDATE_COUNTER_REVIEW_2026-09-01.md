# NH95 라우팅 후보 적대 반대검수 (read-only)

- Date: 2026-09-01 (Asia/Seoul)
- Reviewer: Claude Code (Fable 5), dispatched worker, task_0301edb159e2
- Scope: 현재 working tree bytes + uncommitted diff (branch `codex/adfit-content-rescue-20260810`, HEAD `e79856c`). 코드 수정·테스트 실행·유료 호출·포인터 변경·커밋·배포 없음. 본 보고서 신규 파일 1건만 생성(NH91·NH94 선례와 동일).
- 검수 대상 후보(코디네이터 제시): ① 기존 엔진 tier 정책 재사용 ② 전문지 소스/섹션 선언 메타데이터 + **표준 RSS/Atom category 메타데이터**를 결정적 발행 근거로 신뢰 ③ prior_exact_hash·모델 결과 유지 ④ 미해결 aggregate/mixed 상위 잔여만 미래 LLM shortlist ⑤ 발행 시점 URL/발행사 복구 제거 ⑥ 풀·패킷·라우팅 정체성, 13–14 lane, 사건 정본 카드 1개, 사전 상세, 요청 중 필터만, 성인 게이트, last-good 포인터, 국내외 쿼터 없음 전부 보존 ⑦ 이번 라운드 무과금·무활성·무커밋.

## 판정: **TWEAK** (방향 GO — NH94 D4·Blueprint v4 tier 계약과 일치. 단 아래 P0 2건을 수정하지 않으면 구현 착수 불가)

---

## P0 (설계 수정 필수)

### P0-1. RSS/Atom category 메타데이터 신뢰는 이번 라운드에서 제외하라 — 존재하지 않는 신호를 "신뢰"하는 항목이다

**사실**: `src/feed/fetchers.js`(650줄)는 title·link/guid·summary·pubDate/updated/dc:date만 추출한다. `<category>` 파싱은 0곳이다(grep 0히트). 따라서 이 항목은 "기존 신호 신뢰"가 아니라 **신규 서브시스템**이다: RSS 2.0 `<category>`·Atom `<category term>`·RDF `dc:subject` 파서 + 풀 스키마 확장 + **발행사 자유어휘→14분류 매핑 테이블**.

**공격**:
- 그 매핑 테이블은 같은 후보가 발행 시점에서 삭제하는 `LEGACY_SECTION_CATEGORIES`(category-routing.js:14-23)식 사전을 상류에 재발명하는 것이다. 더 나쁜 점: 발행사 어휘는 계약이 없다. 한국 종합지 태그("속보"·"이슈"·다중값)·한영 혼용·무통보 어휘 변경 — 어떤 sha 영수증도 발행사 쪽 드리프트를 못 잡는다.
- 공급 이득도 환상이다. gnews 아이템은 per-item category가 없고, 전문지 51곳은 이미 레지스트리 선언으로 커버되며, category 태그가 실질 도움이 될 종합지/커뮤니티 혼합 피드는 **정확히 LLM shortlist로 보내기로 한 그 모호 집합**이다.
- 과잉설계 판정: 신규 파서+매핑+드리프트 감시를 들이는 비용 대비 커버 증가분이 shortlist 대상과 겹친다. 수정·개발 범위 법칙 위반 소지.

**Tweak**: 이번 라운드 결정적 근거는 **레지스트리 선언 단일주제 전문지/섹션 소스만**으로 한정(기존 `declared_section` + `sourceTier:specialist` + `category` — NH94 D1과 동일). RSS/Atom category는 별도 라운드에서 도입하더라도 **소스별 opt-in**(communities.json에 소스별 값→분류 매핑 명시) + 관측 히스토그램 영수증으로만 — 전역 신뢰 규칙 금지.

### P0-2. 결정적 근거는 스냅샷 빌드 시점에 물질화해야 하며, NH93.2 basis-first 게이트·블루프린트 truth 라인의 명시적 개정이 선행돼야 한다

**사실**:
- `assertSemanticPublicationRouting`(tools/build-slot-canonical-edition.mjs:93-102)은 `current_model`·`prior_exact_hash`·빈 `withheld`만 허용 — NH93.2 `BASIS_FIRST_FAIL_CLOSED` 승인 사항.
- `assertSamePoolInputs`(:72-91)는 풀 id == 패킷 sourceArticleIds == 라우팅 entry id **정확 일치**를 요구한다.
- 라우터의 `declared_section` 경로는 `!entry`일 때만 발동한다(category-routing.js:115). 정본 빌더 경로에서는 모든 풀 아이템에 entry가 있으므로 **withheld entry가 선언을 이기고 카드가 그냥 탈락한다**(:132 — entry 있으면 entry.categories=[] 투영 → drop).

**공격**: 후보를 라우터(발행/요청 시점) 쪽에서 구현하면 둘 중 하나다 — (a) 선언 근거가 정본 빌더에서 한 번도 발동하지 않거나, (b) 스냅샷 밖 라우팅이 생겨 풀·패킷·라우팅 정체성이 깨진다. 또한 이 근거는 NH92에서 죽인 `specialist_registry_default`(827건 재사용 금지 결정)의 실질 부활이므로, 조용히 코드만 바꾸면 승인된 결정의 회귀로 읽힌다.

**Tweak**: 근거 부여는 **오직 `buildRecoveredCategoryRoutingSnapshot`/`buildCategoryRoutingSnapshot`(오프라인 빌더)에서** 수행하고, `ROUTING_BASES` + `assertSemanticPublicationRouting` 허용 집합 + counts.routingBasis 영수증을 **한 커밋에서 함께** 확장한다(새 basis id 예: `declared_specialist_section`). 블루프린트 NH92/NH93.2 truth 라인 개정은 David 승인 문서 변경으로 선행한다. 라우터의 요청 시점 declared_section(!entry 신착 기사용)은 현행 유지 — 그것은 스냅샷 사이 신착용이지 발행 근거가 아니다.

---

## P1 (구현 시 불변식으로 잠글 것)

### P1-1. evidenceHash는 title+excerpt뿐 — 선언 근거의 해시 편승·교차 소스 전이 차단

`evidenceHashOf`(selection-classifier-lab.js:63)는 제목+발췌만 해시한다. 패킷은 evidenceHash로 target을 **소스 횡단 병합**하고(prepare-selection-shadow.mjs:96-113) 대표는 specialist 우선(`representativePriority`)이다. 공격 시나리오: 통신사 전재 기사(같은 제목+발췌)가 전문지 섹션과 종합지에 동시 등장 → 대표 소스의 선언 카테고리가 **타 소스 사본 전체에** 결정적으로 찍힌다. 나아가 선언 근거가 `reusablePrior`에 들어가면 텍스트 충돌만으로 과거 스냅샷의 소스 메타데이터가 다음 스냅샷에 전이된다.

- **불변식 A**: `reusablePrior`는 `current_model`·`prior_exact_hash`로 유지(현행 diff 그대로). 선언 근거는 **매 빌드 현재 레지스트리에서 재계산**하고 prior 재사용 금지 — 공짜 연산이라 재사용할 이유도 없다.
- **불변식 B**: 선언 근거는 target의 **모든** sourceArticleIds의 소스 선언이 만장일치일 때만. 불일치면 model/withheld로 낙하.

### P1-2. "기존 tier 정책 재사용"은 무조건 신뢰가 아니다 — 교차 주제 기사 방어를 그대로 가져와라

category-policy.js의 계약: specialist 선언은 **강한 기본값 + 보수적 교정**(specialistCorrection — NB margin/known 임계 + 전용어 2히트 + 가드), aggregate는 약한 prior(aggregateReclassification). v2 결정적 근거가 선언을 절대 신뢰하면 교차 주제 기사(한경부동산의 금리 기사, bbc-technology의 규제 정치 기사)에서 **v1보다 퇴보**한다 — 교정 규칙이 태어난 바로 그 오분류들이다.

- **불변식 C**: 스냅샷 빌더가 근거를 찍기 전에 specialistCorrection/aggregateReclassification을 결정적으로 실행하고 `categoryCorrection`을 entry에 기록. `categoryPolicySha256`·`registrySha256` 영수증을 recovery 빌더뿐 아니라 **plain 빌더에도** 추가(레지스트리 드리프트 감지).
- **소스 감사**: declared_section 14곳 중 `marketwatch-top`은 섹션이 아니라 top-stories 혼합 피드다. 결정적 신뢰 목록에서 빼고 aggregate/mixed→shortlist로 보내라. 나머지 13곳은 단일주제 섹션으로 적격.

### P1-3. 공급 산수를 정직하게 명기하라 — 이번 라운드에 신선한 활성판은 나오지 않는다

NH91 사실: strict면 news 모델 행 8건. NH93.1 무과금 재생: 14 lane 중 11개가 13건 미달(스포츠 0·패션 0 포함). 선언 근거 추가는 대략 구 `specialist_registry_default` 827건 커버를 복원하지만, 전문지가 없는 lane(스포츠·유머 등 커뮤니티 의존 분야)은 여전히 **"미래" shortlist**에 달려 있고 이번 라운드는 무과금이다. 결론: **이번 라운드 산출물은 새 활성판이 아니라 (a) 코드+게이트 확장 (b) 무과금 재생 lane별 근거 카운트 영수증**이며, last-good 포인터(`SCE-e35dc2831e2ac6f1`)는 shortlist 지출 승인 전까지 계속 노화한다. 이것을 설계 문서에 기대 결과로 먼저 적어야지, 나중에 발견되게 두면 안 된다. shortlist 지출 규모는 이 영수증을 보고 David가 결정한다.

### P1-4. URL/발행사 복구 제거는 안전하나 반쪽 제거는 오히려 악화다

두 복구(category-routing.js:123-131 `legacySectionCategory` + gnews 발행사 라벨)는 `routingBasis === "legacy_classifier_fallback"` entry에서만 발동하고, 정본 경로는 assertSemanticPublicationRouting이 이미 차단하므로 발행 기준으로는 사어다(배포 스냅샷은 구형·2026-08-25부터 stale이라 라이브 v2에서도 미발동). 제거 GO. 단 **복구만 지우고 `--allow-legacy-fallback` 산출을 남기면** legacy v1 카테고리가 교정 없이 그대로 투영돼 오늘보다 나빠진다.

- **불변식 D**: 복구 코드 제거와 동시에 `legacy_classifier_fallback`의 발행 경로 사용을 함께 봉인(정본 게이트는 이미 차단 — CLI 문서/사용처에서 발행용 사용 금지 명시). `LEGACY_SECTION_CATEGORIES`·`GENERALIST_PUBLISHER_CATEGORIES`·`publisherLabelKey`도 함께 삭제. 구형 스냅샷 파일은 "로드 허용·발행 불가" 현행 유지가 최소 변경.

## P2 (기록만)

- recovery 영수증 `classifiedArticles := admittedArticles` 별칭(build-category-routing-snapshot.mjs:182-184) — NH94 지적 잔존.
- 라이브 v2 stale 경로(`staleFallback`·`observedAfterSnapshot`)는 여전히 v1 `item.category`를 투영 — 후보 범위 밖이나, 선언-단일주제 소스는 post-snapshot 경로에서 declared 근거로 흡수할지 다음 라운드 결정 사항.

---

## 보존 확인 (현재 bytes 기준, 후보와 충돌 없음)

- 풀·패킷·라우팅 정확 일치: assertSamePoolInputs 현행 유지 (불변식 E).
- lane 13–14: `activationMinimumPerCategory:13` + `assertSemanticLaneCoverage` — 미달 시 후보판 실패, last-good 포인터 유지 (불변식 F).
- 사건 정본 카드 1개: 전체 풀 사건 묶음 후 분야 투영(`categoryEditionsFromUnion` — selectedByCategories 필터만) — 근거 변경은 분야 투영에만 작용, 카드 정체성 불변 (불변식 G).
- 사전 상세·요청 중 필터만·성인 게이트: `completeBeforePublish` + `requestPathWork:"pointer_read_and_filter_only"` + 라우터 성인 차단(:111-112) 현행 유지 (불변식 H).
- 국내외 쿼터 없음: 현재 diff에서 `CATEGORY_DOMESTIC_SHARE_BANDS` 전달 제거·digest 지역 예약 루프 삭제·lexicon에서 국가명/일반어 `rate` 제거 확인 — 후보의 "no quota"와 정합 (불변식 I).
- shortlist 구조: `selectSelectionShadowShortlist`가 이미 "모든 route withheld + aggregate/mixed + 창 내 + round-robin + maxCalls 상한" 형태 — 후보 ④는 신규 개발이 아니라 이 함수의 소비 승인 문제다. 상한은 구조로 유지 (불변식 J).

## 최소 파일·테스트 목록 (구현 라운드용)

| 파일 | 변경 |
|---|---|
| `src/feed/category-routing.js` | ROUTING_BASES에 `declared_specialist_section` 추가; legacySectionCategory·발행사 복구·관련 상수 삭제 |
| `tools/build-category-routing-snapshot.mjs` | 만장일치 선언 근거 부여(교정 포함, 불변식 A–C); plain 빌더에 registry/policy sha 영수증 |
| `tools/build-slot-canonical-edition.mjs` | assertSemanticPublicationRouting 허용 집합 += declared basis |
| `src/feed/communities.json` | marketwatch-top declared_section 제외(또는 aggregate 재계층) |
| `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md` | NH92 `specialist_registry_default` 금지·NH93.2 basis 집합 truth 라인 개정 (David 승인) |
| 변경 금지 | `src/feed/fetchers.js`(P0-1), `src/feed/category-policy.js`(재사용만), engine v1 경로, digest/edition-candidates(NH93 결과 유지) |

테스트: `test/category-routing.test.js`(복구 삭제 회귀 + 새 basis 수용/거부), `test/slot-canonical-edition.test.js`(게이트가 declared 수용·혼합소스 declared 거부·legacy 거부), `test/selection-d2d.test.js`/`selection-d2e.test.js`(빌더 basis 카운트·reusablePrior 제한), `test/category-policy.test.js`(무변경 통과 확인), 신규 적대 픽스처 1건: **동일 title+excerpt 전재 기사가 선언 카테고리가 다른 두 소스에 존재 → declared 아님(withheld/model)**.

---

## WRC 보고 필드

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: `WRC_MANUS_HANDOFF/START_HERE.md`(헤더), `PMO_LIVE_BOARD.md`(헤더), `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md` NH91–NH93.2절, `docs/reports/NOWHOT_NH94_SOURCE_ROUTING_AUDIT_2026-08-31.md`
  - 미읽음/불가: 스타트 게이트 나머지 4종 전문(코디네이터 TASK가 범위·금지선을 완결 지정한 dispatched 검수라 저장소 내 근거 우선 — NH94와 동일 관행)
  - 이번 작업 전용 파일: `src/feed/category-routing.js`, `category-policy.js`, `engine.js`(diff+tier 경로), `fetchers.js`, `selection-classifier-lab.js`(해시), `selection-axes.js`, `slot-canonical-edition.js`, `shadow-selection.js`(diff), `digest.js`(diff), `edition-candidates.js`(diff), `tools/build-category-routing-snapshot.mjs`, `tools/build-slot-canonical-edition.mjs`, `tools/prepare-selection-shadow.mjs`, git diff 전량
- 적용한 규칙: 13 First Principles 게이트, 수정·개발 범위 법칙(read-only 준수·최소 범위 권고), 이익 우선·default-GO(방향 GO, 구체 결함만 TWEAK)
- First Principles 게이트: PASS
- 금지선 준수: 코드 수정·테스트 실행·유료 호출·포인터 활성·커밋·배포 없음. 본 보고서 신규 파일 1건만 생성(NH91·NH94 선례).
- David 행동 필요 여부: 있음 — ① P0-1(RSS/Atom 근거 이번 라운드 제외) 채택 여부 ② P0-2 블루프린트 truth 개정 승인 ③ P1-3 shortlist 지출 규모(무과금 영수증 확인 후)
- Telegram 알림 필요 여부: 코디네이터 판단 위임
- 이익 우선·과잉방어 점검: RSS 파서+매핑 신규 서브시스템 제외 권고는 기능 축소가 아니라 shortlist와 중복되는 지출·유지비 제거. 결정적 선언 근거 채택으로 무과금 공급을 늘리는 방향은 GO.
- 하지 않은 일: npm test, 무과금 재생 실측, communities.json 137행 전수 재감사(NH94 수치 인용), 코드 수정
