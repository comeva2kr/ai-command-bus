// 승격 제외 — 피드에는 두되, 우리 이름으로 발행하는 자리에는 올리지 않는다.
//
// ── 왜 (2026-08-04 적대적 검수 3인)
// 자체 콘텐츠 페이지의 대표 글로 이런 것들이 올라와 있었다:
//   "300추 가능한가요?"                    → 브리핑 6대 이슈 3위
//   "실시간 세르카 나메 2관 파티모집창"      → 화제 랭킹 2위
// 둘 다 그 커뮤니티 안에서는 반응이 크지만 **바깥 사람에게는 읽을 것이 없다.**
// 이런 글이 대표 자리에 있으면 심사관에게는 "콘텐츠가 지나치게 부족하여
// 유의미한 소비가 발생하지 않는 매체"로 읽히고, 처음 온 사람에게는 그냥
// 이상한 사이트로 읽힌다.
//
// ── 원칙: 삭제가 아니라 승격 제외
// David의 지시는 일관되게 "삭제 금지, 태그 후 게이트"다. 커뮤니티에서 반응이
// 컸다는 사실 자체는 데이터이므로 **피드에서는 그대로 보인다.** 다만
// 브리핑·랭킹처럼 우리가 "오늘의 대표"라고 이름 붙이는 자리에는 올리지 않는다.
// 트래픽 손실 0, 리스크만 제거하는 경로다.
//
// ── 원칙: 못 하는 것은 하는 척하지 않는다
// 검수는 "청계천에서 흡연하는 중국인", "여경 불안하다고 말하는 남자들…" 같은
// 국적·성별 갈등 유발 제목도 지적했다. 그런데 이건 **정규식으로 판별할 수
// 없다.** "중국인"이 들어갔다고 막으면 정상 뉴스가 통째로 죽고, 안 막으면
// 그대로 나간다. 어설픈 의미 판별은 오탐으로 피드를 망가뜨린다.
//
// 그래서 두 층으로 나눈다:
//   lowValue  — **형식**으로 판별 가능한 것만. 추천 구걸·모집글 등.
//               랭킹·브리핑 대표 자리에서 제외한다.
//   adUnsafe  — 광고를 **바로 옆에** 붙이지 않을 것. 비속어·성인·정치/종교처럼
//               이미 태그가 붙어 있는 신호만 쓴다. 여기서도 글을 지우지 않는다.
//
// 의미 판별이 필요한 영역(혐오·차별)은 규칙이 아니라 사람이나 모델의 판단이
// 필요하다 — 지금 없는 것을 있는 척하지 않고, 대신 그 글 옆에 광고를 두지
// 않는 것으로 실제 리스크(광고주 브랜드 안전)만 막는다.
import { hasProfanity } from "./profanity.js";

// 형식으로 판별되는 저가치 패턴. 각 항목은 "왜 이게 바깥 사람에게 읽을 것이
// 없는가"로 설명될 수 있어야 한다. 애매하면 넣지 않는다 — 오탐 하나가
// 정상 글을 대표 자리에서 밀어낸다.
export const LOW_VALUE_PATTERNS = [
  // 추천 구걸: 글 내용이 아니라 그 게시판의 추천 수치 자체가 목적인 글
  { re: /\d+\s*추\s*(가능|가나|가즈|고고|채워|모아|찍)/, why: "추천 구걸" },
  { re: /추천\s*(좀|한번|부탁)\s*(해|주|드)/, why: "추천 구걸" },
  // 모집: 그 커뮤니티 이용자만 참여할 수 있는 공지
  { re: /(파티|길드|클랜|공대|스터디|팀원|인원)\s*모집/, why: "모집 공고" },
  { re: /모집\s*(창|글|합니다|중)/, why: "모집 공고" },
  // 출석·인증 놀이: 반응은 크지만 읽을 내용이 없다
  { re: /^(출석|출첵|인증)\s*/, why: "출석·인증" },
  // 테스트·삭제 예정 글
  { re: /^(테스트|test)\s*\d*$/i, why: "테스트 글" }
];

// 제목이 저가치 형식인가. 이유를 함께 돌려준다 — 관리자 화면에서 "왜 빠졌나"를
// 볼 수 있어야 규칙을 고칠 수 있다.
export function lowValueReason(title) {
  const t = String(title || "").trim();
  if (!t) return "제목 없음";
  // 너무 짧은 제목은 그 자체로 정보가 없다. 다만 한국어 제목은 짧아도
  // 내용이 있는 경우가 많아 기준을 낮게 잡는다.
  if (t.length < 6) return "제목이 너무 짧다";
  for (const { re, why } of LOW_VALUE_PATTERNS) if (re.test(t)) return why;
  return null;
}

export const isLowValue = (title) => lowValueReason(title) !== null;

// 이 글 **옆에** 광고를 붙여도 되는가. 글 자체를 막는 게 아니다.
// 이미 붙어 있는 태그만 쓴다 — 새로 의미를 판별하려 들지 않는다.
export function adUnsafe(item) {
  if (!item) return false;
  if (item.adult) return true;
  const topics = Array.isArray(item.topics) ? item.topics : [];
  if (topics.includes("politics") || topics.includes("religion")) return true;
  if (hasProfanity(item.title)) return true;
  return false;
}

// 우리 이름으로 발행하는 자리(브리핑·랭킹 대표)에 올려도 되는가.
export function promotable(item) {
  if (!item) return false;
  if (item.adult) return false;
  if (hasProfanity(item.title)) return false;
  if (isLowValue(item.title)) return false;
  return true;
}
