<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Slattery Shanghai - Enhanced Edition</title>
    <meta name="description" content="Enhanced Shanghai Rummy card game with AI players">
    <link rel="preconnect" href="https://cdn.socket.io">
    <style>
        :root {
            --gold: #ffd700;
            --blue: #2a5298;
            --green: #4caf50;
            --red: #f44336;
            --orange: #ff9800;
            --purple: #9c27b0;
            --ai-blue: #90caf9;
            --bg-glass: rgba(255,255,255,0.15);
            --border-radius: 8px;
            --transition: all 0.3s ease;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            min-height: 100vh;
            padding: 20px;
        }
        
        /* Optimized animations - use GPU acceleration */
        .fade-in {
            animation: fadeIn 0.5s ease-out;
        }
        
        .slide-in {
            animation: slideIn 0.5s ease-out;
        }
        
        .pulse {
            animation: pulse 1.5s infinite;
        }
        
        .glow {
            animation: glow 2s infinite;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translate3d(0, -20px, 0); }
            to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale3d(1, 1, 1); }
            50% { transform: scale3d(1.05, 1.05, 1.05); }
        }
        
        @keyframes glow {
            0%, 100% { box-shadow: 0 0 10px currentColor; }
            50% { box-shadow: 0 0 20px currentColor; }
        }
        
        /* Optimized button styles - consolidated classes */
        .btn {
            padding: 12px;
            margin: 10px 0;
            font-size: 16px;
            border: none;
            border-radius: var(--border-radius);
            color: white;
            cursor: pointer;
            font-weight: 600;
            text-transform: uppercase;
            transition: var(--transition);
            position: relative;
            overflow: hidden;
            will-change: transform;
            -webkit-tap-highlight-color: transparent;
        }
        
        .btn:hover:not(:disabled) {
            transform: translate3d(0, -2px, 0);
            box-shadow: 0 8px 15px rgba(0,0,0,0.3);
        }
        
        .btn:active {
            transform: translate3d(0, 0, 0);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            pointer-events: none;
        }
        
        .btn-primary { background: linear-gradient(45deg, var(--green), #45a049); }
        .btn-secondary { background: linear-gradient(45deg, var(--orange), #f57c00); }
        .btn-danger { background: linear-gradient(45deg, var(--red), #da190b); }
        .btn-layoff { background: linear-gradient(45deg, var(--purple), #7b1fa2); }
        
        /* Optimized card styles with better performance */
        .card {
            width: 60px;
            height: 84px;
            background: white;
            border-radius: var(--border-radius);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 5px;
            cursor: pointer;
            border: 2px solid transparent;
            font-size: 12px;
            font-weight: bold;
            transition: var(--transition);
            user-select: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            will-change: transform;
            backface-visibility: hidden;
        }
        
        .card:hover {
            transform: translate3d(0, -3px, 0) scale3d(1.05, 1.05, 1.05);
            box-shadow: 0 8px 15px rgba(0,0,0,0.4);
            z-index: 10;
        }
        
        .card.selected {
            border-color: var(--gold);
        }
        
        .card.selected {
            animation: pulse 1.5s infinite;
        }
        
        .card.wanted {
            border-color: var(--gold);
            animation: glow 2s infinite;
        }
        
        .card.red { color: #d32f2f; }
        .card.black { color: #1976d2; }
        
        /* Optimized layout and dialog styles */
        .dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            padding: 25px;
            border-radius: 15px;
            border: 3px solid var(--gold);
            color: white;
            text-align: center;
            z-index: 1000;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
            min-width: 300px;
        }
        
        .section {
            background: var(--bg-glass);
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            margin-bottom: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5rem;
            color: var(--gold);
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .game-board {
            display: none;
            grid-template-columns: 1fr 300px;
            gap: 20px;
        }
        
        /* Optimized interactive elements */
        .pile {
            width: 80px;
            height: 112px;
            background: rgba(255,255,255,0.1);
            border: 3px dashed rgba(255,255,255,0.4);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: var(--transition);
            will-change: transform;
        }
        
        .pile:hover {
            background: rgba(255,255,255,0.2);
            border-color: var(--gold);
            transform: scale3d(1.1, 1.1, 1.1);
        }
        
        .cards-container {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 10px;
            min-height: 90px;
        }
        
        .meld-display {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 8px 0;
            padding: 10px;
            background: rgba(255,255,255,0.1);
            border-radius: var(--border-radius);
            border: 1px solid rgba(255,255,255,0.2);
            transition: var(--transition);
        }
        
        .player-section {
            margin-bottom: 15px;
            padding: 12px;
            background: rgba(255,255,255,0.08);
            border-radius: 8px;
            border-left: 3px solid var(--green);
        }
        
        .player-section.current {
            border-left-color: var(--gold);
            background: rgba(255,215,0,0.1);
        }
        
        .player-section.ai {
            border-left-color: var(--ai-blue);
            background: rgba(144,202,249,0.1);
        }
        
        .notification {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 20px 30px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            z-index: 1000;
            animation: slideIn 0.5s;
        }
        
        .notification.success { background: var(--green); }
        .notification.error { background: var(--red); }
        .notification.info { background: var(--blue); }
        
        .sound-control {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0,0,0,0.8);
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50px;
            padding: 10px;
            cursor: pointer;
            z-index: 200;
            transition: all 0.3s;
        }
        
        .sound-control:hover {
            background: rgba(0,0,0,0.9);
            border-color: var(--gold);
            transform: scale(1.1);
        }
        
        .messages {
            background: rgba(0,0,0,0.3);
            padding: 15px;
            border-radius: 8px;
            height: 200px;
            overflow-y: auto;
            margin: 15px 0;
        }
        
        input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            background: rgba(255,255,255,0.95);
        }
        
        @media (max-width: 768px) {
            .game-board { grid-template-columns: 1fr; }
            .card { width: 50px; height: 70px; font-size: 10px; }
        }
    </style>
</head>
<body>
    <div class="sound-control" onclick="game.toggleSound()">
        <span id="soundIcon">🔊</span>
    </div>
    
    <div class="container">
        <div class="header">
            <h1>Slattery Shanghai</h1>
            <p>Enhanced Family Card Game - 7 Rounds Edition</p>
        </div>
        
        <div id="gameSetup" class="section">
            <h2>Join Game</h2>
            <div id="connectionStatus">Status: Not connected</div>
            <input type="text" id="playerName" placeholder="Your name" maxlength="20">
            <input type="text" id="gameCode" placeholder="Game code (optional)" maxlength="10">
            <div class="section">
                <h4>🤖 AI Players</h4>
                <label>Number of AI players:</label>
                <input type="number" id="aiCount" min="0" max="6" value="3" style="width: 80px;">
            </div>
            <button class="btn btn-primary" onclick="game.connect()">Connect to Server</button>
            <button class="btn btn-primary" id="joinBtn" onclick="game.joinGame()" disabled>Join Game</button>
            <div id="waitingArea" style="display: none;">
                <h3>Waiting for Players...</h3>
                <div>Game Code: <span id="displayCode">-</span></div>
                <div>Players: <span id="playerCount">0</span></div>
                <div id="currentPlayers"></div>
                <button class="btn btn-primary" id="startBtn" onclick="game.startGame()" style="display: none;">Start Game</button>
            </div>
        </div>
        
        <div id="gameBoard" class="game-board">
            <div class="section">
                <div class="section">
                    <h3>Round <span id="currentRound">1</span> of 7</h3>
                    <div>Required: <span id="requiredMelds">-</span></div>
                </div>
                
                <div style="display: flex; justify-content: center; gap: 20px; margin: 20px 0;">
                    <div class="pile" onclick="game.drawCard()">
                        <div>🂠<br><small>Draw</small></div>
                    </div>
                    <div class="pile" onclick="game.pickUpDiscard()">
                        <div id="discardDisplay">No Card<br><small>Pick Up</small></div>
                    </div>
                </div>
                
                <div class="section">
                    <h4>Players' Melds</h4>
                    <div id="allPlayerMelds">No melds yet</div>
                </div>
                
                <div class="section">
                    <h4>Your Hand (<span id="handCount">0</span> cards)</h4>
                    <div id="playerHand" class="cards-container"></div>
                </div>
                
                <div class="section">
                    <h4>Your Melds</h4>
                    <div id="playerMelds">No melds yet</div>
                </div>
                
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="game.makeSet()" id="setBtn">Make Set</button>
                    <button class="btn btn-primary" onclick="game.makeRun()" id="runBtn">Make Run</button>
                    <button class="btn btn-layoff" onclick="game.toggleLayoff()" id="layoffBtn">Lay Off</button>
                    <button class="btn btn-danger" onclick="game.discardCard()" id="discardBtn">Discard</button>
                </div>
                
                <div style="margin-top: 10px;">
                    <button class="btn btn-secondary" onclick="game.sortBySuit()">Sort by Suit</button>
                    <button class="btn btn-secondary" onclick="game.sortByRank()">Sort by Rank</button>
                </div>
            </div>
            
            <div class="section">
                <div id="playersList"></div>
                <div class="messages" id="messages"></div>
                <div id="scoresTable"></div>
            </div>
        </div>
    </div>
    
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script>
        // High-performance game controller with optimizations
        const game = {
            // Centralized state management
            state: {
                socket: null,
                myName: '',
                gameCode: '',
                players: [],
                currentPlayer: '',
                round: 1,
                hand: [],
                melds: [],
                selectedCards: new Set(), // Use Set for better performance
                isMyTurn: false,
                hasDrawn: false,
                hasGoneDown: false,
                layoffMode: false,
                soundEnabled: true,
                cardOrder: [],
                lastUpdate: 0 // Throttle updates
            },
            
            // Audio context with lazy initialization
            audioCtx: null,
            soundCache: new Map(), // Cache sound objects
            
            // Throttle function for performance
            throttle(func, delay) {
                let timeoutId;
                let lastExecTime = 0;
                
                return function (...args) {
                    const currentTime = Date.now();
                    
                    if (currentTime - lastExecTime > delay) {
                        func.apply(this, args);
                        lastExecTime = currentTime;
                    } else {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => {
                            func.apply(this, args);
                            lastExecTime = Date.now();
                        }, delay - (currentTime - lastExecTime));
                    }
                };
            },
            
            // Optimized audio initialization
            initAudio() {
                if (!this.audioCtx) {
                    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                
                // Resume context if suspended (for mobile browsers)
                if (this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
            },
            
            // Optimized sound generation with caching
            playSound(type) {
                if (!this.state.soundEnabled) return;
                
                this.initAudio();
                
                // Check cache first
                if (this.soundCache.has(type)) {
                    const cachedSound = this.soundCache.get(type);
                    cachedSound.currentTime = 0;
                    cachedSound.play().catch(() => {}); // Ignore play errors
                    return;
                }
                
                const oscillator = this.audioCtx.createOscillator();
                const gainNode = this.audioCtx.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(this.audioCtx.destination);
                
                const sounds = {
                    click: { freq: 800, dur: 0.1 },
                    success: { freq: 1000, dur: 0.2 },
                    error: { freq: 200, dur: 0.3 }
                };
                
                const sound = sounds[type] || sounds.click;
                oscillator.frequency.value = sound.freq;
                gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + sound.dur);
                
                oscillator.start();
                oscillator.stop(this.audioCtx.currentTime + sound.dur);
            },
            
            // Toggle sound
            toggleSound() {
                this.state.soundEnabled = !this.state.soundEnabled;
                document.getElementById('soundIcon').textContent = this.state.soundEnabled ? '🔊' : '🔇';
                if (this.state.soundEnabled) this.playSound('click');
            },
            
            // Show notification
            notify(message, type = 'info') {
                const notif = document.createElement('div');
                notif.className = `notification ${type}`;
                notif.textContent = message;
                document.body.appendChild(notif);
                
                this.playSound(type === 'error' ? 'error' : 'success');
                
                setTimeout(() => {
                    notif.style.opacity = '0';
                    setTimeout(() => notif.remove(), 300);
                }, 2500);
            },
            
            // Add message to chat
            addMessage(text) {
                const messages = document.getElementById('messages');
                if (!messages) return;
                
                const msg = document.createElement('div');
                msg.textContent = `${new Date().toLocaleTimeString()}: ${text}`;
                messages.appendChild(msg);
                messages.scrollTop = messages.scrollHeight;
                
                // Keep only last 50 messages
                while (messages.children.length > 50) {
                    messages.firstChild.remove();
                }
            },
            
            // Connect to server
            connect() {
                this.addMessage("Connecting to server...");
                
                if (this.state.socket) {
                    this.state.socket.disconnect();
                }
                
                this.state.socket = io({
                    transports: ['websocket', 'polling'],
                    timeout: 5000
                });
                
                this.setupSocketHandlers();
            },
            
            // Setup socket event handlers
            setupSocketHandlers() {
                const socket = this.state.socket;
                
                socket.on('connect', () => {
                    this.addMessage("✅ Connected!");
                    document.getElementById('connectionStatus').textContent = "Status: Connected";
                    document.getElementById('joinBtn').disabled = false;
                    this.notify("Connected to server!", "success");
                });
                
                socket.on('disconnect', () => {
                    this.addMessage("❌ Disconnected");
                    document.getElementById('connectionStatus').textContent = "Status: Disconnected";
                    document.getElementById('joinBtn').disabled = true;
                    this.notify("Disconnected", "error");
                });
                
                socket.on('playerJoined', (data) => {
                    this.handlePlayerJoined(data);
                });
                
                socket.on('gameStarted', (data) => {
                    this.handleGameStarted(data);
                });
                
                socket.on('gameUpdate', (data) => {
                    this.updateGameState(data);
                });
                
                socket.on('gameMessage', (data) => {
                    this.addMessage(data.message);
                    if (data.message.includes('won')) this.playSound('success');
                });
                
                socket.on('error', (data) => {
                    this.notify(data.message, "error");
                });
            },
            
            // Handle player joined
            handlePlayerJoined(data) {
                this.state.gameCode = data.gameCode;
                this.state.players = data.players;
                
                document.getElementById('displayCode').textContent = data.gameCode;
                document.getElementById('playerCount').textContent = data.players.length;
                document.getElementById('waitingArea').style.display = 'block';
                
                const playersDiv = document.getElementById('currentPlayers');
                playersDiv.innerHTML = '<h4>Players:</h4>';
                data.players.forEach(player => {
                    const div = document.createElement('div');
                    div.textContent = player + (data.aiPlayers?.includes(player) ? ' 🤖' : '');
                    playersDiv.appendChild(div);
                });
                
                if (data.isHost) {
                    document.getElementById('startBtn').style.display = 'block';
                }
            },
            
            // Handle game started
            handleGameStarted(data) {
                this.addMessage("🎮 Game started!");
                this.notify("Game Started!", "success");
                this.updateGameState(data);
                document.getElementById('gameSetup').style.display = 'none';
                document.getElementById('gameBoard').style.display = 'grid';
            },
            
            // Update game state
            updateGameState(data) {
                Object.assign(this.state, data);
                if (data.hand) {
                    this.state.cardOrder = data.hand.map((_, i) => i);
                }
                this.throttledUpdateUI();
            },
            
            // Throttled UI update for better performance
            throttledUpdateUI: null, // Will be set in constructor
            
            // Optimized UI update with minimal DOM manipulation
            updateUI() {
                const now = Date.now();
                if (now - this.state.lastUpdate < 16) return; // 60fps limit
                this.state.lastUpdate = now;
                
                requestAnimationFrame(() => {
                    this.updateHand();
                    this.updatePlayers();
                    this.updateMelds();
                    this.updateButtons();
                    this.updateGameInfo();
                });
            },
            
            // Separate game info update to reduce DOM queries
            updateGameInfo() {
                const roundEl = document.getElementById('currentRound');
                const handCountEl = document.getElementById('handCount');
                const discardEl = document.getElementById('discardDisplay');
                
                if (roundEl) roundEl.textContent = this.state.round || 1;
                if (handCountEl) handCountEl.textContent = this.state.hand?.length || 0;
                
                if (discardEl) {
                    if (this.state.discardTop) {
                        const color = this.state.discardTop.color === 'red' ? '#d32f2f' : '#1976d2';
                        discardEl.innerHTML = 
                            `<span style="color: ${color}; font-weight: bold;">${this.state.discardTop.display}</span><br><small>Pick Up</small>`;
                    } else {
                        discardEl.innerHTML = 'No Card<br><small>Pick Up</small>';
                    }
                }
            },
            
            // Optimized hand display with virtual scrolling for large hands
            updateHand() {
                const container = document.getElementById('playerHand');
                if (!container) return;
                
                // Use DocumentFragment for better performance
                const fragment = document.createDocumentFragment();
                
                this.state.cardOrder.forEach(idx => {
                    if (idx >= this.state.hand.length) return;
                    
                    const card = this.state.hand[idx];
                    const cardEl = document.createElement('div');
                    cardEl.className = `card ${card.color}`;
                    
                    // Use Set for faster lookup
                    if (this.state.selectedCards.has(idx)) {
                        cardEl.classList.add('selected');
                    }
                    
                    cardEl.innerHTML = `<div>${card.display}</div><div style="transform: rotate(180deg)">${card.display}</div>`;
                    
                    // Use arrow function to maintain context
                    cardEl.onclick = () => this.toggleCard(idx);
                    
                    fragment.appendChild(cardEl);
                });
                
                // Single DOM update
                container.innerHTML = '';
                container.appendChild(fragment);
            },
            
            // Optimized players display with minimal DOM updates
            updatePlayers() {
                const container = document.getElementById('playersList');
                if (!container) return;
                
                const fragment = document.createDocumentFragment();
                const header = document.createElement('h4');
                header.textContent = 'Players';
                fragment.appendChild(header);
                
                this.state.players?.forEach(player => {
                    const div = document.createElement('div');
                    div.className = 'player-section';
                    if (player === this.state.currentPlayer) div.classList.add('current');
                    div.textContent = player + (player === this.state.currentPlayer ? ' 👑' : '');
                    fragment.appendChild(div);
                });
                
                container.innerHTML = '';
                container.appendChild(fragment);
            },
            
            // Update melds display
            updateMelds() {
                const container = document.getElementById('playerMelds');
                if (!container || !this.state.melds) return;
                
                if (this.state.melds.length === 0) {
                    container.innerHTML = 'No melds yet';
                    return;
                }
                
                container.innerHTML = '';
                this.state.melds.forEach(meld => {
                    const div = document.createElement('div');
                    div.className = 'meld-display';
                    div.innerHTML = `<strong>${meld.type}:</strong> ${meld.cards.map(c => 
                        `<span style="color: ${c.color === 'red' ? '#d32f2f' : '#1976d2'}">${c.display}</span>`
                    ).join(' ')}`;
                    container.appendChild(div);
                });
            },
            
            // Optimized button state management
            updateButtons() {
                const canAct = this.state.isMyTurn && !this.state.layoffMode;
                const selectedCount = this.state.selectedCards.size;
                
                document.getElementById('setBtn').disabled = !canAct || selectedCount < 3;
                document.getElementById('runBtn').disabled = !canAct || selectedCount < 4;
                document.getElementById('discardBtn').disabled = !canAct || !this.state.hasDrawn || selectedCount !== 1;
            },
            
            // Game actions
            joinGame() {
                const name = document.getElementById('playerName').value.trim();
                const code = document.getElementById('gameCode').value.trim();
                const aiCount = parseInt(document.getElementById('aiCount').value) || 0;
                
                if (!name) {
                    this.notify("Please enter your name", "error");
                    return;
                }
                
                this.state.myName = name;
                this.state.socket.emit('joinGame', { playerName: name, gameCode: code, aiCount });
            },
            
            startGame() {
                this.state.socket.emit('startGame');
            },
            
            // Optimized card selection using Set for O(1) operations
            toggleCard(index) {
                if (this.state.selectedCards.has(index)) {
                    this.state.selectedCards.delete(index);
                } else {
                    this.state.selectedCards.add(index);
                }
                this.playSound('click');
                this.throttledUpdateUI();
            },
            
            drawCard() {
                if (!this.state.isMyTurn || this.state.hasDrawn) return;
                this.state.socket.emit('drawCard');
                this.playSound('click');
            },
            
            pickUpDiscard() {
                if (!this.state.isMyTurn || this.state.hasDrawn) return;
                this.state.socket.emit('pickUpDiscard');
                this.playSound('click');
            },
            
            makeSet() {
                if (this.state.selectedCards.size < 3) return;
                this.state.socket.emit('makeMeld', { 
                    cardIndices: Array.from(this.state.selectedCards), 
                    meldType: 'set' 
                });
                this.state.selectedCards.clear();
            },
            
            makeRun() {
                if (this.state.selectedCards.size < 4) return;
                this.state.socket.emit('makeMeld', { 
                    cardIndices: Array.from(this.state.selectedCards), 
                    meldType: 'run' 
                });
                this.state.selectedCards.clear();
            },
            
            discardCard() {
                if (this.state.selectedCards.size !== 1) return;
                this.state.socket.emit('discardCard', { 
                    cardIndex: Array.from(this.state.selectedCards)[0] 
                });
                this.state.selectedCards.clear();
            },
            
            toggleLayoff() {
                this.state.layoffMode = !this.state.layoffMode;
                document.getElementById('layoffBtn').textContent = 
                    this.state.layoffMode ? 'Cancel Layoff' : 'Lay Off';
                this.updateUI();
            },
            
            sortBySuit() {
                const suitOrder = { 'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3 };
                const rankOrder = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
                
                this.state.cardOrder.sort((a, b) => {
                    const cardA = this.state.hand[a];
                    const cardB = this.state.hand[b];
                    const suitDiff = suitOrder[cardA.suit] - suitOrder[cardB.suit];
                    return suitDiff || rankOrder[cardA.rank] - rankOrder[cardB.rank];
                });
                
                this.updateHand();
                this.playSound('click');
            },
            
            sortByRank() {
                const rankOrder = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
                const suitOrder = { 'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3 };
                
                this.state.cardOrder.sort((a, b) => {
                    const cardA = this.state.hand[a];
                    const cardB = this.state.hand[b];
                    const rankDiff = rankOrder[cardA.rank] - rankOrder[cardB.rank];
                    return rankDiff || suitOrder[cardA.suit] - suitOrder[cardB.suit];
                });
                
                this.updateHand();
                this.playSound('click');
            }
        };
        
        // Initialize optimizations and event handlers
        window.addEventListener('load', () => {
            // Initialize throttled functions
            game.throttledUpdateUI = game.throttle(game.updateUI.bind(game), 16); // 60fps
            
            // Preload audio context on first user interaction
            document.addEventListener('click', () => {
                game.initAudio();
            }, { once: true });
            
            // Add performance monitoring
            if (window.performance && performance.mark) {
                performance.mark('game-start');
            }
            
            game.addMessage('Welcome to Slattery Shanghai!');
            game.addMessage('Click "Connect to Server" to begin');
        });
        
        // Add visibility API for performance when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Pause expensive operations when tab is hidden
                game.state.soundEnabled = false;
            } else {
                // Resume when tab is visible
                game.state.soundEnabled = true;
            }
        });
    </script>
</body>
</html>
