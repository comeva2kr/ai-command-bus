# 맛집 통합 커뮤니티 (Restaurant Discovery Platform)

여러 소스(SNS·유튜브·네이버·커뮤니티)에서 맛집 언급을 모아 **광고/협찬을 자동
제외**하고, 교차검증된 맛집만 남긴 뒤, **위치 + 생활밀착 다중조건**으로 필터링해
보여주는 검색 엔진과 웹 UI입니다. 의존성 없이 순수 Node로 동작합니다.

## 실행

```bash
npm test          # 엔진 + 3가지 예시 쿼리 검증
npm run eats      # http://localhost:4173 웹 UI + API
```

## 파이프라인

```text
raw multi-source mentions
  → ingest/verify   (광고·협찬 탐지 후 제외 + 교차검증 점수화)
  → geo gate        (반경 / 이동시간 / "OO 근처" 랜드마크)
  → multi-filter    (스타일·음식·메뉴·태그·편의·가격 다중 AND)
  → rank            (검증도·평점·선호일치·근접도 블렌딩)
```

| 모듈 | 역할 |
| --- | --- |
| `src/restaurants/ingest.js` | 광고/협찬 탐지(`협찬`, `제공받아`, `#광고`, `sponsored`…), 플랫폼 교차검증 → `verificationScore`(0–100), `verified` |
| `src/restaurants/geo.js` | 하버사인 거리, 이동시간 추정, `travelBudgetToRadiusKm`(차로 N분→반경), 랜드마크 좌표 |
| `src/restaurants/taxonomy.js` | 스타일·음식·태그·**메뉴·메뉴특성** 동의어 정규화(`고기집→고깃집`, `살아있는→활`) |
| `src/restaurants/filter.js` | 하드조건(제외) + 소프트선호(가점) 다중조건 필터 |
| `src/restaurants/query.js` | 검증→지오→필터→랭킹 결합 `search()` |
| `src/restaurants/server.js` | 무의존성 HTTP API + 정적 프론트엔드 |

## 검증 · 광고 제외

맛집 신뢰도는 **협찬 아닌 자발적 언급이 여러 플랫폼에 걸쳐 있을 때** 부여됩니다.

- 협찬/광고 마커가 있는 언급은 계산에서 제외되고, 카드에 `🚫 광고 N건 제외`로 표기
- `verified = (독립 플랫폼 ≥ 2) AND (유기적 신뢰가중치 ≥ 임계) AND (광고비율 ≤ 0.6)`
- 기본적으로 미검증 업소는 결과에서 빠짐 (`includeUnverified: true`로 포함 가능)

## 위치 필터

- 내 좌표(`location: {lat,lng}`) 또는 `location: {near: "세종"}` 랜드마크 기준
- `radiusKm` 직접 지정, 또는 `travel: {mode:"car", minutes:30}` → 반경 자동 변환
- 결과마다 `distanceKm` / `travelMinutes` 표시
- 이동시간은 블렌딩된 평균속도 모델(도심+간선)입니다. 실서비스에서는 라우팅/ETA API로 교체하는 지점입니다.

## 다중조건 필터

| 필드 | 의미 |
| --- | --- |
| `styles` / `cuisines` | 장소 스타일 / 음식 종류 |
| `menu` + `menuAttrs` | 메뉴 단위 검색 (예: `고등어회` + `["활"]` = 살아있는 고등어회) |
| `tagsAll` / `tagsAny` / `excludeTags` | 분위기·특성 태그 (필수 / 하나이상 / 제외) |
| `require` | 필수 편의 (`{kidsCafe:true, partition:true}`) |
| `excludeFranchise` | 프랜차이즈 제외 |
| `priceMin`~`priceMax` | 가격대(₩1–4) |
| `prefer` / `preferFeatures` | 소프트 선호 — 있으면 순위 가점 |

## 예시 쿼리 (프리셋 제공)

**A. 프랜차이즈 아닌 뒷고기 고깃집 + 키즈카페**
```json
{ "styles":["고깃집"], "cuisines":["돼지고기"], "excludeFranchise":true,
  "require":{"kidsCafe":true}, "prefer":["뒷고기"] }
```

**B. 이자카야 · 숙성회 · 싼 분위기 아님 · 파티션 선호**
```json
{ "styles":["이자카야"], "tagsAll":["숙성회"], "excludeTags":["가성비"],
  "prefer":["고급스러운"], "preferFeatures":{"partition":true}, "priceMin":2 }
```

**C. 세종 인근 · 차로 30분 · 활(살아있는)고등어회**
```json
{ "location":{"near":"세종"}, "travel":{"mode":"car","minutes":30},
  "menu":"고등어회", "menuAttrs":["활"] }
```

## API

- `GET /api/meta` — 랜드마크·스타일·음식·태그·메뉴·편의·프리셋 목록
- `POST /api/search` — 본문에 쿼리 JSON → `{ meta, results }`
- `GET /api/preset?name=kids-pork|izakaya-aged|sejong-mackerel`

## 데이터

`src/restaurants/data/seed.js`는 검증/광고 시나리오를 담은 샘플입니다. 실제
서비스에서는 이 자리에 각 플랫폼 커넥터(네이버 플레이스/블로그, 유튜브,
인스타그램, 지역 커뮤니티)가 수집한 원시 언급이 들어갑니다.
