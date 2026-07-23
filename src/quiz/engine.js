// Axis-based quiz scoring (docs/quiz-design.md).
//
// Each axis is scored as a spectrum: answers push toward the left or right
// pole with weight 1~2, and the axis percentage = leftPts / (leftPts +
// rightPts). The result type is the combination of dominant poles. This is
// deliberately NOT type-sum argmax — per-axis percentages are explainable
// ("당신은 이 축에서 64%"), make every result personally distinct, and absorb
// borderline cases instead of flipping arbitrarily.
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

  const code = axes.map((a) => a.pole.code).join("");
  const result = quiz.results.find((r) => r.code === code);
  if (!result) throw new Error(`유형 ${code}의 결과 서술이 없어요.`);
  return { code, result, axes };
}
