const { expect } = require('chai');
const game = require('../engine/game');

function makeGame(opts = {}) {
  return {
    questions: [
      { text: 'Q1', answer: 'A1', comment: '', handoutImage: '', commentImage: '', warmup: false },
      { text: 'Q2', answer: 'A2', comment: '', handoutImage: '', commentImage: '', warmup: false },
      { text: 'WU1', answer: 'W1', comment: '', handoutImage: '', commentImage: '', warmup: true },
      { text: 'Q3', answer: 'A3', comment: '', handoutImage: '', commentImage: '', warmup: false },
    ],
    teams: [
      { id: 1, name: 'Alpha', activeCaptain: false, exhibition: false },
      { id: 2, name: 'Beta', activeCaptain: false, exhibition: false },
      { id: 3, name: 'Gamma', activeCaptain: false, exhibition: true },
    ],
    results: {
      0: { 1: true, 2: false, 3: true },
      1: { 1: false, 2: true, 3: false },
      3: { 1: true, 2: true, 3: false },
    },
    showStep: 7, // answer of Q3 (index 3 * 2 = 6, +1 = 7)
    ...opts
  };
}

describe('engine/game.js', () => {
  describe('computeTotal', () => {
    it('correctly counts only non-warmup questions', () => {
      const g = makeGame();
      expect(game.computeTotal(g, 1)).to.equal(2); // Q1:+ Q2:- Q3:+ = 2
      expect(game.computeTotal(g, 2)).to.equal(2); // Q1:- Q2:+ Q3:+ = 2
    });

    it('returns 0 for team with no correct answers', () => {
      const g = makeGame();
      g.results = { 0: { 1: false }, 1: {}, 3: undefined };
      expect(game.computeTotal(g, 1)).to.equal(0);
    });
  });

  describe('getResult', () => {
    it('returns undefined for warmup questions', () => {
      const g = makeGame();
      expect(game.getResult(g, 2, 1)).to.be.undefined;
    });

    it('returns true/false for regular questions', () => {
      const g = makeGame();
      expect(game.getResult(g, 0, 1)).to.be.true;
      expect(game.getResult(g, 0, 2)).to.be.false;
    });

    it('returns undefined for unanswered questions', () => {
      const g = makeGame();
      delete g.results[1];
      expect(game.getResult(g, 1, 1)).to.be.undefined;
    });
  });

  describe('playedCount', () => {
    it('returns 0 when no questions', () => {
      expect(game.playedCount({ questions: [], showStep: -1 })).to.equal(0);
    });

    it('returns 0 when showStep < 0', () => {
      const g = makeGame({ showStep: -1 });
      expect(game.playedCount(g)).to.equal(0);
    });

    it('counts only non-warmup questions before current step', () => {
      const g = makeGame({ showStep: 3 }); // answer of Q2 (index 1 * 2 + 1 = 3), qIndex=1
      // Counts non-warmup with index < qIndex(1) => only Q1
      expect(game.playedCount(g)).to.equal(1);
    });

    it('skips warmup questions in count', () => {
      const g = makeGame({ showStep: 7 }); // answer of Q3 (index 3 * 2 + 1 = 7), qIndex=3
      // Counts non-warmup with index < qIndex(3) => Q1, Q2 (WU1 at index 2 is skipped)
      expect(game.playedCount(g)).to.equal(2);
    });
  });

  describe('buildScoresFull', () => {
    it('returns correct structure', () => {
      const g = makeGame();
      const scores = game.buildScoresFull(g);
      expect(scores).to.have.property('questionsCount', 3);
      expect(scores.rows).to.have.length(3);
    });

    it('sorts exhibition teams last', () => {
      const g = makeGame();
      const scores = game.buildScoresFull(g);
      const names = scores.rows.map(r => r.name);
      expect(names[names.length - 1]).to.equal('Gamma');
    });

    it('breaks ties by last correct answer (latest question wins)', () => {
      const g = makeGame();
      // Alpha: Q1:+ Q2:- Q3:+ = 2 (last correct = Q3)
      // Beta:  Q1:- Q2:+ Q3:+ = 2 (last correct = Q3 too)
      // Tie-break: compare Q3 both +, Q2: Alpha -, Beta + => Beta wins
      const scores = game.buildScoresFull(g);
      const alphaIdx = scores.rows.findIndex(r => r.name === 'Alpha');
      const betaIdx = scores.rows.findIndex(r => r.name === 'Beta');
      expect(betaIdx).to.be.lessThan(alphaIdx);
    });

    it('perQuestion has true/false for played questions', () => {
      const g = makeGame();
      const scores = game.buildScoresFull(g);
      const alpha = scores.rows.find(r => r.name === 'Alpha');
      expect(alpha.perQuestion[0]).to.be.true;
      expect(alpha.perQuestion[1]).to.be.false;
      expect(alpha.perQuestion[2]).to.be.true;
    });
  });
});
