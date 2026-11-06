// Node Built in Test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
//  Locate Project Root and Load Game Logic

const root = process.env.CHECKERS_ROOT || path.resolve(__dirname, '..');
const rules = require(path.join(root, 'js/logic/draughtAdapter.js'));
const gameSource = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

// Stand in for HTML element.
// Supports DOM features that game.js uses. 
function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, attributes: {}, textContent: '', innerHTML: '', value: '', style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name);
        return add;
      }
    },
    addEventListener(name, handler) { (this.listeners ??= {})[name] = handler; },
    click() { this.listeners?.click?.(); },
    closest(selector) { return selector === '.sq' ? this : null; },
    querySelector(selector) { return selector === '.piece' ? this.children.find(child => child.className?.includes('piece')) : null; },
    querySelectorAll(selector) { return selector === '.drop-target' ? this.children.filter(child => child.classList.contains('drop-target')) : []; },
    cloneNode() { const copy = element(); copy.className = this.className; return copy; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) {
      this.children = children.flatMap(child => child.fragment ? child.children : [child]);
      this.children.forEach(child => { child.parentElement = this; });
    },
    focus() { this.focused = true; }
  };
}
// Starts fresh copy of game for each of the tests. 
// InitialBoard can be replaced with the short controlled board
function setup(initialBoard = rules.initialBoard, storage = new Map()) {
// Page elements accessed by game.js.
  const ids = [
    'board', 'status', 'turnIndicator', 'log', 'resultOverlay', 'resultTitle',
    'resultReason', 'resultToken', 'resultRematchBtn', 'resultHomeBtn',
    'gameScreen', 'menuScreen', 'artBoard', 'opponent', 'difficulty',
    'historyPanel', 'historyButton', 'historyRecord', 'historyOutcome',
    'historyPercentage', 'startBtn', 'continueBtn', 'newGameBtn', 'rematchBtn', 'menuBtn',
    'whiteScore', 'blackScore', 'whiteCaptured', 'blackCaptured', 'gameTitle',
    'gameHeader', 'gameContent', 'markStatus'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  // Match hidden state of these on real page.
  for (const id of ['gameScreen', 'resultOverlay', 'historyPanel']) elements[id].classList.add('hidden');
  // Simulates the Friend and Bot buttons. 
  const modes = ['friend', 'bot'].map(mode => Object.assign(element(), { dataset: { mode } }));
  const soundToggle = element();
  const dragToggles = [element(), element()];
  const marksToggles = [element(), element()];
  const windowListeners = {};
  let dropTarget = null;
  // Record 
  const scheduled = [];
  const results = [];
  const botCalls = [];
  const document = {
    activeElement: null,
    getElementById(id) { return elements[id]; },
    querySelectorAll(selector) {
      if (selector === '[data-mode]') return modes;
      if (selector === '[data-sound-toggle]') return [soundToggle];
      if (selector === '[data-drag-toggle]') return dragToggles;
      if (selector === '[data-marks-toggle]') return marksToggles;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    createElement() {
      const created = element();
      created.focus = function () { document.activeElement = this; this.focused = true; };
      return created;
    },
    body: element(),
    elementFromPoint() { return dropTarget; },
    createDocumentFragment() { return Object.assign(element(), { fragment: true }); }
  };
  for (const el of Object.values(elements)) {
    el.focus = function () { document.activeElement = this; this.focused = true; };
  }
  const location = { href: 'http://localhost/', hash: '' };
  const window = {
    addEventListener(name, handler) { windowListeners[name] = handler; },
    // Real Rules
    CheckersRules: { ...rules, initialBoard },
    // Records bot calls chooses moves
    CheckersBot: { chooseMove(board, legalMoves, difficulty) {
      botCalls.push({ board, legalMoves, difficulty });
      return legalMoves[0];
    } },
    CheckersDB: { recordGameResult(_player, won) { results.push(won); return Promise.resolve(); } }
  };
  const context = {
    window, document, location,
    history: { replaceState() {} },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    console
  };
  vm.runInNewContext(gameSource, context, { filename: 'game.js' });
  return { elements, document, modes, scheduled, results, botCalls, dragToggles, marksToggles,
    rightClick(row, col) {
      let prevented = false;
      elements.board.listeners.contextmenu({ target: this.square(row, col), preventDefault() { prevented = true; } });
      return prevented;
    },
    drag(from, to) {
      const source = this.square(...from);
      dropTarget = to ? this.square(...to) : null;
      elements.board.listeners.pointerdown({ target: source, pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      windowListeners.pointermove({ pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
      windowListeners.pointerup({ type: 'pointerup', pointerId: 1, clientX: 30, clientY: 30, preventDefault() {} });
    },
    square(row, col) { return elements.board.children[row * 8 + col]; }
  };
}

function boardWith(...pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [row, col, player] of pieces) board[row][col] = { player, king: false };
  return board;
}
// Test #1: White captures last Black piece and wins.
// Should save win.
test('records a win when White captures the last Black piece', () => {
  const app = setup(() => boardWith([2, 1, 'white'], [1, 2, 'black']));
  app.elements.startBtn.click();
  app.square(2, 1).click();
  app.square(0, 3).click();
  assert.equal(app.elements.resultTitle.textContent, 'White wins!');
  assert.equal(app.elements.resultReason.textContent, 'Black has no legal moves.');
  assert.equal(app.elements.resultOverlay.classList.contains('hidden'), false);
  assert.equal(app.elements.gameContent.inert, true);
  assert.deepEqual(app.results, [true]);
  app.elements.resultRematchBtn.click();
  assert.equal(app.elements.gameContent.inert, false);
  assert.equal(app.document.activeElement, app.elements.gameTitle);
});
// Test #2: Black captures last White piece and wiwins.
// Should display a Black win and account for the loss.
test('records a loss when Black captures the last White piece', () => {
  const app = setup(() => boardWith([5, 0, 'white'], [3, 2, 'black']));
  app.elements.startBtn.click();
  app.square(5, 0).click();
  app.square(4, 1).click();
  app.square(3, 2).click();
  app.square(5, 0).click();
  assert.equal(app.elements.resultTitle.textContent, 'Black wins!');
  assert.equal(app.elements.resultReason.textContent, 'White has no legal moves.');
  assert.equal(app.elements.resultOverlay.classList.contains('hidden'), false);
  assert.deepEqual(app.results, [false]);
});
// Test #3: Select Solo Game, start, and ready for White to move.
// The scheduled computer shall be easy.
test('starts an easy bot game and uses easy difficulty for the bot turn', () => {
  const app = setup();
  app.modes[1].click();
  app.elements.startBtn.click();
  assert.equal(app.elements.gameScreen.classList.contains('hidden'), false);
  assert.equal(app.elements.opponent.value, 'bot');
  assert.equal(app.elements.turnIndicator.innerHTML.includes('White to move'), true);
  assert.equal(app.elements.board.children.length, 64);
  app.square(5, 0).click();
  app.square(4, 1).click();
  assert.equal(app.scheduled.length, 1);
  app.scheduled.shift()();
  assert.equal(app.botCalls.length, 1);
  assert.equal(app.botCalls[0].difficulty, 'easy');
});
// Test #4: Starts a default Friend Game and waits for White's first move.
// Black gets next turn.
test('starts a friend game and gives Black the next turn without a bot', () => {
  const app = setup();
  app.elements.startBtn.click();
  assert.equal(app.elements.gameScreen.classList.contains('hidden'), false);
  assert.equal(app.elements.opponent.value, 'friend');
  assert.equal(app.elements.board.children.length, 64);
  app.square(5, 0).click();
  app.square(4, 1).click();
  assert.equal(app.elements.turnIndicator.innerHTML.includes('Black to move'), true);
  assert.equal(app.square(5, 0).attributes['aria-label'].includes('last move from here'), true);
  assert.equal(app.square(4, 1).attributes['aria-label'].includes('last move to here'), true);
  assert.equal(app.scheduled.length, 0);
  assert.equal(app.botCalls.length, 0);
});

test('continue restores the board, turn, opponent, and move history after reload', () => {
  const storage = new Map();
  const first = setup(rules.initialBoard, storage);
  assert.equal(first.elements.continueBtn.disabled, true);
  first.modes[1].click();
  first.elements.startBtn.click();
  first.square(5, 0).click();
  first.square(4, 1).click();
  const resumed = setup(rules.initialBoard, storage);
  assert.equal(resumed.elements.continueBtn.disabled, false);
  resumed.elements.continueBtn.click();
  assert.equal(resumed.elements.gameScreen.classList.contains('hidden'), false);
  assert.equal(resumed.elements.opponent.value, 'bot');
  assert.equal(resumed.elements.turnIndicator.innerHTML.includes('Black to move'), true);
  assert.equal(resumed.square(4, 1).attributes['aria-label'].startsWith('b4, White piece'), true);
  assert.equal(resumed.elements.log.children.length, 1);
  assert.equal(resumed.scheduled.length, 1);
});

test('completed games clear the continue option', () => {
  const storage = new Map();
  const app = setup(() => boardWith([2, 1, 'white'], [1, 2, 'black']), storage);
  app.elements.startBtn.click();
  app.square(2, 1).click();
  app.square(0, 3).click();
  assert.equal(app.elements.continueBtn.disabled, true);
  assert.equal(storage.has('checkers-active-game'), false);
});

test('dragging a piece makes a legal move and saves the new turn', () => {
  const storage = new Map();
  const app = setup(rules.initialBoard, storage);
  app.elements.startBtn.click();
  app.drag([5, 0], [4, 1]);
  assert.equal(app.square(4, 1).attributes['aria-label'].startsWith('b4, White piece'), true);
  assert.equal(app.elements.turnIndicator.innerHTML.includes('Black to move'), true);
  assert.equal(JSON.parse(storage.get('checkers-active-game')).current, 'black');
});

test('dragging to an illegal square leaves the board unchanged', () => {
  const app = setup();
  app.elements.startBtn.click();
  app.drag([5, 0], [3, 2]);
  assert.equal(app.square(5, 0).attributes['aria-label'].startsWith('a3, White piece'), true);
  assert.equal(app.elements.turnIndicator.innerHTML.includes('White to move'), true);
});

test('dragging respects forced captures', () => {
  const app = setup(() => boardWith([5, 0, 'white'], [5, 4, 'white'], [4, 5, 'black'], [2, 7, 'black']));
  app.elements.startBtn.click();
  app.drag([5, 0], [4, 1]);
  assert.equal(app.square(5, 0).attributes['aria-label'].startsWith('a3, White piece'), true);
  app.drag([5, 4], [3, 6]);
  assert.equal(app.square(3, 6).attributes['aria-label'].startsWith('g5, White piece'), true);
});

test('chain jumps can be completed by dragging the same piece again', () => {
  const app = setup(() => boardWith([5, 0, 'white'], [4, 1, 'black'], [2, 3, 'black'], [0, 7, 'black']));
  app.elements.startBtn.click();
  app.drag([5, 0], [3, 2]);
  assert.equal(app.elements.turnIndicator.innerHTML.includes('White to move'), true);
  app.drag([3, 2], [1, 4]);
  assert.equal(app.square(1, 4).attributes['aria-label'].startsWith('e7, White piece'), true);
  assert.equal(app.elements.turnIndicator.innerHTML.includes('Black to move'), true);
});

test('right-click toggles multiple red marks without moving pieces', () => {
  const app = setup();
  app.elements.startBtn.click();
  assert.equal(app.rightClick(5, 0), true);
  app.rightClick(4, 1);
  assert.equal(app.square(5, 0).classList.contains('marked'), true);
  assert.equal(app.square(4, 1).classList.contains('marked'), true);
  app.rightClick(5, 0);
  assert.equal(app.square(5, 0).classList.contains('marked'), false);
  assert.equal(app.square(4, 1).classList.contains('marked'), true);
  assert.equal(app.elements.markStatus.textContent, 'a3 red mark removed.');
  assert.equal(app.elements.turnIndicator.innerHTML.includes('White to move'), true);
  assert.equal(app.elements.log.children.length, 0);
});

test('red marks survive moves and Continue, then clear for a new game', () => {
  const storage = new Map();
  const app = setup(rules.initialBoard, storage);
  app.elements.startBtn.click();
  app.rightClick(4, 1);
  app.square(5, 0).click();
  app.square(4, 1).click();
  assert.equal(app.square(4, 1).classList.contains('marked'), true);
  const resumed = setup(rules.initialBoard, storage);
  resumed.elements.continueBtn.click();
  assert.equal(resumed.square(4, 1).classList.contains('marked'), true);
  resumed.elements.newGameBtn.click();
  assert.equal(resumed.square(4, 1).classList.contains('marked'), false);
});

test('settings can turn red marks and drag and drop off independently', () => {
  const storage = new Map();
  const app = setup(rules.initialBoard, storage);
  app.elements.startBtn.click();
  app.rightClick(4, 1);
  app.marksToggles[0].checked = false;
  app.marksToggles[0].listeners.change();
  assert.equal(app.marksToggles[1].checked, false);
  assert.equal(app.square(4, 1).classList.contains('marked'), false);
  assert.equal(app.rightClick(4, 1), true);
  assert.equal(app.square(4, 1).classList.contains('marked'), false);
  app.dragToggles[1].checked = false;
  app.dragToggles[1].listeners.change();
  assert.equal(app.dragToggles[0].checked, false);
  app.drag([5, 0], [4, 1]);
  assert.equal(app.square(5, 0).attributes['aria-label'].startsWith('a3, White piece'), true);
  app.square(5, 0).click();
  app.square(4, 1).click();
  assert.equal(app.square(4, 1).attributes['aria-label'].startsWith('b4, White piece'), true);
  assert.equal(storage.get('checkers-drag'), 'off');
  assert.equal(storage.get('checkers-marks'), 'off');
});

test('separate scores show pieces captured by White and Black through Continue', () => {
  const storage = new Map();
  const start = () => boardWith([2, 1, 'white'], [1, 2, 'black'], [0, 7, 'black']);
  const app = setup(start, storage);
  app.elements.startBtn.click();
  assert.equal(app.elements.whiteScore.textContent, '0');
  assert.equal(app.elements.blackScore.textContent, '0');
  assert.equal(app.elements.whiteCaptured.classList.contains('hidden'), true);
  app.square(2, 1).click();
  app.square(0, 3).click();
  assert.equal(app.elements.whiteScore.textContent, '1');
  assert.equal(app.elements.blackScore.textContent, '0');
  assert.equal(app.elements.whiteCaptured.classList.contains('hidden'), false);
  assert.equal(app.elements.blackCaptured.classList.contains('hidden'), true);
  const resumed = setup(start, storage);
  resumed.elements.continueBtn.click();
  assert.equal(resumed.elements.whiteScore.textContent, '1');
  assert.equal(resumed.elements.blackScore.textContent, '0');
  resumed.elements.newGameBtn.click();
  assert.equal(resumed.elements.whiteCaptured.classList.contains('hidden'), true);
  assert.equal(resumed.elements.whiteScore.textContent, '0');
});

test('separate scores show pieces captured by Black', () => {
  const storage = new Map();
  const board = boardWith([5, 0, 'white'], [0, 1, 'black'], [0, 3, 'black'], [0, 5, 'black'], [0, 7, 'black']);
  storage.set('checkers-active-game', JSON.stringify({ board, current: 'white', mode: 'friend', difficulty: 'easy',
    moves: [], startingCounts: { white: 4, black: 4 } }));
  const app = setup(rules.initialBoard, storage);
  app.elements.continueBtn.click();
  assert.equal(app.elements.whiteScore.textContent, '0');
  assert.equal(app.elements.blackScore.textContent, '3');
  assert.equal(app.elements.blackCaptured.classList.contains('hidden'), false);
});

test('keyboard navigation and M marking work on light and dark squares', () => {
  const app = setup();
  app.elements.startBtn.click();
  const source = app.square(5, 0);
  source.focus();
  app.elements.board.listeners.keydown({ target: source, key: 'ArrowRight', preventDefault() {} });
  const lightSquare = app.square(5, 1);
  assert.equal(app.document.activeElement, lightSquare);
  app.elements.board.listeners.keydown({ target: lightSquare, key: 'm', preventDefault() {} });
  assert.equal(lightSquare.classList.contains('marked'), true);
  assert.equal(lightSquare.attributes['aria-label'].includes('marked red'), true);
  app.elements.board.listeners.keydown({ target: lightSquare, key: 'm', preventDefault() {} });
  assert.equal(lightSquare.classList.contains('marked'), false);
});

test('board focus is restored after selecting a piece', () => {
  const app = setup();
  app.elements.startBtn.click();
  app.square(5, 0).focus();
  app.square(5, 0).click();
  assert.equal(app.document.activeElement, app.square(5, 0));
  assert.equal(app.square(4, 1).attributes['aria-label'].includes('legal destination'), true);
});

test('capture destinations are announced distinctly to screen readers', () => {
  const app = setup(() => boardWith([2, 1, 'white'], [1, 2, 'black']));
  app.elements.startBtn.click();
  app.square(2, 1).click();
  assert.equal(app.square(0, 3).attributes['aria-label'].includes('legal capture destination'), true);
});
