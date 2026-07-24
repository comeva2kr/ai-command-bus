// File-backed quiz store with the command bus's approval gate baked in.
//
// Generated quizzes land as *drafts*. Publishing is an external side effect
// (콘텐츠가 대중에게 노출됨) — per the repo's safety rules it must pass through
// human approval, so approve() is the only path from drafts/ to published/,
// and the weekly pipeline routes a "publish quiz" task into decision_queue
// via routeTask() rather than publishing on its own.

import fs from "node:fs";
import path from "node:path";

export class QuizStore {
  constructor(opts = {}) {
    this.dir = opts.dir || process.env.QUIZ_DIR || path.join(process.cwd(), "data", "quiz");
    this.draftsDir = path.join(this.dir, "drafts");
    this.publishedDir = path.join(this.dir, "published");
    // 디렉토리는 쓰기 시점에 생성 — 서버가 QuizStore를 물고만 있어도 (퀴즈 기능을
    // 안 쓰는 테스트/배포에서) 빈 data/ 디렉토리를 만들지 않도록.
  }

  // slug is filesystem-facing input — reject anything that could traverse.
  static safeSlug(slug) {
    const s = String(slug || "");
    if (!/^[a-z0-9-]+$/i.test(s)) throw new Error("잘못된 슬러그예요.");
    return s;
  }

  saveDraft(slug, quiz, meta = {}) {
    const s = QuizStore.safeSlug(slug);
    const record = { slug: s, status: "draft", ...meta, quiz };
    fs.mkdirSync(this.draftsDir, { recursive: true });
    this._writeAtomic(path.join(this.draftsDir, `${s}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  getDraft(slug) {
    return this._read(path.join(this.draftsDir, `${QuizStore.safeSlug(slug)}.json`));
  }

  listDrafts() {
    return this._list(this.draftsDir);
  }

  // Human approval: move draft → published. Refuses if there's no draft, so
  // nothing can be published that didn't go through the pipeline.
  approve(slug, meta = {}) {
    const s = QuizStore.safeSlug(slug);
    const draft = this.getDraft(s);
    if (!draft) throw new Error(`승인할 초안이 없어요: ${s}`);
    const record = { ...draft, status: "published", publishedAt: meta.publishedAt || new Date().toISOString() };
    fs.mkdirSync(this.publishedDir, { recursive: true });
    this._writeAtomic(path.join(this.publishedDir, `${s}.json`), JSON.stringify(record, null, 2));
    fs.unlinkSync(path.join(this.draftsDir, `${s}.json`));
    return record;
  }

  getPublished(slug) {
    let s;
    try {
      s = QuizStore.safeSlug(slug);
    } catch {
      return null; // 잘못된 슬러그는 그냥 404로
    }
    return this._read(path.join(this.publishedDir, `${s}.json`));
  }

  listPublished() {
    return this._list(this.publishedDir);
  }

  // --- 응답 통계 -----------------------------------------------------------
  // 결과 페이지의 "응답자 중 N%" 희소성 통계용. 실응답을 누적 집계하고,
  // 표본이 작을 때는 라플라스 스무딩(코드당 +1)으로 극단값을 완화한다 —
  // 초기엔 사전분포로 시딩하고 시간이 갈수록 실데이터가 지배.

  recordResponse(slug, code) {
    const s = QuizStore.safeSlug(slug);
    const record = this.getPublished(s);
    if (!record) throw new Error("발행된 테스트가 아니에요.");
    if (!record.quiz.results.some((r) => r.code === code)) throw new Error("없는 유형 코드예요.");
    const statsDir = path.join(this.dir, "stats");
    fs.mkdirSync(statsDir, { recursive: true });
    const file = path.join(statsDir, `${s}.json`);
    const stats = this._read(file) || { counts: {}, total: 0 };
    stats.counts[code] = (stats.counts[code] || 0) + 1;
    stats.total += 1;
    this._writeAtomic(file, JSON.stringify(stats));
    return stats;
  }

  // 유형별 점유율(%): (count+1) / (total+유형수) — 스무딩 포함.
  statsFor(slug, codes) {
    let s;
    try {
      s = QuizStore.safeSlug(slug);
    } catch {
      return null;
    }
    const stats = this._read(path.join(this.dir, "stats", `${s}.json`)) || { counts: {}, total: 0 };
    const share = {};
    for (const code of codes) {
      share[code] = Math.round(((stats.counts[code] || 0) + 1) / (stats.total + codes.length) * 100);
    }
    return { share, total: stats.total };
  }

  // --- OG 공유 카드 PNG 캐시 -------------------------------------------------
  // 파일명 자체가 캐시 키(슬러그-코드-희소성버킷). code는 "cover" 또는 결과
  // 코드(영숫자)만 허용 — 경로 탈출 방지.

  ogCachePath(slug, code, bucketKey) {
    const s = QuizStore.safeSlug(slug);
    if (!/^[A-Za-z0-9]+$/.test(String(code))) throw new Error("잘못된 유형 코드예요.");
    if (!/^[A-Za-z0-9]+$/.test(String(bucketKey))) throw new Error("잘못된 캐시 키예요.");
    return path.join(this.dir, "og", `${s}-${code}-${bucketKey}.png`);
  }

  readOgCache(slug, code, bucketKey) {
    try {
      return fs.readFileSync(this.ogCachePath(slug, code, bucketKey));
    } catch {
      return null;
    }
  }

  writeOgCache(slug, code, bucketKey, buffer) {
    const file = this.ogCachePath(slug, code, bucketKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this._writeAtomic(file, buffer);
    return file;
  }

  // 원자적 쓰기 (tmp→rename): 같은 회차 재실행이나 동시 응답 기록이 파일을
  // 반쯤 쓴 상태로 남기지 않는다 (매니페스트 run_binding.atomic_write).
  _writeAtomic(file, data) {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  _read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  _list(dir) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return []; // 아직 아무것도 저장된 적 없음
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => this._read(path.join(dir, f)))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
}
