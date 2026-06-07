// engine/game.js
// Pure functional helpers to compute game state from a given 'game' object

function getResult(game, qIndex, teamId) {
  const q = game.questions[qIndex];
  if (q && q.warmup) return undefined;
  const row = game.results[qIndex];
  if (!row) return undefined;
  return row[teamId];
}

function computeTotal(game, teamId) {
  let total = 0;
  for (let i = 0; i < game.questions.length; i++) {
    const q = game.questions[i];
    if (q && q.warmup) continue;
    const r = getResult(game, i, teamId);
    if (r === true) total += 1;
  }
  return total;
}

function playedCount(game) {
  if (!game.questions.length || game.showStep < 0) return 0;
  const maxStep = game.questions.length * 2 - 1;
  const step = Math.max(0, Math.min(game.showStep, maxStep));
  const qIndex = Math.floor(step / 2);
  let count = 0;
  for (let i = 0; i < qIndex; i++) {
    if (!game.questions[i].warmup) count++;
  }
  return count;
}

function buildScoresFull(game) {
  const qCount = game.questions.filter(q => !q.warmup).length;
  const played = playedCount(game);
  const teamsSorted = [...game.teams].sort((a, b) => {
    if (a.exhibition !== b.exhibition) return a.exhibition ? 1 : -1;
    const ta = computeTotal(game, a.id);
    const tb = computeTotal(game, b.id);
    if (tb !== ta) return tb - ta;
    for (let i = game.questions.length - 1; i >= 0; i--) {
      const q = game.questions[i];
      if (q && q.warmup) continue;
      const ra = (getResult(game, i, a.id) === true);
      const rb = (getResult(game, i, b.id) === true);
      if (ra !== rb) return rb ? 1 : -1;
    }
    return (a.name || '').localeCompare(b.name || '', 'ru');
  });

  const rows = teamsSorted.map(t => {
    const perQuestion = [];
    let mainIdx = 0;
    for (let i = 0; i < game.questions.length; i++) {
      const q = game.questions[i];
      if (q.warmup) continue;
      const r = getResult(game, i, t.id);
      if (mainIdx < played) {
        perQuestion.push(r === true ? true : false);
      } else {
        perQuestion.push(r);
      }
      mainIdx++;
    }
    return {
      teamId: t.id,
      name: t.name,
      exhibition: t.exhibition || false,
      perQuestion,
      total: computeTotal(game, t.id)
    };
  });

  return { questionsCount: qCount, rows };
}

module.exports = { getResult, computeTotal, playedCount, buildScoresFull };
