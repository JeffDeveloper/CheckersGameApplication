(function () {
  'use strict';
  const rules = window.CheckersRules, bot = window.CheckersBot;
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), statusEl = $('status'), turnEl = $('turnIndicator'), logEl = $('log');
  const sounds = { click: new Audio('audio/ui-click.ogg'), move: new Audio('audio/piece-move.ogg'), king: new Audio('audio/king-crowned.ogg'), gameOver: new Audio('audio/game-over.ogg') };
  Object.values(sounds).forEach(audio => { audio.volume = 0.35; });
  sounds.gameOver.volume = 0.25;
  let soundOn = true;
  try { soundOn = localStorage.getItem('checkers-sound') !== 'off'; } catch (_) {}
  document.querySelectorAll('[data-sound-toggle]').forEach(el => el.checked = soundOn);
  let board, current, selected, lastMove = null, legal = [], chain = false, over = false, mode = 'friend', timer = null, generation = 0;
  const name = p => p === 'white' ? 'White' : 'Black';
  const label = (r, c) => 'abcdefgh'[c] + (8 - r);
  function sound(key) { if (soundOn) { sounds[key].currentTime = 0; sounds[key].play().catch(() => {}); } }
  function status(text, win = false) { statusEl.textContent = text; statusEl.classList.toggle('win', win); }
  function log(text) { const el = document.createElement('div'); el.textContent = text; logEl.appendChild(el); logEl.scrollTop = logEl.scrollHeight; }
  function turn() { turnEl.innerHTML = `<span class="swatch ${current}"></span> ${name(current)} to move${mode === 'bot' && current === 'black' ? ' (computer)' : ''}`; }
  function stopBot() { generation++; clearTimeout(timer); timer = null; }
  function newGame() {
    stopBot(); board = rules.initialBoard(); current = 'white'; selected = null; lastMove = null; legal = []; chain = over = false;
    sounds.gameOver.pause(); sounds.gameOver.currentTime = 0;
    $('resultOverlay').classList.add('hidden');
    logEl.replaceChildren(); status('Select a piece to see its legal moves.'); turn(); render();
  }
  function showResult(winner, loser) {
    sounds.move.pause(); sounds.king.pause();
    sound('gameOver');
    $('resultTitle').textContent = `${name(winner)} wins!`;
    $('resultReason').textContent = `${name(loser)} has no legal moves.`;
    $('resultToken').className = `result-token ${winner}`;
    $('resultOverlay').classList.remove('hidden');
    $('resultRematchBtn').focus();
  }
  function finishTurn() {
    selected = null; legal = []; chain = false; current = rules.other(current); turn();
    if (!rules.legalMoves(board, current).length) {
      const winner = rules.other(current);
      over = true; status(`${name(winner)} wins! ${name(current)} has no legal moves.`, true);
      turnEl.innerHTML = `<span class="swatch ${winner}"></span> Game over`;
      log(`Game over: ${name(winner)} wins`);
      showResult(winner, current);
    } else if (mode === 'bot' && current === 'black') { status('Computer is thinking…'); scheduleBot(); }
    else status('Select a piece to see its legal moves.');
    render();
  }
  function apply(move) {
    const player = current, result = rules.applyMove(board, move);
    lastMove = move;
    log(`${name(player)}: ${label(...move.from)} → ${label(...move.to)}${move.capture ? ' (capture)' : ''}${result.promoted ? ' — crowned' : ''}`);
    sound(result.promoted ? 'king' : 'move');
    if (result.furtherJumps.length) {
      selected = move.to; legal = result.furtherJumps; chain = true;
      if (mode === 'bot' && player === 'black') { status('Computer continues its jump…'); scheduleBot(); }
      else status('Multi-jump available — continue with the highlighted piece.');
      render(); return;
    }
    finishTurn();
  }
  function scheduleBot() {
    const ticket = generation;
    timer = setTimeout(() => {
      timer = null;
      if (ticket !== generation || over || current !== 'black' || mode !== 'bot' || $('gameScreen').classList.contains('hidden')) return;
      const move = bot.chooseMove(board, chain ? legal : rules.legalMoves(board, 'black'));
      if (move) apply(move);
    }, 450);
  }
  function clickSquare(r, c) {
    if (over || (mode === 'bot' && current === 'black')) return;
    const move = legal.find(m => m.to[0] === r && m.to[1] === c);
    if (move) { apply(move); return; }
    if (chain || board[r][c]?.player !== current) return;
    legal = rules.legalMoves(board, current).filter(m => m.from[0] === r && m.from[1] === c);
    selected = legal.length ? [r, c] : null;
    status(legal.length ? `${legal.length} legal move${legal.length === 1 ? '' : 's'} highlighted.` : 'That piece cannot move now — a capture may be required elsewhere.');
    sound('click'); render();
  }
  function render() {
    const frag = document.createDocumentFragment();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const dark = (r + c) % 2 === 1, sq = document.createElement('button');
      sq.type = 'button'; sq.className = `sq ${dark ? 'dark playable' : 'light'}`;
      sq.setAttribute('aria-label', `${label(r, c)}${board[r][c] ? ` ${name(board[r][c].player)} ${board[r][c].king ? 'king' : 'piece'}` : ''}`);
      sq.disabled = !dark;
      if (lastMove?.from[0] === r && lastMove.from[1] === c) sq.classList.add('last-from');
      if (lastMove?.to[0] === r && lastMove.to[1] === c) sq.classList.add('last-to');
      if (selected?.[0] === r && selected[1] === c) sq.classList.add('selected');
      if (board[r][c]) { const piece = document.createElement('span'); piece.className = `piece ${board[r][c].player}${board[r][c].king ? ' king' : ''}`; sq.appendChild(piece); }
      const destination = legal.find(m => m.to[0] === r && m.to[1] === c);
      if (destination) { const dot = document.createElement('span'); dot.className = `dot${destination.capture ? ' capture' : ''}`; sq.appendChild(dot); }
      if (dark) sq.addEventListener('click', () => clickSquare(r, c));
      frag.appendChild(sq);
    }
    boardEl.replaceChildren(frag);
  }
  function menuArt() {
    const start = rules.initialBoard();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div'); cell.className = `cell ${(r + c) % 2 ? 'dark' : 'light'}`;
      if (start[r][c]) { const piece = document.createElement('div'); piece.className = `mini-piece ${start[r][c].player}`; cell.appendChild(piece); }
      $('artBoard').appendChild(cell);
    }
  }
  function setMode(next) {
    mode = next; $('opponent').value = next;
    document.querySelectorAll('[data-mode]').forEach(btn => { btn.classList.toggle('active', btn.dataset.mode === next); btn.setAttribute('aria-pressed', String(btn.dataset.mode === next)); });
  }
  function setPageHash(playing) {
    try { history.replaceState(null, '', playing ? '#play' : location.href.split('#')[0]); }
    catch (_) { location.hash = playing ? 'play' : ''; }
  }
  function showGame() { $('menuScreen').classList.add('hidden'); $('gameScreen').classList.remove('hidden'); newGame(); setPageHash(true); }
  function showMenu() { stopBot(); sounds.gameOver.pause(); sounds.gameOver.currentTime = 0; $('resultOverlay').classList.add('hidden'); $('gameScreen').classList.add('hidden'); $('menuScreen').classList.remove('hidden'); setPageHash(false); $('startBtn').focus(); }
  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => { setMode(btn.dataset.mode); sound('click'); }));
  $('opponent').addEventListener('change', () => { setMode($('opponent').value); sound('click'); newGame(); });
  document.querySelectorAll('[data-sound-toggle]').forEach(input => input.addEventListener('change', () => {
    soundOn = input.checked;
    document.querySelectorAll('[data-sound-toggle]').forEach(other => other.checked = soundOn);
    try { localStorage.setItem('checkers-sound', soundOn ? 'on' : 'off'); } catch (_) {}
    if (soundOn) sound('click');
  }));
  $('startBtn').addEventListener('click', () => { sound('click'); showGame(); });
  $('newGameBtn').addEventListener('click', () => { sound('click'); newGame(); });
  $('rematchBtn').addEventListener('click', () => { sound('click'); newGame(); });
  $('menuBtn').addEventListener('click', () => { sound('click'); showMenu(); });
  $('resultRematchBtn').addEventListener('click', () => { sound('click'); newGame(); });
  $('resultHomeBtn').addEventListener('click', () => { sound('click'); showMenu(); });
  $('resultOverlay').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const first = $('resultRematchBtn'), last = $('resultHomeBtn');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  menuArt(); setMode('friend');
  if (location.hash === '#play') showGame();
})();
