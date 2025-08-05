const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Security Configuration
const PORT = process.env.PORT || 9494;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    [
        'http://localhost:9494',
        'http://127.0.0.1:9494',
        // Add your actual domains here for production
        // 'https://yourdomain.com'
    ];

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.socket.io; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "connect-src 'self' ws: wss:; " +
        "font-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';"
    );
    next();
});

// Rate Limiting
const connectionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per IP per window
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => NODE_ENV === 'development' && req.ip === '127.0.0.1'
});

app.use(connectionLimiter);

// Socket.IO with Security
const io = socketIo(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ["GET", "POST"],
        credentials: false
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Serve static files with restrictions
app.use(express.static(__dirname, {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d'
}));

// Serve the game at root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'slattery-shanghai.html'));
});

// Input Validation Functions
function validatePlayerName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length < 1 || name.length > 20) return false;
    // Allow letters, numbers, spaces, hyphens, underscores only
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) return false;
    return name.trim();
}

function validateGameCode(code) {
    if (!code) return ''; // Optional field
    if (typeof code !== 'string') return false;
    if (code.length > 10) return false; // Reasonable limit
    if (!/^[A-Z0-9]+$/.test(code)) return false;
    return code.trim().toUpperCase();
}

function sanitizeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[<>\"'&]/g, ''); // Remove potentially dangerous characters
}

function handleSecurityError(socket, error, userMessage = 'Invalid request') {
    console.error(`Security Error from ${socket.handshake.address}:`, error);
    socket.emit('error', { message: userMessage });
    // Consider disconnecting repeat offenders
}

// Connection tracking for rate limiting
const activeConnections = new Map();
const suspiciousIPs = new Set();

// Game state storage
const games = new Map();
const playerSockets = new Map();

// Round requirements for 7-round Slattery Shanghai
const ROUND_REQUIREMENTS = [
    { round: 1, melds: "2 Sets of 3", description: "Two sets of three cards each", sets: 2, runs: 0, minSetSize: 3, minRunSize: 0 },
    { round: 2, melds: "1 Set of 3 + 1 Run of 4", description: "One set of three and one run of four", sets: 1, runs: 1, minSetSize: 3, minRunSize: 4 },
    { round: 3, melds: "2 Runs of 4", description: "Two runs of four cards each", sets: 0, runs: 2, minSetSize: 0, minRunSize: 4 },
    { round: 4, melds: "3 Sets of 3", description: "Three sets of three cards each", sets: 3, runs: 0, minSetSize: 3, minRunSize: 0 },
    { round: 5, melds: "2 Sets of 3 + 1 Run of 4", description: "Two sets of three and one run of four", sets: 2, runs: 1, minSetSize: 3, minRunSize: 4 },
    { round: 6, melds: "1 Set of 3 + 2 Runs of 4", description: "One set of three and two runs of four", sets: 1, runs: 2, minSetSize: 3, minRunSize: 4 },
    { round: 7, melds: "3 Runs of 4", description: "Three runs of four cards each", sets: 0, runs: 3, minSetSize: 0, minRunSize: 4 }
];

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.value = this.getCardValue(rank);
        this.display = this.getDisplayString();
        this.color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
    }

    getCardValue(rank) {
        if (rank === 'A') return 1;
        if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
        return parseInt(rank);
    }

    getDisplayString() {
        const suitSymbols = {
            hearts: '♥',
            diamonds: '♦',
            clubs: '♣',
            spades: '♠'
        };
        return this.rank + suitSymbols[this.suit];
    }

    getScoreValue() {
        if (this.rank === 'A') return 20;
        if (this.rank === 'J' || this.rank === 'Q' || this.rank === 'K') return 10;
        return parseInt(this.rank);
    }
}

class Deck {
    constructor() {
        this.cards = [];
        this.initializeDeck();
        this.shuffle();
    }

    initializeDeck() {
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        
        // Use 2 decks for Shanghai
        for (let deckNum = 0; deckNum < 2; deckNum++) {
            for (let suit of suits) {
                for (let rank of ranks) {
                    this.cards.push(new Card(suit, rank));
                }
            }
        }
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal() {
        return this.cards.pop();
    }

    isEmpty() {
        return this.cards.length === 0;
    }
}

class Game {
    constructor(gameCode, hostName) {
        this.gameCode = gameCode;
        this.players = [];
        this.playerHands = new Map();
        this.playerMelds = new Map();
        this.playerBuys = new Map();
        this.playerScores = new Map();
        this.currentRound = 1;
        this.currentPlayerIndex = 0;
        this.deck = null;
        this.discardPile = [];
        this.gameStarted = false;
        this.hostName = hostName;
        this.turnState = {
            hasDrawn: false,
            canBuy: true
        };
    }

    addPlayer(playerName) {
        if (!this.players.includes(playerName)) {
            this.players.push(playerName);
            this.playerScores.set(playerName, Array(7).fill(0));
            return true;
        }
        return false;
    }

    removePlayer(playerName) {
        const index = this.players.indexOf(playerName);
        if (index > -1) {
            this.players.splice(index, 1);
            this.playerHands.delete(playerName);
            this.playerMelds.delete(playerName);
            this.playerBuys.delete(playerName);
            this.playerScores.delete(playerName);
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) return false;
        
        this.gameStarted = true;
        this.currentRound = 1;
        this.currentPlayerIndex = 0;
        
        console.log(`Game ${this.gameCode} starting with ${this.players.length} players`);
        
        this.dealRound();
        return true;
    }

    dealRound() {
        this.deck = new Deck();
        this.discardPile = [];
        
        // Reset player states for new round
        this.players.forEach(player => {
            this.playerHands.set(player, []);
            this.playerMelds.set(player, []);
            this.playerBuys.set(player, 3);
        });

        // Deal cards (10 + round number)
        const cardsPerPlayer = 10 + this.currentRound;
        
        for (let i = 0; i < cardsPerPlayer; i++) {
            this.players.forEach(player => {
                this.playerHands.get(player).push(this.deck.deal());
            });
        }

        // Start discard pile
        this.discardPile.push(this.deck.deal());
        
        // Rotate starting player each round
        this.currentPlayerIndex = (this.currentRound - 1) % this.players.length;
        
        // Reset turn state
        this.turnState = {
            hasDrawn: false,
            canBuy: true
        };
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.turnState = {
            hasDrawn: false,
            canBuy: true
        };
    }

    // Validate player action permissions
    validatePlayerAction(playerName, actionType) {
        if (actionType === 'turn' && this.getCurrentPlayer() !== playerName) {
            return { valid: false, error: 'Not your turn' };
        }
        if (actionType === 'buy' && this.getCurrentPlayer() === playerName) {
            return { valid: false, error: 'Cannot buy on your turn' };
        }
        return { valid: true };
    }

    drawCard(playerName) {
        const validation = this.validatePlayerAction(playerName, 'turn');
        if (!validation.valid) {
            return { success: false, message: validation.error };
        }

        if (this.turnState.hasDrawn) {
            return { success: false, message: "Already drawn this turn" };
        }

        if (this.deck.isEmpty()) {
            if (this.discardPile.length <= 1) {
                return { success: false, message: "No cards left to draw" };
            }
            const topCard = this.discardPile.pop();
            this.deck.cards = [...this.discardPile];
            this.deck.shuffle();
            this.discardPile = [topCard];
        }

        const card = this.deck.deal();
        this.playerHands.get(playerName).push(card);
        this.turnState.hasDrawn = true;
        
        return { success: true, card };
    }

    pickUpDiscard(playerName) {
        const validation = this.validatePlayerAction(playerName, 'turn');
        if (!validation.valid) {
            return { success: false, message: validation.error };
        }

        if (this.turnState.hasDrawn) {
            return { success: false, message: "Already drawn this turn" };
        }

        if (this.discardPile.length === 0) {
            return { success: false, message: "No card in discard pile" };
        }

        const card = this.discardPile.pop();
        this.playerHands.get(playerName).push(card);
        this.turnState.hasDrawn = true;
        
        return { success: true, card };
    }

    buyCard(playerName) {
        const validation = this.validatePlayerAction(playerName, 'buy');
        if (!validation.valid) {
            return { success: false, message: validation.error };
        }

        if (this.playerBuys.get(playerName) <= 0) {
            return { success: false, message: "No buys remaining" };
        }

        if (this.discardPile.length === 0) {
            return { success: false, message: "No card to buy" };
        }

        const discardCard = this.discardPile.pop();
        this.playerHands.get(playerName).push(discardCard);
        
        if (this.deck.isEmpty()) {
            if (this.discardPile.length > 0) {
                this.deck.cards = [...this.discardPile];
                this.deck.shuffle();
                this.discardPile = [];
            } else {
                return { success: false, message: "No cards left to deal" };
            }
        }
        
        const penaltyCard = this.deck.deal();
        this.playerHands.get(playerName).push(penaltyCard);
        this.playerBuys.set(playerName, this.playerBuys.get(playerName) - 1);
        
        return { success: true, discardCard, penaltyCard };
    }

    validatePlayerMeetsRoundRequirements(playerName) {
        const playerMelds = this.playerMelds.get(playerName) || [];
        const requirements = ROUND_REQUIREMENTS[this.currentRound - 1];
        
        let validSets = 0;
        let validRuns = 0;
        
        playerMelds.forEach(meld => {
            if (meld.type === 'set' && meld.cards.length >= requirements.minSetSize) {
                validSets++;
            } else if (meld.type === 'run' && meld.cards.length >= requirements.minRunSize) {
                validRuns++;
            }
        });
        
        const hasRequiredSets = validSets >= requirements.sets;
        const hasRequiredRuns = validRuns >= requirements.runs;
        const meetsRequirements = hasRequiredSets && hasRequiredRuns;
        
        return {
            meetsRequirements,
            hasRequiredSets,
            hasRequiredRuns,
            validSets,
            validRuns,
            requirements
        };
    }

    discardCard(playerName, cardIndex) {
        const validation = this.validatePlayerAction(playerName, 'turn');
        if (!validation.valid) {
            return { success: false, message: validation.error };
        }

        if (!this.turnState.hasDrawn) {
            return { success: false, message: "Must draw a card first" };
        }

        const hand = this.playerHands.get(playerName);
        if (cardIndex < 0 || cardIndex >= hand.length) {
            return { success: false, message: "Invalid card selection" };
        }

        const discardedCard = hand.splice(cardIndex, 1)[0];
        this.discardPile.push(discardedCard);

        if (hand.length === 0) {
            const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            
            if (!validation.meetsRequirements) {
                hand.push(discardedCard);
                this.discardPile.pop();
                
                let errorMessage = `Cannot go out! You need: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}. `;
                if (!validation.hasRequiredSets) {
                    errorMessage += `Missing ${validation.requirements.sets - validation.validSets} more sets. `;
                }
                if (!validation.hasRequiredRuns) {
                    errorMessage += `Missing ${validation.requirements.runs - validation.validRuns} more runs. `;
                }
                
                return { success: false, message: errorMessage };
            }
            
            const roundResult = this.endRound(playerName);
            return { success: true, card: discardedCard, roundEnded: true, roundResult };
        }

        this.nextTurn();
        return { success: true, card: discardedCard };
    }

    validateMeld(cards, meldType) {
        if (meldType === 'set' && cards.length < 3) {
            return false;
        }
        
        if (meldType === 'run' && cards.length < 4) {
            return false;
        }

        if (meldType === 'set') {
            const rank = cards[0].rank;
            return cards.every(card => card.rank === rank);
        } else if (meldType === 'run') {
            const suit = cards[0].suit;
            if (!cards.every(card => card.suit === suit)) {
                return false;
            }

            const sortedCards = cards.sort((a, b) => a.value - b.value);
            
            for (let i = 1; i < sortedCards.length; i++) {
                if (sortedCards[i].value !== sortedCards[i-1].value + 1) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    makeMeld(playerName, cardIndices, meldType) {
        const validation = this.validatePlayerAction(playerName, 'turn');
        if (!validation.valid) {
            return { success: false, message: validation.error };
        }

        const hand = this.playerHands.get(playerName);
        
        // Validate card indices
        if (!Array.isArray(cardIndices) || cardIndices.some(index => 
            !Number.isInteger(index) || index < 0 || index >= hand.length)) {
            return { success: false, message: "Invalid card selection" };
        }
        
        const cards = cardIndices.map(index => hand[index]);

        if (!this.validateMeld(cards, meldType)) {
            return { success: false, message: `Invalid ${meldType}` };
        }

        const sortedIndices = [...cardIndices].sort((a, b) => b - a);
        
        sortedIndices.forEach(index => {
            hand.splice(index, 1);
        });

        this.playerMelds.get(playerName).push({ type: meldType, cards });

        if (hand.length === 0) {
            const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            
            if (!validation.meetsRequirements) {
                return { 
                    success: false, 
                    message: `You've melded all cards but don't meet round requirements: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` 
                };
            }
            
            const roundResult = this.endRound(playerName);
            return { success: true, meld: { type: meldType, cards }, roundEnded: true, roundResult };
        }
        
        return { success: true, meld: { type: meldType, cards } };
    }

    endRound(winner) {
        this.players.forEach(player => {
            let roundScore = 0;
            const hand = this.playerHands.get(player);
            
            if (player !== winner) {
                roundScore = hand.reduce((sum, card) => sum + card.getScoreValue(), 0);
            }

            const scores = this.playerScores.get(player);
            scores[this.currentRound - 1] = roundScore;
        });

        if (this.currentRound >= 7) {
            const finalResults = this.endGame();
            return { gameEnded: true, finalResults };
        } else {
            this.currentRound++;
            this.dealRound();
            return { gameEnded: false, newRound: this.currentRound };
        }
    }

    endGame() {
        const finalScores = new Map();
        const playerStats = new Map();
        
        this.players.forEach(player => {
            const scores = this.playerScores.get(player);
            const total = scores.reduce((sum, score) => sum + score, 0);
            const roundsWon = scores.filter(score => score === 0).length;
            
            finalScores.set(player, total);
            playerStats.set(player, {
                total,
                roundsWon,
                scores: [...scores]
            });
        });
        
        const sortedPlayers = Array.from(finalScores.entries()).sort((a, b) => a[1] - b[1]);
        const winner = sortedPlayers[0][0];
        const winnerScore = sortedPlayers[0][1];
        
        return {
            winner,
            winnerScore,
            finalStandings: sortedPlayers,
            playerStats: Object.fromEntries(playerStats),
            gameComplete: true
        };
    }

    getGameState(playerName) {
        const allPlayerMelds = {};
        this.players.forEach(player => {
            allPlayerMelds[player] = this.playerMelds.get(player) || [];
        });

        return {
            gameCode: this.gameCode,
            players: this.players,
            currentPlayer: this.getCurrentPlayer(),
            currentRound: this.currentRound,
            roundRequirements: ROUND_REQUIREMENTS[this.currentRound - 1],
            hand: this.playerHands.get(playerName) || [],
            melds: this.playerMelds.get(playerName) || [],
            allPlayerMelds: allPlayerMelds,
            buysRemaining: this.playerBuys.get(playerName) || 0,
            discardTop: this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null,
            scores: Object.fromEntries(this.playerScores),
            turnState: this.turnState,
            gameStarted: this.gameStarted,
            handCounts: Object.fromEntries(
                this.players.map(player => [player, this.playerHands.get(player)?.length || 0])
            )
        };
    }
}

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;
    
    // Rate limit connections per IP
    const connections = activeConnections.get(clientIP) || 0;
    if (connections >= 5 && !ALLOWED_ORIGINS.includes('*')) {
        console.log(`Connection limit exceeded for IP: ${clientIP}`);
        socket.disconnect();
        return;
    }
    
    activeConnections.set(clientIP, connections + 1);
    console.log(`Player connected from ${clientIP} (${connections + 1} active)`);

    socket.on('joinGame', (data) => {
        try {
            if (!data || typeof data !== 'object') {
                handleSecurityError(socket, 'Invalid join data', 'Invalid request format');
                return;
            }

            const playerName = validatePlayerName(data.playerName);
            const gameCode = validateGameCode(data.gameCode);

            if (!playerName) {
                socket.emit('error', { message: 'Invalid player name. Use only letters, numbers, spaces, hyphens, and underscores (1-20 characters)' });
                return;
            }

            if (gameCode === false) {
                socket.emit('error', { message: 'Invalid game code format' });
                return;
            }

            let game;
            let finalGameCode = gameCode || generateGameCode();

            if (gameCode && games.has(gameCode)) {
                game = games.get(gameCode);
                if (game.gameStarted) {
                    socket.emit('error', { message: 'Game already started' });
                    return;
                }
            } else {
                game = new Game(finalGameCode, playerName);
                games.set(finalGameCode, game);
            }

            if (!game.addPlayer(playerName)) {
                socket.emit('error', { message: 'Player name already taken' });
                return;
            }

            playerSockets.set(playerName, socket.id);
            socket.playerName = playerName;
            socket.gameCode = finalGameCode;
            socket.join(finalGameCode);

            io.to(finalGameCode).emit('playerJoined', {
                players: game.players,
                gameCode: finalGameCode,
                isHost: playerName === game.hostName
            });

            console.log(`${playerName} joined game ${finalGameCode}`);
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to join game');
        }
    });

    socket.on('startGame', () => {
        try {
            const game = games.get(socket.gameCode);
            if (!game || socket.playerName !== game.hostName) {
                socket.emit('error', { message: 'Only host can start game' });
                return;
            }

            if (!game.startGame()) {
                socket.emit('error', { message: 'Need at least 2 players to start' });
                return;
            }

            game.players.forEach(playerName => {
                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                if (playerSocket) {
                    playerSocket.emit('gameStarted', game.getGameState(playerName));
                }
            });

            console.log(`Game ${socket.gameCode} started by ${socket.playerName}`);
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to start game');
        }
    });

    socket.on('drawCard', () => {
        try {
            const game = games.get(socket.gameCode);
            if (!game) return;

            const result = game.drawCard(socket.playerName);
            
            if (result.success) {
                game.players.forEach(playerName => {
                    const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                    if (playerSocket) {
                        playerSocket.emit('gameUpdate', game.getGameState(playerName));
                    }
                });

                io.to(socket.gameCode).emit('gameMessage', {
                    message: `${socket.playerName} drew a card`
                });
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to draw card');
        }
    });

    socket.on('pickUpDiscard', () => {
        try {
            const game = games.get(socket.gameCode);
            if (!game) return;

            const result = game.pickUpDiscard(socket.playerName);
            
            if (result.success) {
                game.players.forEach(playerName => {
                    const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                    if (playerSocket) {
                        playerSocket.emit('gameUpdate', game.getGameState(playerName));
                    }
                });

                io.to(socket.gameCode).emit('gameMessage', {
                    message: `${socket.playerName} picked up the ${result.card.display} from discard pile`
                });
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to pick up discard');
        }
    });

    socket.on('buyCard', () => {
        try {
            const game = games.get(socket.gameCode);
            if (!game) return;

            const result = game.buyCard(socket.playerName);
            
            if (result.success) {
                game.players.forEach(playerName => {
                    const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                    if (playerSocket) {
                        playerSocket.emit('gameUpdate', game.getGameState(playerName));
                    }
                });

                io.to(socket.gameCode).emit('gameMessage', {
                    message: `${socket.playerName} bought the ${result.discardCard.display} and drew a penalty card`
                });
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to buy card');
        }
    });

    socket.on('discardCard', (data) => {
        try {
            if (!data || typeof data !== 'object' || !Number.isInteger(data.cardIndex)) {
                handleSecurityError(socket, 'Invalid discard data', 'Invalid card selection');
                return;
            }

            const game = games.get(socket.gameCode);
            if (!game) return;

            const result = game.discardCard(socket.playerName, data.cardIndex);
            
            if (result.success) {
                game.players.forEach(playerName => {
                    const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                    if (playerSocket) {
                        playerSocket.emit('gameUpdate', game.getGameState(playerName));
                    }
                });

                io.to(socket.gameCode).emit('gameMessage', {
                    message: `${socket.playerName} discarded ${result.card.display}`
                });

                if (result.roundEnded) {
                    io.to(socket.gameCode).emit('gameMessage', {
                        message: `🎉 ${socket.playerName} went out! Round ${game.currentRound - 1} ended.`
                    });

                    if (result.roundResult.gameEnded && result.roundResult.finalResults && result.roundResult.finalResults.gameComplete) {
                        setTimeout(() => {
                            io.to(socket.gameCode).emit('gameComplete', result.roundResult.finalResults);
                            
                            io.to(socket.gameCode).emit('gameMessage', {
                                message: `🏆 GAME COMPLETE! Winner: ${result.roundResult.finalResults.winner} with ${result.roundResult.finalResults.winnerScore} points! 🏆`
                            });
                        }, 1500);
                    } else {
                        setTimeout(() => {
                            game.players.forEach(playerName => {
                                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                                if (playerSocket) {
                                    playerSocket.emit('gameUpdate', game.getGameState(playerName));
                                }
                            });
                            
                            io.to(socket.gameCode).emit('gameMessage', {
                                message: `Starting Round ${game.currentRound}!`
                            });
                        }, 1000);
                    }
                }
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to discard card');
        }
    });

    socket.on('makeMeld', (data) => {
        try {
            if (!data || typeof data !== 'object' || 
                !Array.isArray(data.cardIndices) || 
                !['set', 'run'].includes(data.meldType)) {
                handleSecurityError(socket, 'Invalid meld data', 'Invalid meld request');
                return;
            }

            // Validate card indices array
            if (data.cardIndices.length < 3 || data.cardIndices.length > 13 ||
                data.cardIndices.some(index => !Number.isInteger(index) || index < 0)) {
                socket.emit('error', { message: 'Invalid card selection' });
                return;
            }

            const game = games.get(socket.gameCode);
            if (!game) return;

            const result = game.makeMeld(socket.playerName, data.cardIndices, data.meldType);
            
            if (result.success) {
                if (result.roundEnded) {
                    io.to(socket.gameCode).emit('gameMessage', {
                        message: `${socket.playerName} made a ${data.meldType} with ${result.meld.cards.length} cards`
                    });
                    
                    io.to(socket.gameCode).emit('gameMessage', {
                        message: `🎉 ${socket.playerName} went out! Round ${game.currentRound - 1} ended.`
                    });
                    
                    if (result.roundResult.gameEnded && result.roundResult.finalResults && result.roundResult.finalResults.gameComplete) {
                        setTimeout(() => {
                            io.to(socket.gameCode).emit('gameComplete', result.roundResult.finalResults);
                            
                            io.to(socket.gameCode).emit('gameMessage', {
                                message: `🏆 GAME COMPLETE! Winner: ${result.roundResult.finalResults.winner} with ${result.roundResult.finalResults.winnerScore} points! 🏆`
                            });
                        }, 1500);
                    } else {
                        setTimeout(() => {
                            game.players.forEach(playerName => {
                                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                                if (playerSocket) {
                                    playerSocket.emit('gameUpdate', game.getGameState(playerName));
                                }
                            });
                            
                            io.to(socket.gameCode).emit('gameMessage', {
                                message: `Starting Round ${game.currentRound}!`
                            });
                        }, 1000);
                    }
                } else {
                    game.players.forEach(playerName => {
                        const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                        if (playerSocket) {
                            playerSocket.emit('gameUpdate', game.getGameState(playerName));
                        }
                    });
                    
                    io.to(socket.gameCode).emit('gameMessage', {
                        message: `${socket.playerName} made a ${data.meldType} with ${result.meld.cards.length} cards`
                    });
                }
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to make meld');
        }
    });

    // Card reordering event handler with validation
    socket.on('reorderCards', (data) => {
        try {
            if (!data || typeof data !== 'object' || !Array.isArray(data.cardOrder)) {
                handleSecurityError(socket, 'Invalid reorder data', 'Invalid card order');
                return;
            }

            const game = games.get(socket.gameCode);
            if (!game || !socket.playerName) return;

            const hand = game.playerHands.get(socket.playerName);
            if (!hand || data.cardOrder.length !== hand.length) {
                socket.emit('error', { message: 'Invalid card order' });
                return;
            }

            // Validate that all indices are valid and unique
            const validOrder = data.cardOrder.every((index, pos) => 
                Number.isInteger(index) && index >= 0 && index < hand.length
            );
            
            const uniqueIndices = new Set(data.cardOrder);
            if (validOrder && uniqueIndices.size === hand.length) {
                const reorderedHand = data.cardOrder.map(index => hand[index]);
                game.playerHands.set(socket.playerName, reorderedHand);
                
                const gameState = game.getGameState(socket.playerName);
                socket.emit('gameUpdate', gameState);
            } else {
                socket.emit('error', { message: 'Invalid card order' });
            }
        } catch (error) {
            handleSecurityError(socket, error, 'Failed to reorder cards');
        }
    });

    socket.on('disconnect', () => {
        const clientIP = socket.handshake.address;
        const current = activeConnections.get(clientIP) || 1;
        activeConnections.set(clientIP, Math.max(0, current - 1));
        
        console.log(`Player disconnected from ${clientIP}`);
        
        if (socket.playerName && socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game) {
                game.removePlayer(socket.playerName);
                playerSockets.delete(socket.playerName);
                
                io.to(socket.gameCode).emit('playerLeft', {
                    players: game.players,
                    playerName: socket.playerName
                });

                if (game.players.length === 0) {
                    games.delete(socket.gameCode);
                    console.log(`Game ${socket.gameCode} deleted - no players remaining`);
                }
            }
        }
    });

    // Handle any other unexpected events
    socket.onAny((eventName, ...args) => {
        const allowedEvents = [
            'joinGame', 'startGame', 'drawCard', 'pickUpDiscard', 
            'buyCard', 'discardCard', 'makeMeld', 'reorderCards', 'disconnect'
        ];
        
        if (!allowedEvents.includes(eventName)) {
            console.log(`Suspicious event from ${socket.handshake.address}: ${eventName}`);
            suspiciousIPs.add(socket.handshake.address);
        }
    });
});

// Cleanup suspicious IPs periodically
setInterval(() => {
    suspiciousIPs.clear();
    // Clean up old connection counts
    for (const [ip, count] of activeConnections.entries()) {
        if (count <= 0) {
            activeConnections.delete(ip);
        }
    }
}, 60000); // Every minute

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Slattery Shanghai server...');
    io.emit('serverShutdown', { message: 'Server is shutting down' });
    
    setTimeout(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    }, 1000);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

server.listen(PORT, () => {
    console.log(`🛡️ Secure Slattery Shanghai server running on port ${PORT}`);
    console.log(`🔒 Security features enabled:`);
    console.log(`   - Input validation and sanitization`);
    console.log(`   - CORS restrictions: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`   - Rate limiting and connection tracking`);
    console.log(`   - Security headers and CSP`);
    console.log(`   - Error handling and logging`);
    console.log(`🎮 Game available at: http://localhost:${PORT}`);
    console.log(`📋 Environment: ${NODE_ENV}`);
    
    if (NODE_ENV === 'production') {
        console.log(`⚠️  Production mode - ensure HTTPS is configured at reverse proxy level`);
    }
});
