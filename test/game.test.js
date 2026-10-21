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
    children: [], dataset: {}, attributes: {}, textContent: '', innerHTML: '', value: '',
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
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) {
      this.children = children.flatMap(child => child.fragment ? child.children : [child]);
    },
    focus() { this.focused = true; }
  };
}
// Starts fresh copy of game for each of the tests. 
// InitialBoard can be replaced with the short controlled board
function setup(initialBoard = rules.initialBoard) {
// Page elements accessed by game.js.
  const ids = [
    'board', 'status', 'turnIndicator', 'log', 'resultOverlay', 'resultTitle',
    'resultReason', 'resultToken', 'resultRematchBtn', 'resultHomeBtn',
    'gameScreen', 'menuScreen', 'artBoard', 'opponent', 'difficulty',
    'historyPanel', 'historyButton', 'historyRecord', 'historyOutcome',
    'historyPercentage', 'startBtn', 'newGameBtn', 'rematchBtn', 'menuBtn'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  // Match hidden state of these on real page.
  for (const id of ['gameScreen', 'resultOverlay', 'historyPanel']) elements[id].classList.add('hidden');
  // Simulates the Friend and Bot buttons. 
  const modes = ['friend', 'bot'].map(mode => Object.assign(element(), { dataset: { mode } }));
  const soundToggle = element();
  // Record 
  const scheduled = [];
  const results = [];
  const botCalls = [];
  const document = {
    getElementById(id) { return elements[id]; },
    querySelectorAll(selector) {
      if (selector === '[data-mode]') return modes;
      if (selector === '[data-sound-toggle]') return [soundToggle];
      throw new Error(`Unexpected selector: ${selector}`);
    },
    createElement: element,
    createDocumentFragment() { return Object.assign(element(), { fragment: true }); }
  };
  const location = { href: 'http://localhost/', hash: '' };
  const window = {
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
    localStorage: { getItem() { return 'off'; } },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    console
  };
  vm.runInNewContext(gameSource, context, { filename: 'game.js' });
  return { elements, modes, scheduled, results, botCalls,
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
  assert.deepEqual(app.results, [true]);
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
  assert.equal(app.scheduled.length, 0);
  assert.equal(app.botCalls.length, 0);
});
