// 저장 내구성 — 전수검사 P0 (2026-08-05)
//
// 두 줄이 겹쳐 "손상 한 번 = 영구 소실"을 만들고 있었다:
//   ① 대상 파일에 곧바로 쓴다 → 쓰는 도중 죽으면 반쯤 쓰인 파일이 남는다
//   ② 읽기 실패를 조용히 삼키고 빈 상태로 시작한다 → 다음 저장이 원본을 덮어쓴다
// 정전이나 나쁜 타이밍의 재시작 한 번에 가입자·댓글·취향이 사라지고,
// 아무 로그도 없어 사라진 줄도 몰랐다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedStore as Store } from "../src/feed/store.js";
import { ARTICLE_SUMMARY_CONTRACT, articleContentId } from "../src/feed/article-summary.js";

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-store-")), name);
}

const preparedSummaryText = "공개 기사에 따르면 회사는 투자 계획과 착공 일정을 발표했고, 새 설비의 역할과 단계별 진행 방식도 함께 설명했습니다. 발표 내용은 생산 역량 확대와 공급 일정에 영향을 줄 수 있어 후속 공시와 공식 자료를 계속 확인할 필요가 있습니다. ".repeat(3);

function preparedSummary(textKo = preparedSummaryText) {
  return {
    status: "ready",
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    textKo,
    generatedAt: new Date().toISOString()
  };
}

test("저장: 중간 상태가 파일에 남지 않는다", () => {
  const file = tmpFile("db.json");
  const store = new Store({ file });
  store.createUser("u1");
  assert.ok(fs.existsSync(file), "저장이 안 됐다");
  // 임시 파일을 남기지 않는다 — 남으면 디스크가 서서히 찬다
  assert.ok(!fs.existsSync(`${file}.tmp`), "임시 파일이 치워지지 않았다");
  // 쓰인 것은 항상 온전한 JSON이다
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("저장: 손상된 파일을 만나면 멈춘다 — 빈 상태로 덮어쓰지 않는다", () => {
  const file = tmpFile("db.json");
  const first = new Store({ file });
  const user = first.createUser("keeper");
  first.addComment(user.id, "item1", "이 댓글이 사라지면 안 된다");
  const before = fs.readFileSync(file, "utf8");
  assert.ok(before.includes("이 댓글이 사라지면 안 된다"));

  // 쓰는 도중 죽은 것처럼 파일을 자른다
  fs.writeFileSync(file, before.slice(0, Math.floor(before.length / 2)));

  // 예전에는 여기서 빈 상태로 조용히 시작했고, 다음 저장이 원본을 지웠다.
  assert.throws(() => new Store({ file }), /저장 파일을 읽지 못했습니다/);

  // 손상본은 지우지 않고 옆에 치워 둔다 — 사람이 열면 상당 부분을 건진다
  const dir = path.dirname(file);
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith("db.json.corrupt-"));
  assert.equal(kept.length, 1, "손상본을 보존하지 않았다");
  assert.ok(fs.readFileSync(path.join(dir, kept[0]), "utf8").includes("keeper"));
});

test("저장: 파일이 아예 없으면 빈 상태로 시작한다 (첫 실행)", () => {
  const file = tmpFile("fresh.json");
  assert.doesNotThrow(() => new Store({ file }));
  const store = new Store({ file });
  assert.equal(store.getUser("없는사람"), null);
});

test("저장: 재시작해도 그대로 남는다", () => {
  const file = tmpFile("db.json");
  const a = new Store({ file });
  const u = a.createUser("survivor");
  a.addComment(u.id, "item9", "재시작 뒤에도 있어야 한다");

  const b = new Store({ file });
  const back = b.getUser(u.id);
  assert.ok(back, "사용자가 사라졌다");
  assert.equal((back.comments || []).length, 1);
  assert.equal(back.comments[0].body, "재시작 뒤에도 있어야 한다");
});

test("저장: 검증된 편집 캐시가 재시작 뒤에도 evidenceHash로 남는다", () => {
  const file = tmpFile("db.json");
  const a = new Store({ file });
  a.saveEditorialLlmEdit("hash-1", {
    draft: { headline: "검증된 제목" },
    verifier: { headlineSupported: true },
    model: "editor-test",
    verifierModel: "verifier-test"
  });
  assert.equal(a.flushPending(), true);

  const b = new Store({ file });
  assert.equal(b.getEditorialLlmEdit("hash-1").draft.headline, "검증된 제목");
  assert.equal(b.getEditorialLlmEdit("missing"), null);
});

test("저장: 먼저 검증된 기사 요약은 다른 분야의 동시 생성 결과가 덮어쓰지 않는다", () => {
  const file = tmpFile("db.json");
  const store = new Store({ file });
  const base = {
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    verified: true
  };
  store.saveEditorialLlmEdit("article:42", {
    ...base,
    articleSummary: preparedSummary(preparedSummaryText)
  });
  store.saveEditorialLlmEdit("article:42", {
    ...base,
    articleSummary: preparedSummary(preparedSummaryText.replaceAll("발표", "공개"))
  });

  assert.equal(store.getEditorialLlmEdit("article:42").articleSummary.textKo, preparedSummaryText);
});

test("저장: 기사 요약은 분야 조합과 재시작을 넘어 같은 기사에 재사용된다", () => {
  const file = tmpFile("db.json");
  const source = {
    canonicalUrl: "https://example.com/news/42",
    sourceLabel: "테스트 뉴스"
  };
  const businessIssue = {
    evidenceHash: "business-hash",
    admittedCategories: ["business"],
    eventSources: [source]
  };
  const techIssue = {
    evidenceHash: "tech-hash",
    admittedCategories: ["tech"],
    eventSources: [source]
  };
  const summary = {
    status: "ready",
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(businessIssue),
    textKo: preparedSummaryText,
    generatedAt: new Date().toISOString()
  };
  const a = new Store({ file });
  a.saveEditorialEdition("2026-08-25", "lunch", "business", {
    editionId: "edition-business",
    issues: [businessIssue]
  });
  a.enrichEditorialEdition("2026-08-25", "lunch", "business", {
    editionId: "edition-business",
    issues: [{ ...businessIssue, articleSummary: summary }]
  });

  const b = new Store({ file });
  assert.equal(articleContentId(techIssue), articleContentId(businessIssue));
  assert.deepEqual(b.getArticleSummary(articleContentId(techIssue)), summary);
});

test("저장: 새 판에 포함된 검증 요약은 별도 보강 호출 없이 즉시 공용 정본이 된다", () => {
  const file = tmpFile("db.json");
  const issue = {
    evidenceHash: "saved-summary-hash",
    eventSources: [{ canonicalUrl: "https://example.com/news/saved", sourceLabel: "테스트 뉴스" }]
  };
  const summary = {
    ...preparedSummary(),
    articleContentId: articleContentId(issue)
  };
  const store = new Store({ file });
  store.saveEditorialEdition("2026-08-25", "lunch", "v30:business", {
    editionId: "edition-with-summary",
    issues: [{ ...issue, articleSummary: summary }]
  });

  const restarted = new Store({ file });
  assert.deepEqual(restarted.getArticleSummary(articleContentId(issue)), summary);
});

test("저장: 현재 슬롯이 아직 고정되지 않았으면 증거 기준시각을 명시적으로 갱신할 수 있다", () => {
  const store = new Store();
  const first = Date.parse("2026-08-25T03:00:00.000Z");
  const second = Date.parse("2026-08-25T03:05:00.000Z");
  assert.equal(store.saveEditorialEvidenceAnchor("2026-08-25", "lunch", first), first);
  assert.equal(store.saveEditorialEvidenceAnchor("2026-08-25", "lunch", second), first);
  assert.equal(store.saveEditorialEvidenceAnchor("2026-08-25", "lunch", second, { replace: true }), second);
});

test("저장: 요약 인덱싱은 불변 판본의 제목과 출처를 다시 쓰지 않는다", () => {
  const file = tmpFile("db.json");
  const issue = {
    clusterId: "EV-immutable",
    subject: "저장된 제목",
    eventSources: [{ canonicalUrl: "https://example.com/original", sourceLabel: "원 매체" }]
  };
  const store = new Store({ file });
  store.saveEditorialEdition("2026-08-25", "lunch", "news", {
    editionId: "edition-immutable",
    issues: [issue]
  });
  store.enrichEditorialEdition("2026-08-25", "lunch", "news", {
    editionId: "edition-immutable",
    issues: [{
      ...issue,
      subject: "다른 조합이 만든 제목",
      eventSources: [{ canonicalUrl: "https://example.com/other", sourceLabel: "다른 매체" }],
      articleSummary: {
        ...preparedSummary(),
        articleContentId: articleContentId(issue)
      }
    }]
  });

  const saved = store.getEditorialEdition("2026-08-25", "lunch", "news");
  assert.equal(saved.issues[0].subject, "저장된 제목");
  assert.equal(saved.issues[0].eventSources[0].sourceLabel, "원 매체");
  assert.ok(store.getArticleSummary(articleContentId(issue)));
});
