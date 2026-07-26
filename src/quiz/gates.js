// Loop-gate for generated quizzes (docs/quiz-loopgate.md).
//
// Every generated quiz must clear ALL gates before it can become a draft.
// A failed gate does not kill the pipeline — the failure messages are fed
// back into the next generation attempt as explicit constraints ("이전
// 시도가 반려된 사유"), up to a retry budget, and only then does a human
// see it. This is what "바이럴 조건을 매번 갖추고, AI 티가 안 나는" means
// operationally: the conditions are code, not vibes.
//
// Gate IDs (QG1~QG4) and every threshold/grade come from the declarative
// pack manifest (pack.manifest.json) — the WRC-standard single source of
// truth. The flowchart doc, CLI output, and draft metadata all reference
// the same IDs.

import { validateQuiz } from "./generate.js";
import { CONTRACT, decideFromGrades } from "./manifest.js";

const CHECKS = CONTRACT.checks;
const STRUCTURE = CHECKS.structure;

// 사용자 노출 텍스트에서 "AI가 썼구나" 티를 내는 관용구/격식체. 결과문이
// 상담봇처럼 읽히는 순간 공유가 죽는다 (BuzzFeed 말기 안티패턴).
const AI_TELL_PHRASES = CHECKS.ai_tell.phrases;

// 문자 bigram Jaccard 유사도 — 결정적, 외부 의존성 없음. 공백·문장부호를
// 지운 뒤 2-그램 집합의 교집합/합집합 비율로 "같은 소재/문장 재탕"을 잡는다
// (문항 유사도 QG1, 공유 문구 유사도 QG2 — 임계값은 매니페스트 선언).
function normalizeForSimilarity(s) {
  return String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
}
function bigramSet(s) {
  const set = new Set();
  if (s.length < 2) {
    if (s.length === 1) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function bigramJaccard(a, b) {
  const A = bigramSet(normalizeForSimilarity(a));
  const B = bigramSet(normalizeForSimilarity(b));
  if (A.size === 0 && B.size === 0) return 0;
  let intersection = 0;
  for (const gram of A) if (B.has(gram)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// 문자열에서 매칭에 쓸 어절(토큰) 2자+만 뽑는다 — "T/F 공감형" → ["공감형"]
// 처럼 이름에서 특수문자를 걷어낸 2자+ 조각을 취한다. 원래는 토픽 제목
// 토큰화용이었지만(2026-07-26 이전), 이제는 테마 이름(theme.name_ko)
// 토큰화에 재사용한다 — theme_coherence 게이트.
function tokensForOneTopic(topic) {
  const tokens = [];
  const title = String((topic && topic.title) || "");
  for (const raw of title.split(/\s+/)) {
    const cleaned = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (cleaned.length >= 2) tokens.push(cleaned);
  }
  return tokens;
}
function mentionsAnyTopicToken(text, tokens) {
  const t = String(text || "");
  return tokens.some((tok) => t.includes(tok));
}

// 결과 서술 첫 문장의 종결 골격 — 마지막 문장부호(.!?) 앞까지를 첫 문장으로
// 보고, 공백/문장부호를 지운 뒤 마지막 3글자를 취한다. "~게 너다"류 오프닝이
// 8개 결과 전부에서 겹치는 템플릿 티를 잡는다 (structure.opening_pattern_max_ratio).
function firstSentence(text) {
  const s = String(text || "");
  const m = s.match(/^[^.!?]*[.!?]?/);
  return (m ? m[0] : s).trim();
}
function endingPattern(text) {
  const sentence = firstSentence(text)
    .replace(/[.!?]+$/, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
  return sentence.slice(-3);
}

function* userFacingTexts(quiz) {
  yield ["제목", quiz.title];
  yield ["소개", quiz.description];
  // weeklyBrief/축 intro도 사용자에게 그대로 노출되는 텍스트다 — 친절한
  // 반말 설명톤("~했어", "~된 거야")은 통과하고, 격식체·상담봇 관용구만
  // 잡힌다 (David 실사용 피드백 2026-07-25).
  for (const b of quiz.weeklyBrief || []) yield [`브리핑 "${b && b.topic}"`, b && b.intro];
  for (const a of quiz.axes || []) yield [`축 ${a && a.id} 설명`, a && a.intro];
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
    yield [`유형 ${r.code} 이번 주 픽`, r.weeklyPick];
  }
}

export const GATES = [
  {
    key: "QG1",
    id: "QG1-structure",
    name: "구조 게이트",
    desc: "축 2~4개 · 문항 8~15개(축당 3+) · 극 혼합 · 유형 조합 커버리지 · 강점 80:약점 20 · 궁합 상호지정 (validateQuiz) · 답변 개수 통일 · 문항 유사도 · 역채점 극 혼합 · 결과 오프닝 종결 패턴 쏠림",
    run(quiz) {
      const fails = [];
      try {
        validateQuiz(quiz);
      } catch (err) {
        fails.push(String(err.message));
      }

      const qs = Array.isArray(quiz.questions) ? quiz.questions : [];

      // ① 문항별 답변 개수 통일 (8팀 적대 검수: 문항마다 선택지 수가 들쭉날쭉하면
      // 채점 체감이 문항마다 달라 저품질 인상을 준다).
      if (STRUCTURE.answers_per_question_uniform && qs.length > 0) {
        const counts = qs.map((q) => (Array.isArray(q.answers) ? q.answers.length : 0));
        if (new Set(counts).size > 1) {
          const detail = counts.map((c, i) => `Q${i + 1}=${c}개`).join(", ");
          fails.push(`문항별 답변 개수가 다르다 (${detail}) — 전 문항 동일 개수로 통일하라.`);
        }
      }

      // ② 문항 텍스트 쌍별 유사도 — 같은 소재/문장을 두 문항에 재탕하면 안 된다.
      for (let i = 0; i < qs.length; i++) {
        for (let j = i + 1; j < qs.length; j++) {
          const sim = bigramJaccard(qs[i] && qs[i].q, qs[j] && qs[j].q);
          if (sim > STRUCTURE.question_similarity_max) {
            fails.push(`Q${i + 1}·Q${j + 1}이 같은 소재/문장 재탕 (유사도 ${Math.round(sim * 100)}%) — 서로 다른 상황으로 다시 써라.`);
          }
        }
      }

      // ③ 역채점: 같은 축 문항들의 1번(첫) 답변 pole이 전부 같은 극이면 조작
      // 티가 난다 — 축마다 첫 답변의 pole을 섞어야 한다.
      if (STRUCTURE.first_answer_pole_mix_required) {
        const axisFirstPoles = {};
        for (const q of qs) {
          if (!Array.isArray(q.answers) || q.answers.length === 0) continue;
          const pole = q.answers[0].pole;
          (axisFirstPoles[q.axis] || (axisFirstPoles[q.axis] = [])).push(pole);
        }
        for (const [axisId, poles] of Object.entries(axisFirstPoles)) {
          if (poles.length > 1 && new Set(poles).size === 1) {
            fails.push(`축 ${axisId}의 문항들이 전부 1번 답이 같은 극(${poles[0]}) — 역채점 균형이 깨졌다.`);
          }
        }
      }

      // ④ 결과 서술 오프닝 종결 패턴 쏠림 — 2차 검수 반영: 8개 결과가 전부
      // "~게 너다" 같은 같은 문형으로 끝나면 프롬프트가 강제한 3종 이상
      // 오프닝 다양성이 지켜지지 않은 것이다. 최빈 패턴 비율이 임계값을
      // 넘으면 반려한다 (structure.opening_pattern_max_ratio).
      if (STRUCTURE.opening_pattern_max_ratio) {
        const results = Array.isArray(quiz.results) ? quiz.results : [];
        if (results.length > 1) {
          const counts = {};
          for (const r of results) {
            const pattern = endingPattern(r.description);
            counts[pattern] = (counts[pattern] || 0) + 1;
          }
          const entries = Object.entries(counts);
          const [topPattern, topCount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0] || ["", 0]);
          const ratio = topCount / results.length;
          if (ratio > STRUCTURE.opening_pattern_max_ratio) {
            fails.push(
              `결과 ${results.length}개 중 ${topCount}개가 같은 오프닝 종결("…${topPattern}")로 끝난다 (${Math.round(ratio * 100)}%) — 오프닝 문형을 최소 3종 이상 섞어라.`
            );
          }
        }
      }

      return fails;
    }
  },
  {
    key: "QG2",
    id: "QG2-viral",
    name: "바이럴 게이트",
    desc: "공유 미리보기·결과문이 퍼질 조건을 갖췄는가 (제목 훅, I-got 공유 문구, 결과문 분량, 한 줄 답변, 테마 정합성, 공유 문구 다양성·종결 다양성)",
    run(quiz) {
      const v = CHECKS.viral;
      const fails = [];
      const title = String(quiz.title || "");
      if (title.length < v.title_chars_min || title.length > v.title_chars_max) {
        fails.push(`제목이 ${title.length}자 — ${v.title_chars_min}~${v.title_chars_max}자여야 미리보기에서 훅이 된다.`);
      }
      const desc = String(quiz.description || "");
      if (desc.length < v.desc_chars_min || desc.length > v.desc_chars_max) {
        fails.push(`소개가 ${desc.length}자 — ${v.desc_chars_min}~${v.desc_chars_max}자로.`);
      }
      for (const r of quiz.results || []) {
        const rDesc = String(r.description || "");
        if (rDesc.length < v.result_desc_chars_min) {
          fails.push(`유형 ${r.code}의 서술이 ${rDesc.length}자 — 두 줄짜리 결과문은 즉시 저품질 판정. ${v.result_desc_chars_min}자 이상 구체적으로.`);
        }
        if (v.result_desc_chars_max && rDesc.length > v.result_desc_chars_max) {
          fails.push(`유형 ${r.code}의 서술이 ${rDesc.length}자 — ${v.result_desc_chars_max}자 이내로(길수록 AI 티).`);
        }
        const share = String(r.shareText || "");
        if (!share.includes(v.i_got_marker)) fails.push(`유형 ${r.code}의 공유 문구에 "${v.i_got_marker} ○○"(I-got 템플릿)이 없다.`);
        if (!v.call_out_markers.some((m) => share.includes(m))) fails.push(`유형 ${r.code}의 공유 문구에 상대를 부르는 훅(질문/너)이 없다.`);
        if (v.share_text_chars_max && share.length > v.share_text_chars_max) {
          fails.push(`유형 ${r.code}의 공유 문구가 ${share.length}자 — ${v.share_text_chars_max}자 이내로.`);
        }
      }
      for (const q of quiz.questions || []) {
        for (const a of q.answers || []) {
          if (String(a.text || "").length > v.answer_chars_max) {
            fails.push(`답변 "${String(a.text).slice(0, 15)}…"이 ${v.answer_chars_max}자 초과 — 한 줄 이내로.`);
          }
        }
      }

      // 테마 정합성(theme_coherence) — David 확정(2026-07-26): 토픽 결박
      // 게이트(제목/결과 토픽 키워드·토픽 커버리지·문항 토픽 비율·브리핑
      // 토픽 커버리지)를 전부 폐기하고 이 검사로 대체한다. 테마가 주인이므로
      // "이번 주 소재를 얼마나 인용했는가"가 아니라 "테마 하나를 재는
      // 퀴즈인가"만 관대하게 확인한다 (매니페스트 checks.viral.theme_coherence).
      const tc = v.theme_coherence || {};
      const themeName = quiz.theme && quiz.theme.name_ko;
      if (themeName) {
        const themeTokens = tokensForOneTopic({ title: themeName });
        if (themeTokens.length) {
          if (!mentionsAnyTopicToken(title + desc, themeTokens)) {
            fails.push(`제목+소개에 테마 "${themeName}" 어절이 없다 — 이 테마를 위한 제목/소개로 다시 써라.`);
          }
          const results = Array.isArray(quiz.results) ? quiz.results : [];
          const anyResultMentionsTheme = results.some(
            (r) => mentionsAnyTopicToken(r && r.description, themeTokens) || mentionsAnyTopicToken(r && r.weeklyPick, themeTokens)
          );
          if (results.length && !anyResultMentionsTheme) {
            fails.push(`결과 서술·weeklyPick 어디에도 테마 "${themeName}" 어절이 없다 — 최소 한 곳엔 테마가 드러나야 한다(관대 — 하나면 충분).`);
          }
        }
      }
      const briefLen = Array.isArray(quiz.weeklyBrief) ? quiz.weeklyBrief.length : 0;
      const minBrief = tc.weekly_brief_min || 1;
      const maxBrief = tc.weekly_brief_max || 3;
      if (briefLen < minBrief || briefLen > maxBrief) {
        fails.push(`주간 브리핑(weeklyBrief)이 ${briefLen}개 — ${minBrief}~${maxBrief}개여야 한다("이 테스트가 재는 것" 설명).`);
      }

      // shareText 종결 다양성 — 물음표 반문형 일색이면 템플릿 티. 절반 이하만
      // "?"로 끝나야 한다(2차 검수: 감탄·선언·도발형을 섞으라는 지침).
      if (v.share_text_question_ending_max_ratio) {
        const shareTexts = (quiz.results || []).map((r) => String((r && r.shareText) || ""));
        if (shareTexts.length) {
          const questionEnders = shareTexts.filter((s) => s.trim().endsWith("?")).length;
          const ratio = questionEnders / shareTexts.length;
          if (ratio > v.share_text_question_ending_max_ratio) {
            fails.push(
              `공유 문구 중 물음표로 끝나는 비율이 ${questionEnders}/${shareTexts.length}개(${Math.round(ratio * 100)}%) — ${Math.round(v.share_text_question_ending_max_ratio * 100)}% 이하로, 감탄·선언·도발형을 섞어라.`
            );
          }
        }
      }

      // shareText 쌍별 유사도 — 8개를 나란히 놓았을 때 같은 틀이면 "템플릿 복붙".
      if (v.share_text_similarity_max) {
        const results = quiz.results || [];
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            const sim = bigramJaccard(results[i] && results[i].shareText, results[j] && results[j].shareText);
            if (sim > v.share_text_similarity_max) {
              fails.push(`유형 ${results[i].code}·${results[j].code}의 공유 문구가 템플릿 복붙 (유사도 ${Math.round(sim * 100)}%) — 서로 다른 드립으로.`);
            }
          }
        }
      }

      return fails;
    }
  },
  {
    key: "QG3",
    id: "QG3-ai-tell",
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
        if (uniqueRatio < CHECKS.ai_tell.unique_answer_ratio_min) {
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
    key: "QG4",
    id: "QG4-scoring",
    name: "채점 무결성 게이트",
    desc: "축별 가중치 균형 — 특정 유형으로 쏠리는 조악한 채점 방지 ('다 이거 나오던데' 안티패턴)",
    run(quiz) {
      const s = CHECKS.scoring;
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
          if (ratio < s.axis_balance_min || ratio > s.axis_balance_max) {
            fails.push(`축 ${axis.id}의 선택지 가중치가 ${Math.round(ratio * 100)}:${Math.round((1 - ratio) * 100)}로 쏠려 있다 — ${Math.round(s.axis_balance_min * 100)}:${Math.round(s.axis_balance_max * 100)} 안쪽으로 균형을.`);
          }
        }
      }
      return fails;
    }
  }
].map((gate) => ({ ...gate, grade: CONTRACT.gate_grades[gate.key] }));

// Run every gate and return the WRC-standard result envelope:
//   { decision: PASS|HOLD|BLOCK, reasons: ["[QG2-viral] …"], gateResults, pass, failures }
// decision은 매니페스트의 게이트 등급에서 파생된다 (HARD 실패=BLOCK,
// HOLD 실패=HOLD, GUIDE 실패는 통과하되 사유가 남는 advisory).
// pass/failures는 기존 호출부 호환용 별칭이다.
//
// David 확정(2026-07-26) 이후 quiz 하나만으로 전부 판정한다 — 토픽 결박
// 게이트가 폐기되면서 context 인자를 읽는 게이트가 더 이상 없다(매니페스트
// gate_context_note_ko). theme.history 재사용 검사는 게이트가 아니라
// weekly.js submit이 store 기반으로 별도 수행한다. 두 번째 인자는 과거 호출
// 호환을 위해 계속 받되 무시한다.
export function runGates(quiz, _context = {}) {
  const gateResults = [];
  const failures = [];
  for (const gate of GATES) {
    const messages = gate.run(quiz);
    gateResults.push({ id: gate.id, key: gate.key, grade: gate.grade, pass: messages.length === 0, failures: messages });
    for (const message of messages) failures.push({ gate: gate.id, grade: gate.grade, message });
  }
  const reasons = failures.map((f) => `[${f.gate}] ${f.message}`);
  const decision = decideFromGrades(failures.map((f) => f.grade));
  return { decision, reasons, gateResults, pass: decision === "PASS", failures };
}
