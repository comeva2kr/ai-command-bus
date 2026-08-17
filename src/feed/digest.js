import { WEIGHTY } from "./interest.js";
// 브리핑 본문 생성 — 항목 나열이 아니라 "오늘 무슨 일이 있었는지 읽는 글".
//
// ── 왜 바꿨나 (2026-08-03)
// 카카오 애드핏 매체심사 보류 사유가 "자체 콘텐츠가 아닌 외부 콘텐츠·외부 링크가
// 많은 비중"이었다. 그 답으로 만든 것이 브리핑인데, 실물은 카테고리마다 똑같은
// 템플릿 한 줄("○○ 분야에서 가장 뜨거운 글은 …입니다") + 원문 발췌였다.
// 라이브 실측에서는 발췌 자리에 원문 URL과 영어 원문이 그대로 실리고 있었다:
//   "https://xcancel.com/karpathy/status/2083749667410727319"
//   "Qwen Studio offers comprehensive functionality spanning chatbot, …"
// 외부 콘텐츠 비중을 우리 손으로 증명하고 있던 셈이다.
//
// 구글 프로그램 정책은 "논평·큐레이션·기타 부가가치를 더하면 복제 콘텐츠가
// 아니다"라고 명시한다. 그 부가가치를 실제로 만드는 것이 이 파일의 일이다.
//
// ── 설계 원칙
// 1. **원문 문장을 한 줄도 쓰지 않는다.** 우리가 쓰는 문장의 재료는 오직 우리가
//    측정한 값이다 — 몇 개 매체가 함께 다뤘는지, 추천/댓글이 몇인지, 어느
//    커뮤니티에서 나왔는지, 몇 시간 만에 올라왔는지. 이건 원문 어디에도 없는
//    지금핫 고유 정보다. 제목은 인용부호 안에 넣어 출처를 밝히고 쓴다.
// 2. **없는 사실을 만들지 않는다.** 실측이 0인 지표는 문장에서 아예 뺀다.
//    "추천 0·댓글 86을 모으며 화제의 중심"은 자기모순이다(2026-07-31 검수 지적).
// 3. **한 템플릿을 반복하지 않는다.** 데이터의 모양이 다르면 문장도 달라야 한다 —
//    교차보도형·논쟁형·호응형·단독형으로 갈린다. 같은 문장이 열 번 반복되는 것이
//    애초에 "자체 콘텐츠로 안 보인다"는 판정을 받은 이유다.
// 4. LLM을 부르지 않는다. 아이템당 API 호출은 이 프로젝트의 제약을 벗어나고,
//    무엇보다 측정값에서 결정적으로 유도된 문장이라야 매번 같은 입력에 같은
//    글이 나온다(재현 가능·검증 가능).
import { canonicalContentUrl, eventKey, sharedTitleConcepts } from "./dedupe.js";
import {
  assessEditorialDraft,
  coverageEvidence,
  subjectQuality
} from "./editorial-quality.js";
import { buildSourceEvidence } from "./editorial-lineage.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";
import { composeEventFromMembers, decideEventMerge } from "./event-cluster.js";
import { loadRegistry } from "./registry.js";

// 해외발(국내 미보도) 판정 — David #과업3, 2026-08-17: "판별은 소스 레지스트리
// country 필드 실코드 확인". 구성원(보도) 기사 **전부**가 해외 소스일 때만
// 해외발이다 — 국내 매체가 하나라도 섞이면 이미 국내 보도다. 레지스트리는
// 정적 communities.json이라 1회만 읽어 재사용한다(테스트 픽스처의 가상 소스
// id는 등록부에 없으므로 조용히 "해외 아님"으로 떨어진다 — 회귀 없음).
let overseasSourceIdsCache = null;
function overseasSourceIds() {
  if (!overseasSourceIdsCache) {
    overseasSourceIdsCache = new Set(
      loadRegistry().filter((entry) => entry && entry.country && entry.country !== "KR").map((entry) => entry.id)
    );
  }
  return overseasSourceIdsCache;
}
function membersAllOverseas(members) {
  if (!members || !members.length) return false;
  const overseas = overseasSourceIds();
  return members.every((item) => overseas.has(item && item.source));
}

// ---------------------------------------------------------------------------
// 이슈 묶기 — 같은 사건을 다룬 글들을 한 덩어리로
// ---------------------------------------------------------------------------

// 한 문단으로 합치는 기준은 보수적으로 잡는다. 정규화 제목이 완전히 같거나
// 추적 파라미터를 걷은 원문 URL이 같을 때만 같은 사건으로 확정한다. 태그와
// 부분 제목 유사도는 주제만 같고 사건은 다른 글까지 합칠 수 있으므로 여기서
// 쓰지 않는다. 비슷한 제목의 화면 중복은 아래 dedupeNearIssues에서 따로 막는다.
export function clusterIssues(items) {
  const enriched = items.map((i) => ({
    item: i,
    key: eventKey(i.title),
    canonicalUrl: canonicalContentUrl(i.url)
  }));
  const clusters = [];
  for (const e of enriched) {
    let placed = null;
    for (const c of clusters) {
      const same = c.members.some(
        (m) => (m.key && m.key === e.key)
          || (m.canonicalUrl && m.canonicalUrl === e.canonicalUrl)
      );
      if (same) { placed = c; break; }
    }
    if (placed) placed.members.push(e);
    else clusters.push({ members: [e] });
  }
  return clusters.map((c) => c.members.map((m) => m.item));
}

// 이슈 간 근접 중복 제거 — clusterIssues가 못 묶은 제목 변주가
// 변주 헤드라인이 서로 다른 클러스터로 각각 이슈 자리를 차지하는 것을 막는다.
// 실측(2026-08-09): "채상병 순직 책임 임성근" 변주 4건이 이 문제로 이슈
// 6건 중 4건을 차지했다(아래 buildDigest 실측 참고).
//
// clusterIssues 자체는 건드리지 않는다 — 거긴 완전일치 제목·원문 URL로만 묶어야
// 문단 안에 서로 다른 사실이 섞이지 않는다(그 파일 상단 주석). 여기는
// "어느 클러스터를 이슈로 뽑을지" 고르는 단계라 위험이 다르다 — 잘못
// 걸러도 그 클러스터가 사라지는 게 아니라 다음 순위 클러스터가 그 자리를
// 메운다.
//
// 클러스터 하나 안에서도 여러 클러스터와 겹칠 수 있으므로(A~B 3단어,
// B~C 3단어처럼 사슬로 이어지는 경우) 그룹의 대표(첫 멤버)만이 아니라
// 그룹에 이미 들어간 멤버 전체와 비교한다 — clusterIssues가 `c.members.some`
// 으로 같은 일을 하는 것과 같은 방식이다.
const NEAR_DUP_CONCEPTS = 3; // 실제 새 판의 트럼프·이란 배상과 축구협회 성접대
// 변주는 조사·활용형을 접으면 각각 개념 3개가 겹쳤다. 영어 불용어는 세지 않는다.
const STRONG_EVENT_CONCEPTS = new Set(["지진"]);
const DISTINCTIVE_ENTITY_MIN_LENGTH = 3;

// 숫자 충돌 가드(event-cluster.js decideEventMerge의 guard_numbers_only_overlap
// 원리 재사용, David 승인 2026-08-17 — "오병합 가드"). 서로 다른 분야 병합은
// 숫자 하나와 통계 서술어(사건을 특정하지 못하는 범용 수식어)만 겹쳐도 되면
// 안 된다 — 오병합 사례("에볼라 사망자 2,300명" vs "호우 피해신고 2,300건")는
// 핵심 주제어 없이 이 서술어들과 숫자만 우연히 같아 병합됐다. 목록은
// STRONG_EVENT_CONCEPTS와 같은 원칙으로 최소·보수적으로만 둔다(넓히는
// 방향이 아니라 병합을 줄이는 방향).
const STATISTICAL_FILLER_CONCEPTS = new Set([
  "기록적", "증가", "감소", "급증", "급감", "발생", "넘어서", "이상", "이하", "달해", "기록", "집계"
]);

export function nearIssueGroups(scored) {
  const groups = [];
  for (const c of scored) {
    const title = c.members[0].title;
    const categories = new Set(c.members.map((item) => item.category || "news"));
    const hit = groups.find((g) => g.some((m) => {
      const sameCategory = m.members.some((item) => categories.has(item.category || "news"));
      const sharedConcepts = sharedTitleConcepts(title, m.members[0].title);
      if (sameCategory && sharedConcepts.length >= NEAR_DUP_CONCEPTS) return true;

      // 한 매체가 같은 사건을 여러 각도로 연속 발행하면 제목 변주는 두 핵심어만
      // 겹칠 수 있다. 실제 낮판에서 한겨레의 "호남 반도체 클러스터"와
      // "호남 반도체 전격전"이 기술 세 자리 중 두 자리를 차지했다. 출처와
      // 분야가 모두 같을 때만 문턱을 2로 낮춰, 다른 매체의 독립 후속 보도나
      // 일반어 하나만 같은 별개 사건은 보존한다.
      const source = operationalSourceIdentity(c.members[0]);
      const previousSource = operationalSourceIdentity(m.members[0]);
      const sameOperationalSource = source.ownershipGroup === previousSource.ownershipGroup;
      const bothCommunity = c.members.every((item) => sourceRoleOf(item) === "community_signal")
        && m.members.every((item) => sourceRoleOf(item) === "community_signal");
      const hasRelatedCoverageSignal = (cluster) => Math.max(
        ...cluster.members.map((item) => Number(item.coverage) || 0), 0
      ) >= 3;
      const bothRelated = hasRelatedCoverageSignal(c) && hasRelatedCoverageSignal(m);
      if (sameCategory && bothRelated && sharedConcepts.length >= 2
          && sharedConcepts.some((concept) => STRONG_EVENT_CONCEPTS.has(concept))) return true;
      // 서로 다른 매체라도 같은 긴 고유명사와 같은 흐름어가 함께 겹치면 한 판에서
      // 하나만 대표한다. 긴 이름 하나만 같은 별개 사건은 그대로 보존한다.
      if (sameCategory && bothRelated && sharedConcepts.length >= 2
          && sharedConcepts.some((concept) => /^[가-힣]+$/.test(concept)
            && concept.length >= DISTINCTIVE_ENTITY_MIN_LENGTH)) return true;
      if (sameCategory && sameOperationalSource && bothCommunity && sharedConcepts.length >= 2) return true;
      if (sameCategory && sameOperationalSource && sharedConcepts.length >= 2 && bothRelated) return true;

      // 서로 다른 지면 라벨(news/politics)로 들어온 동일 사건은 핵심 내용어와
      // 같은 큰 수치가 함께 맞을 때만 접는다. 인물만 같은 별개 후속 보도는 남긴다.
      // 숫자 충돌 가드: 숫자·통계 서술어를 뺀 실제 주제어가 최소 1개는 겹쳐야
      // 한다 — 그렇지 않으면 서로 다른 사건이 숫자만 우연히 같아 병합된다
      // (guard_numbers_only_overlap 원리, 강결합 canonicalUrl·eventKey가 아닌
      // 이 휴리스틱 병합은 이 조건 없이는 숫자 우연 일치를 막지 못한다).
      const topicalBridge = sharedConcepts.filter((concept) =>
        !concept.startsWith("num:") && !STATISTICAL_FILLER_CONCEPTS.has(concept));
      return !sameCategory && bothRelated && sharedConcepts.length >= NEAR_DUP_CONCEPTS
        && sharedConcepts.some((concept) => concept.startsWith("num:"))
        && topicalBridge.length > 0;
    }));
    if (hit) hit.push(c); else groups.push([c]);
  }
  return groups;
}

// 기존 호출 계약 유지 — 대표만 필요할 때. scored는 weight 내림차순이라
// 그룹의 첫 멤버가 대표다. P1-B부터 buildDigest는 그룹 전체를 받아 병합된
// 클러스터의 기사를 근거로 보존한다(첫 건만 남기고 버리지 않는다).
export function dedupeNearIssues(scored) {
  return nearIssueGroups(scored).map((g) => g[0]);
}

// 사건 2단 판정(event-cluster.js)으로 근접 휴리스틱이 못 잡은 동일 사건을
// 추가 병합한다. 판 편성에서는 **강한 결합(canonicalUrl·eventKey — 표본 5
// 중계 재유통)과 한/영 결합(표본 1)만** 쓴다. 한/한 내용어 결합은 위
// nearIssueGroups의 실측 검증된 휴리스틱이 담당한다 — 사전·형태소 없이
// 일반 명사 겹침만으로 판을 접으면 서로 다른 사건이 오병합되는 것이 표본
// 밖 픽스처에서 확인됐다(오병합은 미병합보다 나쁜 실패). 그룹을 나누는
// 일은 없다(병합만 추가).
const editionMergeDecision = (a, b) => {
  const decision = decideEventMerge(a, b);
  return decision.merge && (decision.mode === "strong" || decision.crossLanguage);
};

function mergeGroupsByEventDecision(groups) {
  const merged = [];
  for (const group of groups) {
    const hit = merged.find((existing) => existing.some((prevCluster) =>
      group.some((cluster) => cluster.members.some((item) =>
        prevCluster.members.some((prevItem) => editionMergeDecision(prevItem, item))))));
    if (hit) hit.push(...group); else merged.push([...group]);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 측정값 → 문장
// ---------------------------------------------------------------------------

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, "")}만`;
  return String(v);
};

// 과학은 화제성만으로 대표 이슈를 세우면 농담·추측성 커뮤니티 글이 연구 보도보다
// 앞설 수 있다. 커뮤니티 신호는 유지하되 보도·공식 근거가 있는 이슈를 먼저 둔다.
const EDITORIAL_WEIGHTY = new Set([...WEIGHTY, "realestate", "science"]);
const VERIFIED_SOURCE_ROLES = new Set(["primary", "reported_secondary", "first_party"]);
const VERIFIED_SOURCE_BONUS = 90;

function sourceRoleOf(item) {
  const role = item && item.editorialCandidate && item.editorialCandidate.sourceRole;
  if (role) return role;
  if (item && item.kind === "news") return "reported_secondary";
  if (item && item.kind === "community") return "community_signal";
  if (item && (item.via === "me" || item.via === "ourdeal")) return "first_party";
  return "unknown";
}

function sourceRoleCounts(items) {
  const counts = {};
  for (const item of items || []) {
    const role = sourceRoleOf(item);
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

// 이 묶음의 성격을 데이터 모양으로 판정한다. 문장 형태가 여기서 갈린다.
export function issueShape(items) {
  const evidence = coverageEvidence(items);
  const coverage = Math.max(...items.map((i) => i.coverage || 0), 0);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  if (coverage >= 3 || evidence.independentGroupCount >= 2) return "coverage";
  // 매체가 하나뿐이어도 지금 사람들이 몰려 찾아보는 사안이면 그게 이유다.
  if (items.some((i) => i.interest && i.interest.how === "term")) return "interest";
  if (comments >= 100 && comments > score) return "debate"; // 댓글이 추천을 앞선다
  if (score >= 100) return "applause";                     // 추천이 크다
  return "single";
}

// 이슈 제목 — 원문 제목을 그대로 쓰지 않는다. 대표 글 제목은 본문 안에서
// 인용부호로 밝히고, 헤드라인은 우리가 관측한 것을 요약한 한 줄로 만든다.
// (Techmeme이 아웃링크 집합을 자체 저작물로 만드는 방식과 같은 원리다.)
// 이 이슈를 무엇이라 부를 것인가. 묶인 글들의 제목에서 **가장 여러 편이
// 함께 쓴 낱말**을 고른다. 우리가 요약해서 지어낸 말이 아니라, 매체들이
// 그 사건을 부를 때 실제로 쓴 말이라 사실에서 벗어날 여지가 없다.
// 한 편에만 나오는 낱말은 그 매체의 표현일 뿐이므로 쓰지 않는다.
export function issueSubject(items, { max = 2 } = {}) {
  const count = new Map();
  const generic = new Set(["관련", "기사", "뉴스", "보도", "소식", "출처의", "관측"]);
  for (const i of items) {
    const seen = new Set();
    for (const w of String(i.title || "").split(/[^가-힣a-zA-Z0-9]+/)) {
      if (w.length < 2 || generic.has(w)) continue;
      if (seen.has(w)) continue;      // 한 제목 안의 반복은 한 번만 센다
      seen.add(w);
      count.set(w, (count.get(w) || 0) + 1);
    }
  }
  // 같은 제목이 여러 수집 경로에서 중복 관측된 경우 공통어 두 개를 다시
  // 조합하면 원문에 없던 파편이 된다. 실제로
  // "[뉴욕증시] 유가 급등에 숨 고르며 CPI 경계…"가 "뉴욕증시 급등에"로
  // 축약됐다. 수집된 원제목이 전부 같으면 원래 앞 구절을 그대로 사용한다.
  // 짧은 제목은 eventKey가 비어도 서로 다른 제목이면 공통어를 뽑아야 한다.
  const normalizedTitles = new Set(items
    .map((item) => String(item && item.title || "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean));
  const shared = normalizedTitles.size > 1 ? [...count.entries()]
    .filter(([, n]) => n >= 2)        // 최소 두 편이 함께 쓴 말
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w) : [];
  if (shared.length) {
    const subject = cleanIssueSubject(shared.join(" "));
    // 여러 중계 피드가 같은 클릭 유도형 앞구절을 반복해도 그것을 사건명으로
    // 확정하지 않는다. 실측 런치판에서 세 매체의 공통어가
    // "55세에 없었더니"로 축약돼, 뒤의 치매·수명 정보가 사라졌다.
    if (subjectQuality(subject).pass && !VAGUE_OPENING_HOOK.test(subject)) return subject;
  }

  // 우리 풀에 그 사건 글이 하나뿐일 때 — 흔한 경우다. 교차보도 5건은 구글이
  // "관련 기사가 5개 있다"고 알려 준 숫자이지, 우리가 5편을 갖고 있다는 뜻이
  // 아니다. 그래서 공통어를 뽑을 대상이 없다.
  //
  // 이때는 그 매체가 쓴 제목에서 앞 구절을 따온다. 요약해서 지어내는 것보다
  // 낫다 — 우리가 만들어 낸 표현이면 사실에서 벗어날 수 있지만, 따온 말은
  // 그 매체가 실제로 쓴 말이다. 헤드라인 전체가 아니라 우리 문장 안에
  // 인용부호로 들어가므로 제목 나열과는 다르다.
  const first = cleanIssueSubject(leadPhrase(items[0] && items[0].title));
  if (subjectQuality(first).pass) return first;
  const extended = cleanIssueSubject(leadPhrase(items[0] && items[0].title, { max: 72 }));
  return subjectQuality(extended).pass ? extended : "";
}

function cleanIssueSubject(text) {
  return String(text || "")
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 실제 사건보다 반응을 먼저 내세운 제목만 뒤의 사실 구절로 교체한다.
// 따옴표 전체를 버리는 일반 규칙은 정상적인 직접 인용까지 훼손하므로,
// 실측된 모호한 훅 + 사건 동사를 모두 만족할 때만 작동한다.
const VAGUE_OPENING_HOOK = /(살지롱|줄\s*알았|맞나|불확실(?:해|하다|성)?|다\s*했(?:다|네|네요)|\d+\s*(?:초|분|시간)\s*만에.*(?:화염|불길).*|죽어서.*살려서|죽을\s*때까지|느니|이\s*\d+\s*가지|\d+세에\s+없었더니|네가\s*사는\s*그\s*집|감도\s*안|긴\s*휴식\s*끝\s*전력대결|새벽\s*\d+시부터.*대출런|폭탄\s*터진\s*듯.*건물\s*와르르|이유\s*있었네|논란\s*일자.*(?:멈춘|중단)|순풍에\s*돛\s*단.*덕|요즘\s+.+핫하네|사후\s*치료\s*넘어\s*조기\s*개입|계속\s*웃기면\s*(?:드라마|코미디)|^(?:상승률|하락률|증가율|감소율|수익률|점유율|성장률)\s*[-+]?\d+(?:\.\d+)?%$|^(?:혈압|혈당|금연)(?:[·,\s]+(?:혈압|혈당|금연)){1,}$)/i;
const INFORMATIVE_EVENT_TAIL = /(확산|화재|긴급\s*방류|언쟁|발언|발표|체포|구속|기소|판결|사망|실종|대피|출시|공개|착수|조사|수사|급등|급락|반등|상승|하락|붕괴|침수|파업|합의|통과|부결|당선|사퇴|해임|배치|충돌|폭발|지진|태풍|폭우|방침|결정|제재|공급|개편|수출|역대\s*(?:최대|최고)|실패|부동산\s*세제|대출총량제|연금|치매|생존|수명|가을야구|플레이오프|인공위성|연구진|발견|관측|실험|논문|모집|연기|돌파)/i;

function prefersInformativeTail(first, tail) {
  const firstClean = cleanIssueSubject(first);
  const tailClean = cleanIssueSubject(tail);
  return VAGUE_OPENING_HOOK.test(firstClean)
    && INFORMATIVE_EVENT_TAIL.test(tailClean)
    && subjectQuality(tailClean).pass;
}

// 제목의 앞 구절. 부제·인용이 시작되는 지점(…, —, [ ) 앞에서 자르고,
// 너무 길면 낱말 경계에서 끊는다. 억지로 자른 티가 나면 안 된다.
export function leadPhrase(title, { max = 72 } = {}) {
  let t = String(title || "").trim();
  if (!t) return "";
  // 말머리를 먼저 떼어 낸다 — "[속보]", "【단독】", "(종합)". 사건 이름이 아니라
  // 편집 표시다. 안 떼면 이름이 통째로 "속보"가 된다.
  // 실측: 라이브 이슈 6개 중 2개가 이 때문에 이름을 못 얻고
  // "5개 매체가 동시에 다룬 사안"으로 남았다.
  for (let n = 0; n < 3; n++) {
    const stripped = t.replace(/^\s*[[【(<][^\]】)>]{0,12}[\]】)>]\s*/, "");
    if (stripped === t) break;
    t = stripped;
  }
  // 그다음 부제가 시작되는 지점에서 자른다. 다만 첫 구절이 조사·연결어로
  // 끝나면 거기서 끊지 않는다. 뒤 구절까지 이어야 사건명이 문장이 된다.
  // 가운데점(·)은 사람·정당·상품명의 일부로 자주 쓰인다. 구분자로 자르면
  // "李·與 서울 지지율"이 "李" 한 글자로 붕괴한다.
  const parts = t.split(/[…|]|—|\.\.\.|·{2,}|\s-\s/).map((x) => x.trim()).filter(Boolean);
  t = parts[0] || "";
  const firstClean = tidyPhrase(t.replace(/^["“'‘\s]+/, "").replace(/["”'’\s]+$/, ""));
  if (parts.length > 1 && prefersInformativeTail(parts[0], parts[1])) {
    t = parts[1];
  } else if (parts.length > 1 && !subjectQuality(firstClean).checks.completeEnding) {
    t = `${parts[0]} ${parts[1]}`;
  }
  // 추출한 사건명은 우리 헤드라인에서 다시 인용한다. 원제목의 여러 인용부를
  // 이어 붙인 뒤 닫는 따옴표와 다음 여는 따옴표가 가짜 한 쌍으로 남지 않게 한다.
  t = t.replace(/[“”‘’"']/g, "")
    .replace(/\s*(?:\((?:종합|속보|영상|포토|사진)\)|\[(?:종합|속보|영상|포토|사진)\])\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    t = (sp >= 8 ? cut.slice(0, sp) : cut).trim();
  }
  return tidyPhrase(t);
}

// 잘라 온 구절을 우리 문장 안에 인용부호로 넣는다. 그래서 **짝이 안 맞는
// 따옴표가 남으면 안 된다** — 실측에서 이렇게 나왔다:
//   5개 매체가 다룬 “이 대통령 “북한과 대결, 정무적
// 열린 따옴표가 닫히지 않아 문장이 깨져 보인다. 꼬리 쉼표도 마찬가지다
// ("Bending Spoons,"). 잘라 낸 자리에 남은 부호는 말이 아니라 흔적이다.
export function tidyPhrase(text) {
  let t = String(text || "");
  const OPEN = /[“‘"']/g, CLOSE = /[”’"']/g;
  // 짝이 맞지 않으면 안쪽 따옴표를 통째로 없앤다. 어느 쪽이 짝인지 추측하는
  // 것보다 낫다 — 추측이 틀리면 뜻이 바뀐다.
  const opens = (t.match(/[“‘]/g) || []).length, closes = (t.match(/[”’]/g) || []).length;
  if (opens !== closes) t = t.replace(/[“”‘’]/g, "");
  const q = (t.match(/["']/g) || []).length;
  if (q % 2 === 1) t = t.replace(/["']/g, "");
  void OPEN; void CLOSE;
  // 잘린 자리에 남은 이음 부호
  return t.replace(/\.{2,}$/, "").replace(/[\s,·、:;\-–—]+$/, "").trim();
}

export function issueHeadline(items, shape, evidence = coverageEvidence(items), subject = issueSubject(items)) {
  const lead = items[0];
  const label = lead.sourceLabel || lead.source;
  const outlets = new Set(items.map((i) => i.sourceLabel || i.source)).size;
  const coverage = Math.max(...items.map((i) => i.coverage || 0), 0);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  // 헤드라인에 그 이슈를 구별하는 **측정값**을 넣는다. 넣지 않으면 같은 소스에서
  // 나온 별개 이슈가 "해커뉴스에서 크게 호응받은 글"로 똑같이 반복된다(실측).
  switch (shape) {
    case "coverage": {
      // 개수만 쓰면 **여섯 이슈가 전부 "5개 매체가 동시에 다룬 사안"**이 된다
      // (2026-08-05 라이브 실측). 구분이 안 되면 헤드라인이 아니다.
      // 무엇에 관한 것인지 함께 말한다 — 우리가 지어낸 말이 아니라 매체들이
      // 그 사건을 부를 때 실제로 함께 쓴 낱말이다.
      // **개수를 쓰지 않는다.** coverage는 구글뉴스 관련기사 목록의 길이인데
      // 그 목록에는 상한이 있다(fetchers.js COVERAGE_MAX = 5, 실측: 사실상 0 아니면 5).
      // 상한에 걸린 값을 "5개 매체"라는 정확한 수치인 양 말하면 거짓이 된다 —
      // editorial.js는 이미 같은 이유로 숫자를 버리고 "여러 곳"만 쓰기로 정해 뒀는데,
      // digest.js만 그 규칙 밖에 있었다.
      //
      // 실측(2026-08-06 라이브): 홈에 나간 이슈 6건이 **전부** "5개 매체가 다룬"이었고,
      // 그중에는 우리 피드에 단 한 곳(KBS뉴스)에서만 들어온 것도 있었다.
      // 하필 그 문장이 애드핏 재심사용 자체 콘텐츠의 맨 앞자리였다.
      void coverage;
      if (!subject) return "근거 확인이 필요한 보도 흐름";
      return evidence.mode === "multiple_feed_observed"
        ? `“${subject}” · 복수 수집 경로 확인`
        : `“${subject}” · 관련 보도 묶음 포착`;
    }
    case "interest": {
      const m = items.find((i) => i.interest && i.interest.how === "term").interest;
      return `“${m.term}” 검색과 함께 뜬 “${subject}”`;
    }
    case "debate":
      return `댓글 ${fmt(comments)}건이 붙은 “${subject}”`;
    case "applause":
      return `추천 ${fmt(score)}건을 모은 “${subject}”`;
    default:
      return comments > 0 ? `${label} 상위의 “${subject}” · 댓글 ${fmt(comments)}건`
                          : `${label} 상위의 “${subject}”`;
  }
}

// 매체 이름 목록. **개수를 세지 않는다.**
//
// 라이브 실측(2026-08-06): "우리 피드에는 donga.com·동아일보 등 2곳에서 들어왔다."
// 같은 신문사인데 한 소스는 도메인, 다른 소스는 한글 사명으로 라벨이 붙어 있어서
// 한 곳을 2곳으로 세고 있었다. 캡값 숫자를 걷어내면서 "우리가 센 것만 쓴다"고
// 해 놓고 정작 그 센 값이 부정확했던 것이다.
//
// 로마자(donga.com)와 한글(동아일보)은 **문자열로는 합칠 수 없다.** 억지로
// 합치려다 서로 다른 매체를 하나로 묶으면 더 나쁜 거짓말이 된다. 그래서
// 합치지 않고 **수를 안 쓴다** — 이름만 밝히면 세는 문제 자체가 사라진다.
// 표시에서 도메인 꼬리는 떼어 읽기 좋게만 다듬는다(같은 곳을 가리키는 값이다).
export function distinctOutlets(items) {
  const seen = new Set();
  const out = [];
  for (const i of items) {
    const raw = String(i.sourceLabel || i.source || "").trim();
    if (!raw) continue;
    const pretty = raw.replace(/\.(com|co\.kr|kr|net|org)$/i, "");
    if (seen.has(pretty)) continue;
    seen.add(pretty);
    out.push(pretty);
  }
  return out;
}

// 이슈 본문 — 전부 측정값으로만 쓴다. 0인 지표는 문장에서 뺀다.
export function issueParagraph(items, shape, evidence = coverageEvidence(items)) {
  const lead = items[0];
  const title = String(lead.title || "").trim();
  const outlets = distinctOutlets(items);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  const parts = [];

  if (shape === "coverage") {
    const named = [...new Set(
      (evidence.groups && evidence.groups.length ? evidence.groups.map((group) => group.label) : outlets)
    )].filter(Boolean).slice(0, 3).join("·");
    if (evidence.mode === "multiple_feed_observed") {
      parts.push(`서로 다른 수집 경로에서 “${title}” 보도를 확인했다. 직접 확인한 원문은 ${named}에서 들어왔다.`);
    } else {
      parts.push(`관련 보도 묶음 신호에서 “${title}” 보도를 포착했다. 지금핫 수집 풀에서 직접 확인한 원문은 ${named} 기사 한 건이다.`);
    }
    // 대표 글과 **같은 제목**은 빼고 소개한다. 라이브 실측(2026-08-06):
    // "같은 흐름에서 「與서울의원들, 오늘 부동산 세제 개편안 논의」도 상위에
    // 올랐다" — 바로 윗줄에서 소개한 그 글이었다. 같은 사건을 여러 매체가
    // 같은 제목으로 쓰면 이렇게 겹친다.
    const seenTitle = new Set([title]);
    const others = items.slice(1)
      .map((i) => String(i.title || "").trim())
      .filter((t) => t && !seenTitle.has(t) && (seenTitle.add(t), true))
      .slice(0, 2)
      .map((t) => `“${t}”`)
      .join(", ");
    if (others) parts.push(`같은 흐름에서 ${others}도 상위에 올랐다.`);
  } else if (shape === "debate") {
    parts.push(`${outlets[0]}의 “${title}” 게시물에 댓글 ${fmt(comments)}건이 달리며 논쟁이 이어졌다.`);
    if (score > 0) parts.push(`추천은 ${fmt(score)}건으로 댓글 수에 못 미친다 — 합의보다 이견이 큰 주제다.`);
    else parts.push(`추천보다 댓글이 앞서는 전형적인 논쟁형 흐름이다.`);
  } else if (shape === "applause") {
    parts.push(`${outlets[0]}의 “${title}” 게시물이 추천 ${fmt(score)}건을 모았다.`);
    if (comments > 0) parts.push(`댓글은 ${fmt(comments)}건이다.`);
  } else {
    parts.push(`${outlets[0]} 상위 목록에 “${title}” 제목이 올라 있다.`);
    if (comments > 0) parts.push(`댓글 ${fmt(comments)}건이 달렸다.`);
    else if (score > 0) parts.push(`추천 ${fmt(score)}건을 받았다.`);
  }
  if (items.length > 2 && shape !== "coverage") {
    parts.push(`같은 주제로 ${items.length}건이 함께 올라왔다.`);
  }
  return parts.join(" ");
}

// 감정/성격 태그 — 라벨도 측정값에서 나온다(감정 분석이 아니다).
export function issueTone(shape, evidence = null) {
  if (shape === "coverage") {
    return evidence && evidence.mode === "multiple_feed_observed" ? "운영그룹 교차 관측" : "관련 보도";
  }
  return { debate: "논쟁", applause: "호응", single: "단독" }[shape] || "단독";
}

// refs 투영 — 이슈(사건)에 속한 기사 전체를 대표 우선 순서 그대로 노출한다
// (David #6, 2026-08-17). members는 이미 대표가 0번인 배열(clusterIssues가
// 화제성순 items를 순서대로 채우고, 병합 시에도 대표 클러스터 members 뒤에
// 병합분을 붙인다) — 여기서 순서를 새로 정하지 않는다. 상한(과거 perIssueRefs)
// 없이 전량 투영한다: 선별·병합이 이미 "이 기사들이 한 사건"이라고 판정했으므로
// 그 판정 결과를 자르지 않는 것이 투영 계층의 책임이다.
function projectIssueRefs(members) {
  return members.map((item) => {
    const identity = operationalSourceIdentity(item);
    return {
      id: item.id, title: item.title, sourceLabel: item.sourceLabel || item.source,
      category: item.category || "news", score: item.score || 0,
      commentCount: item.commentCount || 0, coverage: item.coverage || 0,
      canonicalUrl: item.editorialCandidate && item.editorialCandidate.canonicalUrl || null,
      publishedAt: item.publishedAt || null,
      sourceRole: item.editorialCandidate && item.editorialCandidate.sourceRole || "unknown",
      ownershipGroup: identity.ownershipGroup,
      ownershipBasis: identity.ownershipBasis,
      syndicationGroup: item.editorialCandidate && item.editorialCandidate.syndicationGroup || null,
      carryover: item.editorialCarryover ? { ...item.editorialCarryover } : null
    };
  });
}

// eslint-disable-next-line no-unused-vars -- perIssueRefs는 buildDigest 공개
// 시그니처 호환을 위해 유지한다(외부 호출부 없음, 2026-08-17 확인). refs는
// 더 이상 이 값으로 자르지 않는다 — projectIssueRefs가 전량 투영한다.
function buildIssueDraft(members, perIssueRefs, requireKoreanAudience = false) {
  const shape = issueShape(members);
  const evidence = coverageEvidence(members);
  const subject = issueSubject(members);
  const headline = issueHeadline(members, shape, evidence, subject);
  const paragraph = issueParagraph(members, shape, evidence);
  const sourceLabels = [...new Set([
    ...evidence.sources.map((source) => source.label),
    ...distinctOutlets(members)
  ])].filter(Boolean);
  const editorialGate = assessEditorialDraft({
    headline,
    paragraph,
    subject,
    evidence,
    sourceLabels,
    categoryItems: members,
    requireKoreanAudience
  });
  const sourceEvidence = buildSourceEvidence(members);
  const roleCounts = sourceRoleCounts(members);
  const carryoverEvidenceCount = members.filter((item) => item.editorialCarryover).length;
  return {
    subject,
    headline,
    paragraph,
    tone: issueTone(shape, evidence),
    shape,
    categoryIds: [...new Set(members.map((item) => item.category || "news"))],
    metrics: {
      sourceCount: evidence.observedFeedCount,
      independentGroupCount: evidence.independentGroupCount,
      score: members.reduce((sum, item) => sum + (item.score || 0), 0),
      comments: members.reduce((sum, item) => sum + (item.commentCount || 0), 0),
      coverage: evidence.coverage,
      evidenceMode: evidence.mode,
      relatedCoverageSignal: evidence.relatedCoverageSignal,
      sourceRoles: roleCounts,
      verifiedSourceCount: [...VERIFIED_SOURCE_ROLES]
        .reduce((sum, role) => sum + (roleCounts[role] || 0), 0),
      carryoverUsed: carryoverEvidenceCount > 0,
      carryoverEvidenceCount,
      communityOnly: (roleCounts.community_signal || 0) > 0
        && Object.entries(roleCounts).every(([role, count]) => role === "community_signal" || count === 0)
    },
    evidence: {
      mode: evidence.mode,
      observedFeedCount: evidence.observedFeedCount,
      independentGroupCount: evidence.independentGroupCount,
      ownershipGroups: evidence.ownershipGroups,
      groups: evidence.groups,
      independenceBasis: evidence.independenceBasis,
      relatedCoverageSignal: evidence.relatedCoverageSignal,
      sources: evidence.sources
    },
    sourceEvidence,
    editorialGate,
    refs: projectIssueRefs(members),
    // 해외발(국내 미보도) 플래그 — David #과업3. 병합이 있으면 아래
    // issues 조립 단계에서 allMembers 기준으로 재계산한다(refs와 같은 패턴).
    overseasOnly: membersAllOverseas(members)
  };
}

// ---------------------------------------------------------------------------
// 브리핑 한 편
// ---------------------------------------------------------------------------

// slot: 하루 편성. 수집이 멈춘 시간대에 빈 글이 발행되지 않도록 호출부가
// MIN_ISSUES로 막는다(server/engine).
// ── 하루 3편, 시간대마다 성격이 다르다 (David 2026-08-04)
//
// "15분마다 갱신될 필요는 없지 않니? 사람들 활동시간 기준으로 아침 점심
//  저녁에만 한번씩 브리핑 해도 될 것 같은데 내용 충실하게 해서.
//  아침 브리핑이면 지난 밤 있던 얘기들 위주에 해외 핫토픽을 한글로 정리해서
//  올리는 게 많을 거고 점심 저녁은 국내 비중이 많을 수 있고."
//
// 그래서 슬롯마다 두 가지가 달라진다:
//   windowHours — 어느 구간의 글을 볼 것인가
//   overseasBias — 해외 소스를 얼마나 앞에 둘 것인가 (1이면 가중 없음)
//
// 아침은 한국이 자는 동안 쌓인 해외 이야기가 주된 새 정보다. 국내 커뮤니티는
// 밤사이 조용하고, 반대로 해커뉴스·Techmeme은 그 시간이 한창이다.
// 점심·저녁은 국내가 활발하므로 가중을 두지 않는다 — 자연스러운 반응량으로
// 겨루게 둔다.
export const SLOTS = [
  {
    id: "morning", label: "모닝", fromHour: 5, toHour: 11,
    publishHour: 7,
    windowHours: 12,      // 전날 저녁부터 오늘 아침까지 — 자는 동안 있었던 일
    overseasBias: 1.6,
    lead: "밤사이 해외에서 오간 이야기부터"
  },
  {
    id: "lunch", label: "런치", fromHour: 11, toHour: 17,
    publishHour: 12,
    windowHours: 6,
    overseasBias: 1,
    lead: "오전에 가장 많이 오간 이야기"
  },
  {
    id: "evening", label: "이브닝", fromHour: 17, toHour: 5,
    publishHour: 19,
    windowHours: 7,
    overseasBias: 1,
    lead: "오늘 하루 가장 크게 번진 이야기"
  }
];

// 설계 문서와 일부 초기 로컬 호출은 낮판을 `midday`라고 불렀고, 운영 저장
// ID는 이미 `lunch`다. 저장 키를 바꾸지 않고 별칭만 받아 잘못 모닝판으로
// 떨어지던 동작을 막는다.
export const slotById = (id) => SLOTS.find((s) => s.id === (id === "midday" ? "lunch" : id)) || SLOTS[0];

// 해외 소스인가 — 언어로 판별한다. kind는 community/news로 갈릴 뿐 국적을
// 말해 주지 않고(해커뉴스가 community다), 소스 목록을 하드코딩하면 소스를
// 추가할 때마다 여기도 고쳐야 한다.
export const isOverseas = (item) =>
  Boolean(item && ((item.originalLang && item.originalLang !== "ko") ||
    (item.lang && item.lang !== "ko") || item.translated));

export const MIN_ISSUES = 3; // 이보다 적으면 발행하지 않는다 — 빈 글은 자체 콘텐츠가 아니다

export function slotForHour(kstHour) {
  if (kstHour >= 5 && kstHour < 11) return SLOTS[0];
  if (kstHour >= 11 && kstHour < 17) return SLOTS[1];
  return SLOTS[2];
}

// items: 이미 필터링된(성인·정치·광고 제외) 화제성 순 배열.
// 반환: { issues:[...], summary, quality }. quality는 현재 동적 후보의 기계
// 편집 게이트 영수증이며 E1의 별도 고정 사람 평가 표본 수와 무관하다.
export function buildDigest(items, {
  maxIssues = 6,
  perIssueRefs = 4,
  maxPerSource = 2,
  selectedCategories = [],
  minIssuesPerCategory = 0,
  additiveCategoryUnion = false,
  requireKoreanAudience = false,
  // v2 전용(David 승인, 2026-08-17 — "골라놓은 순서 그대로"). Map<itemId,
  // rank:number>(작을수록 우선). 있으면 클러스터 중요도 정렬을 이 순위로
  // 고정한다 — 반응·교차보도로 다시 계산하지 않는다(순위 재계산 금지).
  // 매핑이 없는 클러스터는 매핑된 클러스터들 뒤로 밀리고, 그들끼리는 기존
  // weight로 정렬한다(부분 공급 시 안전망). null(기본, v1 전 경로)이면 이
  // 함수의 나머지 동작은 바이트 그대로다.
  externalRank = null
} = {}) {
  const clusters = clusterIssues(items);

  // ── 이슈 정렬: 반응 총량이 아니라 **중요도** 순 (David 2026-08-05)
  //
  // 예전엔 `반응 총량 + 교차보도×60`이었다. 원점수를 그대로 더하니 반응 하나가
  // 나머지를 전부 눌렀다 — 실측(2026-08-05 라이브 모닝 브리핑)에서 대표 이슈가
  //   1. 해커뉴스 · 추천 907건   2. 해커뉴스 · 댓글 357건
  //   3. 보배드림 · 추천 342건   4. 보배드림 · 추천 311건
  // 이렇게 나왔다. David가 지적한 "사적·매니악함"이 바로 이 정렬의 결과다.
  //
  // ── 반응은 로그로 누른다
  // 소스마다 추천의 의미가 다르다(더쿠 16만 vs 인벤 수백). 원점수를 더하면
  // 스케일 큰 소스가 통째로 가져간다. log10으로 누르면 907과 3421의 차이가
  // 2.96 대 3.53으로 줄어 **"많이 받았다"는 사실만 남고 스케일은 사라진다.**
  //
  // ── 중요도는 세 가지로 잰다 (전부 실측값 기준)
  //   교차보도  ×80 — 여러 매체가 같은 날 동시에 다뤘다는 것은 그 사건이
  //                   중요하다는 가장 단단한 신호다. 우리가 매긴 값이 아니다.
  //   검색 급상승 ≤250 — 지금 사람들이 실제로 찾아보고 있는가(구글 검색량).
  //   무게 있는 분야 105 — 경제·정책·사회·정치. David가 이름 붙인 축이다.
  // 250과 105는 기존 점수 분포의 상위 10%·25%에서 그대로 가져왔다.
  //
  // 결과: 5개 매체가 다룬 사안(400)이 추천 907건짜리 글(178)보다 앞선다.
  // 커뮤니티 글을 빼는 게 아니다 — 중요한 사건 **다음에** 놓는다.
  const REACTION_K = 60;
  const COVERAGE_K = 80;
  const RELATED_COVERAGE_K = 40;
  const INTEREST_MAX = 250;
  const WEIGHTY_BONUS = 105;
  // v2 externalRank — 클러스터의 순위는 구성원 중 매핑된 항목의 최솟값(가장
  // 우선순위 높은 기사)으로 정한다. 매핑이 하나도 없으면 null(뒤로 밀림).
  const externalRankOf = (members) => {
    if (!externalRank) return null;
    let best = null;
    for (const item of members) {
      const r = externalRank.get(item && item.id);
      if (r != null && (best === null || r < best)) best = r;
    }
    return best;
  };
  const scored = clusters.map((members) => {
    const eng = members.reduce((s, i) => s + (i.score || 0) + (i.commentCount || 0) * 2, 0);
    const evidence = coverageEvidence(members);
    const best = members.reduce((m, i) => {
      const t = i.interest ? (i.interest.traffic || 0) * (i.interest.strength || 1) : 0;
      return t > m ? t : m;
    }, 0);
    const isWeighty = members.some((i) => EDITORIAL_WEIGHTY.has(i.category));
    const roles = sourceRoleCounts(members);
    const hasVerifiedSource = [...VERIFIED_SOURCE_ROLES].some((role) => (roles[role] || 0) > 0);
    // 중요한 분야라는 이유만으로 커뮤니티 단일 글에 105점을 주지 않는다.
    // 실측에서 핫딜·추측성 글이 business 라벨 하나로 보도보다 앞섰다. 보도·
    // 공식 근거나 서로 다른 운영그룹 관측이 있을 때만 중요도 보너스를 부여한다.
    const weighty = isWeighty && (hasVerifiedSource || evidence.mode === "multiple_feed_observed")
      ? WEIGHTY_BONUS : 0;
    const sourceTrust = isWeighty && hasVerifiedSource ? VERIFIED_SOURCE_BONUS : 0;
    const coveragePoints = evidence.mode === "multiple_feed_observed"
      ? Math.min(5, evidence.independentGroupCount) * COVERAGE_K
      : evidence.relatedCoverageSignal
        ? Math.min(5, evidence.coverage) * RELATED_COVERAGE_K
        : 0;
    return {
      members,
      draft: buildIssueDraft(members, perIssueRefs, requireKoreanAudience),
      carryoverOnly: members.every((item) => Boolean(item.editorialCarryover)),
      externalRank: externalRankOf(members),
      weight: Math.log10(1 + Math.max(0, eng)) * REACTION_K
        + coveragePoints
        + INTEREST_MAX * Math.min(1, best / 1000)
        + weighty
        + sourceTrust
    };
  }).sort((a, b) => {
    if (Number(a.carryoverOnly) !== Number(b.carryoverOnly)) {
      return Number(a.carryoverOnly) - Number(b.carryoverOnly);
    }
    if (!externalRank) return b.weight - a.weight;
    if (a.externalRank !== null && b.externalRank !== null) return a.externalRank - b.externalRank;
    if (a.externalRank !== null) return -1;
    if (b.externalRank !== null) return 1;
    return b.weight - a.weight;
  });

  // 문장·근거 계약을 먼저 통과시킨 뒤 근접 중복을 접는다. 실패 클러스터를 먼저
  // 대표로 정하면, 같은 사건의 다음 정상 클러스터까지 중복으로 사라져 빈자리가
  // 생긴다. 게이트 실패 후보는 어떤 형태로도 유효 후보의 자리를 차지하지 않는다.
  const machinePassed = scored.filter((cluster) => cluster.draft.editorialGate.pass);
  // P1-B 사건 계층: 근접 중복은 "첫 건만 남김"이 아니라 사건 병합이다.
  // 기존 휴리스틱 그룹 위에 사건 2단 판정 병합을 얹고, 병합된 클러스터의
  // 기사는 대표 이슈의 근거(sourceEvidence)로 보존한다 — 타 매체 근거 소실 0.
  const eventGroups = mergeGroupsByEventDecision(nearIssueGroups(machinePassed));
  const deduped = eventGroups.map((group) => group[0]);
  const mergedEvidenceOf = new Map(eventGroups.map((group) => [
    group[0],
    group.slice(1).flatMap((cluster) => cluster.members)
  ]));

  // 한 소스가 브리핑을 독식하지 않게 상한을 둔다.
  //
  // 실측(2026-08-03): 상한 없이 뽑으니 이슈 1~4위가 전부 더쿠였다. 소스마다
  // score의 의미와 스케일이 달라서(더쿠는 추천 16만, 인벤은 수백) 반응량으로만
  // 정렬하면 스케일이 큰 소스가 통째로 가져간다. 그러면 "오늘의 브리핑"이
  // 아니라 "더쿠 모음"으로 읽힌다 — 자체 콘텐츠로 보이려면 오늘 전체를
  // 훑었다는 것이 드러나야 한다.
  //
  // 근본 해결은 소스 간 점수 정규화이고 그건 별건이다. 여기서는 브리핑이
  // 목적을 잃지 않도록 편성 단계에서 막는다.
  const rankOfOriginal = new Map(deduped.map((cluster, index) => [cluster, index]));
  const perSource = new Map();
  const balanced = [];
  const chosen = new Set();
  const chosenSubjects = new Set();
  const chosenTrendTerms = new Set();
  const selected = new Set((selectedCategories || []).filter(Boolean));
  const categoryCounts = new Map();
  const addBalanced = (cluster, { ignoreSourceCap = false } = {}) => {
    if (chosen.has(cluster) || balanced.length >= maxIssues) return false;
    const src = cluster.members[0].sourceLabel || cluster.members[0].source || "?";
    if (!ignoreSourceCap && (perSource.get(src) || 0) >= maxPerSource) return false;
    const subjectKey = String(cluster.draft.subject || "").toLowerCase();
    const trendTerms = [...new Set(cluster.members
      .filter((item) => item.interest && item.interest.how === "term")
      .map((item) => String(item.interest.term || "").trim().toLowerCase())
      .filter(Boolean))];
    if (subjectKey && chosenSubjects.has(subjectKey)) return false;
    if (trendTerms.some((term) => chosenTrendTerms.has(term))) return false;
    chosen.add(cluster);
    balanced.push(cluster);
    if (subjectKey) chosenSubjects.add(subjectKey);
    for (const term of trendTerms) chosenTrendTerms.add(term);
    perSource.set(src, (perSource.get(src) || 0) + 1);
    for (const category of new Set(cluster.members.map((item) => item.category || "news"))) {
      if (selected.has(category)) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    return true;
  };

  // 개인판은 후보에 여러 분야가 있어도 최종 중요도 정렬에서 한 분야가 다시
  // 지면을 독식할 수 있다. 공급이 있는 선택 분야의 대표 이슈를 먼저 확보하고,
  // 남은 자리는 아래 전체 중요도 순으로 채운다. 기본 브리핑은 floor=0이라
  // 기존 동작을 그대로 유지한다.
  const floor = Math.max(0, Math.floor(Number(minIssuesPerCategory) || 0));
  if (floor && selected.size) {
    for (const category of selected) {
      for (const cluster of deduped) {
        if ((categoryCounts.get(category) || 0) >= floor) break;
        if (!cluster.members.some((item) => (item.category || "news") === category)) continue;
        addBalanced(cluster);
      }
    }
    // 앞선 분야가 전역 소스 상한을 먼저 소진해 뒤의 분야가 후보를 갖고도 0~1건에
    // 머무르면, 전체 중요도 자리를 채우기 전에 그 분야의 최소 깊이에 한해 상한을
    // 푼다. 중복 사건·주제·전체 판본 상한은 그대로라 없는 공급을 만들지는 않는다.
    for (const category of selected) {
      for (const cluster of deduped) {
        if ((categoryCounts.get(category) || 0) >= floor) break;
        if (!cluster.members.some((item) => (item.category || "news") === category)) continue;
        addBalanced(cluster, { ignoreSourceCap: true });
      }
    }
  }
  if (!additiveCategoryUnion) {
    for (const c of deduped) {
      addBalanced(c);
      if (balanced.length >= maxIssues) break;
    }
  }
  // 공급이 얇아 상한 때문에 못 채우면 상한을 풀되, 현재 가장 적게 뽑힌
  // 출처의 다음 고순위 이슈부터 채운다. 정렬 순서대로 곧장 풀면 실측 게임
  // 단독판처럼 14건 중 10건이 한 매체가 되어 "충분한 브리핑"이 그 매체의
  // 최신글 모음으로 되돌아간다. 모든 후보는 이미 품질 게이트를 통과했고,
  // 출처별 내부 순위는 deduped의 원래 중요도 순서를 그대로 보존한다.
  const fillTarget = additiveCategoryUnion
    ? balanced.length
    : Math.min(maxIssues, deduped.length);
  while (balanced.length < fillTarget) {
    const remaining = deduped
      .filter((cluster) => !chosen.has(cluster))
      .sort((a, b) => {
        const sourceOf = (cluster) => cluster.members[0].sourceLabel || cluster.members[0].source || "?";
        return (perSource.get(sourceOf(a)) || 0) - (perSource.get(sourceOf(b)) || 0)
          || rankOfOriginal.get(a) - rankOfOriginal.get(b);
      });
    let added = false;
    for (const cluster of remaining) {
      if (addBalanced(cluster, { ignoreSourceCap: true })) {
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  // 예약 순서가 분야 탭 순서가 되지 않게 원래 중요도 순서를 복원한다.
  const rankOf = rankOfOriginal;
  balanced.sort((a, b) => rankOf.get(a) - rankOf.get(b));

  const issues = balanced.map((cluster) => {
    const draft = cluster.draft;
    const mergedMembers = mergedEvidenceOf.get(cluster) || [];
    const allMembers = [...cluster.members, ...mergedMembers];
    if (mergedMembers.length) {
      // 병합된 클러스터의 기사도 근거로 남긴다(사라지지 않는다 — v4 성공지표).
      // 대표의 측정값·게이트는 그대로 둔다: 병합 근거로 교차 계수를 부풀리지
      // 않는다(합산 금지, 커뮤 반응은 별도 축 — event.counts가 축별 정본).
      draft.sourceEvidence = buildSourceEvidence(allMembers);
      // refs도 같은 근거로 재투영한다 (David #6) — 병합 전 refs는 대표
      // 클러스터 members만 봤다. allMembers는 대표 클러스터 members가 먼저,
      // 병합분이 뒤라 대표 우선 순서가 유지된다. 선별·병합 판정 자체는
      // 위(mergeGroupsByEventDecision)에서 이미 끝났고 여기는 그 결과를
      // 그대로 펼치기만 한다.
      draft.refs = projectIssueRefs(allMembers);
      // 해외발 플래그도 전체 구성원 기준으로 재계산한다 — 대표 클러스터는
      // 해외 단독이었어도 병합분에 국내 매체가 섞이면 더 이상 "국내 미보도"가
      // 아니다.
      draft.overseasOnly = membersAllOverseas(allMembers);
    }
    // 사건 투영: 안정 사건 ID를 기존 소비처 필드명 clusterId로 노출한다
    // (edition-change 등 소비처 무변경 호환 — 없으면 종전대로 스냅샷 키 사용).
    const event = composeEventFromMembers(allMembers);
    draft.clusterId = event.eventId;
    draft.event = event;
    return draft;
  });

  const machinePass = machinePassed.length;
  const failuresByRule = {};
  for (const cluster of scored) {
    for (const failure of cluster.draft.editorialGate.failures || []) {
      failuresByRule[failure] = (failuresByRule[failure] || 0) + 1;
    }
  }
  const evidenceModes = {};
  for (const issue of issues) {
    const mode = issue.evidence && issue.evidence.mode || "unknown";
    evidenceModes[mode] = (evidenceModes[mode] || 0) + 1;
  }
  const categoriesOfCluster = (cluster) => new Set(
    (cluster && cluster.members || []).map((item) => item.category || "news")
  );
  const countClusters = (rows, category) => (rows || [])
    .filter((cluster) => categoriesOfCluster(cluster).has(category)).length;
  const funnelCategories = [...new Set([
    ...(selectedCategories || []).filter(Boolean),
    ...items.map((item) => item.category || "news")
  ])];
  const categoryFunnel = funnelCategories.map((categoryId) => {
    const inputItemCount = items.filter((item) => (item.category || "news") === categoryId).length;
    const clusterCount = countClusters(scored, categoryId);
    const machinePassClusterCount = countClusters(machinePassed, categoryId);
    const qualifiedClusterCount = countClusters(deduped, categoryId);
    const draftSelectedCount = issues.filter((issue) =>
      (issue.categoryIds || []).includes(categoryId)).length;
    return {
      categoryId,
      inputItemCount,
      clusterCount,
      machinePassClusterCount,
      qualifiedClusterCount,
      draftSelectedCount,
      machineHoldCount: Math.max(0, clusterCount - machinePassClusterCount),
      nearDuplicateHoldCount: Math.max(0, machinePassClusterCount - qualifiedClusterCount),
      selectionHoldCount: Math.max(0, qualifiedClusterCount - draftSelectedCount)
    };
  });

  return {
    issues,
    summary: buildSummary(issues, items),
    quality: {
      sampleMode: "dynamic_current_edition",
      evaluatedClusters: scored.length,
      machinePass,
      machineHold: scored.length - machinePass,
      qualifiedClusters: deduped.length,
      nearDuplicateHolds: Math.max(0, machinePassed.length - deduped.length),
      selectedAfterGate: issues.length,
      failuresByRule,
      evidenceModes,
      categoryFunnel
    }
  };
}

// 종합 문단 — 이슈들의 성격 분포를 한 문장으로. 여기서도 새 사실을 만들지 않는다.
export function buildSummary(issues, items) {
  if (!issues.length) return "";
  const byTone = {};
  for (const i of issues) byTone[i.tone] = (byTone[i.tone] || 0) + 1;
  const outlets = new Set(items.map((i) => i.sourceLabel || i.source)).size;
  const bits = [];
  bits.push(`커뮤니티·매체 ${outlets}곳에서 모은 ${items.length}건을 ${issues.length}개 이슈로 정리했다.`);
  const cross = byTone["운영그룹 교차 관측"] || 0;
  const related = byTone["관련 보도"] || 0;
  const deb = byTone["논쟁"] || 0;
  if (cross) bits.push(`이 중 ${cross}건은 서로 다른 운영그룹에서 교차 관측했다.`);
  if (related) bits.push(`${related}건은 관련 보도 묶음 신호가 있었다.`);
  if (deb) bits.push(`${deb}건은 추천보다 댓글이 앞서는 논쟁형이다.`);
  return bits.join(" ");
}
