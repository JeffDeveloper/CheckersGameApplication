/* 
Entity      | Primary Key| Attributes
GameSession | gameId     | boardState, currentTurn, opponentMode, gameStatus, aiDifficulty
MoveHistory | modeId     | gameId, moveNumber, player, startPosition, endPosition, isCapture, isPromotion
UserStates  | username   | totalWins, totalLosses, totalGames, winPercentage
*/

(function (root) {
    'use strict';

    const DB_NAME = 'CheckersDatabase';
    const DB_VERSION = 1;

    const STORES = {
        SESSIONS: 'GameSession',
        MOVES: 'MoveHistory',
        USERS: 'UserStates',
    };

    const DEFAULT_USERNAME = 'Player';

    let dbPromise = null;

    // General IndexedDB helpers
    // requestResult takes an IndexedDB request and returns a Promise
    // that resolves with the request result or rejects if the request fails.
    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(
                request.error || new Error('IndexedDB request failed.')
            );
        });
    }
    // transactionDone returns a Promise that resolves when a database transaction
    // completes or rejects if the transaction fails or is aborted.
    function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(
                transaction.error || new Error('IndexedDB transaction aborted')
            );
            transaction.onerror = () => reject(
                transaction.error || new Error('IndexedDB transaction failed')
            );
        });
    }

    // Generates a random unique UUID
    function makeID(prefix) {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') {
            return `${prefix}-${root.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
    // Creates a copy of the board, including each piece's color and king status
    function cloneBoard(board) {
        if (!Array.isArray(board) || board.length !== 8) {
            throw new TypeError('Expected an 8x8 checkers board.');
        }
        return board.map(row => {
            if (!Array.isArray(row) || row.length !== 8) {
                throw new TypeError('Expected an 8x8 checkers board.');
            }

            return row.map(piece => {
                if (piece == null) return null;
                if ((piece.player !== 'white' && piece.player !== 'black') || typeof piece.king !== 'boolean') {
                    throw new TypeError('Invalid checker piece.');
                }
                return {
                    player: piece.player,
                    king: piece.king
                };
            });
        });
    }
    // Creates a copy of a board position represented by a [row, column] array, after validating its coordinates.
    function clonePosition(position) {
        if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isInteger) || position.some(n => n < 0 || n > 7)) {
            throw new TypeError('Expected a board position [row, column].');
        }
        return [...position];
    }
    // Opens the CheckersDatabase database and creates the required object stores and indexes if they do not exist.
    function openDatabase() {
        if (dbPromise) return dbPromise;
        if (!root.indexedDB) {
            return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
        }
        dbPromise = new Promise((resolve, reject) => {
            const request = root.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = event => {
                const database = request.result;

                let sessions;
                if (!database.objectStoreNames.contains(STORES.SESSIONS)) {
                    sessions = database.createObjectStore(STORES.SESSIONS, { keyPath: 'gameId' });
                } else {
                    sessions = request.transaction.objectStore(STORES.SESSIONS);
                }
                if (!sessions.indexNames.contains('updatedAt')) {
                    sessions.createIndex('updatedAt', 'updatedAt');
                }
                let moves;
                if (!database.objectStoreNames.contains(STORES.MOVES)) {
                    moves = database.createObjectStore(STORES.MOVES, { keyPath: 'modeId' });
                } else {
                    moves = request.transaction.objectStore(STORES.MOVES);
                }
                if (!moves.indexNames.contains('gameId')) {
                    moves.createIndex('gameId', 'gameId', { unique: false });
                }
                if (!moves.indexNames.contains('gameId_moveNumber')) {
                    moves.createIndex('gameId_moveNumber', ['gameId', 'moveNumber'], { unique: false });
                }
                if (!database.objectStoreNames.contains(STORES.USERS)) {
                    database.createObjectStore(STORES.USERS, { keyPath: 'username' });
                }
            };
            request.onsuccess = () => {
                const database = request.result;

                database.onversionchange = () => {
                    database.close();
                    dbPromise = null;
                };
                resolve(database);
            };
            request.onerror = () => {
                dbPromise = null;
                reject(request.error || new Error('Could not open the database.'));
            };
            request.onblocked = () => {
                console.warn('Database upgrade blocked. Close other tabs using this application.');
            };
        });
        return dbPromise;
    }

    async function runTransaction(storeNames, mode, action) {
        const database = await openDatabase();
        const transaction = database.transaction(storeNames, mode);
        const done = transactionDone(transaction);

        try {
            const result = await action(transaction);
            await done;
            return result;
        } catch (error) {
            try {
                transaction.abort();
            } catch (_) {
                // The transaction may already have completed or aborted.
            }
            await done.catch(() => { });
            throw error;
        }
    }

    // Game sessions
    // Creates a new game session with the provided options and default values.
    function createGameSession(options = {}) {
        const now = new Date().toISOString();

        return {
            gameId: options.gameId || makeID('game'),
            boardState: cloneBoard(options.boardState),
            currentTurn: options.currentTurn || 'white',
            opponentMode: options.opponentMode || 'friend',
            gameStatus: options.gameStatus || 'inProgress',
            winner: options.winner || null,
            createdAt: options.createdAt || now,
            updatedAt: now,
            aiDifficulty: options.aiDifficulty || 'easy'
        };
    }
    // Saves a game session to the database, updating its last-modified timestamp.
    async function saveGameSession(session) {
        if (!session || !session.gameId) {
            throw new TypeError('A game ession must have a gameId.');
        }
        if (!['white', 'black'].includes(session.currentTurn)) {
            throw new TypeError('currentTurn must be white or black.');
        }
        if (!['friend', 'bot'].includes(session.opponentMode)) {
            throw new TypeError('opponentMode must be friend or bot.');
        }
        if (!['inProgress', 'completed', 'abandoned'].includes(session.gameStatus)) {
            throw new TypeError('Invalid gameStatus');
        }
        if (!['easy', 'medium', 'hard'].includes(session.aiDifficulty)) {
            throw new TypeError('Difficulty must be easy, medium, or hard.');
        }
        const record = {
            ...session,
            boardState: cloneBoard(session.boardState),
            updatedAt: new Date().toISOString()
        };
        await runTransaction(STORES.SESSIONS, 'readwrite', tx =>
            requestResult(tx.objectStore(STORES.SESSIONS).put(record))
        );
        return record;
    }
    // Retrieves a specific game session using its game ID.
    async function getGameSession(gameId) {
        return runTransaction(STORES.SESSIONS, 'readonly', tx =>
            requestResult(tx.objectStore(STORES.SESSIONS).get(gameId))
        );
    }
    // Retrieves all saved game sessions, sorted by most recently updated.
    async function listGameSessions() {
        const sessions = await runTransaction(STORES.SESSIONS, 'readonly', tx => requestResult(tx.objectStore(STORES.SESSIONS).getAll()));
        return sessions.sort((a, b) =>
            String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
    // Deletes a game session and all move history associated with it.
    async function deleteGameSession(gameId) {
        return runTransaction(
            [STORES.SESSIONS, STORES.MOVES],
            'readwrite',
            tx => new Promise((resolve, reject) => {
                const sessions = tx.objectStore(STORES.SESSIONS);
                const moves = tx.objectStore(STORES.MOVES);
                const request = moves.index('gameId').openKeyCursor(IDBKeyRange.only(gameId));
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (cursor) {
                        moves.delete(cursor.primaryKey);
                        cursor.continue();
                    } else {
                        sessions.delete(gameId);
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            })
        );
    }

    // Move History
    // Records a player's move, including its positions, captures, and promotions.
    async function recordMove(move) {
        if (!move || !move.gameId) {
            throw new TypeError('A move record must include gameId.');
        }
        if (!Number.isInteger(move.moveNumber) || move.moveNumber < 1) {
            throw new TypeError('moveNumber must be a positive integer.');
        }
        if (!['white', 'black'].includes(move.player)) {
            throw new TypeError('Move player must be white or black.');
        }
        const record = {
            modeId: move.modeId || makeID('move'),
            gameId: move.gameId,
            moveNumber: move.moveNumber,
            player: move.player,
            startPosition: clonePosition(move.startPosition),
            endPosition: clonePosition(move.endPosition),
            isCapture: Boolean(move.isCapture),
            isPromotion: Boolean(move.isPromotion),
            createdAt: new Date().toISOString()
        };
        await runTransaction(STORES.MOVES, 'readwrite', tx => requestResult(tx.objectStore(STORES.MOVES).add(record)));
        return record;
    }
    // Retrieves all recorded moves for a game, sorted by move number.
    async function getMovesForGame(gameId) {
        const moves = await runTransaction(STORES.MOVES, 'readonly', tx => requestResult(tx.objectStore(STORES.MOVES).index('gameId').getAll(IDBKeyRange.only(gameId))));
        return moves.sort((a, b) => a.moveNumber - b.moveNumber);
    }

    // One local player profile
    // Validates a username and removes any leading or trailing whitespace.
    function normalizeUsername(username) {
        if (typeof username !== 'string' || !username.trim()) {
            throw new TypeError('Username cannot be empty.');
        }
        return username.trim();
    }
    // Retrieves a player's statistics using their username.
    async function getUserState(username = DEFAULT_USERNAME) {
        username = normalizeUsername(username);
        return runTransaction(STORES.USERS, 'readonly', tx => requestResult(tx.objectStore(STORES.USERS).get(username)));
    }
    // Saves a player's statistics and calculates their win percentage.
    async function saveUserState(state) {
        if (!state) throw new TypeError('A user state is required.');

        const username = normalizeUsername(state.username);
        const totalWins = Number(state.totalWins);
        const totalLosses = Number(state.totalLosses);
        const totalGames = Number(state.totalGames);

        if (![totalWins, totalLosses, totalGames].every(Number.isInteger) || totalWins < 0 || totalLosses < 0 || totalGames < 0 || totalWins + totalLosses > totalGames) {
            throw new TypeError('Invalid user statistics');
        }

        const record = {
            username,
            totalWins,
            totalLosses,
            totalGames,
            winPercentage: totalGames ? Number(((totalWins / totalGames) * 100).toFixed(2)) : 0
        };
        await runTransaction(STORES.USERS, 'readwrite', tx => requestResult(tx.objectStore(STORES.USERS).put(record)));
        return record;
    }
    // Retrieves an existing player profile or creates one with default statistics.
    async function getOrCreateUserState(username = DEFAULT_USERNAME) {
        username = normalizeUsername(username);
        const existing = await getUserState(username);
        if (existing) return existing;

        const initial = {
            username,
            totalWins: 0,
            totalLosses: 0,
            totalGames: 0,
            winPercentage: 0
        };

        await runTransaction(STORES.USERS, 'readwrite', tx => requestResult(tx.objectStore(STORES.USERS).add(initial)));
        return initial;
    }
    // Updates a player's win/loss record and recalculates their statistics after a completed game
    async function recordGameResult(username, won) {
        username = normalizeUsername(username);

        if (typeof won !== 'boolean') {
            throw new TypeError('won must be true or false.');
        }
        return runTransaction(STORES.USERS, 'readwrite', tx => {
            const store = tx.objectStore(STORES.USERS);
            return new Promise((resolve, reject) => {
                const request = store.get(username);
                request.onsuccess = () => {
                    const previous = request.result || {
                        username,
                        totalWins: 0,
                        totalLosses: 0,
                        totalGames: 0,
                        winPercentage: 0
                    };
                    const totalWins = previous.totalWins + (won ? 1 : 0);
                    const totalLosses = previous.totalLosses + (won ? 0 : 1);
                    const totalGames = previous.totalGames + 1;
                    const updated = {
                        username,
                        totalWins,
                        totalLosses,
                        totalGames,
                        winPercentage: Number(((totalWins / totalGames) * 100).toFixed(2)),
                        lastOutcome: won ? 'win' : 'loss'
                    };
                    const putRequest = store.put(updated);
                    putRequest.onsuccess = () => resolve(updated);
                    putRequest.onerror = () => reject(putRequest.error);
                };
                request.onerror = () => reject(request.error);
            });
        });
    }

    // Public API
    root.CheckersDB = Object.freeze({
        initialize: openDatabase,
        createGameSession,
        saveGameSession,
        getGameSession,
        listGameSessions,
        deleteGameSession,
        recordMove,
        getMovesForGame,
        getUserState,
        saveUserState,
        getOrCreateUserState,
        recordGameResult
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/*
add a way to list and load previous game sessions
*/