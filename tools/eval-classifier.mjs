// 분류기 홀드아웃 평가 — 라이브 구글뉴스 섹션 제목으로 80/20 학습/평가.
// 라벨링 인력 없이 정확도를 재는 방법: 구글의 섹션 분류를 정답으로 삼는다.
import { TitleClassifier, classifyTitle, TRAIN_LABELS } from "../src/feed/classify.js";
import { loadRegistry, buildSources } from "../src/feed/registry.js";
import { makeFetcher } from "../src/feed/fetchers.js";

const reg = loadRegistry().filter((c) => TRAIN_LABELS.has(c.id) && c.id.startsWith("gnews"));
const rows = [];
for (const e of reg) {
  const [s] = buildSources([e], { seed: false, fetcher: (x) => makeFetcher(x)() });
  const items = await s.fetch();
  const cat = TRAIN_LABELS.get(e.id).category;
  for (const it of items) rows.push({ title: it.title, cat });
}
console.log(`라이브 라벨 표본: ${rows.length}건`);

// 결정적 셔플(제목 해시 기반) 후 80/20 분할
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
rows.sort((a, b) => hash(a.title) - hash(b.title));
const cut = Math.floor(rows.length * 0.8);
const train = rows.slice(0, cut), test = rows.slice(cut);

const cl = new TitleClassifier();
for (const r of train) cl.learn(r.title, r.cat);

let ok = 0, wrong = 0, abstain = 0;
const errors = [];
for (const r of test) {
  const p = classifyTitle(cl, r.title);
  if (p === null) { abstain++; continue; }
  if (p === r.cat) ok++;
  else { wrong++; if (errors.length < 8) errors.push(`${r.cat}→${p}: ${r.title.slice(0, 40)}`); }
}
const decided = ok + wrong;
console.log(`학습 ${train.length} / 평가 ${test.length}`);
console.log(`분류 시도 ${decided}건 중 정답 ${ok} (정확도 ${(ok / decided * 100).toFixed(1)}%)`);
console.log(`기권 ${abstain}건 (${(abstain / test.length * 100).toFixed(1)}%) — 기권 시 소스 카테고리 유지라 무해`);
console.log(`\n오분류 표본:`); errors.forEach((e) => console.log("  ", e));
