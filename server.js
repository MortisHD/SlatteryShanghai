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

// Serve static files
app.use(express.static(__dirname));

// Serve the game at root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'slattery-shanghai.html'));
});

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

// AI player names
const AI_NAMES = [
    'AI-Emma', 'AI-Oliver', 'AI-Sofia', 'AI-Lucas', 'AI-Grace',
    'AI-Henry', 'AI-Chloe', 'AI-Jack', 'AI-Maya', 'AI-Leo'
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

class AIPlayer {
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
        this.aiPlayers = new Map(); // Store AI player instances
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
        
        // Add AI players
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
            this.aiPlayers.delete(playerName);
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) return false;
        
        this.gameStarted = true;
        this.currentRound = 1;
        this.currentPlayerIndex = 0;
        
        console.log(`Game starting with ${this.players.length} players`);
        console.log(`Round 1 starting player: ${this.players[0]}`);
        
        this.dealRound();
        
        // Start AI turn if first player is AI
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
        
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
        console.log(`Dealing ${cardsPerPlayer} cards per player for round ${this.currentRound}`);
        
        for (let i = 0; i < cardsPerPlayer; i++) {
            this.players.forEach(player => {
                this.playerHands.get(player).push(this.deck.deal());
            });
        }

        // Start discard pile
        this.discardPile.push(this.deck.deal());
        
        // Rotate starting player each round
        this.currentPlayerIndex = (this.currentRound - 1) % this.players.length;
        console.log(`Round ${this.currentRound} starting player: ${this.getCurrentPlayer()} (index ${this.currentPlayerIndex})`);
        
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
        console.log(`Turn changed to player ${this.currentPlayerIndex}: ${this.getCurrentPlayer()}`);
        
        // Schedule AI turn if next player is AI
        if (this.aiPlayers.has(this.getCurrentPlayer())) {
            this.scheduleAITurn();
        }
    }

    scheduleAITurn() {
        const currentPlayer = this.getCurrentPlayer();
        const aiPlayer = this.aiPlayers.get(currentPlayer);
        
        if (!aiPlayer) return;
        
        const delay = aiPlayer.getDecisionDelay();
        console.log(`Scheduling AI turn for ${currentPlayer} in ${delay}ms`);
        
        setTimeout(() => {
            if (this.getCurrentPlayer() === currentPlayer && this.gameStarted) {
                this.executeAITurn(currentPlayer);
            }
        }, delay);
    }

    executeAITurn(playerName) {
        const aiPlayer = this.aiPlayers.get(playerName);
        if (!aiPlayer || this.getCurrentPlayer() !== playerName) return;
        
        console.log(`Executing AI turn for ${playerName}`);
        
        // First, draw a card or pick up discard
        let drewCard = false;
        if (this.discardPile.length > 0 && Math.random() < 0.3) { // 30% chance to pick up discard
            const result = this.pickUpDiscard(playerName);
            if (result.success) {
                drewCard = true;
                this.broadcastMessage(`${playerName} picked up the ${result.card.display} from discard pile`);
            }
        }
        
        if (!drewCard) {
            const result = this.drawCard(playerName);
            if (result.success) {
                this.broadcastMessage(`${playerName} drew a card`);
            }
        }
        
        // Try to make melds
        setTimeout(() => {
            this.tryAIMelds(playerName);
            
            // Then discard
            setTimeout(() => {
                this.aiDiscardCard(playerName);
            }, 500);
        }, 1000);
    }

    tryAIMelds(playerName) {
        const aiPlayer = this.aiPlayers.get(playerName);
        if (!aiPlayer) return;
        
        let madeAMeld = true;
        while (madeAMeld) {
            const bestMeld = aiPlayer.chooseBestMeld(this);
            if (bestMeld && bestMeld.cards.length >= (bestMeld.type === 'set' ? 3 : 4)) {
                const result = this.makeMeld(playerName, bestMeld.cards, bestMeld.type);
                if (result.success) {
                    this.broadcastMessage(`${playerName} made a ${bestMeld.type} with ${bestMeld.cards.length} cards`);
                    
                    if (result.roundEnded) {
                        this.handleRoundEnd(result.roundResult);
                        return;
                    }
                } else {
                    madeAMeld = false;
                }
            } else {
                madeAMeld = false;
            }
        }
    }

    aiDiscardCard(playerName) {
        const aiPlayer = this.aiPlayers.get(playerName);
        if (!aiPlayer || this.getCurrentPlayer() !== playerName) return;
        
        const discardIndex = aiPlayer.chooseDiscardCard(this);
        const result = this.discardCard(playerName, discardIndex);
        
        if (result.success) {
            this.broadcastMessage(`${playerName} discarded ${result.card.display}`);
            this.broadcastGameUpdate();
            
            if (result.roundEnded) {
                this.handleRoundEnd(result.roundResult);
            }
        }
    }

    // Handle AI buying cards
    processAIBuys(gameCode) {
        if (!this.discardPile.length) return;
        
        const discardCard = this.discardPile[this.discardPile.length - 1];
        
        // Check all AI players (except current player) for buying interest
        this.players.forEach(playerName => {
            if (this.getCurrentPlayer() !== playerName && this.aiPlayers.has(playerName)) {
                const aiPlayer = this.aiPlayers.get(playerName);
                const buysRemaining = this.playerBuys.get(playerName) || 0;
                
                if (buysRemaining > 0 && aiPlayer.shouldBuyCard(this, discardCard)) {
                    setTimeout(() => {
                        const result = this.buyCard(playerName);
                        if (result.success) {
                            this.broadcastMessage(`${playerName} bought the ${result.discardCard.display} and drew a penalty card`);
                            this.broadcastGameUpdate();
                        }
                    }, Math.random() * 2000 + 500); // Random delay 0.5-2.5 seconds
                }
            }
        });
    }

    broadcastMessage(message) {
        if (io && this.gameCode) {
            io.to(this.gameCode).emit('gameMessage', { message });
        }
    }

    broadcastGameUpdate() {
        if (!io || !this.gameCode) return;
        
        this.players.forEach(playerName => {
            if (!this.aiPlayers.has(playerName)) { // Only send to human players
                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                if (playerSocket) {
                    const gameState = this.getGameState(playerName);
                    playerSocket.emit('gameUpdate', gameState);
                }
            }
        });
    }

    handleRoundEnd(roundResult) {
        this.broadcastMessage(`🎉 Round ended!`);
        
        if (roundResult.gameEnded && roundResult.finalResults) {
            setTimeout(() => {
                io.to(this.gameCode).emit('gameComplete', roundResult.finalResults);
                this.broadcastMessage(`🏆 GAME COMPLETE! Winner: ${roundResult.finalResults.winner} with ${roundResult.finalResults.winnerScore} points! 🏆`);
            }, 1500);
        } else {
            setTimeout(() => {
                this.broadcastGameUpdate();
                this.broadcastMessage(`Starting Round ${this.currentRound}!`);
                
                // Start new round with AI if needed
                if (this.aiPlayers.has(this.getCurrentPlayer())) {
                    this.scheduleAITurn();
                }
            }, 2000);
        }
    }

    // NEW: Lay-off functionality
    layOffCard(playerName, cardIndex, targetPlayerName, meldIndex) {
        console.log(`${playerName} attempting to lay off card ${cardIndex} to ${targetPlayerName}'s meld ${meldIndex}`);
        
        if (this.getCurrentPlayer() !== playerName) {
            return { success: false, message: "Not your turn" };
        }

        const hand = game.playerHands.get(playerName);
        if (cardIndex < 0 || cardIndex >= hand.length) {
            return { success: false, message: "Invalid card" };
        }

        const targetMelds = this.playerMelds.get(targetPlayerName);
        if (!targetMelds || meldIndex < 0 || meldIndex >= targetMelds.length) {
            return { success: false, message: "Invalid target meld" };
        }

        const card = hand[cardIndex];
        const targetMeld = targetMelds[meldIndex];
        
        // Check if card can be added to the meld
        if (!this.canLayOffCard(card, targetMeld)) {
            return { success: false, message: "Card cannot be added to that meld" };
        }

        // Add card to the meld
        hand.splice(cardIndex, 1);
        targetMeld.cards.push(card);

        console.log(`${playerName} laid off ${card.display} to ${targetPlayerName}'s ${targetMeld.type}`);

        // Check if player went out
        if (hand.length === 0) {
            const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            
            if (!validation.meetsRequirements) {
                // Put card back
                hand.splice(cardIndex, 0, card);
                targetMeld.cards.pop();
                
                return { 
                    success: false, 
                    message: `Cannot go out! You need: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` 
                };
            }
            
            console.log(`${playerName} went out by laying off their last card!`);
            const roundResult = this.endRound(playerName);
            return { success: true, card, layOff: true, roundEnded: true, roundResult };
        }

        return { success: true, card, layOff: true };
    }

    canLayOffCard(card, meld) {
        if (meld.type === 'set') {
            // Card must match the rank of the set
            return meld.cards.every(meldCard => meldCard.rank === card.rank);
        } else if (meld.type === 'run') {
            // Card must extend the run (same suit, consecutive value)
            const suit = meld.cards[0].suit;
            if (card.suit !== suit) return false;

            const values = meld.cards.map(c => c.value).sort((a, b) => a - b);
            const cardValue = card.value;
            
            // Check if card extends the run at either end
            return cardValue === values[0] - 1 || cardValue === values[values.length - 1] + 1;
        }
        
        return false;
    }

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

    validatePlayerMeetsRoundRequirements(playerName) {
        console.log(`=== VALIDATING ROUND REQUIREMENTS FOR ${playerName} ===`);
        
        const playerMelds = this.playerMelds.get(playerName) || [];
        const requirements = ROUND_REQUIREMENTS[this.currentRound - 1];
        
        console.log(`Round ${this.currentRound} requirements:`, requirements);
        console.log(`Player ${playerName} has ${playerMelds.length} melds:`, playerMelds.map(m => `${m.type}(${m.cards.length})`));
        
        let validSets = 0;
        let validRuns = 0;
        
        playerMelds.forEach(meld => {
            if (meld.type === 'set' && meld.cards.length >= requirements.minSetSize) {
                validSets++;
                console.log(`✅ Valid set found: ${meld.cards.length} cards`);
            } else if (meld.type === 'run' && meld.cards.length >= requirements.minRunSize) {
                validRuns++;
                console.log(`✅ Valid run found: ${meld.cards.length} cards`);
            } else {
                console.log(`❌ Invalid meld: ${meld.type} with ${meld.cards.length} cards`);
            }
        });
        
        const hasRequiredSets = validSets >= requirements.sets;
        const hasRequiredRuns = validRuns >= requirements.runs;
        const meetsRequirements = hasRequiredSets && hasRequiredRuns;
        
        console.log(`Requirements check: Sets ${validSets}/${requirements.sets}, Runs ${validRuns}/${requirements.runs}`);
        console.log(`Meets requirements: ${meetsRequirements}`);
        
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
        console.log(`${playerName} attempting to discard card at index ${cardIndex}`);
        
        if (this.getCurrentPlayer() !== playerName || !this.turnState.hasDrawn) {
            console.log(`Discard failed: current player is ${this.getCurrentPlayer()}, hasDrawn: ${this.turnState.hasDrawn}`);
            return { success: false, message: "Not your turn or haven't drawn" };
        }

        const hand = this.playerHands.get(playerName);
        if (cardIndex < 0 || cardIndex >= hand.length) {
            return { success: false, message: "Invalid card" };
        }

        const discardedCard = hand.splice(cardIndex, 1)[0];
        this.discardPile.push(discardedCard);
        console.log(`${playerName} discarded ${discardedCard.display}, discard pile now has ${this.discardPile.length} cards`);

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
                
                console.log(`${playerName} tried to go out but doesn't meet requirements`);
                return { success: false, message: errorMessage };
            }
            
            console.log(`${playerName} went out and meets requirements! Ending round.`);
            const roundResult = this.endRound(playerName);
            return { success: true, card: discardedCard, roundEnded: true, roundResult };
        }

        console.log(`Ending ${playerName}'s turn, moving to next player`);
        this.nextTurn();
        console.log(`New current player: ${this.getCurrentPlayer()}`);
        
        // Process AI buying opportunities after discard
        if (!this.aiPlayers.has(playerName)) {
            setTimeout(() => this.processAIBuys(), 500);
        }
        
        return { success: true, card: discardedCard };
    }

    validateMeld(cards, meldType) {
        if (meldType === 'set' && cards.length < 3) {
            console.log(`Set validation failed: only ${cards.length} cards (need at least 3)`);
            return false;
        }
        
        if (meldType === 'run' && cards.length < 4) {
            console.log(`Run validation failed: only ${cards.length} cards (need at least 4)`);
            return false;
        }

        if (meldType === 'set') {
            const rank = cards[0].rank;
            const isValid = cards.every(card => card.rank === rank);
            console.log(`Set validation: rank ${rank}, all same? ${isValid}`);
            return isValid;
        } else if (meldType === 'run') {
            const suit = cards[0].suit;
            if (!cards.every(card => card.suit === suit)) {
                console.log(`Run validation failed: not all same suit`);
                return false;
            }

            const sortedCards = cards.sort((a, b) => a.value - b.value);
            console.log(`Run cards sorted:`, sortedCards.map(c => `${c.rank}${c.suit}`));
            
            for (let i = 1; i < sortedCards.length; i++) {
                if (sortedCards[i].value !== sortedCards[i-1].value + 1) {
                    console.log(`Run validation failed: gap between ${sortedCards[i-1].rank} and ${sortedCards[i].rank}`);
                    return false;
                }
            }
            console.log(`Run validation: passed`);
            return true;
        }
        return false;
    }

    makeMeld(playerName, cardIndices, meldType) {
        console.log(`${playerName} attempting to make ${meldType} with cards at indices:`, cardIndices);
        
        if (this.getCurrentPlayer() !== playerName) {
            return { success: false, message: "Not your turn" };
        }

        const hand = this.playerHands.get(playerName);
        console.log(`Player hand size: ${hand.length}`);
        
        for (let index of cardIndices) {
            if (index < 0 || index >= hand.length) {
                console.log(`Invalid card index: ${index}`);
                return { success: false, message: "Invalid card selection" };
            }
        }
        
        const cards = cardIndices.map(index => hand[index]);
        console.log(`Selected cards:`, cards.map(c => `${c.rank}${c.suit}`));

        if (!this.validateMeld(cards, meldType)) {
            console.log(`Meld validation failed for ${meldType}`);
            return { success: false, message: `Invalid ${meldType}` };
        }

        const sortedIndices = [...cardIndices].sort((a, b) => b - a);
        console.log(`Removing cards at indices:`, sortedIndices);
        
        sortedIndices.forEach(index => {
            hand.splice(index, 1);
        });

        this.playerMelds.get(playerName).push({ type: meldType, cards });
        
        console.log(`${playerName} successfully made ${meldType}, hand now has ${hand.length} cards`);
        console.log(`Player now has ${this.playerMelds.get(playerName).length} melds`);

        if (hand.length === 0) {
            const validation = this.validatePlayerMeetsRoundRequirements(playerName);
            
            if (!validation.meetsRequirements) {
                console.log(`${playerName} melded all cards but doesn't meet round requirements`);
                return { 
                    success: false, 
                    message: `You've melded all cards but don't meet round requirements: ${ROUND_REQUIREMENTS[this.currentRound - 1].melds}` 
                };
            }
            
            console.log(`${playerName} went out by melding their last cards and meets requirements!`);
            const roundResult = this.endRound(playerName);
            return { success: true, meld: { type: meldType, cards }, roundEnded: true, roundResult };
        }
        
        return { success: true, meld: { type: meldType, cards } };
    }

    endRound(winner) {
        console.log(`=== ENDING ROUND ${this.currentRound} ===`);
        console.log(`Winner: ${winner}`);
        
        this.players.forEach(player => {
            let roundScore = 0;
            const hand = this.playerHands.get(player);
            
            if (player !== winner) {
                roundScore = hand.reduce((sum, card) => sum + card.getScoreValue(), 0);
                console.log(`${player} has ${hand.length} cards worth ${roundScore} points`);
            } else {
                console.log(`${winner} went out with 0 points`);
            }

            const scores = this.playerScores.get(player);
            scores[this.currentRound - 1] = roundScore;
        });

        if (this.currentRound >= 7) {
            console.log("🎉 GAME COMPLETE AFTER 7 ROUNDS! 🎉");
            const finalResults = this.endGame();
            return { gameEnded: true, finalResults };
        } else {
            console.log(`Moving to round ${this.currentRound + 1}`);
            this.currentRound++;
            this.dealRound();
            return { gameEnded: false, newRound: this.currentRound };
        }
    }

    endGame() {
        console.log(`=== ENDING GAME ===`);
        
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
                scores: [...scores],
                isAI: this.aiPlayers.has(player)
            });
            
            console.log(`${player} final score: ${total} (won ${roundsWon} rounds) ${this.aiPlayers.has(player) ? '[AI]' : '[Human]'}`);
        });
        
        const sortedPlayers = Array.from(finalScores.entries()).sort((a, b) => a[1] - b[1]);
        const winner = sortedPlayers[0][0];
        const winnerScore = sortedPlayers[0][1];
        
        console.log(`🏆 GAME WINNER: ${winner} with ${winnerScore} points! 🏆`);
        
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
            ),
            aiPlayers: Array.from(this.aiPlayers.keys()) // Send list of AI players to client
        };
    }
}

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinGame', (data) => {
        const { playerName, gameCode, aiCount } = data;
        
        if (!playerName) {
            socket.emit('error', { message: 'Player name required' });
            return;
        }

        let game;
        let finalGameCode = gameCode;

        if (gameCode && games.has(gameCode)) {
            game = games.get(gameCode);
            if (game.gameStarted) {
                socket.emit('error', { message: 'Game already started' });
                return;
            }
        } else {
            finalGameCode = generateGameCode();
            const aiPlayerCount = aiCount || 0;
            game = new Game(finalGameCode, playerName, aiPlayerCount);
            games.set(finalGameCode, game);
            console.log(`Created new game ${finalGameCode} with ${aiPlayerCount} AI players`);
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
            isHost: playerName === game.hostName,
            aiPlayers: Array.from(game.aiPlayers.keys())
        });

        console.log(`${playerName} joined game ${finalGameCode}`);
    });

    socket.on('startGame', () => {
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
            if (!game.aiPlayers.has(playerName)) { // Only send to human players
                const playerSocket = io.sockets.sockets.get(playerSockets.get(playerName));
                if (playerSocket) {
                    playerSocket.emit('gameStarted', game.getGameState(playerName));
                }
            }
        });

        console.log(`Game ${socket.gameCode} started`);
    });

    socket.on('drawCard', () => {
        console.log(`${socket.playerName} attempting to draw card`);
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('Game not found');
            return;
        }

        const result = game.drawCard(socket.playerName);
        console.log('Draw result:', result);
        
        if (result.success) {
            game.broadcastGameUpdate();
            game.broadcastMessage(`${socket.playerName} drew a card`);
        } else {
            socket.emit('error', result);
        }
    });

    socket.on('pickUpDiscard', () => {
        console.log(`${socket.playerName} attempting to pick up discard`);
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('Game not found');
            return;
        }

        const result = game.pickUpDiscard(socket.playerName);
        console.log('Pick up discard result:', result);
        
        if (result.success) {
            game.broadcastGameUpdate();
            game.broadcastMessage(`${socket.playerName} picked up the ${result.card.display} from discard pile`);
        } else {
            console.log('Pick up discard failed:', result.message);
            socket.emit('error', result);
        }
    });

    socket.on('buyCard', () => {
        console.log(`${socket.playerName} attempting to buy card`);
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('Game not found');
            return;
        }

        const result = game.buyCard(socket.playerName);
        console.log('Buy card result:', result);
        
        if (result.success) {
            game.broadcastGameUpdate();
            game.broadcastMessage(`${socket.playerName} bought the ${result.discardCard.display} and drew a penalty card`);
        } else {
            console.log('Buy card failed:', result.message);
            socket.emit('error', result);
        }
    });

    // NEW: Lay-off event handler
    socket.on('layOffCard', (data) => {
        console.log(`=== LAY OFF CARD EVENT ===`);
        console.log(`Player: ${socket.playerName}`);
        console.log(`Data received:`, data);
        
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('❌ Game not found for code:', socket.gameCode);
            return;
        }

        const result = game.layOffCard(socket.playerName, data.cardIndex, data.targetPlayer, data.meldIndex);
        console.log('Lay-off result:', result);
        
        if (result.success) {
            console.log(`✅ Lay-off successful, updating all players...`);
            
            game.broadcastGameUpdate();
            game.broadcastMessage(`${socket.playerName} laid off ${result.card.display} to ${data.targetPlayer}'s meld`);

            if (result.roundEnded) {
                console.log(`🎉 Round ended! ${socket.playerName} went out by laying off!`);
                game.handleRoundEnd(result.roundResult);
            }
        } else {
            console.log('❌ Lay-off failed:', result.message);
            socket.emit('error', result);
        }
        
        console.log(`=== END LAY OFF EVENT ===`);
    });

    socket.on('discardCard', (data) => {
        console.log(`=== DISCARD CARD EVENT ===`);
        console.log(`Player: ${socket.playerName}`);
        console.log(`Data received:`, data);
        
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('❌ Game not found for code:', socket.gameCode);
            return;
        }

        const result = game.discardCard(socket.playerName, data.cardIndex);
        console.log('Discard result:', result);
        
        if (result.success) {
            console.log(`✅ Discard successful, updating all players...`);
            
            game.broadcastGameUpdate();
            game.broadcastMessage(`${socket.playerName} discarded ${result.card.display}`);

            if (result.roundEnded) {
                console.log(`🎉 Round ended! ${socket.playerName} went out!`);
                game.handleRoundEnd(result.roundResult);
            }
        } else {
            console.log('❌ Discard failed:', result.message);
            socket.emit('error', result);
        }
        
        console.log(`=== END DISCARD EVENT ===`);
    });

    socket.on('makeMeld', (data) => {
        console.log(`=== MAKE MELD EVENT ===`);
        console.log(`Player: ${socket.playerName}`);
        console.log(`Meld type: ${data.meldType}`);
        console.log(`Card indices: ${data.cardIndices}`);
        
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('❌ Game not found');
            return;
        }

        const result = game.makeMeld(socket.playerName, data.cardIndices, data.meldType);
        console.log('Make meld result:', result);
        
        if (result.success) {
            console.log(`✅ Meld successful, updating all players...`);
            
            if (result.roundEnded) {
                console.log(`🎉 ${socket.playerName} went out by melding their last cards!`);
                
                game.broadcastMessage(`${socket.playerName} made a ${data.meldType} with ${result.meld.cards.length} cards`);
                game.handleRoundEnd(result.roundResult);
            } else {
                game.broadcastGameUpdate();
                game.broadcastMessage(`${socket.playerName} made a ${data.meldType} with ${result.meld.cards.length} cards`);
            }
        } else {
            console.log('❌ Make meld failed:', result.message);
            socket.emit('error', result);
        }
        
        console.log(`=== END MAKE MELD EVENT ===`);
    });

    // Card reordering event handler
    socket.on('reorderCards', (data) => {
        console.log(`${socket.playerName} reordering cards:`, data.cardOrder);
        const game = games.get(socket.gameCode);
        if (!game) {
            console.log('Game not found');
            return;
        }

        if (socket.playerName) {
            const hand = game.playerHands.get(socket.playerName);
            if (hand && data.cardOrder && data.cardOrder.length === hand.length) {
                const validOrder = data.cardOrder.every((index, pos) => 
                    Number.isInteger(index) && index >= 0 && index < hand.length
                );
                
                const uniqueIndices = new Set(data.cardOrder);
                if (validOrder && uniqueIndices.size === hand.length) {
                    const reorderedHand = data.cardOrder.map(index => hand[index]);
                    game.playerHands.set(socket.playerName, reorderedHand);
                    
                    console.log(`${socket.playerName} hand reordered successfully`);
                    
                    const gameState = game.getGameState(socket.playerName);
                    socket.emit('gameUpdate', gameState);
                } else {
                    console.log(`Invalid card order from ${socket.playerName}:`, data.cardOrder);
                    socket.emit('error', { message: 'Invalid card order' });
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        if (socket.playerName && socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game && !game.aiPlayers.has(socket.playerName)) {
                game.removePlayer(socket.playerName);
                playerSockets.delete(socket.playerName);
                
                io.to(socket.gameCode).emit('playerLeft', {
                    players: game.players,
                    playerName: socket.playerName
                });

                if (game.players.filter(p => !game.aiPlayers.has(p)).length === 0) {
                    games.delete(socket.gameCode);
                    console.log(`Game ${socket.gameCode} deleted - no human players remaining`);
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Slattery Shanghai server running on port ${PORT}`);
    console.log(`Game available at: http://localhost:${PORT}`);
    console.log(`For network access, use your computer's IP address`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down Slattery Shanghai server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
