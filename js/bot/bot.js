// A deliberately simple opponent: prefer captures and crowns.
(function (root) {
  'use strict';
  function chooseMove(board, moves) {
    if (!moves.length) return null;
    let best = -Infinity, candidates = [];
    for (const move of moves) {
      const piece = board[move.from[0]][move.from[1]];
      const [r, c] = move.to;
      const score = (move.capture ? 10 : 0) + (!piece.king && r === 7 ? 6 : 0)
        + (3.5 - Math.abs(c - 3.5)) * 0.1;
      if (score > best) { best = score; candidates = [move]; }
      else if (score === best) candidates.push(move);
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  root.CheckersBot = { chooseMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = { chooseMove };
})(typeof globalThis !== 'undefined' ? globalThis : this);
