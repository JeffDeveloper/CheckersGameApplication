// Rules for the 8x8 American checkers board used by the application.
// draughts.js in this repository implements a different, 10x10 variant.
(function (root) {
  'use strict';
  const SIZE = 8;
  const other = player => player === 'white' ? 'black' : 'white';
  const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  function initialBoard() {
    return Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => {
      if ((r + c) % 2 !== 1) return null;
      if (r < 3) return { player: 'black', king: false };
      if (r > 4) return { player: 'white', king: false };
      return null;
    }));
  }

  function pieceMoves(board, r, c) {
    const piece = board[r]?.[c];
    if (!piece) return { steps: [], jumps: [] };
    const steps = [], jumps = [];
    const directions = piece.king ? [-1, 1] : [piece.player === 'white' ? -1 : 1];
    for (const dr of directions) for (const dc of [-1, 1]) {
      const nr = r + dr, nc = c + dc;
      if (inside(nr, nc) && !board[nr][nc]) steps.push({ from: [r, c], to: [nr, nc], capture: null });
      const jr = r + dr * 2, jc = c + dc * 2;
      if (inside(jr, jc) && board[nr]?.[nc]?.player === other(piece.player) && !board[jr][jc]) {
        jumps.push({ from: [r, c], to: [jr, jc], capture: [nr, nc] });
      }
    }
    return { steps, jumps };
  }

  function legalMoves(board, player) {
    const steps = [], jumps = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (board[r][c]?.player !== player) continue;
      const moves = pieceMoves(board, r, c);
      steps.push(...moves.steps);
      jumps.push(...moves.jumps);
    }
    return jumps.length ? jumps : steps;
  }

  function applyMove(board, move) {
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const piece = board[fr][fc];
    if (!piece) throw new Error('No piece at the source square');
    board[fr][fc] = null;
    board[tr][tc] = piece;
    if (move.capture) board[move.capture[0]][move.capture[1]] = null;
    const promoted = !piece.king && (piece.player === 'white' ? tr === 0 : tr === SIZE - 1);
    if (promoted) piece.king = true;
    // In American checkers, crowning finishes a jump turn.
    const furtherJumps = move.capture && !promoted ? pieceMoves(board, tr, tc).jumps : [];
    return { promoted, furtherJumps };
  }

  const api = { initialBoard, pieceMoves, legalMoves, applyMove, other };
  root.CheckersRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
