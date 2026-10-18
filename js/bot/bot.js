/**
 * ComputerOpponent module integrating with CheckersRules and AppSettings.
 * Matches Report #2 class diagram specifications for ComputerOpponent.
 */
(function (root) {
    'use strict';

    class ComputerOpponent {
        constructor(playerName = 'Computer', playerColor = 'black', difficultyLevel = 'easy') {
            this.playerName = playerName;
            this.playerColor = playerColor; // 'black' (bot is typically black)
            this.playerType = true;
            this.difficultyLevel = this.parseDifficulty(difficultyLevel);
        }

        parseDifficulty(level) {
            if (typeof level === 'string') {
                switch (level.toLowerCase()) {
                    case 'medium': return 2;
                    case 'hard': return 3;
                    case 'easy':
                    default: return 1;
                }
            }
            return level;
        }

        /**
         * Uses CheckersRules to generate legal moves for the bot.
         */
        generateMoves(board) {
            const rules = root.CheckersRules;
            if (!rules) return [];
            return rules.legalMoves(board, this.playerColor);
        }

        /**
         * Evaluates the board state numerically.
         */
        evaluateBoard(board) {
            let score = 0;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const piece = board[r][c];
                    if (piece) {
                        let value = piece.king ? 2.0 : 1.0;
                        if (piece.player === this.playerColor) {
                            score += value;
                        } else {
                            score -= value;
                        }
                    }
                }
            }
            return score;
        }

        /**
         * Chooses a move based on difficulty level (1: Easy, 2: Medium, 3: Hard).
         */
        chooseMove(board, legalMoves) {
            if (!legalMoves || legalMoves.length === 0) return null;

            if (this.difficultyLevel === 1) {
                // Easy: Random move
                const index = Math.floor(Math.random() * legalMoves.length);
                return legalMoves[index];
            } else if (this.difficultyLevel === 2) {
                // Medium: Prioritize captures if available
                const captures = legalMoves.filter(m => m.capture);
                if (captures.length > 0) {
                    return captures[Math.floor(Math.random() * captures.length)];
                }
                return legalMoves[Math.floor(Math.random() * legalMoves.length)];
            } else {
                // Hard: Evaluate best score option
                let bestMove = legalMoves[0];
                let maxScore = -Infinity;
                for (let move of legalMoves) {
                    // Quick heuristic evaluation
                    const score = move.capture ? 2 : 1;
                    if (score > maxScore) {
                        maxScore = score;
                        bestMove = move;
                    }
                }
                return bestMove;
            }
        }
    }

    // Expose globally to match game.js expectations (`window.CheckersBot`)
    root.CheckersBot = {
        ComputerOpponent,
        chooseMove: (board, legalMoves, difficulty = 'easy') => {
            const botInstance = new ComputerOpponent('AI', 'black', difficulty);
            return botInstance.chooseMove(board, legalMoves);
        }
    };

})(typeof globalThis !== 'undefined' ? globalThis : window);