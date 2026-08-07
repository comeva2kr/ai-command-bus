// State store for the personalized feed.
//
// Holds users, their preference vectors, rating history, and comments. Backed
// by an in-memory map with optional JSON-file persistence so a running server
// survives restarts. No external database required — this keeps the project's
// zero-dependency posture while still being real enough to demo end to end.

import { emptyBucket, applyEvent } from "./analytics.js";
import { emptyCostBucket, recordCall } from "./costs.js";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { emptyPreferenceVector, buildPreferenceVector } from "./survey.js";
import { inferFromHistory, mergeVectors } from "./history.js";

// 잦은 기록을 몇 번 모아 한 번에 쓴다. 길게 잡으면 재시작 때 잃는 게 늘고,
// 짧게 잡으면 다시 요청마다 쓰는 꼴이 된다.
const PERSIST_DEBOUNCE_MS = 2000;
import { validatePost, validateComment, userLevel, DEFAULT_RULES } from "./rules.js";
import { nicknameFor } from "./nickname.js";
import { FILTERABLE_TOPICS, FILTER_KEYS } from "./topics.js";

function nowIso(clock) {
  // `clock` is injected so tests and reproducible runs don't depend on the
  // wall clock (Date.now is also unavailable in some sandboxes).
  return clock ? clock() : new Date().toISOString();
}

export class FeedStore {
  // opts.clock: () => ISO string, opts.file: path for persistence
  constructor(opts = {}) {
    this.clock = opts.clock || null;
    this.file = opts.file || null;
    this.users = new Map(); // userId -> user record
    this.sessions = new Map(); // token -> { userId, expiresAt } (social login sessions)
    this._seq = 0;
    if (this.file && fs.existsSync(this.file)) this._load();
    // 밀린 저장은 종료 직전에 비운다. 지연 저장 타이머는 unref라 프로세스를
    // 붙잡지 않으니, 여기서 안 비우면 마지막 몇 초가 그냥 사라진다.
    // 파일에 붙은 스토어에만 건다 — 테스트가 만드는 메모리 스토어는 제외.
    if (this.file && typeof process !== "undefined" && process.once) {
      const flush = () => { try { this.flushPending(); } catch {} };
      process.once("SIGTERM", () => { flush(); process.exit(0); });
      process.once("SIGINT", () => { flush(); process.exit(0); });
      process.once("beforeExit", flush);
    }
  }

  // ── 순번 ID를 쓰지 않는다 (2026-08-05 전수검사 P0)
  //
  // 예전엔 user_1, user_2 … 순번이었다. 라이브에서 세 번 부르니 user_300,
  // user_301, user_302가 나왔다 — 즉 **전 사용자 목록을 1부터 세면 얻는다.**
  // 여기에 "요청 본문의 userId를 그대로 믿는" 라우트가 겹쳐, 아무나 남의
  // 내 공간을 읽고 그 이름으로 글을 쓸 수 있었다(재현 확인).
  //
  // 순번은 그대로 두되(내부 카운터·정렬에 쓰인다) **ID에는 무작위를 붙인다.**
  // 기존 user_N 들은 그대로 유효하다 — 새로 만드는 것만 바뀐다.
  _id(prefix) {
    this._seq += 1;
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  }

  createUser(userId) {
    const id = userId || this._id("user");
    if (this.users.has(id)) return this.users.get(id);
    const user = {
      id,
      nickname: nicknameFor(id), // 오늘의 닉네임 — anonymous, stable per user
      preferences: emptyPreferenceVector(),
      surveyed: false,
      feedbackCount: 0,
      saved: [], // 스크랩한 itemId 목록
      mutedSources: [], // 사용자가 피드에서 숨긴 소스
      // sourceId -> 지금까지 홈 피드에서 이 소스가 노출된 횟수 (David 2026-07-24
      // 적대적 검수 #2 — 라운드로빈 페어니스의 근거. markSeen과 함께 매 getFeed
      // 호출마다 누적되며, ingest.roundRobinInterleave가 "가장 적게 노출된 소스
      // 우선"의 기준으로 사용한다. 세션이 끝나도 유저별로 유지되어야 특정 소스
      // 독식이 여러 페이지에 걸쳐서도 재발하지 않는다.
      sourceExposure: {},
      // 정치/종교처럼 기본값이 '숨김'인 토픽 중 사용자가 직접 켠 것들
      // (FILTERABLE_TOPICS만 유효).
      showTopics: [],
      ratings: {}, // itemId -> { signal, at }
      seen: [], // itemIds shown, most-recent last
      comments: [], // { id, itemId, body, at }
      createdAt: nowIso(this.clock)
    };
    this.users.set(id, user);
    this._persist();
    return user;
  }

  // ── 계정을 기기에 묶는다 (2026-08-05 전수검사 P0)
  //
  // 요청 본문의 userId를 그대로 믿으면 아무나 남이 될 수 있다. 그렇다고
  // 지금 당장 쿠키를 강제하면 기존 471명이 전부 로그아웃된다.
  //
  // 그래서 계정마다 **열쇠**를 하나 두고, 그 열쇠를 HttpOnly 쿠키로만 준다.
  // 처음 보는 짝을 그대로 채택한다: 아직 열쇠가 없는 계정이면 지금 온 열쇠를
  // 그 계정의 열쇠로 삼고, 그 뒤로는 다른 열쇠를 거절한다.
  //
  // **기기 쿠키(nh_cid)를 쓰지 않는 이유**: 그 쿠키에는 userId가 그대로 들어
  // 있다. 쿠키는 사용자가 직접 만들 수 있으므로 "nh_cid=user_10"이라고 쓰면
  // 그만이다 — 비밀이 아니면 열쇠가 아니다. 첫 판에서 이 함정에 빠졌다.
  //
  // 완벽하지 않다 — 주인이 돌아오기 **전에** 공격자가 먼저 주장하면 뺏긴다.
  // 다만 그 창은 각 계정이 다음에 접속할 때까지이고, 지금처럼 "누구나 아무
  // 계정이나" 열려 있는 것과는 비교가 안 된다. 로그인(소셜) 계정은 이 경로를
  // 타지 않는다 — 세션 쿠키가 우선한다.
  //
  bindDevice(userId, key) {
    const user = this.getUser(userId);
    if (!user) return true;               // 없는 사용자는 여기서 판단하지 않는다
    if (!user.deviceKey) {
      // 아직 열쇠가 없는 계정. 열쇠를 들고 왔으면 그것을 이 계정의 열쇠로
      // 삼는다. 안 들고 왔으면 통과시킨다 — 아직 지킬 것이 없고, 여기서
      // 막으면 배포 직후 기존 사용자 471명이 전부 막힌다.
      if (key) { user.deviceKey = key; this._persist(); }
      return true;
    }
    // 이미 열쇠가 있는 계정. 열쇠를 안 들고 왔으면 거절한다 — 통과시키면
    // 공격자는 쿠키를 빼고 요청하면 그만이라 결속이 무의미해진다.
    return Boolean(key) && user.deviceKey === key;
  }


  getUser(userId) {
    return this.users.get(userId) || null;
  }

  requireUser(userId) {
    const user = this.getUser(userId);
    if (!user) throw new Error(`unknown user: ${userId}`);
    return user;
  }

  // ---- social login (src/feed/auth.js) ----
  //
  // Identity = provider + the provider's own user id (never email — see
  // docs/legal.md "개인정보 최소수집"). A user record can carry more than one
  // linked provider at once (google + kakao both pointing at the same
  // account), stored in `user.social` keyed by "<provider>:<providerUserId>"
  // so lookups and re-links are O(1) per provider without a second index.
  // `user.socialProfile` is a *display-only* snapshot (nickname/avatar) for
  // "내 공간" / the drawer's logged-in state — it deliberately never touches
  // `user.nickname` (the existing anonymous "오늘의 닉네임" used on public
  // posts/comments), so signing in never changes what other users see you as.

  // Find the user a (provider, providerUserId) pair is already linked to, or
  // null if this is the first time this social account has ever signed in.
  findUserBySocial(provider, providerUserId) {
    const key = `${provider}:${providerUserId}`;
    for (const user of this.users.values()) {
      if (user.social && user.social[key]) return user;
    }
    return null;
  }

  // Link a social account onto an existing user record — this is the taste
  // succession step. Called either on an anonymous user (their preferences/
  // ratings/saved/etc. stay exactly as-is, just gain a login) or on a user
  // that was just newly created for a first-time social login with no prior
  // anonymous id to inherit from. Never touches preferences/ratings/posts.
  linkSocialAccount(userId, provider, providerUserId, profile = {}) {
    const user = this.requireUser(userId);
    user.social = user.social || {};
    const key = `${provider}:${providerUserId}`;
    user.social[key] = {
      provider,
      providerUserId: String(providerUserId),
      linkedAt: nowIso(this.clock)
    };
    // display-only snapshot, refreshed on every login — never gates or
    // replaces the anonymous public nickname
    user.socialProfile = {
      provider,
      nickname: profile.nickname || null,
      avatar: profile.avatar || null
    };
    this._persist();
    return user;
  }

  // ---- sessions (HttpOnly cookie -> userId, src/feed/auth.js) ----
  //
  // Purely additive to the existing anonymous userId-query-param auth: a
  // session only ever *identifies* a user for the cookie-based endpoints
  // (GET /api/auth/session, POST /api/auth/logout); every other route keeps
  // trusting the userId it's given, unchanged (하위호환).
  createSession(userId, ttlMs = 30 * 24 * 60 * 60 * 1000) {
    this.requireUser(userId);
    const token = crypto.randomBytes(32).toString("hex");
    this.sessions = this.sessions || new Map();
    this.sessions.set(token, { userId, expiresAt: this._nowMs() + ttlMs });
    this._persist();
    return token;
  }

  // Resolve a session token to a userId, or null if missing/expired (and
  // prunes it on expiry so it doesn't linger in the persisted file).
  sessionUser(token) {
    if (!token) return null;
    this.sessions = this.sessions || new Map();
    const s = this.sessions.get(token);
    if (!s) return null;
    if (this._nowMs() > s.expiresAt) {
      this.sessions.delete(token);
      this._persistSoon();
      return null;
    }
    return s.userId;
  }

  destroySession(token) {
    this.sessions = this.sessions || new Map();
    const had = this.sessions.delete(token);
    if (had) this._persist();
    return had;
  }

  // Store survey answers and seed the initial preference vector.
  saveSurvey(userId, answers) {
    const user = this.requireUser(userId);
    const surveyVec = buildPreferenceVector(answers);
    // if the user warm-started from browsing history, fold that signal in at a
    // reduced weight so the explicit survey answers lead but the inferred taste
    // isn't thrown away
    if (user.warmStarted) mergeVectors(surveyVec, user.preferences, 0.6);
    user.preferences = surveyVec;
    user.surveyAnswers = answers;
    user.surveyed = true;
    this._persist();
    return user;
  }

  // Warm-start from browsing history: infer a vector and merge it in. Runs
  // before or after the survey; survey/feedback still dominate via bigger steps.
  applyHistory(userId, entries) {
    const user = this.requireUser(userId);
    const { vector, hits, entriesSeen } = inferFromHistory(entries);
    mergeVectors(user.preferences, vector, 1);
    user.warmStarted = true;
    user.historyHits = hits;
    // a strong footprint gives a small confidence head start
    const signalCount = hits.sources + hits.keywords;
    if (signalCount >= 3) user.feedbackCount = Math.max(user.feedbackCount, Math.min(6, Math.floor(signalCount / 3)));
    this._persist();   // 온보딩 1회성 취향 워밍업 — 잦은 기록이 아니다. 유실되면 사용자는 알 방법이 없다
    return { hits, entriesSeen, preferences: user.preferences };
  }

  // Persist a Web Push subscription for a user (real push delivery needs a
  // VAPID-signed server; this stores the endpoint that server would push to).
  savePushSubscription(userId, subscription) {
    const user = this.requireUser(userId);
    user.pushSubscription = subscription || null;
    user.notifyEnabled = Boolean(subscription);
    this._persist();
    return user.notifyEnabled;
  }

  // Mark a user as age-verified (real deployments wire this to an actual
  // 성인인증/PASS flow; here it records the verified result).

  // Toggle the 19금 view. Only takes effect when the user is age-verified;
  // an unverified user can never turn it on.
  // ---- 트래픽 실측 (David 2026-08-01 "트래픽 어디서 확인함?") ----
  // 외부 애널리틱스와 별개로 서버가 직접 세는 일별 지표. 애드블록·쿠키 거부
  // 유저도 빠짐없이 잡히는 실측이고, 개인정보는 익명 userId뿐이라 방침 변경도
  // 불필요하다. date -> { pv(첫화면 로드), feed(피드 요청), uids(고유 방문자) }.
  _trafficDay(now = new Date()) {
    // KST 기준 날짜 버킷 — 운영자가 한국에서 보는 "오늘"과 일치시킨다
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    return kst.toISOString().slice(0, 10);
  }

  // ── 방문자 표식 ↔ 계정 연결 (2026-08-06)
  //
  // nh_cid(계정 쿠키)는 계정이 만들어질 때만 심긴다 — 앱 화면을 연 사람에게만
  // 붙는다는 뜻이다. 검색으로 발행 페이지에 도착해 읽고 나간 사람은 아무 표식도
  // 못 받고, 다음에 와도 처음 보는 사람이 된다(실측 2026-08-06: 세션 287건 중
  // 새 신원 162건 57%). 취향을 아무리 잘 파악해도 다음 방문에 못 알아보면
  // 전부 날아간다.
  //
  // 그래서 아무 페이지에서나 심을 수 있는 **기기 표식**(nh_vid)을 따로 두고,
  // 계정이 생기는 순간 그 표식과 묶는다. 다음에 localStorage가 날아가도
  // 이 표식으로 같은 계정을 찾는다.
  //
  // **계정을 새로 만들지는 않는다** — 표식만으로는 빈 계정이 늘지 않는다.
  linkVisitor(vid, userId) {
    if (!vid || !userId) return;
    if (!this.getUser(userId)) return;
    this.visitorMap = this.visitorMap || {};
    if (this.visitorMap[vid] === userId) return;
    this.visitorMap[vid] = userId;
    // 무한히 자라지 않게 — 오래된 것부터 버린다(삽입 순서 = 오래된 순).
    const keys = Object.keys(this.visitorMap);
    if (keys.length > 200000) for (const k of keys.slice(0, keys.length - 200000)) delete this.visitorMap[k];
    this._persistSoon();
  }

  visitorUser(vid) {
    const id = vid && this.visitorMap ? this.visitorMap[vid] : null;
    return id && this.getUser(id) ? id : null;
  }

  recordTraffic(kind, userId = null) {
    if (!this.traffic) this.traffic = {};
    const day = this._trafficDay(new Date(this._nowMs()));
    if (!this.traffic[day]) this.traffic[day] = { pv: 0, feed: 0, uids: [] };
    const t = this.traffic[day];
    if (kind === "page") t.pv += 1;
    else if (kind === "feed") t.feed += 1;
    if (userId && !t.uids.includes(userId) && t.uids.length < 100000) t.uids.push(userId);
    // 90일 이전 버킷은 정리 (무한 성장 방지)
    const keys = Object.keys(this.traffic);
    if (keys.length > 90) {
      for (const k of keys.sort().slice(0, keys.length - 90)) delete this.traffic[k];
    }
    this._persistSoon();
  }

  trafficStats(days = 14) {
    const out = [];
    const t = this.traffic || {};
    for (const day of Object.keys(t).sort().slice(-days)) {
      out.push({ date: day, pv: t[day].pv, feed: t[day].feed, visitors: t[day].uids.length });
    }
    return out;
  }

  // ---- 수집 풀 firstSeenAt 영속화 (적대적 검수 P1-a, 2026-07-31) -----------
  // 엔진의 수집 풀은 메모리라 재시작(=배포)마다 firstSeenAt이 리셋됐다 —
  // 그 순간 2021년 아카이브 글도 "방금 처음 봄"이 되어 신선도 상한을 다시
  // 통과하고, 최신순에서는 전체가 한 버킷에 뭉쳤다(검수 실측: 40건 전부
  // firstSeenAt 동일). 여기 남는 "처음 본 시각"은 재시작을 넘어 이어진다.
  firstSeenOf(id) {
    return this.firstSeen ? this.firstSeen[id] : undefined;
  }

  // 새로 본 아이템들의 시각을 한 번에 기록 — 아이템당 _persist를 피한다.
  // 보존 기간이 지난 항목은 함께 청소한다(풀 retention 48h·소스 예외 72h보다
  // 넉넉한 7일 — 그 뒤 다시 나타난 글은 "다시 처음 본 것"으로 취급해도
  // 신선도 판정이 위험해지지 않는다: 상한을 통과하려면 어차피 재등장 후
  // 48시간이 더 필요하다).
  // ---- 보강(og:image/발췌) 캐시 영속화 (2026-08-01) ----------------------
  // 이미지·발췌는 원문 페이지를 직접 받아야 얻는 비싼 값인데, 캐시가 메모리에만
  // 있어 배포·재시작마다 전부 날아갔다 — 라이브에서 커버리지가 40%대에 계속
  // 머문 진짜 이유(배포가 잦은 날은 매번 원점). URL 기준으로 저장한다.
  loadEnrichCache() {
    return this.enrichCache || {};
  }

  saveEnrichCache(entries, nowMs) {
    if (!entries) return;
    this.enrichCache = entries;
    this._coldDirty = true;
    // 만료분 청소 — 저장 파일이 무한히 커지지 않게
    for (const url of Object.keys(this.enrichCache)) {
      if ((this.enrichCache[url].expiresAt || 0) < nowMs) delete this.enrichCache[url];
    }
    this._persistSoon();
  }

  // ---- 열기 눈금 시계열 영속화 (2026-08-01) ------------------------------
  // heatHist(수집 사이클별 반응량)도 메모리 풀에만 있으면 배포·재시작마다
  // 리셋된다 — 실제로 라이브에서 30건 중 0건만 눈금이 그려졌다(배포가 잦은
  // 기간엔 5칸이 모일 틈이 없다). 시그니처 요소가 사실상 죽으므로 저장한다.
  // 항목당 최대 14개 숫자라 900건 기준 수백 KB 수준.
  heatOf(id) {
    return this.heatHist ? this.heatHist[id] : undefined;
  }

  recordHeat(entries, nowMs) {
    this._coldDirty = true;
    if (!entries || !entries.length) return;
    if (!this.heatHist) this.heatHist = {};
    if (!this.heatSeen) this.heatSeen = {};
    for (const [id, hist] of entries) {
      this.heatHist[id] = hist.slice(-14);
      this.heatSeen[id] = nowMs;
    }
    // 풀에서 내려간 글의 시계열은 7일 뒤 청소 (firstSeen과 같은 기준)
    const cutoff = nowMs - 7 * 24 * 3600 * 1000;
    for (const id of Object.keys(this.heatSeen)) {
      if (this.heatSeen[id] < cutoff) { delete this.heatSeen[id]; delete this.heatHist[id]; }
    }
    this._persistSoon();
  }

  recordFirstSeen(entries, nowMs) {
    this._coldDirty = true;
    if (!entries || !entries.length) return;
    if (!this.firstSeen) this.firstSeen = {};
    for (const [id, at] of entries) {
      if (this.firstSeen[id] === undefined) this.firstSeen[id] = at;
    }
    const cutoff = nowMs - 7 * 24 * 3600 * 1000;
    for (const id of Object.keys(this.firstSeen)) {
      if (this.firstSeen[id] < cutoff) delete this.firstSeen[id];
    }
    this._persistSoon();
  }

  // ---- 일별 에디션 (브리핑+화제랭킹 스냅샷, 자체 콘텐츠 아카이브) ----------
  // engine.refresh()가 수집 사이클마다 그날(KST) 키로 덮어쓴다 — 하루의 마지막
  // 기록이 그날의 최종판이 되는 구조라 별도 마감 작업이 필요 없다. 아카이브는
  // /briefing/<날짜>, /ranking 주간·월간 집계의 원천이다. 전부 실측 스냅샷.
  saveDailyEdition(date, { briefing, ranking }) {
    if (!this.dailyEditions) this.dailyEditions = new Map();
    this.dailyEditions.set(date, { briefing, ranking, updatedAt: this._nowMs() });
    // 무한 성장 방지 — 아카이브는 400일이면 충분하고, 그 이상은 파일만 불린다
    if (this.dailyEditions.size > 400) {
      const dates = [...this.dailyEditions.keys()].sort();
      for (const d of dates.slice(0, dates.length - 400)) this.dailyEditions.delete(d);
    }
    this._persist();
  }

  // 소스 헬스 기록 — "마지막으로 건수가 있었던 시각"과 "마지막으로 반응
  // 수치가 있었던 시각". 판정 자체는 health.js가 하고 여기는 시각만 보관한다.
  // 이게 영속되지 않으면 재시작할 때마다 모든 소스가 "기록 없음"으로 돌아가
  // "3일째 죽어 있다"를 영영 말할 수 없다.
  saveSourceHealth(next) {
    this.sourceHealth = { ...(this.sourceHealth || {}), ...next };
    this._persistSoon();
  }

  getSourceHealth() {
    return this.sourceHealth || {};
  }

  // ---- 행동 분석 (analytics.js) -------------------------------------------
  // 이벤트는 들어오는 즉시 그날 버킷에 더한다. 원본 로그를 쌓지 않는 이유는
  // store가 단일 JSON 파일이라 선형으로 커지면 어느 시점에 못 읽기 때문이다.
  recordEvents(events, ctx = {}) {
    if (!Array.isArray(events) || !events.length) return 0;
    if (!this.analytics) this.analytics = {};
    const day = this._trafficDay(new Date(this._nowMs()));
    if (!this.analytics[day]) this.analytics[day] = emptyBucket();
    const b = this.analytics[day];
    let n = 0;
    for (const ev of events.slice(0, 50)) { // 한 요청이 버킷을 통째로 흔들지 못하게
      if (applyEvent(b, ev, ctx)) n++;
    }
    if (ctx.userId) {
      if (!b.uids.includes(ctx.userId) && b.uids.length < 100000) b.uids.push(ctx.userId);
      // "신규"는 그 유저의 가입 시각이 오늘인지로 본다 — 오늘 버킷에 처음
      // 나타났다는 것만으로는 어제 온 사람과 구분되지 않는다.
      const u = this.getUser(ctx.userId);
      const created = u && (u.createdAt || u.joinedAt);
      if (created && this._trafficDay(new Date(created)) === day && !b.newUids.includes(ctx.userId)) {
        b.newUids.push(ctx.userId);
      }
    }
    this._pruneBuckets("analytics", 400);
    this._persistSoon();
    return n;
  }

  // 세션 발급 때 신원 경로를 남긴다(server.js /api/session).
  recordIdentity(source) {
    if (!this.analytics) this.analytics = {};
    const day = this._trafficDay(new Date(this._nowMs()));
    if (!this.analytics[day]) this.analytics[day] = emptyBucket();
    const m = this.analytics[day].identity || (this.analytics[day].identity = {});
    const k = String(source || "new").slice(0, 20);
    m[k] = (m[k] || 0) + 1;
    this._persistSoon();
  }

  analyticsBuckets() {
    return this.analytics || {};
  }

  // ---- 지출 (costs.js) ----------------------------------------------------
  recordLlmCall({ model, inputTokens, outputTokens, purpose }) {
    if (!this.costs) this.costs = {};
    const day = this._trafficDay(new Date(this._nowMs()));
    if (!this.costs[day]) this.costs[day] = emptyCostBucket();
    recordCall(this.costs[day], { model, inputTokens, outputTokens, purpose });
    this._pruneBuckets("costs", 400);
    this._persistSoon();
  }

  costBuckets() {
    return this.costs || {};
  }

  // 고정비는 자동으로 알 길이 없어 David가 월 단위로 입력한다.
  // 미입력 달은 0이 아니라 "미입력"으로 보고된다(costs.fixedForRange).
  setFixedCosts(monthKey, entries) {
    if (!this.fixedCosts) this.fixedCosts = {};
    this.fixedCosts[monthKey] = (entries || [])
      .filter((e) => e && e.label)
      .slice(0, 30)
      .map((e) => ({ label: String(e.label).slice(0, 40), krw: Number(e.krw) || 0 }));
    this._persist();
    return this.fixedCosts[monthKey];
  }

  fixedCostsAll() {
    return this.fixedCosts || {};
  }

  // 쿠팡 정산액은 우리가 자동으로 읽을 수 없다 — David가 대시보드에서 넣는다.
  // 넣기 전에는 null로 남아 순이익 계산 자체를 하지 않는다.
  setRevenue(monthKey, krw) {
    if (!this.revenue) this.revenue = {};
    this.revenue[monthKey] = Number(krw) || 0;
    this._persist();
    return this.revenue[monthKey];
  }

  revenueAll() {
    return this.revenue || {};
  }

  _pruneBuckets(field, keep) {
    const m = this[field];
    if (!m) return;
    const keys = Object.keys(m);
    if (keys.length <= keep) return;
    for (const k of keys.sort().slice(0, keys.length - keep)) delete m[k];
  }

  // 브리핑 한 편을 저장한다 (날짜 + 슬롯). 요청 때마다 만들지 않고 하루 3번만
  // 만들어 두는 구조의 저장소다 — 페이지는 읽기만 하므로 항상 즉시 응답하고,
  // 해설도 그 시점 그대로 아카이브에 남는다(예전엔 실시간 /briefing에만
  // 있고 날짜별 아카이브에는 한 건도 없었다).
  saveBriefing(date, slotId, data) {
    if (!this.briefings) this.briefings = {};
    if (!this.briefings[date]) this.briefings[date] = {};
    this.briefings[date][slotId] = { ...data, savedAt: this._nowMs() };
    // 아카이브는 400일이면 충분하다 — 그 이상은 파일만 불린다.
    const dates = Object.keys(this.briefings).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - 400))) delete this.briefings[d];
    this._persist();
    return this.briefings[date][slotId];
  }

  getBriefing(date, slotId) {
    return (this.briefings && this.briefings[date] && this.briefings[date][slotId]) || null;
  }

  // 그날 저장된 편들 중 가장 최근 것. 슬롯 경계 직후 아직 안 만들어졌으면
  // 이전 슬롯을 보여준다 — 빈 화면보다 낫다.
  latestBriefing(date, order) {
    const day = (this.briefings && this.briefings[date]) || {};
    for (let k = order.length - 1; k >= 0; k--) if (day[order[k]]) return day[order[k]];
    return null;
  }

  briefingDates() {
    return this.briefings ? Object.keys(this.briefings).sort() : [];
  }

  getDailyEdition(date) {
    return (this.dailyEditions && this.dailyEditions.get(date)) || null;
  }

  listEditionDates() {
    return this.dailyEditions ? [...this.dailyEditions.keys()].sort() : [];
  }

  // 뉴스 성향 슬라이더 (-1 진보쪽 ~ 0 균형 ~ +1 보수쪽). 기본 0 = 성향 미개입.
  setLeanBalance(userId, balance) {
    const user = this.requireUser(userId);
    const v = Number(balance);
    user.leanBalance = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    this._persist();
    return user.leanBalance;
  }

  // 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 슬라이더.
  // -1 = 커뮤니티 쪽, 0 = 균형, +1 = 뉴스 쪽. 기본 0 = 미개입.
  // 성향 슬라이더(leanBalance)와 같은 골격 — 하나는 "뉴스 안에서 어느 쪽",
  // 다른 하나는 "뉴스냐 커뮤냐"로 축이 다르고 서로 곱해져 함께 작동한다.
  setMixBalance(userId, balance) {
    const user = this.requireUser(userId);
    const v = Number(balance);
    user.mixBalance = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    this._persist();
    return user.mixBalance;
  }


  // Record that an implicit signal was applied (for observability/metrics). The
  // preference-vector mutation itself happens in the engine via applyImplicit.
  recordSignal(userId, itemId, type, step) {
    const user = this.requireUser(userId);
    user.implicitCount = (user.implicitCount || 0) + 1;
    user.lastSignal = { itemId, type, step, at: nowIso(this.clock) };
    this._persist();
    return user.implicitCount;
  }

  recordRating(userId, itemId, signal) {
    const user = this.requireUser(userId);
    const prev = user.ratings[itemId];
    user.ratings[itemId] = { signal, at: nowIso(this.clock) };
    // only count the first rating of an item toward confidence volume
    if (!prev) user.feedbackCount += 1;
    this._persist();
    return user.ratings[itemId];
  }

  markSeen(userId, itemIds) {
    const user = this.requireUser(userId);
    const set = new Set(user.seen);
    for (const id of itemIds) set.add(id);
    // 상한 3,000 (David 2026-08-07: "본 걸 굳이 또 볼 필욘 없으니까").
    // 500이던 때 실측: 821명 중 17명이 이미 도달했고, 잘려나간 만큼 예전에
    // 본 글이 **다시 후보로 돌아왔다.** 피드는 seen을 후보에서 빼므로
    // 상한이 곧 "안 본 글만 보여주는" 보장의 길이다.
    // id 하나가 약 10바이트라 3,000개도 사용자당 30KB 수준이다.
    user.seen = [...set].slice(-3000);
    this._persist();
    return user.seen.length;
  }

  seenSet(userId) {
    const user = this.getUser(userId);
    return new Set(user ? user.seen : []);
  }

  // Record that a batch of sources was just shown to this user (one call per
  // item, or pass the same source multiple times for multiple items) — the
  // fairness ledger behind the home feed's round-robin (see ingest.js's
  // roundRobinInterleave `exposure` option). Never throws on an unknown
  // source id; a source that's since been removed from the registry just
  // accumulates a harmless, unused count.
  recordSourceExposure(userId, sources) {
    const user = this.requireUser(userId);
    user.sourceExposure = user.sourceExposure || {};
    for (const src of sources) {
      if (!src) continue;
      user.sourceExposure[src] = (user.sourceExposure[src] || 0) + 1;
    }
    this._persist();
    return user.sourceExposure;
  }

  sourceExposureFor(userId) {
    const user = this.getUser(userId);
    return (user && user.sourceExposure) || {};
  }

  // ---- monetization: ad/affiliate slot event tracking (docs/monetization.md) ----
  // Ad slot items are generated fresh per request (monetize.js) and never
  // stored as feed items, so they can't flow through recordSignal/recordRating
  // (both require a real item in the engine's collected pool). This is a
  // small, separate counter+log — enough for the "세션당 수익 proxy"(클릭수)
  // and for monetize.js's adaptive density (adResponsiveness below) without
  // pulling in an analytics dependency.
  // 광고 노출·클릭 기록.
  //
  // **익명도 받는다**(2026-08-06). 발행 페이지(브리핑·랭킹·리포트…)에는 배너가
  // 페이지마다 두 장씩 나가는데 방문자 대부분이 세션 없는 검색 유입이라,
  // userId를 요구하면 그 노출이 통째로 안 잡힌다. 실제로 안 잡히고 있었다 —
  // 쿠팡 콘솔에는 subId로 남지만 **우리 관리자에는 0**이었고, 그러면 어느
  // 자리가 돈이 되는지 우리 손으로 판단할 수 없다.
  // (블루프린트 대목적: "알고리즘보다 측정과 구매 의도가 먼저다.")
  recordAdEvent(userId, itemId, type, meta = {}) {
    const user = userId ? this.getUser(userId) : null;
    if (userId && !user) return null;   // 있는데 모르는 유저면 거절
    if (type !== "impression" && type !== "click") return user ? user.adStats : null;
    if (user) {
      user.adStats = user.adStats || { impressions: 0, clicks: 0 };
      if (type === "impression") user.adStats.impressions += 1;
      else user.adStats.clicks += 1;
    }
    // 자리별·날짜별 집계. adEvents는 최근 2,000건만 남기므로 그것만으로는
    // "지난주 어느 자리가 나았나"를 못 본다. 세는 값은 따로 쌓는다.
    if (meta.slot) {
      const day = this._trafficDay(new Date(this._nowMs()));
      this.adSlotStats = this.adSlotStats || {};
      const d = (this.adSlotStats[day] = this.adSlotStats[day] || {});
      const cell = (d[meta.slot] = d[meta.slot] || { impressions: 0, clicks: 0 });
      cell[type === "impression" ? "impressions" : "clicks"] += 1;
      const days = Object.keys(this.adSlotStats);
      if (days.length > 90) for (const k of days.sort().slice(0, days.length - 90)) delete this.adSlotStats[k];
    }

    // 라운드1 검수 #1: which sample product ids this user has actually seen,
    // so monetize.js's rotation can skip forward past them instead of
    // re-serving the same one. Small rolling window (not the full 2000-entry
    // adEvents log) so a product can cycle back in after enough scrolling —
    // see sampleAffiliateCandidates' `excludeIds` doc comment.
    if (user && type === "impression" && itemId) {
      user.adSeenIds = user.adSeenIds || [];
      user.adSeenIds = user.adSeenIds.filter((id) => id !== itemId);
      user.adSeenIds.push(itemId);
      if (user.adSeenIds.length > 6) user.adSeenIds = user.adSeenIds.slice(-6);
    }

    this.adEvents = this.adEvents || [];
    this.adEvents.push({ userId: userId || null, itemId, type,
      variant: meta.variant || null, slot: meta.slot || null, page: meta.page || null,
      at: nowIso(this.clock) });
    if (this.adEvents.length > 2000) this.adEvents = this.adEvents.slice(-2000); // cap memory, most-recent-last

    // 광고 노출은 스크롤마다 들어온다 — 요청마다 스토어 전체를 쓰면
    // 그 자체가 서비스를 느리게 만든다(2026-08-06 홈 4초 사고와 같은 종류).
    this._persistSoon();
    return user ? user.adStats : null;
  }

  // 자리별 성과 — 관리자 화면이 읽는다. 실제로 센 값만 돌려준다.
  adSlotReport(days = 7) {
    const out = new Map();
    const keys = Object.keys(this.adSlotStats || {}).sort().slice(-days);
    for (const k of keys) {
      for (const [slot, v] of Object.entries(this.adSlotStats[k] || {})) {
        const cur = out.get(slot) || { slot, impressions: 0, clicks: 0 };
        cur.impressions += v.impressions || 0;
        cur.clicks += v.clicks || 0;
        out.set(slot, cur);
      }
    }
    return [...out.values()]
      .map((r) => ({ ...r, ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0 }))
      .sort((a, b) => b.impressions - a.impressions);
  }

  // Recently-impressed ad/affiliate sample ids for this user (see
  // recordAdEvent above) — monetize.js's sampleAffiliateCandidates rotates
  // past these instead of re-picking the same product back-to-back.
  adSeenIdsFor(userId) {
    const user = this.getUser(userId);
    return new Set((user && user.adSeenIds) || []);
  }

  // Monotonic per-user counter, advanced once per _monetize() call
  // (engine.js) regardless of the request's `cursor` step size. Fixes the
  // 라운드1 검수 #1 root cause: deriving the rotation seed from `cursor`
  // meant an even paging `limit` (e.g. 10) kept the seed's parity fixed
  // forever. This counter always advances, even/odd steps alike.
  nextAdSeed(userId) {
    const user = this.requireUser(userId);
    user.adSeedSeq = (user.adSeedSeq || 0) + 1;
    this._persist();
    return user.adSeedSeq;
  }

  // ---- monetization: session-total slot cap (라운드1 검수 #7) ----
  // AD_MAX_PER_PAGE only bounds a single request/page — without this, an
  // endlessly-scrolling session accumulates unlimited ad slots over time.
  // Tracked as a rolling window (default 24h, since this app has no explicit
  // login-session boundary — userId persists across requests) rather than an
  // ever-growing lifetime count, so a returning user isn't permanently capped.
  recordAdSlotsServed(userId, n) {
    const user = this.requireUser(userId);
    if (!n) return this.adSlotsServedCount(userId);
    user.adServedAt = user.adServedAt || [];
    const now = this._nowMs();
    for (let i = 0; i < n; i++) user.adServedAt.push(now);
    if (user.adServedAt.length > 500) user.adServedAt = user.adServedAt.slice(-500); // cap memory
    this._persist();
    return this.adSlotsServedCount(userId);
  }

  adSlotsServedCount(userId, opts = {}) {
    const user = this.getUser(userId);
    if (!user || !user.adServedAt || !user.adServedAt.length) return 0;
    const windowMs = opts.windowMs ?? Number(process.env.AD_SESSION_WINDOW_MS || 24 * 60 * 60 * 1000);
    const now = this._nowMs();
    return user.adServedAt.filter((t) => now - t < windowMs).length;
  }

  // Observed click-through ratio for this user vs a reference CTR (see
  // monetize.js's adaptiveEvery, which this feeds). null = not enough
  // impressions yet — caller must treat that as "no signal, use the
  // configured default density," never as "zero responsiveness."
  adResponsiveness(userId, opts = {}) {
    const user = this.getUser(userId);
    const stats = user && user.adStats;
    if (!stats || !stats.impressions) return null;
    const minSample = opts.minSample ?? 5;
    if (stats.impressions < minSample) return null;
    const ctr = stats.clicks / stats.impressions;
    const baseline = opts.baselineCtr ?? Number(process.env.AD_BASELINE_CTR || 0.02);
    return baseline > 0 ? ctr / baseline : null;
  }

  // Aggregate ad stats for the admin console — the "1차지표=세션당 수익
  // proxy(클릭수)" and a raw recent-event tail for the retention guardrail
  // (직후 유기카드 스크롤 지속 여부 — joined against `seen` timestamps by an
  // analyst; this store only needs to keep the raw log, not compute that join).
  adminAdStats() {
    let impressions = 0;
    let clicks = 0;
    for (const u of this.users.values()) {
      impressions += (u.adStats && u.adStats.impressions) || 0;
      clicks += (u.adStats && u.adStats.clicks) || 0;
    }
    return {
      impressions,
      clicks,
      ctr: impressions ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
      recentEvents: (this.adEvents || []).slice(-50)
    };
  }

  // User-generated post. Becomes a first-class feed item (kind "community",
  // source "me"), so the space really behaves like a community built for you.
  _nowMs() {
    return Date.parse(nowIso(this.clock));
  }

  // Rulebook merged with any admin-added banned words.
  _rules() {
    if (!this.adminBannedWords || !this.adminBannedWords.length) return DEFAULT_RULES;
    return { ...DEFAULT_RULES, bannedWords: [...DEFAULT_RULES.bannedWords, ...this.adminBannedWords] };
  }

  // Count a user's recent posts/comments/submissions within a window, for rate limiting.
  recentActionCount(userId, type, windowMs) {
    const now = this._nowMs();
    if (type === "post") {
      return (this.posts || []).filter(
        (p) => p.userId === userId && now - Date.parse(p.publishedAt) < windowMs
      ).length;
    }
    if (type === "submit") {
      return (this.submissions || []).filter(
        (s) => s.userId === userId && now - Date.parse(s.publishedAt) < windowMs
      ).length;
    }
    const user = this.getUser(userId);
    return (user && user.comments ? user.comments : []).filter(
      (c) => now - Date.parse(c.at) < windowMs
    ).length;
  }

  createPost(userId, post) {
    const user = this.requireUser(userId);
    // enforce the space's posting rules (length, banned words, tags, rate limit)
    const check = validatePost(post, {
      recentPosts: this.recentActionCount(userId, "post", 10 * 60 * 1000)
    }, this._rules());
    if (!check.ok) {
      const err = new Error(check.errors.join(" "));
      err.rule = check;
      throw err;
    }
    const title = String(post.title || "").trim();
    const record = {
      id: this._id("post"),
      userId,
      kind: "community",
      source: "me",
      via: "me", // provenance: a user's own post keeps its full body (see legal.md), and
      // is the one card type the feed still opens in-app rather than out-linking (index.html)
      category: post.category || "life",
      tags: Array.isArray(post.tags) ? post.tags.slice(0, 8) : [],
      title: title.slice(0, 300),
      summary: String(post.summary || post.body || "").slice(0, 2000),
      // **내부 userId를 공개 필드에 담지 않는다.** (적대적 검수 2026-08-06)
      // 여기 있던 userId가 /api/feed·/api/item 응답에 그대로 나가서,
      // 누구나 남의 계정 id를 수집할 수 있었다 — 계정 결속 탈취(P0)의 재료다.
      // 소유권은 아래 record.userId가 계속 들고 있고, 화면에는 닉네임만 간다.
      author: user.nickname || "익명",
      adult: post.adult === true,
      lang: "ko",
      score: 0,
      commentCount: 0,
      publishedAt: nowIso(this.clock)
    };
    if (!this.posts) this.posts = [];
    this.posts.push(record);
    user.posts = user.posts || [];
    user.posts.push(record.id);
    this._persist();
    return record;
  }

  // All user posts, for a store-backed feed source.
  allPosts() {
    return this.posts || [];
  }

  // User-submitted out-link (legal ingestion path: no crawling). `item` comes
  // from ingest.normalizeSubmission — title + short excerpt + source + url.
  addSubmission(userId, item) {
    const user = this.requireUser(userId);
    if (!item || !item.url) throw new Error("링크가 필요해요.");
    // rate limit: reuses the same perWindow/windowMs shape as post/comment
    const r = this._rules().submit;
    const recent = this.recentActionCount(userId, "submit", r.windowMs);
    if (recent >= r.perWindow) {
      const err = new Error(`잠시 후에 다시 제출해주세요. (${r.windowMs / 60000}분에 ${r.perWindow}개까지)`);
      err.rule = { rateLimited: true };
      throw err;
    }
    const record = {
      id: this._id("sub"),
      userId,
      via: "submit",
      score: 0,
      commentCount: 0,
      publishedAt: nowIso(this.clock),
      ...item
    };
    this.submissions = this.submissions || [];
    this.submissions.push(record);
    this._persist();
    return record;
  }

  allSubmissions() {
    return this.submissions || [];
  }

  // ---- 우리가 직접 올리는 딜 (애드핏 P0-A ①, David 2026-08-06) ----
  //
  // 애드핏 4차 반려: "자체 콘텐츠가 아닌 외부 콘텐츠, 외부 링크가 많은 비중을
  // 차지하고 있는 매체는 광고 게재가 허용되지 않습니다."
  //
  // 커뮤니티에서 긁어 온 딜은 아웃링크다. 우리가 고르고 우리가 쓴 상품 소개는
  // **자체 콘텐츠**이고, 링크도 아웃링크가 아니라 제휴 링크다. 정책의 모든
  // 조항(복제 아님·자체 콘텐츠 있음·아웃링크 아님)을 통과한다.
  //
  // **가격과 상품명은 David가 확인한 값만 저장한다.** 쿠팡 짧은 링크는
  // Akamai 봇 차단 + JS 리다이렉트라 서버에서 상품 정보를 뽑을 수 없고
  // (2026-08-06 실측), 상품 페이지를 긁는 것은 우리 원칙에 어긋난다.
  // 그래서 지어내지 않고 입력받는다 — 실측 안 된 숫자는 쓰지 않는다.
  ourDeals() {
    return this.ourDealsList || [];
  }

  createOurDeal(deal) {
    const url = String(deal.url || "").trim();
    const title = String(deal.title || "").trim();
    const price = String(deal.price || "").trim();
    if (!/^https:\/\/(link\.coupang\.com|www\.coupang\.com|coupa\.ng)\//i.test(url)) {
      throw new Error("쿠팡 파트너스 링크만 등록할 수 있어요 (link.coupang.com)");
    }
    if (title.length < 4) throw new Error("상품명을 4자 이상 적어주세요");
    if (title.length > 120) throw new Error("상품명이 너무 길어요 (120자까지)");
    if (!price) throw new Error("가격을 적어주세요 — 지어낼 수 없는 값이에요");
    if (price.length > 40) throw new Error("가격 표기가 너무 길어요 (40자까지)");
    const img = String(deal.image || "").trim();
    if (img && !/^https:\/\//i.test(img)) throw new Error("사진 주소는 https 주소여야 해요");
    if (img.length > 500) throw new Error("사진 주소가 너무 길어요");

    // ── 우리가 확인할 수 없는 주장은 받지 않는다
    //
    // products.json의 원칙과 같다: "가격은 출처에 적힌 것을 그대로만 옮긴다.
    // 우리가 확인할 수 없는 할인율·재고·기간을 쓰는 순간 허위표시다."
    //
    // 쿠팡 상품 페이지에는 "12% 할인", "~~27,900원~~", "한 달간 7,000명 이상
    // 구매", "품절임박" 같은 것이 함께 붙어 온다. 그중 **가격만** 옮긴다.
    // 나머지는 시간이 지나면 틀려지는데 우리는 그걸 갱신할 방법이 없다 —
    // 틀린 채로 남으면 그 순간 허위표시가 된다(David 고정 원칙, 2026-08-06).
    const note = String(deal.note || "").trim();
    const RISKY = /(\d+\s*[%％])|할인율|최저가|역대가|품절\s*임박|재고\s*(소진|얼마|없)|한정\s*(수량|판매)|마감\s*임박|오늘\s*만|특가\s*마감/;
    if (RISKY.test(note)) {
      throw new Error("할인율·재고·기간 주장은 넣을 수 없어요 — 시간이 지나면 틀려지는데 우리가 갱신할 방법이 없어요");
    }
    if (note.length > 120) throw new Error("한 줄 소개가 너무 길어요 (120자까지)");
    // 가격 표기에도 같은 잣대를 댄다. "27,900원 → 24,290원"처럼 원가를 함께
    // 쓰면 그 원가가 언제 틀려질지 우리가 모른다.
    if (/[%％]|→|->/.test(price)) {
      throw new Error("가격은 지금 팔리는 값 하나만 적어주세요 (원가·할인율 제외)");
    }

    const record = {
      id: this._id("odeal"),
      via: "ourdeal",
      source: "nowhot-deal",
      sourceLabel: "지금핫 딜",
      // kind는 출처 성격(커뮤니티/뉴스)을 가리키는 필드다 — normalizeItem이
      // 두 값만 허용하므로 광고 표시용으로 쓸 수 없다(넣으면 "news"로 떨어진다).
      // 광고 여부는 via/affiliate가 말한다.
      kind: "community",
      category: String(deal.category || "life"),
      title,
      price,
      // 한 줄 소개 — 우리가 쓴 문장이다. 없으면 비워 둔다(지어내지 않는다).
      summary: note,
      url,
      image: img || null,
      dest: String(deal.dest || "").trim() || null,
      score: 0,
      commentCount: 0,
      publishedAt: nowIso(this.clock),
      // 가격을 **언제 확인했는지**. 값만 보여주면 영원히 유효한 것처럼 읽힌다 —
      // 우리는 갱신하지 않으므로 시점을 함께 밝혀야 정직하다.
      priceCheckedAt: nowIso(this.clock),
      createdAt: Date.now()
    };
    this.ourDealsList = this.ourDealsList || [];
    // 같은 링크를 두 번 올리면 화면에서는 하나로 합쳐지고(중복 제거) 관리자
    // 목록에만 둘로 남아 "올렸는데 안 보인다"가 된다(검수 2026-08-06).
    if (this.ourDealsList.some((d) => d.url === url)) {
      throw new Error("이미 등록된 링크예요");
    }
    // 상한. 관리자 토큰만 있으면 저장소를 무한히 불릴 수 있었다.
    if (this.ourDealsList.length >= 200) {
      throw new Error("등록 상한(200건)에 닿았어요 — 오래된 딜을 먼저 내려주세요");
    }
    this.ourDealsList.unshift(record);
    this._persist();
    return record;
  }

  deleteOurDeal(id) {
    const before = (this.ourDealsList || []).length;
    this.ourDealsList = (this.ourDealsList || []).filter((d) => d.id !== id);
    if (this.ourDealsList.length !== before) this._persist();
    return before !== this.ourDealsList.length;
  }

  // ---- admin / moderation ----

  // Extra banned words configured at runtime by an admin (merged with the
  // static rulebook when validating posts/comments).
  bannedWords() {
    return this.adminBannedWords || [];
  }
  addBannedWord(word) {
    const w = String(word || "").trim();
    if (!w) return this.bannedWords();
    this.adminBannedWords = this.adminBannedWords || [];
    if (!this.adminBannedWords.includes(w)) this.adminBannedWords.push(w);
    this._persist();
    return this.adminBannedWords;
  }
  removeBannedWord(word) {
    this.adminBannedWords = (this.adminBannedWords || []).filter((w) => w !== word);
    this._persist();
    return this.adminBannedWords;
  }

  // Globally disable/enable a source for everyone (admin-level, distinct from a
  // user's personal mute).
  setSourceDisabled(sourceId, disabled) {
    this.adminDisabledSources = this.adminDisabledSources || [];
    const has = this.adminDisabledSources.includes(sourceId);
    if (disabled && !has) this.adminDisabledSources.push(sourceId);
    if (!disabled && has) this.adminDisabledSources = this.adminDisabledSources.filter((s) => s !== sourceId);
    this._persist();
    return this.adminDisabledSources;
  }
  disabledSources() {
    return new Set(this.adminDisabledSources || []);
  }

  deletePost(id) {
    const before = (this.posts || []).length;
    const post = (this.posts || []).find((p) => p.id === id);
    this.posts = (this.posts || []).filter((p) => p.id !== id);
    if (post) {
      const owner = this.users.get(post.userId);
      if (owner) owner.posts = (owner.posts || []).filter((pid) => pid !== id);
      if (this.commentsByItem) this.commentsByItem.delete(id); // drop its thread
    }
    this._persist();
    return before !== (this.posts || []).length;
  }

  deleteComment(id) {
    let removed = false;
    if (this.commentsByItem) {
      for (const [itemId, list] of this.commentsByItem) {
        const next = list.filter((c) => c.id !== id);
        if (next.length !== list.length) {
          removed = true;
          this.commentsByItem.set(itemId, next);
        }
      }
    }
    for (const u of this.users.values()) {
      if (u.comments && u.comments.some((c) => c.id === id)) {
        u.comments = u.comments.filter((c) => c.id !== id);
        removed = true;
      }
    }
    if (removed) this._persist();
    return removed;
  }

  adminStats() {
    let comments = 0;
    let ratings = 0;
    let signals = 0;
    for (const u of this.users.values()) {
      comments += (u.comments || []).length;
      ratings += Object.keys(u.ratings || {}).length;
      signals += u.implicitCount || 0;
    }
    return {
      users: this.users.size,
      posts: (this.posts || []).length,
      comments,
      ratings,
      signals,
      disabledSources: [...this.disabledSources()],
      bannedWords: this.bannedWords()
    };
  }

  adminUsers() {
    return [...this.users.values()].map((u) => ({
      id: u.id,
      createdAt: u.createdAt,
      surveyed: u.surveyed,
      feedbackCount: u.feedbackCount || 0,
      posts: (u.posts || []).length,
      comments: (u.comments || []).length
    }));
  }

  // Scrap / un-scrap an item. Returns the new saved state (boolean).
  toggleSave(userId, itemId, on) {
    const user = this.requireUser(userId);
    user.saved = user.saved || [];
    const has = user.saved.includes(itemId);
    const want = on == null ? !has : Boolean(on);
    if (want && !has) user.saved.push(itemId);
    if (!want && has) user.saved = user.saved.filter((id) => id !== itemId);
    this._persist();
    return want;
  }

  savedIds(userId) {
    const user = this.getUser(userId);
    return user && user.saved ? user.saved : [];
  }

  // Mute / unmute a source so it stops appearing in the feed. Returns muted list.
  setMute(userId, source, muted) {
    const user = this.requireUser(userId);
    user.mutedSources = user.mutedSources || [];
    const has = user.mutedSources.includes(source);
    if (muted && !has) user.mutedSources.push(source);
    if (!muted && has) user.mutedSources = user.mutedSources.filter((s) => s !== source);
    this._persist();
    return user.mutedSources;
  }

  mutedSet(userId) {
    const user = this.getUser(userId);
    return new Set(user && user.mutedSources ? user.mutedSources : []);
  }

  // 기본 숨김 토픽(정치/종교) 켜고 끄기. adult는 여기 없다 — 성인 콘텐츠를
  // 켜는 기능 자체가 없어졌다(David 2026-08-05, 애드핏 2차 보류).
  setTopicFilter(userId, topic, on) {
    const user = this.requireUser(userId);
    if (!FILTER_KEYS.includes(topic)) {
      throw new Error(`unknown filterable topic: ${topic}`);
    }
    user.showTopics = user.showTopics || [];
    const has = user.showTopics.includes(topic);
    if (on && !has) user.showTopics.push(topic);
    if (!on && has) user.showTopics = user.showTopics.filter((t) => t !== topic);
    this._persist();
    return user.showTopics;
  }

  showTopicsSet(userId) {
    const user = this.getUser(userId);
    return new Set(user && user.showTopics ? user.showTopics : []);
  }

  // "내 공간" — everything the user has created or reacted to in one place.
  mySpace(userId) {
    const user = this.requireUser(userId);
    const myPosts = (this.posts || []).filter((p) => p.userId === userId);
    const myComments = user.comments || [];
    // 최근 본 글 — "본 걸 다시 찾고 싶을 때"를 위한 발자취(David 2026-08-07).
    // seen은 오래된 것이 앞이므로 뒤집어 최근순으로 준다.
    const recentIds = (user.seen || []).slice(-40).reverse();
    const ratings = Object.entries(user.ratings || {}).map(([itemId, r]) => ({ itemId, ...r }));
    const liked = ratings.filter((r) => r.signal > 0).length;
    const disliked = ratings.filter((r) => r.signal < 0).length;

    // likes received on this user's own posts, across everyone's ratings —
    // the reputation signal that drives level progression
    const myPostIds = new Set(myPosts.map((p) => p.id));
    let likesReceived = 0;
    for (const u of this.users.values()) {
      for (const [itemId, r] of Object.entries(u.ratings || {})) {
        if (r.signal > 0 && myPostIds.has(itemId)) likesReceived += 1;
      }
    }

    const counts = {
      posts: myPosts.length,
      comments: myComments.length,
      likes: liked,
      dislikes: disliked,
      saved: (user.saved || []).length,
      likesReceived
    };
    return {
      nickname: user.nickname,
      posts: myPosts,
      comments: myComments,
      ratings: { total: ratings.length, liked, disliked, items: ratings },
      savedIds: user.saved || [],
      recentIds,
      mutedSources: user.mutedSources || [],
      showTopics: user.showTopics || [],
      // 저장된 취향 답 — 내 공간에서 "지금 이렇게 돼 있다"를 보여 주고 거기서
      // 고칠 수 있어야 한다(David 2026-08-05). 예전엔 매번 빈 화면에서 처음부터
      // 다시 고르게 해서, 무엇을 골랐었는지 알 수 없었다.
      surveyAnswers: user.surveyAnswers || null,
      level: userLevel(counts),
      counts
    };
  }

  addComment(userId, itemId, body) {
    const user = this.requireUser(userId);
    const check = validateComment(body, {
      recentComments: this.recentActionCount(userId, "comment", 10 * 60 * 1000)
    }, this._rules());
    if (!check.ok) {
      const err = new Error(check.errors.join(" "));
      err.rule = check;
      throw err;
    }
    const text = String(body || "").trim();
    const comment = {
      id: this._id("cmt"),
      userId,
      author: user.nickname || nicknameFor(userId), // show a nickname, never "나"
      itemId,
      body: text.slice(0, 2000),
      at: nowIso(this.clock)
    };
    user.comments.push(comment);
    if (!this.commentsByItem) this.commentsByItem = new Map();
    const list = this.commentsByItem.get(itemId) || [];
    list.push(comment);
    this.commentsByItem.set(itemId, list);
    this._persist();
    return comment;
  }

  commentsFor(itemId) {
    if (!this.commentsByItem) return [];
    return this.commentsByItem.get(itemId) || [];
  }

  // 자주 일어나고 하나쯤 늦어도 되는 기록(방문 수·행동 로그·수집 캐시)을
  // 위한 저장. **요청을 막지 않는다.**
  //
  // 실사용 제보(현지, 2026-08-06 16:10) — "너무 느려졌엉", 공유링크가 뜨는 데
  // 두 번 한참 걸린다. 실측: 홈 TTFB 4.2초인데 /briefing 42ms·/api/health
  // 52ms. 홈만 느릴 이유가 SSR에는 없었다.
  //
  // 원인은 저장이었다. _persist()는 스토어 **전체**(가입자·댓글·enrichCache·
  // heatHist·세션 …)를 JSON으로 찍어 동기로 쓴다. 그 파일이 11.8MB로 자랐는데
  // recordTraffic·sessionUser가 **요청마다** 그걸 불렀다. 동기 작업이라 그동안
  // 이벤트 루프가 멈추고, 그래서 홈의 withDeadline(1200) 타이머조차 못 뜬다
  // (타이머는 루프가 비어야 뜬다) — 데드라인을 걸어 뒀는데도 4초가 걸린 이유다.
  //
  // 여러 번 불려도 한 번만 쓴다. 최대 PERSIST_DEBOUNCE_MS만큼 밀린다.
  _persistSoon() {
    if (!this.file) return;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      try { this._persist(); } catch (err) {
        console.error("[store] 지연 저장 실패:", err && err.message ? err.message : err);
      }
    }, PERSIST_DEBOUNCE_MS);
    // 프로세스가 이것 때문에 살아 있을 이유는 없다. 대신 종료 훅에서 비운다.
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  // 밀린 저장이 있으면 지금 쓴다. 종료 직전에 부른다.
  flushPending() {
    if (!this._flushTimer) return false;
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    try { this._persist(); return true; } catch { return false; }
  }

  _persist() {
    if (!this.file) return;
    // 즉시 저장이 들어오면 밀려 있던 것도 함께 나간다.
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    const data = {
      seq: this._seq,
      users: [...this.users.values()],
      posts: this.posts || [],
      submissions: this.submissions || [],
      ourDealsList: this.ourDealsList || [],
      adminDisabledSources: this.adminDisabledSources || [],
      adminBannedWords: this.adminBannedWords || [],
      adEvents: this.adEvents || [],
      adSlotStats: this.adSlotStats || {},
      visitorMap: this.visitorMap || {},
      traffic: this.traffic || {}, // 일별 방문 실측 — 재시작에도 유지 (2026-08-01)
      // 일별 에디션(브리핑+화제랭킹 스냅샷) — 자체 콘텐츠 아카이브의 원천이라
      // 재시작에도 반드시 유지 (애드핏 대응, David 2026-07-31)
      dailyEditions: [...(this.dailyEditions || new Map())].map(([date, e]) => ({ date, ...e })),
      sourceHealth: this.sourceHealth || {},
      briefings: this.briefings || {},
      analytics: this.analytics || {},
      costs: this.costs || {},
      fixedCosts: this.fixedCosts || {},
      revenue: this.revenue || {},
      sessions: [...(this.sessions || new Map())].map(([token, s]) => ({ token, ...s }))
    };
    // ── 원자적 쓰기 (2026-08-05 전수검사 P0)
    //
    // 예전엔 대상 파일에 곧바로 썼다. 쓰는 도중 프로세스가 죽으면 파일이
    // 반쯤 쓰인 채 남고, 그러면 다음 시작 때 JSON 파싱이 실패한다.
    // 그리고 아래 _load의 catch가 그 실패를 조용히 삼키고 **빈 상태로**
    // 시작했다 — 그다음 저장이 그 빈 상태로 원본을 덮어썼다.
    // 정전이나 나쁜 타이밍의 재시작 한 번에 가입자·댓글·취향이 통째로
    // 사라지고, **사라진 줄도 모른다.**
    //
    // 임시 파일에 다 쓴 뒤 rename으로 바꿔치기한다. rename은 같은 파일
    // 시스템에서 원자적이라 중간 상태가 존재하지 않는다 — 읽는 쪽은 항상
    // 옛 파일 아니면 새 파일을 본다.
    // ── 더운 것과 찬 것을 나눈다 (2026-08-07 라이브 장애)
    //
    // 실측: 저장 파일 8.8MB 중 6.3MB(firstSeen·heatSeen·heatHist·enrichCache)는
    // **수집 사이클(15분)에 한 번만 바뀌는** 데이터인데, 사용자 행동이 올 때마다
    // 2초 디바운스로 전체를 다시 직렬화했다. CPU 프로파일에서 _persist가
    // **71%** — 이벤트 루프가 상시 막혀 /api/health까지 0.8초, 홈 TTFB 2.5초,
    // David 제보 "접속이 안 돼 이용자 다 이탈하겠다".
    //
    // 찬 4종은 별도 파일에, **바뀐 사이클에만** 쓴다(recordFirstSeen·recordHeat·
    // setEnrichCache가 _coldDirty를 세운다). 더운 파일은 ~2MB라 2초 디바운스가
    // 다시 감당된다. 디바운스 자체(TTFB 4초 사고의 해법)는 건드리지 않는다.
    const tmp = `${this.file}.tmp`;
    try {
      // 들여쓰기를 넣지 않는다. 사람이 읽을 파일이 아니고, 실측(2026-08-06)
      // 11.8MB짜리를 요청마다 예쁘게 찍고 있었다 — 크기도 시간도 두 배다.
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
      if (this._coldDirty) {
        const cold = {
          firstSeen: this.firstSeen || {},
          heatHist: this.heatHist || {},
          heatSeen: this.heatSeen || {},
          enrichCache: this.enrichCache || {}
        };
        const ctmp = `${this.file}.cold.tmp`;
        fs.writeFileSync(ctmp, JSON.stringify(cold));
        fs.renameSync(ctmp, `${this.file}.cold`);
        this._coldDirty = false;
      }
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      throw err;
    }
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this._seq = data.seq || 0;
      this.users = new Map();
      this.commentsByItem = new Map();
      this.posts = data.posts || [];
      this.submissions = data.submissions || [];
      this.ourDealsList = data.ourDealsList || [];
      this.adminDisabledSources = data.adminDisabledSources || [];
      this.adminBannedWords = data.adminBannedWords || [];
      this.adEvents = data.adEvents || [];
      this.adSlotStats = data.adSlotStats || {};
      this.visitorMap = data.visitorMap || {};
      this.traffic = data.traffic || {};
      this.dailyEditions = new Map((data.dailyEditions || []).map((e) => [e.date, { briefing: e.briefing, ranking: e.ranking, updatedAt: e.updatedAt }]));
      this.sourceHealth = data.sourceHealth || {};
      this.briefings = data.briefings || {};
      this.analytics = data.analytics || {};
      this.costs = data.costs || {};
      this.fixedCosts = data.fixedCosts || {};
      this.revenue = data.revenue || {};
      this.firstSeen = data.firstSeen || {};
      this.heatHist = data.heatHist || {};
      this.enrichCache = data.enrichCache || {};
      this.heatSeen = data.heatSeen || {};
      this.sessions = new Map((data.sessions || []).map((s) => [s.token, { userId: s.userId, expiresAt: s.expiresAt }]));
      for (const user of data.users || []) {
        if (!user.nickname) user.nickname = nicknameFor(user.id); // backfill
        this.users.set(user.id, user);
        for (const c of user.comments || []) {
          const list = this.commentsByItem.get(c.itemId) || [];
          list.push(c);
          this.commentsByItem.set(c.itemId, list);
        }
      }
      // 분리 저장된 찬 데이터(있으면). 반드시 **모든 대입이 끝난 뒤**에 덮는다 —
      // 처음엔 중간에 넣었다가 뒤의 `this.firstSeen = data.firstSeen`이 도로
      // 덮어 재시작 생존이 조용히 깨졌다(로컬 검증에서 잡음).
      try {
        const cold = JSON.parse(fs.readFileSync(`${this.file}.cold`, "utf8"));
        if (cold.firstSeen) this.firstSeen = cold.firstSeen;
        if (cold.heatHist) this.heatHist = cold.heatHist;
        if (cold.heatSeen) this.heatSeen = cold.heatSeen;
        if (cold.enrichCache) this.enrichCache = cold.enrichCache;
      } catch { /* cold 파일이 아직 없으면 그대로 */ }
    } catch (err) {
      // ── 손상된 파일을 조용히 무시하지 않는다 (2026-08-05 전수검사 P0)
      //
      // 예전엔 여기서 빈 Map으로 시작했다. 그 주석("start fresh")은 선의였지만
      // 결과가 나빴다 — 빈 상태로 시작한 뒤 **다음 저장이 원본을 덮어써서**
      // 손상 한 번이 영구 소실이 됐다. 게다가 아무 로그도 남지 않아 사라진
      // 줄도 몰랐다.
      //
      // 파일이 아예 없으면(첫 실행) 빈 상태가 맞다. 있는데 못 읽는 것은
      // 다른 이야기다 — 그건 **사고**이고, 덮어쓰기 전에 사람이 봐야 한다.
      if (err && err.code === "ENOENT") {
        this.users = new Map();
        this.sessions = new Map();
        return;
      }
      // 손상본을 옆에 치워 둔다. 지우지 않는다 — 사람이 열어 보면 상당 부분을
      // 건질 수 있다.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try { fs.renameSync(this.file, backup); } catch {}
      throw new Error(
        `저장 파일을 읽지 못했습니다: ${err.message}\n` +
        `손상본을 ${backup} 로 옮겼습니다. 빈 상태로 시작하면 다음 저장이 원본을 덮어쓰므로 중단합니다.`
      );
    }
  }
}
