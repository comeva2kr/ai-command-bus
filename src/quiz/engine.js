// Quiz scoring: map a user's answer choices to a result type.
//
// Deterministic on purpose — the same choices always give the same result
// (ties break by results[] order), so the server-rendered result page and the
// client-side computation can never disagree.

export function scoreQuiz(quiz, answerIndices) {
  if (!Array.isArray(answerIndices) || answerIndices.length !== quiz.questions.length) {
    throw new Error("답변 수가 질문 수와 달라요.");
  }
  const tally = {};
  for (const r of quiz.results) tally[r.id] = 0;

  quiz.questions.forEach((q, qi) => {
    const ai = answerIndices[qi];
    const answer = q.answers[ai];
    if (!answer) throw new Error(`질문 ${qi + 1}의 답변 번호가 잘못됐어요.`);
    for (const s of answer.scores) tally[s.result] += s.points;
  });

  let best = quiz.results[0];
  for (const r of quiz.results) {
    if (tally[r.id] > tally[best.id]) best = r; // strict > → 동점이면 앞 순서 유지
  }
  return { resultId: best.id, result: best, tally };
}
