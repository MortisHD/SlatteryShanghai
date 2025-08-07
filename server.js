const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 9494;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve the game's HTML file at the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'slattery-shanghai.html'));
});

// --- Game State Storage ---
const games = new Map();
const playerSockets = new Map();

// --- Game Constants ---
const ROUND_REQUIREMENTS = [
    { round: 1, melds: "2 Sets of 3", description: "Two sets of three cards each", sets: 2, runs: 0, minSetSize: 3, minRunSize: 0 },
    { round: 2, melds: "1 Set of 3 + 1 Run of 4", description: "One set of three and one run of four", sets: 1, runs: 1, minSetSize: 3, minRunSize: 4 },
    { round: 3, melds: "2 Runs of 4", description: "Two runs of four cards each", sets: 0, runs: 2, minSetSize: 0, minRunSize: 4 },
    { round: 4, melds: "3 Sets of 3", description: "Three sets of three cards each", sets: 3, runs: 0, minSetSize: 3, minRunSize: 0 },
    { round: 5, melds: "2 Sets of 3 + 1 Run of 4", description: "Two sets of three and one run of four", sets: 2, runs: 1, minSetSize: 3, minRunSize: 4 },
    { round: 6, melds: "1 Set of 3 + 2 Runs of 4", description: "One set of three and two runs of four", sets: 1, runs: 2, minSetSize: 3, minRunSize: 4 },
    { round: 7, melds: "3 Runs of 4", description: "Three runs of four cards each", sets: 0, runs: 3, minSetSize: 0, minRunSize: 4 }
];

const AI_NAMES = ['AI-Emma', 'AI-Oliver', 'AI-Sofia', 'AI-Lucas', 'AI-Grace', 'AI-Henry', 'AI-Chloe', 'AI-Jack', 'AI-Maya', 'AI-Leo'];

// --- Game Classes ---

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
        if (['J', 'Q', 'K'].includes(rank)) return 10;
        return parseInt(rank);
    }

    getDisplayString() {
        const suitSymbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
        return this.rank + suitSymbols[this.suit];
    }

    getScoreValue() {
        if (this.rank === 'A') return 20;
        if (['J', 'Q', 'K'].includes(this.rank)) return 10;
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
        for (let i = 0; i < 2; i++) { // 2 decks for Shanghai
            for (const suit of suits) {
                for (const rank of ranks) {
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

class AIPlayer {
    // ... (AI Player logic from your file remains unchanged)
    constructor(name, difficulty = 'medium') {
        this.name = name;
        this.difficulty = difficulty; // 'easy', 'medium', 'hard'
        this.isAI = true;
    }

    // AI decision making for different difficulties
    getDecisionDelay() {
        switch (this.difficulty) {
            case 'easy': return 2000 + Math.random() * 2000; // 2-4 seconds
            case 'medium': return 1500 + Math.random() * 1500; // 1.5-3 seconds
            case 'hard': return 1000 + Math.random() * 1000; // 1-2 seconds
            default: return 2000;
        }
    }

    shouldBuyCard(game, discardCard) {
        if (this.buysRemaining <= 0) return false;
        
        const hand = game.playerHands.get(this.name);
        const requirements = ROUND_REQUIREMENTS[game.currentRound - 1];
        
        // Check if the discard card helps complete sets or runs
        const cardValue = this.evaluateCardValue(discardCard, hand, requirements);
        
        switch (this.difficulty) {
            case 'easy': return Math.random() < 0.2 && cardValue > 3;
            case 'medium': return cardValue > 5;
            case 'hard': return cardValue > 4;
            default: return false;
        }
    }

    evaluateCardValue(card, hand, requirements) {
        let value = 0;
        
        // Count matching ranks for sets
        const sameRank = hand.filter(c => c.rank === card.rank).length;
        if (sameRank >= 2) value += (sameRank * 3);
        
        // Count potential runs
        const sameSuit = hand.filter(c => c.suit === card.suit);
        sameSuit.forEach(c => {
            const diff = Math.abs(c.value - card.value);
            if (diff === 1) value += 4;
            if (diff === 2) value += 2;
        });
        
        return value;
    }

    chooseBestMeld(game) {
        const hand = game.playerHands.get(this.name);
        const requirements = ROUND_REQUIREMENTS[game.currentRound - 1];
        
        // Find all possible melds
        const possibleSets = this.findPossibleSets(hand);
        const possibleRuns = this.findPossibleRuns(hand);
        
        // Prioritize based on round requirements
        let bestMeld = null;
        let bestScore = 0;
        
        // Check sets first if we need them
        if (requirements.sets > 0) {
            possibleSets.forEach(set => {
                const score = this.scoreMeld(set, 'set', requirements);
                if (score > bestScore) {
                    bestMeld = { cards: set, type: 'set' };
                    bestScore = score;
                }
            });
        }
        
        // Check runs if we need them
        if (requirements.runs > 0) {
            possibleRuns.forEach(run => {
                const score = this.scoreMeld(run, 'run', requirements);
                if (score > bestScore) {
                    bestMeld = { cards: run, type: 'run' };
                    bestScore = score;
                }
            });
        }
        
        return bestMeld;
    }

    findPossibleSets(hand) {
        const sets = [];
        const rankGroups = {};
        
        hand.forEach((card, index) => {
            if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
            rankGroups[card.rank].push({ card, index });
        });
        
        Object.values(rankGroups).forEach(group => {
            if (group.length >= 3) {
                // Try all combinations of 3+ cards
                for (let size = 3; size <= group.length; size++) {
                    const indices = group.slice(0, size).map(item => item.index);
                    sets.push(indices);
                }
            }
        });
        
        return sets;
    }

    findPossibleRuns(hand) {
        const runs = [];
        const suitGroups = {};
        
        hand.forEach((card, index) => {
            if (!suitGroups[card.suit]) suitGroups[card.suit] = [];
            suitGroups[card.suit].push({ card, index });
        });
        
        Object.values(suitGroups).forEach(group => {
            if (group.length >= 4) {
                group.sort((a, b) => a.card.value - b.card.value);
                
                // Find consecutive sequences
                for (let start = 0; start < group.length - 3; start++) {
                    let sequence = [start];
                    
                    for (let i = start + 1; i < group.length; i++) {
                        if (group[i].card.value === group[sequence[sequence.length - 1]].card.value + 1) {
                            sequence.push(i);
                        } else if (group[i].card.value > group[sequence[sequence.length - 1]].card.value + 1) {
                            break;
                        }
                    }
                    
                    if (sequence.length >= 4) {
                        const indices = sequence.map(pos => group[pos].index);
                        runs.push(indices);
                    }
                }
            }
        });
        
        return runs;
    }

    scoreMeld(cardIndices, type, requirements) {
        let score = cardIndices.length * 2;
        
        // Bonus for meeting round requirements
        if ((type === 'set' && requirements.sets > 0) || 
            (type === 'run' && requirements.runs > 0)) {
            score += 10;
        }
        
        return score;
    }

    chooseDiscardCard(game) {
        const hand = game.playerHands.get(this.name);
        let worstCardIndex = 0;
        let worstScore = Infinity;
        
        hand.forEach((card, index) => {
            const score = this.evaluateCardValue(card, hand.filter((_, i) => i !== index), ROUND_REQUIREMENTS[game.currentRound - 1]);
            if (score < worstScore) {
                worstScore = score;
                worstCardIndex = index;
            }
        });
        
        return worstCardIndex;
    }
}

class Game {
    constructor(gameCode, hostName, aiCount = 0) {
        this.gameCode = gameCode;
        this.players = [];
        this.aiPlayers = new Map();
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
        this.turnState = { hasDrawn: false, canBuy: true };
        
        for (let i = 0; i < aiCount; i++) {
            const aiName = AI_NAMES[i % AI_NAMES.length] + (Math.floor(i / AI_NAMES.length) > 0 ? `-${Math.floor(i / AI_NAMES.length) + 1}` : '');
            const difficulty = ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)];
            const aiPlayer = new AIPlayer(aiName, difficulty);
            
            this.players.push(aiName);
            this.aiPlayers.set(aiName, aiPlayer);
            this.playerScores.set(aiName, Array(7).fill(0));
            console.log(`Added AI player: ${aiName} (${difficulty})`);
        }
    }

    addPlayer(playerName) {
        if (this.players.includes(playerName)) return false;
        this.players.push(playerName);
        this.playerScores.set(playerName, Array(7).fill(0));
        return true;
    }

    removePlayer(playerName) {
        const index = this.players.indexOf(playerName);
        if (index > -1) {
            this.players.splice(index, 1);
            this.playerHands.delete(playerName);
            this.playerMelds.delete(playerName);
            this.playerBuys.delete(playerName);
            this.playerScores.delete(playerName);
            this.aiPlayers.delete(playerName);
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) return false;
        this.gameStarted = true;
        this.dealRound();
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
        return true;
    }

    dealRound() {
        this.deck = new Deck();
        this.discardPile = [];
        this.players.forEach(player => {
            this.playerHands.set(player, []);
            this.playerMelds.set(player, []);
            this.playerBuys.set(player, 3);
        });

        const cardsPerPlayer = 10 + this.currentRound;
        for (let i = 0; i < cardsPerPlayer; i++) {
            this.players.forEach(player => this.playerHands.get(player).push(this.deck.deal()));
        }

        this.discardPile.push(this.deck.deal());
        this.currentPlayerIndex = (this.currentRound - 1) % this.players.length;
        this.turnState = { hasDrawn: false, canBuy: true };
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        this.turnState = { hasDrawn: false, canBuy: true };
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
    }

    scheduleAITurn() {
        const currentPlayer = this.getCurrentPlayer();
        const aiPlayer = this.aiPlayers.get(currentPlayer);
        if (!aiPlayer) return;

        const delay = aiPlayer.getDecisionDelay();
        setTimeout(() => {
            if (this.getCurrentPlayer() === currentPlayer && this.gameStarted) {
                this.executeAITurn(currentPlayer);
            }
        }, delay);
    }

    executeAITurn(playerName) {
        // ... (AI turn execution logic from your file remains unchanged)
    }

    layOffCard(playerName, cardIndex, targetPlayerName, meldIndex) {
        console.log(`${playerName} attempting to lay off card ${cardIndex} to ${targetPlayerName}'s meld ${meldIndex}`);
        
        if (this.getCurrentPlayer() !== playerName) {
            return { success: false, message: "Not your turn" };
        }

        // --- NEW: Server-side validation to ensure player has met their contract ---
        const validation = this.validatePlayerMeetsRoundRequirements(playerName);
        if (!validation.meetsRequirements) {
            return { success: false, message: "You must meet your round requirements before laying off cards." };
        }
        // --- END NEW VALIDATION ---

        const hand = this.playerHands.get(playerName);
        if (cardIndex < 0 || cardIndex >= hand.length) {
            return { success: false, message: "Invalid card" };
        }

        const targetMelds = this.playerMelds.get(targetPlayerName);
        if (!targetMelds || meldIndex < 0 || meldIndex >= targetMelds.length) {
            return { success: false, message: "Invalid target meld" };
        }

        const card = hand[cardIndex];
        const targetMeld = targetMelds[meldIndex];
        
        if (!this.canLayOffCard(card, targetMeld)) {
            return { success: false, message: "Card cannot be added to that meld" };
        }

        hand.splice(cardIndex, 1);
        targetMeld.cards.push(card);
        console.log(`${playerName} laid off ${card.display} to ${targetPlayerName}'s ${targetMeld.type}`);

        if (hand.length === 0) {
            // This check is implicitly handled by the new validation at the start of the function,
            // but we keep it here as a safeguard for the "going out" action.
            const postLayoffValidation = this.validatePlayerMeetsRoundRequirements(playerName);
            if (!postLayoffValidation.meetsRequirements) {
                hand.splice(cardIndex, 0, card); // Put card back
                targetMeld.cards.pop();
                return { success: false, message: `Cannot go out! You need: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` };
            }
            const roundResult = this.endRound(playerName);
            return { success: true, card, layOff: true, roundEnded: true, roundResult };
        }

        return { success: true, card, layOff: true };
    }

    canLayOffCard(card, meld) {
        if (meld.type === 'set') {
            return meld.cards.every(meldCard => meldCard.rank === card.rank);
        } else if (meld.type === 'run') {
            if (card.suit !== meld.cards[0].suit) return false;
            const values = meld.cards.map(c => c.value).sort((a, b) => a - b);
            return card.value === values[0] - 1 || card.value === values[values.length - 1] + 1;
        }
        return false;
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
        
        const meetsRequirements = validSets >= requirements.sets && validRuns >= requirements.runs;
        
        return { meetsRequirements };
    }

    // ... (All other Game class methods from your file remain unchanged) ...
    // (drawCard, pickUpDiscard, buyCard, discardCard, makeMeld, etc.)
    drawCard(playerName) {
        if (this.getCurrentPlayer() !== playerName || this.turnState.hasDrawn) {
            return { success: false, message: "Not your turn or already drawn" };
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
        
        console.log(`${playerName} drew a card, hand now has ${this.playerHands.get(playerName).length} cards`);
        
        // Process AI buying opportunities after a human draws
        if (!this.aiPlayers.has(playerName)) {
            setTimeout(() => this.processAIBuys(), 1000);
        }
        
        return { success: true, card };
    }

    pickUpDiscard(playerName) {
        if (this.getCurrentPlayer() !== playerName || this.turnState.hasDrawn) {
            return { success: false, message: "Not your turn or already drawn" };
        }

        if (this.discardPile.length === 0) {
            return { success: false, message: "No card in discard pile" };
        }

        const card = this.discardPile.pop();
        this.playerHands.get(playerName).push(card);
        this.turnState.hasDrawn = true;
        
        console.log(`${playerName} picked up ${card.display}, discard pile now has ${this.discardPile.length} cards`);
        return { success: true, card };
    }

    buyCard(playerName) {
        if (this.getCurrentPlayer() === playerName || this.playerBuys.get(playerName) <= 0) {
            return { success: false, message: "Cannot buy on your turn or no buys left" };
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
                console.error("Deck and discard pile both empty!");
                return { success: false, message: "No cards left to deal" };
            }
        }
        
        const penaltyCard = this.deck.deal();
        this.playerHands.get(playerName).push(penaltyCard);
        this.playerBuys.set(playerName, this.playerBuys.get(playerName) - 1);
        
        console.log(`${playerName} bought ${discardCard.display}, discard pile now has ${this.discardPile.length} cards`);
        return { success: true, discardCard, penaltyCard };
    }

    discardCard(playerName, cardIndex) {
        if (this.getCurrentPlayer() !== playerName || !this.turnState.hasDrawn) {
            return { success: false, message: "Not your turn or haven't drawn" };
        }

        const hand = this.playerHands.get(playerName);
        if (cardIndex < 0 || cardIndex >= hand.length) {
            return { success: false, message: "Invalid card" };
        }

        const discardedCard = hand.splice(cardIndex, 1)[0];
        this.discardPile.push(discardedCard);

        if (hand.length === 0) {
            const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            if (!validation.meetsRequirements) {
                hand.push(discardedCard);
                this.discardPile.pop();
                return { success: false, message: `Cannot go out! You need: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` };
            }
            const roundResult = this.endRound(playerName);
            return { success: true, card: discardedCard, roundEnded: true, roundResult };
        }

        this.nextTurn();
        if (!this.aiPlayers.has(playerName)) {
            setTimeout(() => this.processAIBuys(), 500);
        }
        
        return { success: true, card: discardedCard };
    }

    validateMeld(cards, meldType) {
        if (meldType === 'set' && cards.length < 3) return false;
        if (meldType === 'run' && cards.length < 4) return false;

        if (meldType === 'set') {
            return cards.every(card => card.rank === cards[0].rank);
        } else if (meldType === 'run') {
            if (!cards.every(card => card.suit === cards[0].suit)) return false;
            const sortedCards = cards.sort((a, b) => a.value - b.value);
            for (let i = 1; i < sortedCards.length; i++) {
                if (sortedCards[i].value !== sortedCards[i-1].value + 1) return false;
            }
            return true;
        }
        return false;
    }

    makeMeld(playerName, cardIndices, meldType) {
        if (this.getCurrentPlayer() !== playerName) {
            return { success: false, message: "Not your turn" };
        }

        const hand = this.playerHands.get(playerName);
        const cards = cardIndices.map(index => hand[index]);

        if (!this.validateMeld(cards, meldType)) {
            return { success: false, message: `Invalid ${meldType}` };
        }

        const sortedIndices = [...cardIndices].sort((a, b) => b - a);
        sortedIndices.forEach(index => hand.splice(index, 1));

        if (!this.playerMelds.has(playerName)) this.playerMelds.set(playerName, []);
        this.playerMelds.get(playerName).push({ type: meldType, cards });

        if (hand.length === 0) {
             const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            if (!validation.meetsRequirements) {
                 // This case is tricky, might need to revert the meld
                 return { success: false, message: `You've melded all cards but don't meet round requirements: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` };
            }
            const roundResult = this.endRound(playerName);
            return { success: true, meld: { type: meldType, cards }, roundEnded: true, roundResult };
        }
        
        return { success: true, meld: { type: meldType, cards } };
    }
    
    endRound(winner) {
        this.players.forEach(player => {
            let roundScore = 0;
            if (player !== winner) {
                const hand = this.playerHands.get(player);
                roundScore = hand.reduce((sum, card) => sum + card.getScoreValue(), 0);
            }
            const scores = this.playerScores.get(player);
            scores[this.currentRound - 1] = roundScore;
        });

        if (this.currentRound >= 7) {
            return { gameEnded: true, finalResults: this.endGame() };
        } else {
            this.currentRound++;
            this.dealRound();
            return { gameEnded: false, newRound: this.currentRound };
        }
    }

    endGame() {
        const finalScores = new Map();
        this.players.forEach(player => {
            const total = this.playerScores.get(player).reduce((sum, score) => sum + score, 0);
            finalScores.set(player, total);
        });
        
        const sortedPlayers = Array.from(finalScores.entries()).sort((a, b) => a[1] - b[1]);
        return { winner: sortedPlayers[0][0], winnerScore: sortedPlayers[0][1], finalStandings: sortedPlayers };
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
            ),
            aiPlayers: Array.from(this.aiPlayers.keys())
        };
    }
}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Join Game Logic
    socket.on('joinGame', (data) => {
        const { playerName, gameCode, aiCount } = data;
        if (!playerName) return socket.emit('error', { message: 'Player name required' });

        let game;
        let finalGameCode = gameCode;

        if (gameCode && games.has(gameCode)) {
            game = games.get(gameCode);
            if (game.gameStarted) return socket.emit('error', { message: 'Game already started' });
        } else {
            finalGameCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            game = new Game(finalGameCode, playerName, aiCount || 0);
            games.set(finalGameCode, game);
        }

        if (!game.addPlayer(playerName)) return socket.emit('error', { message: 'Player name already taken' });

        playerSockets.set(playerName, socket.id);
        socket.playerName = playerName;
        socket.gameCode = finalGameCode;
        socket.join(finalGameCode);

        io.to(finalGameCode).emit('playerJoined', {
            players: game.players,
            gameCode: finalGameCode,
            isHost: playerName === game.hostName,
            aiPlayers: Array.from(game.aiPlayers.keys())
        });
    });

    // Start Game Logic
    socket.on('startGame', () => {
        const game = games.get(socket.gameCode);
        if (!game || socket.playerName !== game.hostName) return socket.emit('error', { message: 'Only host can start game' });
        if (!game.startGame()) return socket.emit('error', { message: 'Need at least 2 players to start' });

        game.players.forEach(playerName => {
            if (!game.aiPlayers.has(playerName)) {
                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                if (playerSocket) playerSocket.emit('gameStarted', game.getGameState(playerName));
            }
        });
    });

    // ... (All other socket event handlers from your file remain unchanged) ...
    socket.on('drawCard', () => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.drawCard(socket.playerName);
        if (result.success) {
            game.broadcastGameUpdate();
        } else {
            socket.emit('error', result);
        }
    });

    socket.on('pickUpDiscard', () => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.pickUpDiscard(socket.playerName);
        if (result.success) {
            game.broadcastGameUpdate();
        } else {
            socket.emit('error', result);
        }
    });
    
    socket.on('buyCard', () => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.buyCard(socket.playerName);
        if (result.success) {
            game.broadcastGameUpdate();
        } else {
            socket.emit('error', result);
        }
    });

    socket.on('layOffCard', (data) => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.layOffCard(socket.playerName, data.cardIndex, data.targetPlayer, data.meldIndex);
        if (result.success) {
            game.broadcastGameUpdate();
            if (result.roundEnded) game.handleRoundEnd(result.roundResult);
        } else {
            socket.emit('error', result);
        }
    });

    socket.on('discardCard', (data) => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.discardCard(socket.playerName, data.cardIndex);
        if (result.success) {
            game.broadcastGameUpdate();
            if (result.roundEnded) game.handleRoundEnd(result.roundResult);
        } else {
            socket.emit('error', result);
        }
    });

    socket.on('makeMeld', (data) => {
        const game = games.get(socket.gameCode);
        if (!game) return;
        const result = game.makeMeld(socket.playerName, data.cardIndices, data.meldType);
        if (result.success) {
            game.broadcastGameUpdate();
            if (result.roundEnded) {
                game.handleRoundEnd(result.roundResult);
            }
        } else {
            socket.emit('error', result);
        }
    });

    // Disconnect Logic
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        if (socket.playerName && socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game && !game.aiPlayers.has(socket.playerName)) {
                game.removePlayer(socket.playerName);
                playerSockets.delete(socket.playerName);
                io.to(socket.gameCode).emit('playerLeft', { players: game.players, playerName: socket.playerName });
                if (game.players.filter(p => !game.aiPlayers.has(p)).length === 0) {
                    games.delete(socket.gameCode);
                    console.log(`Game ${socket.gameCode} deleted - no human players remaining`);
                }
            }
        }
    });
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Slattery Shanghai server running on port ${PORT}`);
    console.log(`Game available at: http://localhost:${PORT}`);
});
