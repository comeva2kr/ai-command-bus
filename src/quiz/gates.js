// Loop-gate for generated quizzes (docs/quiz-loopgate.md).
//
// Every generated quiz must clear ALL gates before it can become a draft.
// A failed gate does not kill the pipeline — the failure messages are fed
// back into the next generation attempt as explicit constraints ("이전
// 시도가 반려된 사유"), up to a retry budget, and only then does a human
// see it. This is what "바이럴 조건을 매번 갖추고, AI 티가 안 나는" means
// operationally: the conditions are code, not vibes.
//
// Gate IDs are stable — the flowchart doc, CLI output, and draft metadata
// all reference them.

import { validateQuiz } from "./generate.js";

// 사용자 노출 텍스트에서 "AI가 썼구나" 티를 내는 관용구/격식체. 결과문이
// 상담봇처럼 읽히는 순간 공유가 죽는다 (BuzzFeed 말기 안티패턴).
const AI_TELL_PHRASES = [
  "AI", "인공지능", "언어 모델", "물론입니다", "도움이 되", "여러분",
  "하십시오", "습니까", "알아보겠습니다", "살펴보겠습니다", "~에 대해", "다음과 같"
];

function* userFacingTexts(quiz) {
  yield ["제목", quiz.title];
  yield ["소개", quiz.description];
  for (const q of quiz.questions || []) {
    yield ["문항", q.q];
    for (const a of q.answers || []) yield ["답변", a.text];
  }
  for (const r of quiz.results || []) {
    yield [`유형 ${r.code} 이름`, r.title];
    yield [`유형 ${r.code} 서술`, r.description];
    for (const s of r.strengths || []) yield [`유형 ${r.code} 강점`, s];
    for (const s of r.weaknesses || []) yield [`유형 ${r.code} 성장 포인트`, s];
    for (const s of r.advice || []) yield [`유형 ${r.code} 조언`, s];
    yield [`유형 ${r.code} 공유 문구`, r.shareText];
  }
}

export const GATES = [
  {
    id: "G1-structure",
    name: "구조 게이트",
    desc: "축 2~4개 · 문항 8~15개(축당 3+) · 극 혼합 · 유형 조합 커버리지 · 강점 80:약점 20 · 궁합 상호지정 (validateQuiz)",
    run(quiz) {
      try {
        validateQuiz(quiz);
        return [];
      } catch (err) {
        return [String(err.message)];
      }
    }
  },
  {
    id: "G2-viral",
    name: "바이럴 게이트",
    desc: "공유 미리보기·결과문이 퍼질 조건을 갖췄는가 (제목 훅, I-got 공유 문구, 결과문 분량, 한 줄 답변)",
    run(quiz) {
      const fails = [];
      const title = String(quiz.title || "");
      if (title.length < 8 || title.length > 40) fails.push(`제목이 ${title.length}자 — 8~40자여야 미리보기에서 훅이 된다.`);
      const desc = String(quiz.description || "");
      if (desc.length < 20 || desc.length > 90) fails.push(`소개가 ${desc.length}자 — 20~90자로.`);
      for (const r of quiz.results || []) {
        if (String(r.description || "").length < 40) {
          fails.push(`유형 ${r.code}의 서술이 ${String(r.description || "").length}자 — 두 줄짜리 결과문은 즉시 저품질 판정. 40자 이상 구체적으로.`);
        }
        const share = String(r.shareText || "");
        if (!share.includes("나는")) fails.push(`유형 ${r.code}의 공유 문구에 "나는 ○○"(I-got 템플릿)이 없다.`);
        if (!share.includes("?") && !share.includes("너")) fails.push(`유형 ${r.code}의 공유 문구에 상대를 부르는 훅(질문/너)이 없다.`);
      }
      for (const q of quiz.questions || []) {
        for (const a of q.answers || []) {
          if (String(a.text || "").length > 40) fails.push(`답변 "${String(a.text).slice(0, 15)}…"이 40자 초과 — 한 줄 이내로.`);
        }
      }
      return fails;
    }
  },
  {
    id: "G3-ai-tell",
    name: "AI-티 게이트",
    desc: "격식체·상담봇 관용구·복붙 티 검출 — '한 사람이 만든' 수제 감성 유지",
    run(quiz) {
      const fails = [];
      for (const [where, text] of userFacingTexts(quiz)) {
        const t = String(text || "");
        for (const phrase of AI_TELL_PHRASES) {
          if (t.includes(phrase)) {
            fails.push(`${where}에 AI 티 나는 표현 "${phrase}" — 캐주얼한 구어체로 다시.`);
            break;
          }
        }
      }
      // 복붙 티: 답변 텍스트 중복률. 같은 선택지가 여러 문항에서 재사용되면
      // "양산형 템플릿" 인상 (BuzzFeed 말기, 국내 아류 테스트의 공통 사인).
      const answers = (quiz.questions || []).flatMap((q) => (q.answers || []).map((a) => String(a.text || "")));
      if (answers.length > 0) {
        const uniqueRatio = new Set(answers).size / answers.length;
        if (uniqueRatio < 0.8) {
          fails.push(`답변 중복률이 높다 (고유 ${Math.round(uniqueRatio * 100)}%) — 문항마다 새 선택지를 써라.`);
        }
      }
      // 유형 이름 중복
      const titles = (quiz.results || []).map((r) => String(r.title || ""));
      if (new Set(titles).size !== titles.length) fails.push("유형 이름이 중복된다 — 유형마다 고유한 별칭을.");
      return fails;
    }
  },
  {
    id: "G4-scoring",
    name: "채점 무결성 게이트",
    desc: "축별 가중치 균형 — 특정 유형으로 쏠리는 조악한 채점 방지 ('다 이거 나오던데' 안티패턴)",
    run(quiz) {
      const fails = [];
      for (const axis of quiz.axes || []) {
        let left = 0;
        let right = 0;
        for (const q of (quiz.questions || []).filter((x) => x.axis === axis.id)) {
          for (const a of q.answers || []) {
            const w = a.weight == null ? 1 : a.weight;
            if (a.pole === "left") left += w;
            else right += w;
          }
        }
        const total = left + right;
        if (total > 0) {
          const ratio = left / total;
          if (ratio < 0.35 || ratio > 0.65) {
            fails.push(`축 ${axis.id}의 선택지 가중치가 ${Math.round(ratio * 100)}:${Math.round((1 - ratio) * 100)}로 쏠려 있다 — 35:65 안쪽으로 균형을.`);
          }
        }
      }
      return fails;
    }
  }
];

// Run every gate; a quiz passes only when all gates return zero failures.
export function runGates(quiz) {
  const failures = [];
  for (const gate of GATES) {
    for (const message of gate.run(quiz)) {
      failures.push({ gate: gate.id, message });
    }
  }
  return { pass: failures.length === 0, failures };
}
