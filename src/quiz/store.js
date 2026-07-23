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
    fs.writeFileSync(path.join(this.draftsDir, `${s}.json`), JSON.stringify(record, null, 2));
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
    fs.writeFileSync(path.join(this.publishedDir, `${s}.json`), JSON.stringify(record, null, 2));
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
