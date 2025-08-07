const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { 
        origin: process.env.NODE_ENV === 'production' ? false : "*", 
        methods: ["GET", "POST"] 
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 9494;

// Performance optimizations
app.set('trust proxy', 1);
app.use(express.static(__dirname, { 
    maxAge: '1d',
    etag: false 
}));

// Performance optimizations
app.set('trust proxy', 1);
app.use(express.static(__dirname, { 
    maxAge: '1d',
    etag: false 
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'slattery-shanghai.html'));
});

// Optimized game storage with cleanup
const games = new Map();
const playerSockets = new Map();

// Auto-cleanup inactive games every 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, game] of games.entries()) {
        if (now - game.lastActivity > 30 * 60 * 1000) { // 30 minutes
            games.delete(code);
            console.log(`Cleaned up inactive game: ${code}`);
        }
    }
}, 30 * 60 * 1000);

// Optimized constants with frozen objects for immutability
const SUITS = Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const SUIT_SYMBOLS = Object.freeze({ hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' });
const AI_NAMES = Object.freeze(['Hiro', 'Honey Lemon', 'Rosie', 'Oreo']);

// Pre-computed value mappings for performance
const RANK_VALUES = Object.freeze({
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, 
    '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
});

const RANK_SCORES = Object.freeze({
    'A': 20, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, 
    '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
});

const ROUND_REQUIREMENTS = Object.freeze([
    Object.freeze({ round: 1, melds: "2 Sets of 3", sets: 2, runs: 0, minSetSize: 3, minRunSize: 0 }),
    Object.freeze({ round: 2, melds: "1 Set of 3 + 1 Run of 4", sets: 1, runs: 1, minSetSize: 3, minRunSize: 4 }),
    Object.freeze({ round: 3, melds: "2 Runs of 4", sets: 0, runs: 2, minSetSize: 0, minRunSize: 4 }),
    Object.freeze({ round: 4, melds: "3 Sets of 3", sets: 3, runs: 0, minSetSize: 3, minRunSize: 0 }),
    Object.freeze({ round: 5, melds: "2 Sets of 3 + 1 Run of 4", sets: 2, runs: 1, minSetSize: 3, minRunSize: 4 }),
    Object.freeze({ round: 6, melds: "1 Set of 3 + 2 Runs of 4", sets: 1, runs: 2, minSetSize: 3, minRunSize: 4 }),
    Object.freeze({ round: 7, melds: "3 Runs of 4", sets: 0, runs: 3, minSetSize: 0, minRunSize: 4 })
]);

// Optimized Card class with pre-computed values
class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.value = RANK_VALUES[rank];
        this.scoreValue = RANK_SCORES[rank];
        this.display = rank + SUIT_SYMBOLS[suit];
        this.color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
        this.id = `${suit}_${rank}`; // Unique identifier for faster comparisons
        Object.freeze(this); // Prevent mutations
    }

    // Removed redundant methods since values are pre-computed
}

// Optimized Deck class with Fisher-Yates shuffle
class Deck {
    constructor() {
        this.cards = [];
        this.initialize();
        this.shuffle();
    }

    initialize() {
        // Pre-allocate array for better performance
        this.cards = new Array(104); // 2 decks * 52 cards
        let index = 0;
        
        // Create 2 decks for Shanghai
        for (let deck = 0; deck < 2; deck++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    this.cards[index++] = new Card(suit, rank);
                }
            }
        }
    }

    shuffle() {
        // Optimized Fisher-Yates shuffle
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

    reset(discardPile) {
        if (discardPile.length > 0) {
            // Reuse existing array instead of creating new one
            this.cards.length = 0;
            this.cards.push(...discardPile);
            this.shuffle();
            return true;
        }
        return false;
    }
}

// Simplified AI Player
class AIPlayer {
    constructor(name, difficulty = 'medium') {
        this.name = name;
        this.difficulty = difficulty;
        this.isAI = true;
    }

    getDelay() {
        const delays = { easy: 3000, medium: 2000, hard: 1000 };
        return delays[this.difficulty] + Math.random() * 1000;
    }

    evaluateCard(card, hand) {
        let value = 0;
        
        // Check for set potential
        const sameRank = hand.filter(c => c.rank === card.rank).length;
        value += sameRank * 3;
        
        // Check for run potential
        const sameSuit = hand.filter(c => c.suit === card.suit);
        sameSuit.forEach(c => {
            const diff = Math.abs(c.value - card.value);
            if (diff === 1) value += 4;
            if (diff === 2) value += 2;
        });
        
        return value;
    }

    shouldBuy(card, hand, buys) {
        if (buys <= 0) return false;
        const value = this.evaluateCard(card, hand);
        const thresholds = { easy: 7, medium: 5, hard: 4 };
        return value > thresholds[this.difficulty];
    }

    findBestMeld(hand, requirements) {
        const melds = [];
        
        // Find sets
        const rankGroups = {};
        hand.forEach((card, idx) => {
            if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
            rankGroups[card.rank].push(idx);
        });
        
        Object.values(rankGroups).forEach(group => {
            if (group.length >= 3) {
                melds.push({ type: 'set', indices: group.slice(0, 3) });
            }
        });
        
        // Find runs
        const suitGroups = {};
        hand.forEach((card, idx) => {
            if (!suitGroups[card.suit]) suitGroups[card.suit] = [];
            suitGroups[card.suit].push({ card, idx });
        });
        
        Object.values(suitGroups).forEach(group => {
            if (group.length >= 4) {
                group.sort((a, b) => a.card.value - b.card.value);
                
                for (let i = 0; i <= group.length - 4; i++) {
                    const run = [];
                    let lastValue = group[i].card.value - 1;
                    
                    for (let j = i; j < group.length && run.length < 4; j++) {
                        if (group[j].card.value === lastValue + 1) {
                            run.push(group[j].idx);
                            lastValue = group[j].card.value;
                        }
                    }
                    
                    if (run.length >= 4) {
                        melds.push({ type: 'run', indices: run });
                    }
                }
            }
        });
        
        // Return best meld based on requirements
        if (requirements.sets > 0 && melds.find(m => m.type === 'set')) {
            return melds.find(m => m.type === 'set');
        }
        if (requirements.runs > 0 && melds.find(m => m.type === 'run')) {
            return melds.find(m => m.type === 'run');
        }
        
        return melds[0];
    }

    chooseDiscard(hand) {
        let worstIdx = 0;
        let worstValue = Infinity;
        
        hand.forEach((card, idx) => {
            const value = this.evaluateCard(card, hand.filter((_, i) => i !== idx));
            if (value < worstValue) {
                worstValue = value;
                worstIdx = idx;
            }
        });
        
        return worstIdx;
    }
}

// Optimized Game class with better performance and memory management
class Game {
    constructor(gameCode, hostName, aiCount = 0) {
        this.gameCode = gameCode;
        this.hostName = hostName;
        this.players = [];
        this.aiPlayers = new Map();
        this.playerData = new Map(); // Consolidated player data
        this.currentRound = 1;
        this.currentPlayerIndex = 0;
        this.deck = null;
        this.discardPile = [];
        this.gameStarted = false;
        this.lastActivity = Date.now(); // For cleanup tracking
        this.turnState = { hasDrawn: false };
        this.buyPhase = { active: false, card: null, requests: new Map() };
        
        // Initialize AI players with better distribution
        const difficulties = ['easy', 'medium', 'hard'];
        for (let i = 0; i < aiCount; i++) {
            const name = `${AI_NAMES[i % AI_NAMES.length]}${i >= AI_NAMES.length ? i + 1 : ''}`;
            const difficulty = difficulties[i % difficulties.length];
            const ai = new AIPlayer(name, difficulty);
            this.aiPlayers.set(name, ai);
        }
    }

    // Track activity for cleanup
    updateActivity() {
        this.lastActivity = Date.now();
    }

    // Initialize player data with frozen objects where appropriate
    initPlayerData(name) {
        this.playerData.set(name, {
            hand: [],
            melds: [],
            buys: 3,
            scores: new Array(7).fill(0),
            goneDown: false,
            wantList: { ranks: new Set(), suits: new Set(), specific: new Set() }
        });
    }

    // Add player
    addPlayer(name) {
        if (this.players.includes(name)) return false;
        
        this.players.push(name);
        this.initPlayerData(name);
        
        // Add AI players if host
        if (name === this.hostName) {
            this.aiPlayers.forEach((ai, aiName) => {
                this.players.push(aiName);
                this.initPlayerData(aiName);
            });
        }
        
        return true;
    }

    // Start game
    startGame() {
        if (this.players.length < 2) return false;
        
        this.gameStarted = true;
        this.dealRound();
        
        // Schedule AI turn if needed
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
        
        return true;
    }

    // Deal cards for round
    dealRound() {
        this.deck = new Deck();
        this.discardPile = [this.deck.deal()];
        
        const cardsPerPlayer = 10 + this.currentRound;
        
        // Reset player data for round
        this.players.forEach(player => {
            const data = this.playerData.get(player);
            data.hand = [];
            data.melds = [];
            data.buys = 3;
            data.goneDown = false;
            
            // Deal cards
            for (let i = 0; i < cardsPerPlayer; i++) {
                data.hand.push(this.deck.deal());
            }
        });
        
        // Set starting player
        this.currentPlayerIndex = this.currentRound === 1 ? 0 : (this.currentRound - 1) % this.players.length;
        this.turnState = { hasDrawn: false };
    }

    // Get current player
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    // Next turn
    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.turnState = { hasDrawn: false };
        
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
    }

    // Schedule AI turn
    scheduleAITurn() {
        const player = this.getCurrentPlayer();
        const ai = this.aiPlayers.get(player);
        if (!ai) return;
        
        setTimeout(() => {
            if (this.getCurrentPlayer() === player && this.gameStarted) {
                this.executeAITurn(player);
            }
        }, ai.getDelay());
    }

    // Execute AI turn
    executeAITurn(player) {
        const ai = this.aiPlayers.get(player);
        const data = this.playerData.get(player);
        if (!ai || !data) return;
        
        // Draw phase
        if (Math.random() < 0.3 && this.discardPile.length > 0) {
            this.pickUpDiscard(player);
        } else {
            this.drawCard(player);
        }
        
        // Meld phase
        setTimeout(() => {
            const req = ROUND_REQUIREMENTS[this.currentRound - 1];
            let meldMade = true;
            
            while (meldMade) {
                const meld = ai.findBestMeld(data.hand, req);
                if (meld) {
                    const result = this.makeMeld(player, meld.indices, meld.type);
                    meldMade = result.success;
                } else {
                    meldMade = false;
                }
            }
            
            // Discard phase
            setTimeout(() => {
                const discardIdx = ai.chooseDiscard(data.hand);
                this.discardCard(player, discardIdx);
            }, 500);
        }, 1000);
    }

    // Draw card
    drawCard(player) {
        if (this.getCurrentPlayer() !== player || this.turnState.hasDrawn) {
            return { success: false, message: "Cannot draw" };
        }
        
        if (this.deck.isEmpty()) {
            const top = this.discardPile.pop();
            if (!this.deck.reset(this.discardPile)) {
                return { success: false, message: "No cards available" };
            }
            this.discardPile = [top];
        }
        
        const data = this.playerData.get(player);
        data.hand.push(this.deck.deal());
        this.turnState.hasDrawn = true;
        
        this.broadcast('gameMessage', { message: `${player} drew a card` });
        return { success: true };
    }

    // Pick up discard
    pickUpDiscard(player) {
        if (this.getCurrentPlayer() !== player || this.turnState.hasDrawn || !this.discardPile.length) {
            return { success: false, message: "Cannot pick up" };
        }
        
        const data = this.playerData.get(player);
        const card = this.discardPile.pop();
        data.hand.push(card);
        this.turnState.hasDrawn = true;
        
        this.broadcast('gameMessage', { message: `${player} picked up ${card.display}` });
        return { success: true, card };
    }

    // Make meld
    makeMeld(player, indices, type) {
        if (this.getCurrentPlayer() !== player) {
            return { success: false, message: "Not your turn" };
        }
        
        const data = this.playerData.get(player);
        const cards = indices.map(i => data.hand[i]);
        
        if (!this.validateMeld(cards, type)) {
            return { success: false, message: "Invalid meld" };
        }
        
        // Remove cards from hand
        indices.sort((a, b) => b - a).forEach(i => data.hand.splice(i, 1));
        data.melds.push({ type, cards });
        
        // Check if player has gone down
        if (!data.goneDown) {
            const req = ROUND_REQUIREMENTS[this.currentRound - 1];
            const sets = data.melds.filter(m => m.type === 'set' && m.cards.length >= req.minSetSize).length;
            const runs = data.melds.filter(m => m.type === 'run' && m.cards.length >= req.minRunSize).length;
            
            if (sets >= req.sets && runs >= req.runs) {
                data.goneDown = true;
            }
        }
        
        this.broadcast('gameMessage', { message: `${player} made a ${type}` });
        
        // Check for round end
        if (data.hand.length === 0 && data.goneDown) {
            return { success: true, roundEnded: true, roundResult: this.endRound(player) };
        }
        
        return { success: true };
    }

    // Validate meld
    validateMeld(cards, type) {
        if (type === 'set') {
            if (cards.length < 3) return false;
            const rank = cards[0].rank;
            return cards.every(c => c.rank === rank);
        } else if (type === 'run') {
            if (cards.length < 4) return false;
            const suit = cards[0].suit;
            if (!cards.every(c => c.suit === suit)) return false;
            
            const sorted = [...cards].sort((a, b) => a.value - b.value);
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i].value !== sorted[i-1].value + 1) return false;
            }
            return true;
        }
        return false;
    }

    // Discard card
    discardCard(player, index) {
        if (this.getCurrentPlayer() !== player || !this.turnState.hasDrawn) {
            return { success: false, message: "Cannot discard" };
        }
        
        const data = this.playerData.get(player);
        if (index < 0 || index >= data.hand.length) {
            return { success: false, message: "Invalid card" };
        }
        
        const card = data.hand.splice(index, 1)[0];
        this.discardPile.push(card);
        
        this.broadcast('gameMessage', { message: `${player} discarded ${card.display}` });
        
        // Check for round end
        if (data.hand.length === 0 && data.goneDown) {
            return { success: true, roundEnded: true, roundResult: this.endRound(player) };
        }
        
        // Start buy phase
        this.startBuyPhase(card);
        
        return { success: true, card };
    }

    // Start buy phase
    startBuyPhase(card) {
        this.buyPhase = { active: true, card, requests: new Map() };
        
        // Get eligible buyers
        const buyers = this.players.filter(p => 
            p !== this.getCurrentPlayer() && 
            this.playerData.get(p).buys > 0
        );
        
        if (buyers.length === 0) {
            this.endBuyPhase();
            return;
        }
        
        // Notify buyers
        buyers.forEach(player => {
            if (this.aiPlayers.has(player)) {
                // AI decision
                const ai = this.aiPlayers.get(player);
                const data = this.playerData.get(player);
                const wants = ai.shouldBuy(card, data.hand, data.buys);
                this.buyPhase.requests.set(player, wants);
            } else {
                // Notify human player
                const socket = io.sockets.sockets.get(playerSockets.get(player));
                if (socket) {
                    socket.emit('buyRequest', { card, timeLimit: 3000 });
                }
            }
        });
        
        // Process after timeout
        setTimeout(() => this.processBuyPhase(), 3000);
    }

    // Process buy phase
    processBuyPhase() {
        const buyers = Array.from(this.buyPhase.requests.entries())
            .filter(([_, wants]) => wants)
            .map(([player]) => player);
        
        if (buyers.length > 0) {
            // Give to first buyer in turn order
            const buyer = buyers[0];
            const data = this.playerData.get(buyer);
            
            data.hand.push(this.discardPile.pop());
            data.hand.push(this.deck.deal());
            data.buys--;
            
            this.broadcast('gameMessage', { message: `${buyer} bought the card` });
        }
        
        this.endBuyPhase();
    }

    // End buy phase
    endBuyPhase() {
        this.buyPhase = { active: false, card: null, requests: new Map() };
        this.nextTurn();
        this.broadcastGameState();
    }

    // End round
    endRound(winner) {
        // Calculate scores
        this.players.forEach(player => {
            const data = this.playerData.get(player);
            let score = 0;
            
            if (player !== winner) {
                score = data.hand.reduce((sum, card) => sum + card.getScoreValue(), 0);
            }
            
            data.scores[this.currentRound - 1] = score;
        });
        
        if (this.currentRound >= 7) {
            return { gameEnded: true, finalResults: this.endGame() };
        }
        
        this.currentRound++;
        this.dealRound();
        return { gameEnded: false, newRound: this.currentRound };
    }

    // End game
    endGame() {
        const finalScores = new Map();
        
        this.players.forEach(player => {
            const data = this.playerData.get(player);
            const total = data.scores.reduce((sum, score) => sum + score, 0);
            finalScores.set(player, total);
        });
        
        const sorted = Array.from(finalScores.entries()).sort((a, b) => a[1] - b[1]);
        
        return {
            winner: sorted[0][0],
            winnerScore: sorted[0][1],
            finalStandings: sorted,
            gameComplete: true
        };
    }

    // Get game state for player
    getGameState(player) {
        const data = this.playerData.get(player);
        const allMelds = {};
        const handCounts = {};
        const scores = {};
        
        this.players.forEach(p => {
            const pData = this.playerData.get(p);
            allMelds[p] = pData.melds;
            handCounts[p] = pData.hand.length;
            scores[p] = pData.scores;
        });
        
        return {
            gameCode: this.gameCode,
            players: this.players,
            currentPlayer: this.getCurrentPlayer(),
            currentRound: this.currentRound,
            roundRequirements: ROUND_REQUIREMENTS[this.currentRound - 1],
            hand: data.hand,
            melds: data.melds,
            allPlayerMelds: allMelds,
            handCounts,
            scores,
            buysRemaining: data.buys,
            discardTop: this.discardPile[this.discardPile.length - 1] || null,
            turnState: this.turnState,
            hasGoneDown: data.goneDown,
            aiPlayers: Array.from(this.aiPlayers.keys())
        };
    }

    // Broadcast to all players
    broadcast(event, data) {
        io.to(this.gameCode).emit(event, data);
    }

    // Broadcast game state
    broadcastGameState() {
        this.players.forEach(player => {
            if (!this.aiPlayers.has(player)) {
                const socket = io.sockets.sockets.get(playerSockets.get(player));
                if (socket) {
                    socket.emit('gameUpdate', this.getGameState(player));
                }
            }
        });
    }
}

// Optimized socket handlers with better error handling and validation
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Rate limiting per socket
    const rateLimiter = new Map();
    
    const checkRateLimit = (event) => {
        const now = Date.now();
        const key = `${socket.id}_${event}`;
        const lastCall = rateLimiter.get(key) || 0;
        
        if (now - lastCall < 100) { // 100ms between calls
            return false;
        }
        
        rateLimiter.set(key, now);
        return true;
    };

    socket.on('joinGame', (data) => {
        if (!checkRateLimit('joinGame')) return;
        
        try {
            const { playerName, gameCode, aiCount } = data;
            
            // Enhanced validation
            if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
                socket.emit('error', { message: 'Valid name required' });
                return;
            }
            
            if (playerName.length > 20) {
                socket.emit('error', { message: 'Name too long (max 20 characters)' });
                return;
            }
            
            const sanitizedName = playerName.trim();
            const sanitizedAiCount = Math.max(0, Math.min(6, parseInt(aiCount) || 0));

            let game;
            let code = gameCode;

            if (code && games.has(code)) {
                game = games.get(code);
                game.updateActivity();
            } else {
                // More robust game code generation
                do {
                    code = Math.random().toString(36).substring(2, 8).toUpperCase();
                } while (games.has(code));
                
                game = new Game(code, sanitizedName, sanitizedAiCount);
                games.set(code, game);
            }

            if (!game.addPlayer(sanitizedName)) {
                socket.emit('error', { message: 'Name already taken' });
                return;
            }

            // Clean up old socket association
            if (socket.playerName) {
                playerSockets.delete(socket.playerName);
            }

            playerSockets.set(sanitizedName, socket.id);
            socket.playerName = sanitizedName;
            socket.gameCode = code;
            socket.join(code);

            io.to(code).emit('playerJoined', {
                players: game.players,
                gameCode: code,
                isHost: sanitizedName === game.hostName,
                aiPlayers: Array.from(game.aiPlayers.keys())
            });
        } catch (error) {
            console.error('Error in joinGame:', error);
            socket.emit('error', { message: 'Server error occurred' });
        }
    });

    socket.on('startGame', () => {
        if (!checkRateLimit('startGame')) return;
        
        try {
            const game = games.get(socket.gameCode);
            if (!game || socket.playerName !== game.hostName) {
                socket.emit('error', { message: 'Cannot start game' });
                return;
            }

            game.updateActivity();
            
            if (game.startGame()) {
                game.broadcastGameState();
                game.players.forEach(player => {
                    if (!game.aiPlayers.has(player)) {
                        const s = io.sockets.sockets.get(playerSockets.get(player));
                        if (s) s.emit('gameStarted', game.getGameState(player));
                    }
                });
            }
        } catch (error) {
            console.error('Error in startGame:', error);
            socket.emit('error', { message: 'Failed to start game' });
        }
    });

    // Optimized game action handlers with rate limiting
    ['drawCard', 'pickUpDiscard'].forEach(action => {
        socket.on(action, () => {
            if (!checkRateLimit(action)) return;
            
            try {
                const game = games.get(socket.gameCode);
                if (!game) return;
                
                game.updateActivity();
                const result = game[action](socket.playerName);
                if (result.success) {
                    game.broadcastGameState();
                } else {
                    socket.emit('error', result);
                }
            } catch (error) {
                console.error(`Error in ${action}:`, error);
                socket.emit('error', { message: 'Action failed' });
            }
        });
    });

    socket.on('makeMeld', (data) => {
        if (!checkRateLimit('makeMeld')) return;
        
        try {
            const game = games.get(socket.gameCode);
            if (!game) return;
            
            game.updateActivity();
            const result = game.makeMeld(socket.playerName, data.cardIndices, data.meldType);
            if (result.success) {
                if (result.roundEnded) {
                    handleRoundEnd(game, result.roundResult);
                } else {
                    game.broadcastGameState();
                }
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            console.error('Error in makeMeld:', error);
            socket.emit('error', { message: 'Meld failed' });
        }
    });

    socket.on('discardCard', (data) => {
        if (!checkRateLimit('discardCard')) return;
        
        try {
            const game = games.get(socket.gameCode);
            if (!game) return;
            
            game.updateActivity();
            const result = game.discardCard(socket.playerName, data.cardIndex);
            if (result.success) {
                if (result.roundEnded) {
                    handleRoundEnd(game, result.roundResult);
                }
            } else {
                socket.emit('error', result);
            }
        } catch (error) {
            console.error('Error in discardCard:', error);
            socket.emit('error', { message: 'Discard failed' });
        }
    });

    socket.on('submitBuyRequest', (data) => {
        if (!checkRateLimit('submitBuyRequest')) return;
        try {
            const game = games.get(socket.gameCode);
            if (!game || !game.buyPhase.active) return;
            
            game.updateActivity();
            game.buyPhase.requests.set(socket.playerName, data.wantsCard);
        } catch (error) {
            console.error('Error in submitBuyRequest:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        // Clean up rate limiter
        for (const [key] of rateLimiter.entries()) {
            if (key.startsWith(socket.id)) {
                rateLimiter.delete(key);
            }
        }
        
        if (socket.playerName && socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game) {
                game.updateActivity();
                const idx = game.players.indexOf(socket.playerName);
                if (idx > -1) {
                    game.players.splice(idx, 1);
                    game.playerData.delete(socket.playerName);
                    playerSockets.delete(socket.playerName);
                    
                    if (game.players.filter(p => !game.aiPlayers.has(p)).length === 0) {
                        games.delete(socket.gameCode);
                    }
                }
            }
        }
    });
});

// Handle round end
function handleRoundEnd(game, result) {
    if (result.gameEnded) {
        io.to(game.gameCode).emit('gameComplete', result.finalResults);
    } else {
        game.broadcastGameState();
        game.broadcast('gameMessage', { message: `Round ${result.newRound} starting!` });
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`Shanghai Rummy server running on port ${PORT}`);
    console.log(`Game available at: http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
