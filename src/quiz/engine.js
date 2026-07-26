// Axis-based quiz scoring (docs/quiz-design.md).
//
// Each axis is scored as a spectrum: answers push toward the left or right
// pole with weight 1~2, and the axis percentage = leftPts / (leftPts +
// rightPts). This is deliberately NOT type-sum argmax — per-axis percentages
// are explainable ("당신은 이 축에서 64%"), make every result personally
// distinct, and absorb borderline cases instead of flipping arbitrarily.
//
// David 확정(2026-07-26): 결과 형태는 테마 따라 두 가지다 —
//   - combo_types: 극 조합 전체가 결과 유형(기존 16personalities류 구조).
//   - level_bands: axes[0](주 지표)의 leftPercent가 곧 "레벨 %"고, 그
//     퍼센트가 속하는 밴드(quiz.bands)를 찾아 판정한다. 스타일 축(axes[1])이
//     있으면 그 dominant pole code를 밴드 code에 이어붙여 결과 code를
//     만든다(예: "L2" + "D" → "L2D").
//
// Deterministic on purpose — the same choices always give the same result
// (an exact 50:50 axis resolves to the left pole; validateQuiz nudges
// generators toward odd question counts per axis so this stays rare), so the
// server-rendered result page and the client-side computation never disagree.

export function scoreQuiz(quiz, answerIndices) {
  if (!Array.isArray(answerIndices) || answerIndices.length !== quiz.questions.length) {
    throw new Error("답변 수가 질문 수와 달라요.");
  }

  const pts = {}; // axisId → { left, right }
  for (const axis of quiz.axes) pts[axis.id] = { left: 0, right: 0 };

  quiz.questions.forEach((q, qi) => {
    const answer = q.answers[answerIndices[qi]];
    if (!answer) throw new Error(`질문 ${qi + 1}의 답변 번호가 잘못됐어요.`);
    pts[q.axis][answer.pole] += answer.weight == null ? 1 : answer.weight;
  });

  // 축별 스펙트럼: leftPercent(0~100) + 지배 극. 50:50 동점은 left로 확정.
  const axes = quiz.axes.map((axis) => {
    const { left, right } = pts[axis.id];
    const total = left + right;
    const leftPercent = total === 0 ? 50 : Math.round((left / total) * 100);
    const dominant = leftPercent >= 50 ? "left" : "right";
    return {
      id: axis.id,
      name: axis.name,
      leftPercent,
      rightPercent: 100 - leftPercent,
      dominant,
      pole: axis[dominant]
    };
  });

  const format = quiz.theme && quiz.theme.format;
  if (format === "level_bands") {
    const levelPercent = axes[0].leftPercent;
    const band = (quiz.bands || []).find((b) => levelPercent >= b.min && levelPercent <= b.max);
    if (!band) throw new Error(`레벨 ${levelPercent}%에 해당하는 밴드가 없어요.`);
    const code = axes.length > 1 ? band.code + axes[1].pole.code : band.code;
    const result = quiz.results.find((r) => r.code === code);
    if (!result) throw new Error(`유형 ${code}의 결과 서술이 없어요.`);
    return { code, result, axes, levelPercent, band: { code: band.code, label: band.label_ko } };
  }

  const code = axes.map((a) => a.pole.code).join("");
  const result = quiz.results.find((r) => r.code === code);
  if (!result) throw new Error(`유형 ${code}의 결과 서술이 없어요.`);
  return { code, result, axes };
}
