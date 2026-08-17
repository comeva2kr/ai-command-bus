// 하루특가류 광고 품질 사전 — 동결 (David 승인 S2-1, 2026-08-17).
//
// 실측 근거: 3일 shadow 관찰(11슬롯, .nowhot-local/shadow-observation/pool-*,
// 제목 10,020종)에서 하루특가류 광고 47건이 품질 게이트를 전부 통과했고,
// 그중 3건이 유머판에 실선별됐다(receipts 실물 — 아래 픽스처).
// 원인: 기존 "가격형 특가 광고" 패턴은 제목 첫머리 "특가"만 보고, isDeal은
// 가격 표기를 요구해 "하루특가) 상품명, 규격, 수량" 꼴이 둘 다 비켜 갔다.
//
// 여기 픽스처는 전부 관찰 풀·수집 풀의 실물 제목이다. 지어낸 제목은
// 반례(오탐 방지) 쪽에만 있고 그렇게 표시했다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lowValueReason, isLowValue } from "../src/feed/promotion.js";

// ── 실선별 3건 (receipts-2026-08-14-morning / receipts-2026-08-17-morning, default 콤보)
const SELECTED_REAL_ADS = [
  "하루특가) CJ제일제당 고메 바삭튀겨낸 돈카츠 통등심 + 모짜렐라, 450g, 1세트", // 08-14 아침 9위
  "하루특가) 유니맥스 벅스 킬러 해충 퇴치기 UMK-08K, 블랙, 1개",               // 08-17 아침 2위
  "하루특가) 가이타이너 무동력 스핀형 물걸레 청소기, GTL-RM1, 화이트, 1개"      // 08-17 아침 9위
];

test("실선별됐던 하루특가 광고 3건(실물)은 이제 저가치로 판별된다", () => {
  for (const title of SELECTED_REAL_ADS) {
    assert.equal(lowValueReason(title), "특가 라벨 광고", title);
  }
});

test("접두 라벨 변형(실물)도 같은 사유로 잡힌다", () => {
  const variants = [
    // etoland — 관찰 풀 실물
    "26년 첫출하 특가) 차돌복숭아, 11-12과, 2kg, 1박스",
    "15일 하루 특가) 크리넥스 마이비데 클린케어 화장실용 물티슈, 리필형, 40매, 16팩",
    // ppomppu — 관찰 풀 실물 (대괄호 말머리)
    "[선착코드특가]GMKtec M8 6650H($149), K12($190), FIREBAT F1 H255($327), GMKtec...",
    "[특가]26년형 전자식비데 코나에코홈(8.2만) 이누스 비데(11.8만) GMKtec G3S($105)/무료",
    // ibabynews — 관찰 풀 실물 (협찬성 보도가 특가 말머리를 단 경우)
    "[오늘의 특가] 믹순, ‘네고왕’ 프로모션 진행… 최대 82% 할인 혜택 선봬",
    // feed-data-pool 실물 — 2026-08-13 수집, David HOLD 결함 3의 표본
    "하루특가) 온작 이영자의 뼈없는 갈비탕, 특사이즈, 24인분, 900g, 8개",
    "토스콜라보 최초특가) 라오메뜨 전설의패치, 프리미엄 미니, 60매, 1개"
  ];
  for (const title of variants) {
    assert.equal(lowValueReason(title), "특가 라벨 광고", title);
  }
});

test("특가 직후 괄호 가격(딜 게시판 실물)은 가격 병기 광고로 잡힌다", () => {
  // ppomppu-deal 실물 — 접두 라벨이 아니라 "특가 (가격원)" 꼴
  assert.equal(lowValueReason("지센 여름 원피스 특가 (29,900원~/무료)"), "특가 가격 병기 광고");
});

test("오탐 0 — '특가'를 다루는 정상 제목은 걸리지 않는다", () => {
  // 관찰 풀 11슬롯 제목 10,020종 전수에서 새 두 패턴의 오탐은 0이었다
  // (걸린 45건 전부 판매 글). 풀에는 '특가'를 다루는 정상 기사가 없었으므로
  // 아래 반례는 그 꼴을 지어낸 합성 제목이다(합성임을 명시).
  const normals = [
    "특가 논란에 소비자단체 반발",                       // 합성 — 문장 첫머리 '특가'
    "이마트, 반값 특가 행사 논란 확산",                   // 합성 — 문장 속 '특가'
    "“역대급 특가” 미끼 광고 무더기 적발",       // 합성 — 인용부호 '특가'
    "홈쇼핑 특가 방송 중단… 방심위 제재",                 // 합성 — 라벨 아닌 보도
    "하루 만에 끝난 특가 경쟁, 남은 것은",                // 합성 — '하루'와 '특가' 분리
    "尹 구속"                                            // 실물 유형 — 짧은 진짜 뉴스 회귀
  ];
  for (const title of normals) {
    assert.equal(lowValueReason(title), null, title);
    assert.equal(isLowValue(title), false, title);
  }
});
