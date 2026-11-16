(function () {
  'use strict';
  const rules = window.CheckersRules, bot = window.CheckersBot;
  const $ = id => document.getElementById(id);
  const boardEl = $('board'), statusEl = $('status'), turnEl = $('turnIndicator'), logEl = $('log');
  const sounds = { click: new Audio('audio/home-screen-click.wav'), piece: new Audio('audio/click-on-piece.wav'), move: new Audio('audio/piece-move.ogg'), jump: new Audio('audio/checkers-jump-click.wav'), king: new Audio('audio/king-crowned.ogg'), gameOver: new Audio('audio/game-over.ogg') };
  Object.values(sounds).forEach(audio => { audio.volume = 0.35; });
  sounds.gameOver.volume = 0.25;
  let soundOn = true;
  try { soundOn = localStorage.getItem('checkers-sound') !== 'off'; } catch (_) { }
  document.querySelectorAll('[data-sound-toggle]').forEach(el => el.checked = soundOn);
  let dragOn = true, marksOn = true;
  try {
    dragOn = localStorage.getItem('checkers-drag') !== 'off';
    marksOn = localStorage.getItem('checkers-marks') !== 'off';
  } catch (_) { }
  document.querySelectorAll('[data-drag-toggle]').forEach(el => el.checked = dragOn);
  document.querySelectorAll('[data-marks-toggle]').forEach(el => el.checked = marksOn);
  let board, current, selected, lastMove = null, legal = [], chain = false, over = false, mode = 'friend', difficulty = 'easy', timer = null, generation = 0, gameId = null, moveNumber = 0;
  let markedSquares = new Set();
  let startingCounts = { white: 12, black: 12 }, focusSquare = [5, 0];
  const saveKey = 'checkers-active-game';
  let sessionSavePromise = Promise.resolve();
  let moveSavePromise = Promise.resolve();
  // Reads saved game
  function readSave() {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey));
      if (!saved || !Array.isArray(saved.board) || saved.board.length !== 8 ||
        !saved.board.every(row => Array.isArray(row) && row.length === 8 && row.every(piece =>
          piece === null || (['white', 'black'].includes(piece.player) && typeof piece.king === 'boolean'))) ||
        !['white', 'black'].includes(saved.current) || !['friend', 'bot'].includes(saved.mode) ||
        !['easy', 'medium', 'hard'].includes(saved.difficulty) || !Array.isArray(saved.moves)) return null;
      return saved;
    } catch (_) { return null; }
  }
  // Enables available continuation
  function updateContinue() { $('continueBtn').disabled = !readSave(); }
  function saveGame() {
    try {
      localStorage.setItem(saveKey, JSON.stringify({
        board, current, mode, difficulty, gameId, moveNumber,
        lastMove, selected: chain ? selected : null, chain, moves: Array.from(logEl.children, el => el.textContent),
        markedSquares: [...markedSquares], startingCounts
      }));
    } catch (error) { console.warn('Game could not be saved.', error); }
    updateContinue();
  }
  function clearSave() {
    try { localStorage.removeItem(saveKey); } catch (_) { }
    updateContinue();
  }
  const name = p => p === 'white' ? 'White' : 'Black';
  const label = (r, c) => 'abcdefgh'[c] + (8 - r);
  function sound(key) { if (soundOn) { sounds[key].currentTime = 0; sounds[key].play().catch(() => { }); } }
  function status(text, win = false) { statusEl.textContent = text; statusEl.classList.toggle('win', win); }
  function log(text) { const el = document.createElement('div'); el.textContent = text; logEl.appendChild(el); logEl.scrollTop = logEl.scrollHeight; }
  function turn() { turnEl.innerHTML = `<span class="swatch ${current}"></span> ${name(current)} to move${mode === 'bot' && current === 'black' ? ' (computer)' : ''}`; }
  function stopBot() { generation++; clearTimeout(timer); timer = null; }
  function countPieces() {
    const counts = { white: 0, black: 0 };
    board.flat().forEach(piece => { if (piece) counts[piece.player]++; });
    return counts;
  }
  function updateCaptureScores() {
    const remaining = countPieces();
    const whiteCaptured = Math.max(0, startingCounts.black - remaining.black);
    const blackCaptured = Math.max(0, startingCounts.white - remaining.white);
    if ($('whiteScore').textContent !== String(whiteCaptured)) $('whiteScore').textContent = String(whiteCaptured);
    if ($('blackScore').textContent !== String(blackCaptured)) $('blackScore').textContent = String(blackCaptured);
    for (const [player, count] of [['white', whiteCaptured], ['black', blackCaptured]]) {
      $(`${player}Captured`).classList.toggle('hidden', count === 0);
    }
  }

  // Helper function 
  async function updateGameSession() {
    if (!gameId) return;

    try {
      await moveSavePromise;
      const session = await window.CheckersDB.getGameSession(gameId);

      if (!session) {
        console.warn('Game session could not be found.');
        return;
      }
      session.boardState = board;
      session.currentTurn = current;
      session.opponentMode = mode;
      session.gameStatus = over ? 'completed' : 'inProgress';
      session.aiDifficulty = difficulty;

      await window.CheckersDB.saveGameSession(session);
    } catch (error) {
      console.warn('Game session could not be updated.', error);
    }
  }

  function newGame() {
    stopBot(); board = rules.initialBoard(); current = 'white'; selected = null; lastMove = null; legal = []; chain = over = false;
    markedSquares.clear(); startingCounts = countPieces(); focusSquare = [5, 0];
    sounds.gameOver.pause(); sounds.gameOver.currentTime = 0;
    $('resultOverlay').classList.add('hidden');
    $('gameHeader').inert = false; $('gameContent').inert = false;
    logEl.replaceChildren(); status('Select a piece to see its legal moves.'); turn(); render();
    
    // Creates a game session and unique game ID to record into the DB
    const session = window.CheckersDB.createGameSession({
      boardState: board,
      currentTurn: current,
      opponentMode: mode,
      gameStatus: 'inProgress',
      aiDifficulty: difficulty
    });

    gameId = session.gameId;
    moveNumber = 0;
    moveSavePromise = Promise.resolve();

    sessionSavePromise = window.CheckersDB.saveGameSession(session).catch(error => {
      console.warn('Game session could not be saved.', error);
      throw error;
    });
    saveGame();

  }
  function showResult(winner, loser) {
    sounds.move.pause(); sounds.jump.pause(); sounds.king.pause();
    sound('gameOver');
    $('resultTitle').textContent = `${name(winner)} wins!`;
    $('resultReason').textContent = `${name(loser)} has no legal moves.`;
    $('resultToken').className = `result-token ${winner}`;
    $('gameHeader').inert = true; $('gameContent').inert = true;
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
      // Save Completed Game Result
      window.CheckersDB.recordGameResult('Player', winner === 'white').catch(error => console.warn('Game history could not be saved.', error));
      clearSave(); showResult(winner, current);
    } else if (mode === 'bot' && current === 'black') { status('Computer is thinking…'); scheduleBot(); }
    else status('Select a piece to see its legal moves.');
    render();
    if (!over) saveGame();
    updateGameSession();
  }

  function apply(move) {
    const player = current, result = rules.applyMove(board, move);
    lastMove = move;
    const currentMoveNumber = ++moveNumber;

    // Waits for moveSavePromise and sessionSavePromise to resolve, then records the current move in DB, resolving the promise for next queued move to proceed.
    moveSavePromise = moveSavePromise.then(() => sessionSavePromise).then(() => window.CheckersDB.recordMove({
      gameId,
      moveNumber: currentMoveNumber,
      player,
      startPosition: move.from,
      endPosition: move.to,
      isCapture: move.capture,
      isPromotion: result.promoted
    })).catch(error => console.warn('Move could not be saved.', error));

    log(`${name(player)}: ${label(...move.from)} → ${label(...move.to)}${move.capture ? ' (capture)' : ''}${result.promoted ? ' — crowned' : ''}`);
    if (move.capture) sound('jump');
    if (result.promoted) sound('king');
    else if (!move.capture) sound('move');
    if (result.furtherJumps.length) {
      selected = move.to; legal = result.furtherJumps; chain = true;
      if (mode === 'bot' && player === 'black') { status('Computer continues its jump…'); scheduleBot(); }
      else status('Multi-jump available — continue with the highlighted piece.');
      render(); saveGame(); return;
    }
    finishTurn();
  }


  function scheduleBot() {
    const ticket = generation;
    timer = setTimeout(() => {
      timer = null;
      if (ticket !== generation || over || current !== 'black' || mode !== 'bot' || $('gameScreen').classList.contains('hidden')) return;
      // Pass the current difficulty setting to the bot
      const move = bot.chooseMove(board, chain ? legal : rules.legalMoves(board, 'black'), difficulty);
      if (move) apply(move);
    }, 450);
  }

  function clickSquare(r, c) {
    if (over || (mode === 'bot' && current === 'black')) return;
    focusSquare = [r, c];
    const move = legal.find(m => m.to[0] === r && m.to[1] === c);
    if (move) { apply(move); return; }
    if (chain || board[r][c]?.player !== current) return;
    legal = rules.legalMoves(board, current).filter(m => m.from[0] === r && m.from[1] === c);
    selected = legal.length ? [r, c] : null;
    status(legal.length ? `${legal.length} legal move${legal.length === 1 ? '' : 's'} highlighted.` : 'That piece cannot move now — a capture may be required elsewhere.');
    sound('piece'); render();
  }

  let drag = null, suppressClick = false;
  function dragStart(event) {
    if (!dragOn || event.button !== 0) return;
    suppressClick = false;
    const square = event.target.closest('.sq');
    if (!square || !square.querySelector('.piece') || over ||
      (mode === 'bot' && current === 'black')) return;
    const from = [Number(square.dataset.row), Number(square.dataset.col)];
    if (board[from[0]][from[1]]?.player !== current) return;
    const moves = (chain ? legal : rules.legalMoves(board, current))
      .filter(move => move.from[0] === from[0] && move.from[1] === from[1]);
    if (!moves.length) return;
    drag = {
      from, moves, square, x: event.clientX, y: event.clientY,
      pointerId: event.pointerId, ghost: null
    };
  }

  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.ghost) {
      drag.ghost = drag.square.querySelector('.piece').cloneNode(true);
      drag.ghost.classList.add('drag-ghost');
      document.body.appendChild(drag.ghost);
      drag.square.classList.add('dragging');
      for (const move of drag.moves) boardEl.children[move.to[0] * 8 + move.to[1]].classList.add('drop-target');
    }
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
  }

  function dragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const active = drag;
    drag = null;
    if (!active.ghost) return;
    event.preventDefault();
    suppressClick = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.sq');
    const row = Number(target?.dataset.row), col = Number(target?.dataset.col);
    const move = event.type !== 'pointercancel' && active.moves.find(m => target && m.to[0] === row && m.to[1] === col);
    active.ghost.remove();
    active.square.classList.remove('dragging');
    boardEl.querySelectorAll('.drop-target').forEach(square => square.classList.remove('drop-target'));
    if (move) apply(move);
    else status('Drop the piece on a highlighted square.');
  }

  boardEl.addEventListener('pointerdown', dragStart);
  function toggleMark(square) {
    if (!marksOn || !square) return;
    const key = `${square.dataset.row},${square.dataset.col}`;
    if (markedSquares.has(key)) markedSquares.delete(key);
    else markedSquares.add(key);
    square.classList.toggle('marked', markedSquares.has(key));
    square.setAttribute('aria-label', squareLabel(Number(square.dataset.row), Number(square.dataset.col)));
    $('markStatus').textContent = `${label(Number(square.dataset.row), Number(square.dataset.col))} ${markedSquares.has(key) ? 'marked red' : 'red mark removed'}.`;
    if (board && !over) saveGame();
  }

  boardEl.addEventListener('contextmenu', event => {
    event.preventDefault();
    toggleMark(event.target.closest('.sq'));
  });

  boardEl.addEventListener('keydown', event => {
    const square = event.target.closest('.sq');
    if (!square) return;
    const row = Number(square.dataset.row), col = Number(square.dataset.col);
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
    if (step) {
      event.preventDefault();
      const nextRow = Math.max(0, Math.min(7, row + step[0]));
      const nextCol = Math.max(0, Math.min(7, col + step[1]));
      square.tabIndex = -1;
      focusSquare = [nextRow, nextCol];
      const next = boardEl.children[nextRow * 8 + nextCol];
      next.tabIndex = 0;
      next.focus({ preventScroll: true });
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault(); toggleMark(square);
    }
  });

  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', dragEnd);
  window.addEventListener('pointercancel', dragEnd);
  function squareLabel(r, c) {
    const piece = board[r][c];
    const destination = legal.find(move => move.to[0] === r && move.to[1] === c);
    return `${label(r, c)}, ${piece ? `${name(piece.player)} ${piece.king ? 'king' : 'piece'}` : 'empty'}${destination ? destination.capture ? ', legal capture destination' : ', legal destination' : ''}${selected?.[0] === r && selected[1] === c ? ', selected' : ''}${lastMove?.from[0] === r && lastMove.from[1] === c ? ', last move from here' : ''}${lastMove?.to[0] === r && lastMove.to[1] === c ? ', last move to here' : ''}${markedSquares.has(`${r},${c}`) && marksOn ? ', marked red' : ''}`;
  }

  function render() {
    const focused = document.activeElement;
    const restoreFocus = focused?.parentElement === boardEl && focused.dataset?.row !== undefined;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const dark = (r + c) % 2 === 1, sq = document.createElement('button');
      sq.type = 'button'; sq.className = `sq ${dark ? 'dark playable' : 'light'}`;
      sq.dataset.row = r; sq.dataset.col = c;
      sq.tabIndex = focusSquare[0] === r && focusSquare[1] === c ? 0 : -1;
      sq.setAttribute('aria-label', squareLabel(r, c));
      if (marksOn && markedSquares.has(`${r},${c}`)) sq.classList.add('marked');
      if (lastMove?.from[0] === r && lastMove.from[1] === c) sq.classList.add('last-from');
      if (lastMove?.to[0] === r && lastMove.to[1] === c) sq.classList.add('last-to');
      if (selected?.[0] === r && selected[1] === c) sq.classList.add('selected');
      if (board[r][c]) { const piece = document.createElement('span'); piece.className = `piece ${board[r][c].player}${board[r][c].king ? ' king' : ''}`; sq.appendChild(piece); }
      const destination = legal.find(m => m.to[0] === r && m.to[1] === c);
      if (destination) { const dot = document.createElement('span'); dot.className = `dot${destination.capture ? ' capture' : ''}`; sq.appendChild(dot); }
      if (dark) sq.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        clickSquare(r, c);
      });
      frag.appendChild(sq);
    }
    boardEl.replaceChildren(frag);
    updateCaptureScores();
    if (restoreFocus) boardEl.children[focusSquare[0] * 8 + focusSquare[1]].focus({ preventScroll: true });
  }

  function menuArt() {
    const start = rules.initialBoard();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div'); cell.className = `cell ${(r + c) % 2 ? 'dark' : 'light'}`;
      if (start[r][c]) { const piece = document.createElement('div'); piece.className = `mini-piece ${start[r][c].player}`; cell.appendChild(piece); }
      $('artBoard').appendChild(cell);
    }
  }

  function updateMatchMeta() {
    const metaEl = $('matchMeta');
    if (!metaEl) return;
    if (mode === 'bot') {
      const diffName = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
      metaEl.textContent = `Mode: Solo vs Computer (${diffName})`;
    } else {
      metaEl.textContent = 'Mode: Pass & Play (2 Players)';
    }
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll('[data-mode]').forEach(btn => {
      const isSelected = btn.dataset.mode === next;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });
    const diffField = $('difficultyField');
    if (diffField) {
      diffField.classList.toggle('hidden', next !== 'bot');
    }
    updateMatchMeta();
  }

  function setPageHash(playing) {
    try { history.replaceState(null, '', playing ? '#play' : location.href.split('#')[0]); }
    catch (_) { location.hash = playing ? 'play' : ''; }
  }

  // Load Saved Game History
  async function loadHistory() {
    try {
      const state = await window.CheckersDB.getOrCreateUserState('Player');
      $('historyRecord').textContent = `Wins: ${state.totalWins} · Losses: ${state.totalLosses}`;
      $('historyOutcome').textContent = `Previous game: ${state.lastOutcome === 'win' ? 'White won' : state.lastOutcome === 'loss' ? 'White lost' : 'None yet'}`;
      $('historyPercentage').textContent = `Win percentage: ${state.winPercentage}%`;
    } catch (error) {
      $('historyRecord').textContent = 'Game history unavailable.';
      $('historyOutcome').textContent = '';
      $('historyPercentage').textContent = '';
      console.warn('Game history could not be loaded.', error);
    }
  }

  // List saved in-progress game sessions from IndexedDB
  async function renderSavedGamesList() {
    const listEl = $('savedGamesList');
    if (!listEl) return;
    try {
      const sessions = await window.CheckersDB.listGameSessions();
      const activeSessions = sessions.filter(s => s.gameStatus === 'inProgress');
      listEl.replaceChildren();

      if (!activeSessions.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No saved games found.';
        listEl.appendChild(empty);
        return;
      }

      activeSessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'saved-game-item';

        const info = document.createElement('div');
        info.className = 'saved-game-info';

        const title = document.createElement('strong');
        const modeLabel = session.opponentMode === 'bot'
          ? `vs Computer (${session.aiDifficulty})`
          : 'Pass & Play';
        title.textContent = `${modeLabel} · ${name(session.currentTurn)}'s turn`;

        const dateText = document.createElement('small');
        const date = new Date(session.updatedAt);
        dateText.textContent = date.toLocaleString();

        info.append(title, dateText);

        const actions = document.createElement('div');
        actions.className = 'saved-game-actions';

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'btn primary btn-sm';
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', () => {
          sound('click');
          loadSavedSession(session.gameId);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn ghost btn-sm';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
          sound('click');
          await window.CheckersDB.deleteGameSession(session.gameId);
          if (readSave()?.gameId === session.gameId) clearSave();
          renderSavedGamesList();
        });

        actions.append(loadBtn, delBtn);
        item.append(info, actions);
        listEl.appendChild(item);
      });
    } catch (error) {
      listEl.innerHTML = '<p>Could not load saved games.</p>';
      console.warn('Could not list saved sessions.', error);
    }
  }

  // Load a specific game session by gameId from IndexedDB
  async function loadSavedSession(targetGameId) {
    try {
      const session = await window.CheckersDB.getGameSession(targetGameId);
      if (!session) {
        alert('Saved game could not be found.');
        renderSavedGamesList();
        return;
      }
      const moves = await window.CheckersDB.getMovesForGame(targetGameId);
      stopBot();

      board = session.boardState;
      current = session.currentTurn;
      mode = session.opponentMode;
      difficulty = session.aiDifficulty || 'easy';
      gameId = session.gameId;
      moveNumber = moves.length;
      selected = null;
      legal = [];
      chain = false;
      over = session.gameStatus === 'completed';

      const lastRecorded = moves[moves.length - 1];
      lastMove = lastRecorded
        ? { from: lastRecorded.startPosition, to: lastRecorded.endPosition, capture: lastRecorded.isCapture }
        : null;

      markedSquares.clear();
      startingCounts = { white: 12, black: 12 };
      focusSquare = [5, 0];
      sessionSavePromise = Promise.resolve();
      moveSavePromise = Promise.resolve();

      setMode(mode);
      if ($('difficulty')) $('difficulty').value = difficulty;
      updateMatchMeta();

      logEl.replaceChildren();
      moves.forEach(m => {
        log(`${name(m.player)}: ${label(...m.startPosition)} → ${label(...m.endPosition)}${m.isCapture ? ' (capture)' : ''}${m.isPromotion ? ' — crowned' : ''}`);
      });

      $('resultOverlay').classList.add('hidden');
      $('gameHeader').inert = false;
      $('gameContent').inert = false;
      $('menuScreen').classList.add('hidden');
      $('gameScreen').classList.remove('hidden');

      turn();
      render();
      saveGame();
      status(mode === 'bot' && current === 'black' ? 'Computer is thinking…' : 'Game loaded. Select a piece to see its legal moves.');
      setPageHash(true);
      $('gameTitle').focus();
      if (mode === 'bot' && current === 'black' && !over) scheduleBot();
    } catch (error) {
      console.warn('Failed to load game session.', error);
    }
  }

  // Explicitly saves the active game to both localStorage and IndexedDB
  async function manualSaveGame() {
    if (!board || over) return;
    saveGame();
    await updateGameSession();
    status('Game saved! You can resume it anytime from the main menu.');
  }

  function showGame() {
    updateMatchMeta();
    $('menuScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    newGame();
    setPageHash(true);
    $('gameTitle').focus();
  }

  // Restores quick-saved game from localStorage
  function continueGame() {
    const saved = readSave();
    if (!saved) { updateContinue(); return; }
    stopBot();
    board = saved.board;
    current = saved.current;
    selected = saved.chain ? saved.selected : null;
    gameId = saved.gameId ?? null;
    moveNumber = saved.moveNumber ?? 0;
    sessionSavePromise = Promise.resolve();
    lastMove = saved.lastMove; chain = !!saved.chain; over = false;
    markedSquares = new Set(Array.isArray(saved.markedSquares) ? saved.markedSquares.filter(key => /^[0-7],[0-7]$/.test(key)) : []);
    startingCounts = saved.startingCounts && Number.isInteger(saved.startingCounts.white) && Number.isInteger(saved.startingCounts.black)
      ? saved.startingCounts : { white: 12, black: 12 };
    focusSquare = [5, 0];
    legal = chain && Array.isArray(selected) ? rules.pieceMoves(board, ...selected).jumps : [];
    mode = saved.mode; difficulty = saved.difficulty;
    setMode(mode);
    if ($('difficulty')) $('difficulty').value = difficulty;
    updateMatchMeta();
    logEl.replaceChildren(); saved.moves.forEach(log);
    $('resultOverlay').classList.add('hidden');
    $('gameHeader').inert = false; $('gameContent').inert = false;
    $('menuScreen').classList.add('hidden'); $('gameScreen').classList.remove('hidden');
    turn(); render();
    status(chain ? 'Multi-jump available — continue with the highlighted piece.' :
      mode === 'bot' && current === 'black' ? 'Computer is thinking…' : 'Select a piece to see its legal moves.');
    setPageHash(true);
    $('gameTitle').focus();
    if (mode === 'bot' && current === 'black') scheduleBot();
  }

  function showMenu() {
    stopBot();
    if (board && !over) {
      saveGame();
      updateGameSession();
    }
    sounds.gameOver.pause();
    sounds.gameOver.currentTime = 0;
    $('resultOverlay').classList.add('hidden');
    $('gameHeader').inert = false;
    $('gameContent').inert = false;
    $('gameScreen').classList.add('hidden');
    $('menuScreen').classList.remove('hidden');
    setPageHash(false);
    updateContinue();
    if ($('historyPanel') && !$('historyPanel').classList.contains('hidden')) loadHistory();
    if ($('savedGamesPanel') && !$('savedGamesPanel').classList.contains('hidden')) renderSavedGamesList();
    $('startBtn').focus();
  }

  document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    setMode(btn.dataset.mode);
    sound('click');
  }));

  const difficultyEl = $('difficulty');
  if (difficultyEl) {
    difficultyEl.addEventListener('change', () => {
      difficulty = difficultyEl.value;
      updateMatchMeta();
      sound('click');
    });
  }

  document.querySelectorAll('[data-sound-toggle]').forEach(input => input.addEventListener('change', () => {
    soundOn = input.checked;
    document.querySelectorAll('[data-sound-toggle]').forEach(other => other.checked = soundOn);
    try { localStorage.setItem('checkers-sound', soundOn ? 'on' : 'off'); } catch (_) { }
    if (soundOn) sound('click');
  }));

  for (const [selector, key] of [['[data-drag-toggle]', 'checkers-drag'], ['[data-marks-toggle]', 'checkers-marks']]) {
    document.querySelectorAll(selector).forEach(input => input.addEventListener('change', () => {
      const enabled = input.checked;
      if (key === 'checkers-drag') dragOn = enabled;
      else { marksOn = enabled; if (!enabled) markedSquares.clear(); if (board) render(); if (board && !over) saveGame(); }
      document.querySelectorAll(selector).forEach(other => other.checked = enabled);
      try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) { }
    }));
  }

  $('historyButton')?.addEventListener('click', () => {
    sound('click');
    const open = !$('historyPanel').classList.toggle('hidden');
    $('historyButton').setAttribute('aria-expanded', String(open));
    if (open) loadHistory();
  });

  $('savedGamesButton')?.addEventListener('click', () => {
    sound('click');
    const open = !$('savedGamesPanel').classList.toggle('hidden');
    $('savedGamesButton').setAttribute('aria-expanded', String(open));
    if (open) renderSavedGamesList();
  });

  $('startBtn').addEventListener('click', () => { sound('click'); showGame(); });
  $('continueBtn').addEventListener('click', () => { sound('click'); continueGame(); });
  // "New game" while in an active game saves state and takes the player back to the main menu
  $('newGameBtn').addEventListener('click', () => { sound('click'); showMenu(); });
  $('saveGameBtn')?.addEventListener('click', () => { sound('click'); manualSaveGame(); });
  $('rematchBtn').addEventListener('click', () => { sound('click'); newGame(); });
  $('resultRematchBtn').addEventListener('click', () => { sound('click'); newGame(); $('gameTitle').focus(); });
  $('resultHomeBtn').addEventListener('click', () => { sound('click'); showMenu(); });

  $('resultOverlay').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const first = $('resultRematchBtn'), last = $('resultHomeBtn');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  menuArt();
  setMode('friend');
  updateContinue();
  if (location.hash === '#play') {
    if (readSave()) continueGame();
    else showGame();
  }
})();
