        // Import role definitions
        import { ROLE_COUNTS, ROLES, EMBEDDED_SCRIPTS } from './roleDefinitions.js';
        
        // PubNub Configuration - Replace with your keys
        const PUBNUB_PUBLISH_KEY = 'demo';
        const PUBNUB_SUBSCRIBE_KEY = 'demo';

        let pubnub;
        let currentUser = '';
        let currentRoom = '';
        let userType = '';
        let players = [];
        let isConnected = false;
        let currentTemplate = null;
        let sentMessages = new Map(); // Track messages we've sent locally
        let mostRecentSetupTimestamp = 0;
        let playerRoles = {}; // Track role assignments
        let selectedPlayerForRole = null;
        let currentGameId = null;
        let playerReminders = {}; // Track reminders for each player
        let playerDeathState = {}; // Track alive/dead status for each player
        let playerGhostVotes = {}; // Track ghost vote tokens for each player
        let isNightTime = true; // Game starts at night
        let dayNightCounter = 1; // Game starts on night 1

        // Track storyteller workflow state
        let storytellerWorkflowState = 'distribute_roles'; // 'distribute_roles', 'minion_demon_info', 'night_action'





        let currentScript = null;

        let gameMode = 'new'; // 'new' or 'reconnect'
        let selectedRoles = []; // Roles selected for the current game
        let targetDistribution = {}; // Target role distribution

        function generateGameId(roomId) {
            // Extract room name and increment counter
            const baseRoom = roomId.replace(/_game\d+$/, ''); // Remove existing game suffix

            // For new games, we'll increment. For now, just generate based on timestamp
            // This could be made more sophisticated with history parsing if needed
            const gameNumber = Math.floor(Date.now() / 1000) % 10000; // Simple incrementing number
            return `${baseRoom}_game${gameNumber}`;
        }

        function extractLatestGameId(roomId, messageHistory) {
            // Look through message history to find the highest game number
            let maxGameNumber = 0;
            const baseRoom = roomId.replace(/_game\d+$/, '');

            messageHistory.forEach(msg => {
                if (msg.gameId && msg.gameId.startsWith(baseRoom + '_game')) {
                    const gameNum = parseInt(msg.gameId.split('_game')[1]) || 0;
                    maxGameNumber = Math.max(maxGameNumber, gameNum);
                }
            });

            return `${baseRoom}_game${maxGameNumber + 1}`;
        }

      function selectGameMode(mode) {
            gameMode = mode;
            const newBtn = document.getElementById('newGameBtn');
            const reconnectBtn = document.getElementById('reconnectBtn');
            const generateBtn = document.getElementById('generateRoomBtn');
            const newGameFields = document.getElementById('newGameFields');
            const playerNamesField = document.getElementById('playerNamesField');
            const joinBtn = document.getElementById('joinGameBtn');

            if (mode === 'new') {
                newBtn.style.background = 'linear-gradient(45deg, #ff6b6b, #ee5a24)';
                reconnectBtn.style.background = '#666';
                generateBtn.style.display = 'inline-block';
                newGameFields.style.display = 'block';
                playerNamesField.style.display = 'block';
                joinBtn.textContent = 'Start Game';
            } else {
                newBtn.style.background = '#666';
                reconnectBtn.style.background = 'linear-gradient(45deg, #ff6b6b, #ee5a24)';
                generateBtn.style.display = 'none';
                newGameFields.style.display = 'none';
                playerNamesField.style.display = 'none';
                joinBtn.textContent = 'Rejoin Game';
            }
            
            updateURL();
        }

        // Initialize user type selection and populate scripts
        document.getElementById('userType').addEventListener('change', function() {
            const storytellerSetup = document.getElementById('storytellerSetup');
            const playerSetup = document.getElementById('playerSetup');

            if (this.value === 'storyteller') {
                storytellerSetup.classList.remove('hidden');
                playerSetup.classList.add('hidden');
            } else {
                storytellerSetup.classList.add('hidden');
                playerSetup.classList.remove('hidden');
            }
        });

        // Update URL when player selects their name
        document.getElementById('playerName').addEventListener('change', function() {
            if (this.value) {
                currentUser = this.value;
                updateURL();
            }
        });

        // Populate script dropdown
        function populateScriptDropdown() {
            const scriptSelect = document.getElementById('scriptSelect');
            scriptSelect.innerHTML = '<option value="">Select a script...</option>';

            Object.values(EMBEDDED_SCRIPTS).forEach(script => {
                const option = document.createElement('option');
                option.value = script.id;
                option.textContent = script.name;
                scriptSelect.appendChild(option);
            });
        }

        function generateRoomId() {
            const roomId = 'botc_' + Math.random().toString(36).substr(2, 8);
            document.getElementById('gameRoom').value = roomId;
        }

        function checkRoom() {
            const roomId = document.getElementById('gameRoomPlayer').value.trim();
            if (!roomId) {
                alert('Please enter a room ID');
                return;
            }

            // Simple room check - create temporary connection
            const tempPubNub = new PubNub({
                publishKey: PUBNUB_PUBLISH_KEY,
                subscribeKey: PUBNUB_SUBSCRIBE_KEY,
                userId: 'temp_' + Math.random().toString(36).substr(2, 8)
            });

            tempPubNub.addListener({
                message: function(messageEvent) {
                    if (messageEvent.message.type === 'game_setup') {
                        const setup = messageEvent.message;
                        populatePlayerNames(setup.players);
                        tempPubNub.unsubscribeAll();
                    }
                }
            });

            tempPubNub.subscribe({ channels: [roomId] });

            tempPubNub.publish({
                channel: roomId,
                message: { type: 'request_game_state', from: 'temp_player', timestamp: Date.now() }
            });

            setTimeout(() => {
                if (document.getElementById('playerNameSection').classList.contains('hidden')) {
                    showRoomStatus('Room not found or no Storyteller online.', 'error');
                    tempPubNub.unsubscribeAll();
                }
            }, 3000);
        }

        function populatePlayerNames(playerList) {
            players = playerList;
            showRoomStatus(`Found game with ${playerList.length} players`, 'success');

            const playerSelect = document.getElementById('playerName');
            playerSelect.innerHTML = '<option value="">Select your name...</option>';
            playerList.forEach(player => {
                const option = document.createElement('option');
                option.value = player;
                option.textContent = player;
                playerSelect.appendChild(option);
            });

            document.getElementById('playerNameSection').classList.remove('hidden');
        }

        function showRoomStatus(message, type) {
            const statusEl = document.getElementById('roomStatus');
            statusEl.textContent = message;
            statusEl.className = type === 'success' ? 'status connected' : 'status disconnected';
            statusEl.classList.remove('hidden');
        }

        function joinGame() {
            userType = document.getElementById('userType').value;

            if (userType === 'storyteller') {
                currentRoom = document.getElementById('gameRoom').value.trim();

                if (!currentRoom) {
                    alert('Please enter a room ID');
                    return;
                }

                if (gameMode === 'new') {
                    const scriptId = document.getElementById('scriptSelect').value;
                    console.log('scriptId:', scriptId);
                    console.log('EMBEDDED_SCRIPTS[scriptId]:', EMBEDDED_SCRIPTS[scriptId]);

                    if (!scriptId) {
                        alert('Please select a script');
                        return;
                    }

                    const playerNamesText = document.getElementById('playerNames').value.trim();
                    if (!playerNamesText) {
                        alert('Please enter player names');
                        return;
                    }

                    // Load the selected script
                    currentScript = EMBEDDED_SCRIPTS[scriptId];
                    players = playerNamesText.split('\n').map(name => name.trim()).filter(name => name);

                    // Calculate target distribution
                    const playerCount = players.length;
                    if (ROLE_COUNTS[playerCount]) {
                        targetDistribution = ROLE_COUNTS[playerCount];
                        currentGameId = generateGameId(currentRoom);
                        showRoleSelectionScreen();
                        return; // Don't proceed to game yet
                    } else {
                        alert(`No setup defined for ${playerCount} players`);
                        return;
                    }

                    // Populate target player dropdown for new games
                    const targetSelect = document.getElementById('targetPlayer');
                    targetSelect.innerHTML = '<option value="">Select player...</option>';
                    const orderedPlayers = getOrderedPlayersForNight();
                    orderedPlayers.forEach(player => {
                        if (player === '-----') {
                            const separator = document.createElement('option');
                            separator.value = '';
                            separator.textContent = '-----';
                            separator.disabled = true;
                            targetSelect.appendChild(separator);
                        } else {
                            const option = document.createElement('option');
                            option.value = player;
                            option.textContent = player;
                            targetSelect.appendChild(option);
                        }
                    });
                }

                currentUser = 'Storyteller';
            } else {
                currentRoom = document.getElementById('gameRoomPlayer').value.trim();
                currentUser = document.getElementById('playerName').value;

                if (!currentRoom || !currentUser) {
                    alert('Please check the room and select your name first');
                    return;
                }

                // Players should NOT generate their own gameId - they'll adopt it  from setup messages.
                currentGameId = null;
            }

            initializePubNub();
            // If storyteller starting new game, mark current time to ignore older setups
            if (userType === 'storyteller' && gameMode === 'new') {
                mostRecentSetupTimestamp = Date.now();
            } else if (userType === 'storyteller' && gameMode === 'reconnect') {
                // For reconnect, we'll determine gameId from message history
                currentGameId = null; // Will be set when we process history
            }
            switchToGameScreen();
        }

        function initializePlayerRoles() {
            playerRoles = {};
            playerReminders = {};
            playerDeathState = {};
            playerGhostVotes = {};
            players.forEach(player => {
                playerRoles[player] = null;
                playerReminders[player] = [];
                playerDeathState[player] = 'alive'; // 'alive' or 'dead'
                playerGhostVotes[player] = true; // Default to having ghost vote
            });
        }

        function initializePubNub() {
            pubnub = new PubNub({
                publishKey: PUBNUB_PUBLISH_KEY,
                subscribeKey: PUBNUB_SUBSCRIBE_KEY,
                userId: currentUser
            });

            pubnub.subscribe({ channels: [currentRoom] });

            pubnub.addListener({
                message: function(messageEvent) {
                    handleIncomingMessage(messageEvent.message);
                },
                status: function(statusEvent) {
                    handleConnectionStatus(statusEvent);

                    // When successfully connected, fetch message history
                    if (statusEvent.category === 'PNConnectedCategory') {
                        fetchMessageHistory();

                        // If storyteller, send game setup immediately when connected
                        if (userType === 'storyteller') {
                            sendGameSetup();
                        }
                    }
                }
            });

        }

        function fetchMessageHistory() {
            // Fetch the last 100 messages (adjust count as needed)
            pubnub.history({
                channel: currentRoom,
                count: 100, // Max messages to fetch
                reverse: false // false = newest first, true = oldest first
            }).then((response) => {
                if (response.messages && response.messages.length > 0) {
                    // Process messages in chronological order (oldest first)
                    const messages = response.messages.reverse();

                    messages.forEach(messageWrapper => {
                        // PubNub history wraps messages in an object with timetoken
                        const message = messageWrapper.entry;
                        reconstructGameStateFromMessage(message);
                        handleIncomingMessage(message, true); // true = from history
                    });
                }
            }).catch((error) => {
                console.log('Error fetching message history:', error);
            });
        }

        function reconstructGameStateFromMessage(message) {
            // Only reconstruct for storytellers in reconnect mode
            if (userType !== 'storyteller' || gameMode !== 'reconnect') {
                return;
            }

            // Find the most recent game_setup message to establish current game
            if (message.type === 'game_setup' && message.gameId) {
                if (!currentGameId || message.timestamp > mostRecentSetupTimestamp) {
                    currentGameId = message.gameId;
                    mostRecentSetupTimestamp = message.timestamp;

                    // Reconstruct basic game state
                    if (message.players) {
                        players = message.players;
                    }
                    if (message.script) {
                        if (typeof message.script === 'string') {
                            currentScript = Object.values(EMBEDDED_SCRIPTS).find(s => s.name === message.script) ||
                                           EMBEDDED_SCRIPTS[message.script];
                        } else {
                            currentScript = message.script;
                        }
                    }
                    if (message.playerRoles) {
                        playerRoles = message.playerRoles;
                    }
                    if (message.playerReminders) {
                        playerReminders = message.playerReminders;
                    }
                }
            }

            if (message.type === 'seat_assignment' && message.gameId === currentGameId && message.players) {
                players = message.players;
            }

            // Update role assignments from more recent role_assignment messages
            if (message.type === 'role_assignment' && message.gameId === currentGameId && message.playerRoles) {
                playerRoles = { ...playerRoles, ...message.playerRoles };
            }

            // Update reminders from more recent reminder_update messages
            if (message.type === 'reminder_update' && message.gameId === currentGameId && message.playerReminders) {
                playerReminders = { ...playerReminders, ...message.playerReminders };
            }

            // Update death state from more recent death_update messages
            if (message.type === 'death_update' && message.gameId === currentGameId && message.playerDeathState) {
                playerDeathState = { ...playerDeathState, ...message.playerDeathState };
            }

            // Reconstruct phase state from daybreak/nightfall messages
            if ((message.type === 'daybreak' || message.type === 'nightfall') && message.gameId === currentGameId) {
                isNightTime = (message.type === 'nightfall');
            }
        }

        function handleConnectionStatus(statusEvent) {
            const gameIdEl = document.getElementById('displayGameId');

            if (statusEvent.category === 'PNConnectedCategory') {
                isConnected = true;
                if (gameIdEl) {
                    gameIdEl.style.color = '#26de81'; // Green when connected
                }
            } else if (statusEvent.category === 'PNNetworkDownCategory') {
                isConnected = false;
                if (gameIdEl) {
                    gameIdEl.style.color = '#ff6b6b'; // Red when disconnected
                }
            }

            // After connection is established and history is processed, update UI for reconnecting storytellers
            if (statusEvent.category === 'PNConnectedCategory' && userType === 'storyteller' && gameMode === 'reconnect') {
                setTimeout(() => {
                    updatePlayersList();
                    updatePhaseUI();
                    populateTargetPlayerDropdown();
                }, 2000); // Give time for history processing
            }
        }



        function sendGameSetup() {
          console.log('sendGameSetup called, currentScript:', currentScript); // Add this line
          const setupMessage = {
                gameId: currentGameId,
                type: 'game_setup',
                players: players,
                script: currentScript,
                playerRoles: playerRoles,
                playerReminders: playerReminders,
                playerDeathState: playerDeathState,
                playerGhostVotes: playerGhostVotes,
                storyteller: currentUser,
                timestamp: Date.now()
            };

            pubnub.publish({
                channel: currentRoom,
                message: setupMessage
            });
        }

        function togglePhase() {
            const newPhase = isNightTime ? 'daybreak' : 'nightfall';

            // Broadcast the specific phase event
            pubnub.publish({
                channel: currentRoom,
                message: {
                    type: newPhase,
                    gameId: currentGameId,
                    timestamp: Date.now()
                }
            });
        }

        function handleIncomingMessage(message, isFromHistory = false) {

            let debug_payload = {
                messageType: message.type,
                messageGameId: message.gameId,
                currentGameId: currentGameId,
                userType: userType,
                from: message.from,
                to: message.to,
                currentUser: currentUser
            };
            // console.log('handleIncomingMessage called:', debug_payload);


            if (message.type === 'game_setup') {
                // For players, always consider all game_setup messages to find the most recent
                // For storytellers, only process messages that match their current game
                if (userType === 'player') {
                    // Players should adopt the most recent game setup, regardless of current gameId
                    if (!currentGameId || message.timestamp > mostRecentSetupTimestamp) {
                        currentGameId = message.gameId;
                        mostRecentSetupTimestamp = message.timestamp;
                        console.log('Player adopted most recent gameId:', currentGameId);

                        // Update the display
                        const gameIdEl = document.getElementById('displayGameId');
                        if (gameIdEl) {
                            gameIdEl.textContent = currentGameId;
                        }

                        // Process this setup message
                        players = message.players;

                        // Process script information
                        if (message.script) {
                            if (typeof message.script === 'string') {
                                currentScript = Object.values(EMBEDDED_SCRIPTS).find(s => s.name === message.script) ||
                                               EMBEDDED_SCRIPTS[message.script];
                            } else {
                                currentScript = message.script;
                            }

                            // Update script display if we're on the game screen
                            const scriptEl = document.getElementById('displayScript');
                            if (scriptEl && currentScript) {
                                scriptEl.textContent = currentScript.name;
                            }
                        }

                        // Update player list after processing game state
                        updatePlayersList();
                    }
                    // If this isn't the most recent, ignore it
                    else {
                        return;
                    }
                } else if (message.gameId === currentGameId) {
                    // Storytellers only process their own game's setup messages
                    mostRecentSetupTimestamp = message.timestamp;
                    players = message.players;

                    if (message.playerRoles) {
                        playerRoles = message.playerRoles;
                    }

                    if (message.playerReminders) {
                        playerReminders = message.playerReminders;
                    }

                    if (message.playerDeathState) {
                        playerDeathState = message.playerDeathState;
                    }

                    if (message.playerGhostVotes) {
                        playerGhostVotes = message.playerGhostVotes;
                    }

                    // Look up the full script object from the script name/id
                    if (typeof message.script === 'string') {
                        // If it's just a name, find the script by name
                        currentScript = Object.values(EMBEDDED_SCRIPTS).find(s => s.name === message.script) ||
                                       EMBEDDED_SCRIPTS[message.script];
                    } else {
                        // If it's already an object, use it directly
                        currentScript = message.script;
                    }

                    // Update script display if we're on the game screen
                    const scriptEl = document.getElementById('displayScript');
                    if (scriptEl && currentScript) {
                        scriptEl.textContent = currentScript.name;
                        updateScriptViewer(); // Also update the script viewer if it's open
                    }

                    updatePlayersList();
               }
               // If it's an older setup message, just ignore it
            } else if (message.type === 'request_game_state' && userType === 'storyteller') {
                // Don't respond to historical requests
                if (!isFromHistory) {
                    sendGameSetup();
                }
            } else if (message.type === 'role_assignment' && userType === 'storyteller' &&
                      message.gameId === currentGameId) {
                // Update local role assignments
                if (message.playerRoles) {
                    playerRoles = message.playerRoles;
                    updatePlayersList();
                }
            } else if (message.type === 'seat_assignment' && userType === 'storyteller' &&
                      message.gameId === currentGameId) {
                // Update local role assignments
                if (message.players) {
                    players = message.players;
                    updatePlayersList();
                }
            } else if (message.type === 'reminder_update' && userType === 'storyteller' &&
                       message.gameId === currentGameId) {
                // Update local reminder assignments
                if (message.playerReminders) {
                    playerReminders = message.playerReminders;
                    updatePlayersList();
                }
            } else if (message.type === 'death_update' && message.gameId === currentGameId) {
                // Update local death state
                if (message.playerDeathState) {
                    playerDeathState = message.playerDeathState;
                    updatePlayersList();
                }
            } else if (message.type === 'ghost_vote_update' && message.gameId === currentGameId) {
                // Update local ghost vote state
                if (message.playerGhostVotes) {
                    playerGhostVotes = message.playerGhostVotes;
                    updatePlayersList();
                }
            } else if (message.type === 'daybreak' && message.gameId === currentGameId) {
                setDayPhase();
            } else if (message.type === 'nightfall' && message.gameId === currentGameId) {
                setNightPhase();
            } else if (message.type === 'private_message') {
                // For players without gameId, adopt it from any valid message
                if (userType === 'player' && !currentGameId && message.gameId) {
                    currentGameId = message.gameId;
                    console.log('Player adopted gameId from message:', currentGameId);
                    // Update the display
                    const gameIdEl = document.getElementById('displayGameId');
                    if (gameIdEl) {
                        gameIdEl.textContent = currentGameId;
                    }
                }

                // Now check if we should process this message
                if (message.gameId === currentGameId) {

                    console.log('Processing private message:', message);

                    // Check if this is an echo of our own message
                    if (message.from === currentUser && sentMessages.has(message.timestamp)) {
            // This is an echo - mark the local message as delivered
                        markMessageDelivered(message.timestamp);
                        return; // Don't display duplicate
                    }

                    // If it's not our message or not in sent messages, display normally
                    displayMessage(message);
                } else {
                    console.log('Message rejected - gameId mismatch:', message.gameId, 'vs', currentGameId);
                }
            }
        }

        function switchToGameScreen() {
            document.getElementById('setupScreen').classList.add('hidden');
            document.getElementById('gameScreen').classList.remove('hidden');
            const gameIdEl = document.getElementById('displayGameId');
            gameIdEl.textContent = currentGameId || 'Not set';
            gameIdEl.style.color = isConnected ? '#26de81' : '#ff6b6b'; // Set initial color based on connection state

            document.getElementById('displayTime').textContent = 'Night 1';

            if (currentScript) {
                document.getElementById('displayScript').textContent = currentScript.name;
                updateScriptViewer();
            } else if (userType === 'player') {
                document.getElementById('displayScript').textContent = 'Waiting for game info...';
            } else {
                document.getElementById('displayScript').textContent = 'No script selected';
            }

            if (userType === 'storyteller') {
                document.getElementById('storytellerControls').classList.remove('hidden');

                // Initialize workflow state
                updateStorytellerWorkflowUI();
            }

            updatePlayersList();
            
            // Update URL with current game state
            updateURL();
        }

        function updateStorytellerWorkflowUI() {
            // Hide all phases first
            document.getElementById('distributeRolesPhase').style.display = 'none';
            document.getElementById('minionDemonPhase').style.display = 'none';
            document.getElementById('nightActionPhase').style.display = 'none';

            // Show current phase
            if (storytellerWorkflowState === 'distribute_roles') {
                document.getElementById('distributeRolesPhase').style.display = 'block';
            } else if (storytellerWorkflowState === 'minion_demon_info') {
                document.getElementById('minionDemonPhase').style.display = 'block';
            } else if (storytellerWorkflowState === 'night_action') {
                document.getElementById('nightActionPhase').style.display = 'block';
            }
        }

        function skipMinionDemonInfo() {
            storytellerWorkflowState = 'night_action';
            updateStorytellerWorkflowUI();
        }

        function getLivingPlayerCount() {
            return players.filter(player => playerDeathState[player] !== 'dead').length;
        }

        function getMajorityVotes() {
            const livingCount = getLivingPlayerCount();
            return Math.ceil(livingCount / 2);
        }

        function updateGameStateDisplay() {
            const livingCount = getLivingPlayerCount();
            const majorityVotes = getMajorityVotes();
            const gameStateEl = document.getElementById('gameStateDisplay');
            if (gameStateEl) {
                gameStateEl.textContent = `Living: ${livingCount}; Majority: ${majorityVotes}`;
            }
        }

        function updatePlayersList() {
            const playersList = document.getElementById('playersList');
            playersList.innerHTML = '';

            // Debug log to see what we're working with
            console.log('updatePlayersList called, playerRoles:', playerRoles);
            console.log('currentScript:', currentScript);

          players.forEach((player, index) => {
            const playerCard = document.createElement('div');
                playerCard.className = 'player-card';

                const seatDiv = document.createElement('div');
                seatDiv.className = 'seat-num';
                seatDiv.textContent = `Seat ${index+1}`;
                playerCard.appendChild(seatDiv);

                const isDead = playerDeathState[player] === 'dead';

                const nameDiv = document.createElement('div');
                nameDiv.className = 'player-name';
                nameDiv.textContent = player;
                nameDiv.textContent = isDead ? `💀 ${player} 💀` : player;
                playerCard.appendChild(nameDiv);

                // Add death styling if player is dead
                if (isDead) {
                    playerCard.style.opacity = '0.5';
                    nameDiv.style.textDecoration = 'line-through';
                }

                // Show role if storyteller
                if (userType === 'storyteller') {
                    const roleDiv = document.createElement('div');
                    roleDiv.className = 'player-role';
                    const roleId = playerRoles[player];
                    const role = roleId ? getRoleById(roleId) : null;

                    // Debug individual role lookup
                    console.log(`Player ${player}: roleId=${roleId}, role=`, role);

                    roleDiv.innerHTML = role ?
                        `<span class="role-${role.team}">${role.name}</span>` :
                        '<span class="role-none">No role</span>';
                    playerCard.appendChild(roleDiv);

                    // Show reminders if any
                    if (playerReminders[player] && playerReminders[player].length > 0) {
                        const remindersDiv = document.createElement('div');
                        remindersDiv.className = 'player-reminders';
                        remindersDiv.style.fontSize = '0.7rem';
                        remindersDiv.style.opacity = '0.8';
                        remindersDiv.style.marginTop = '3px';
                        remindersDiv.style.fontStyle = 'italic';
                        remindersDiv.innerHTML = playerReminders[player].map(reminder => `• ${reminder}`).join('<br>');
                        playerCard.appendChild(remindersDiv);
                    }

                    playerCard.classList.add('storyteller-view');
                    playerCard.onclick = () => openRoleAssignmentModal(player);
                }

                // Show emoji for dead players based on ghost vote status (visible to all users)
                if (isDead) {
                    const hasGhostVote = playerGhostVotes[player] ?? true;
                    const deathStatusDiv = document.createElement('div');
                    deathStatusDiv.className = hasGhostVote ? 'ghost-vote-indicator' : 'tombstone-indicator';
                    deathStatusDiv.style.fontSize = '1.2rem';
                    deathStatusDiv.style.textAlign = 'center';
                    deathStatusDiv.style.marginTop = '5px';
                    deathStatusDiv.textContent = hasGhostVote ? '👻' : '🪦';
                    playerCard.appendChild(deathStatusDiv);
                }

                if (player === currentUser) {
                    playerCard.classList.add('online');
                }

                playersList.appendChild(playerCard);
            });

            if (userType === 'player') {
                const storytellerCard = document.createElement('div');
                storytellerCard.className = 'player-card storyteller';
                storytellerCard.textContent = '👑 Storyteller';
                playersList.appendChild(storytellerCard);
            } else if (userType == 'storyteller') {
                // Update target player dropdown for storytellers
                const targetSelect = document.getElementById('targetPlayer');
                targetSelect.innerHTML = '<option value="">Select player...</option>';
                const orderedPlayers = getOrderedPlayersForNight();
                orderedPlayers.forEach(player => {
                    if (player === '-----') {
                        const separator = document.createElement('option');
                        separator.value = '';
                        separator.textContent = '-----';
                        separator.disabled = true;
                        targetSelect.appendChild(separator);
                    } else {
                        const option = document.createElement('option');
                        option.value = player;
                        option.textContent = player;
                        targetSelect.appendChild(option);
                    }
                });
            }

            updateGameStateDisplay();
        }

        function getOrderedPlayersForNight() {
            if (!currentScript || players.length === 0) {
                return players; // Return original order if no script or players
            }

            // Determine which night order to use
            const nightOrder = (dayNightCounter === 1)
                ? currentScript.first_night_order
                : currentScript.other_night_order;

            if (!nightOrder || nightOrder.length === 0) {
                return players; // Return original order if no night order defined
            }

            console.log('getOrderedPlayersForNight Night order for night', dayNightCounter, ':', nightOrder);
            console.log('getOrderedPlayersForNight Player roles:', playerRoles);

            const orderedPlayers = [];
            const usedPlayers = new Set(); // Track which players we've already added

            // First, add players in night order
            nightOrder.forEach(roleId => {
                // Find the player with this role
                const playerWithRole = players.find(player =>
                    playerRoles[player] === roleId && !usedPlayers.has(player)
                );
                if (playerWithRole) {
                    console.log('getOrderedPlayersForNight Adding player', playerWithRole, 'for role', roleId);
                    orderedPlayers.push(playerWithRole);
                    usedPlayers.add(playerWithRole);
                }
            });

            // Add any remaining players at the end
            const hasRemainingPlayers = players.some(player => !usedPlayers.has(player));
            if (hasRemainingPlayers && orderedPlayers.length > 0) {
                orderedPlayers.push('-----'); // Separator
            }

            players.forEach(player => {
                if (!usedPlayers.has(player)) {
                    console.log('getOrderedPlayersForNight Adding remaining player', player);
                    orderedPlayers.push(player);
                }
        });

            console.log('getOrderedPlayersForNight Final ordered players:', orderedPlayers);
            return orderedPlayers;
        }

        function populateTargetPlayerDropdown() {
            if (userType === 'storyteller' && players.length > 0) {
                const targetSelect = document.getElementById('targetPlayer');
                targetSelect.innerHTML = '<option value="">Select player...</option>';
                const orderedPlayers = getOrderedPlayersForNight();
                orderedPlayers.forEach(player => {
                    if (player === '-----') {
                        const separator = document.createElement('option');
                        separator.value = '';
                        separator.textContent = '-----';
                        separator.disabled = true;
                        targetSelect.appendChild(separator);
                    } else {
                        const option = document.createElement('option');
                        option.value = player;
                        option.textContent = player;
                        targetSelect.appendChild(option);
                    }
                });
            }
        }

        function getRoleById(roleId) {
            return ROLES[roleId] || null;
        }

        function getScriptRoles(script) {
            if (!script || !script.roles) return [];
            return script.roles.map(roleId => ROLES[roleId]).filter(role => role);
        }

        function openRoleAssignmentModal(playerName) {
            selectedPlayerForRole = playerName;

            const modal = document.getElementById('roleAssignmentModal');
            const title = document.getElementById('roleAssignmentTitle');
            const roleSelect = document.getElementById('roleSelect');
            const deathToggleBtn = document.getElementById('deathToggleBtn');

            title.textContent = `Assign Role to ${playerName}`;

            // Populate role dropdown
            roleSelect.innerHTML = '<option value="">No role assigned</option>';

            if (currentScript) {
                // Group roles by team
                const rolesByTeam = {
                    townsfolk: [],
                    outsider: [],
                    minion: [],
                    demon: []
                };

                getScriptRoles(currentScript).forEach(role => {
                    rolesByTeam[role.team].push(role);
                });

                // Add roles grouped by team
                const teamNames = {
                    townsfolk: '👥 Townsfolk',
                    outsider: '🚪 Outsiders',
                    minion: '😈 Minions',
                    demon: '👹 Demons'
                };

                Object.entries(rolesByTeam).forEach(([team, roles]) => {
                    if (roles.length > 0) {
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = teamNames[team];

                        roles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role.id;
                            option.textContent = role.name;
                            optgroup.appendChild(option);
                        });

                        roleSelect.appendChild(optgroup);
                    }
                });
            }

            // Set current role if any
            if (playerRoles[playerName]) {
                roleSelect.value = playerRoles[playerName];
            }

            // Update death toggle button text based on current state
            const isAlive = playerDeathState[playerName] !== 'dead';
            deathToggleBtn.textContent = isAlive ? '💀 Dies' : '⚡ Reborn';
            deathToggleBtn.style.background = isAlive ?
                'linear-gradient(45deg, #9b59b6, #8e44ad)' :
                'linear-gradient(45deg, #26de81, #20bf6b)';

            // Update ghost vote toggle button text based on current state
            const ghostVoteToggleBtn = document.getElementById('ghostVoteToggleBtn');
            const hasGhostVote = playerGhostVotes[playerName] ?? true;
            ghostVoteToggleBtn.textContent = hasGhostVote ? '👻 Remove Ghost Vote' : '👻 Add Ghost Vote';
            ghostVoteToggleBtn.style.background = hasGhostVote ?
                'linear-gradient(45deg, #ff6b6b, #ee5a24)' :
                'linear-gradient(45deg, #4834d4, #686de0)';

            modal.classList.remove('hidden');
        }

        function closeRoleAssignmentModal() {
            document.getElementById('roleAssignmentModal').classList.add('hidden');
            selectedPlayerForRole = null;
        }

        function confirmRoleAssignment() {
            if (!selectedPlayerForRole) return;

            const roleSelect = document.getElementById('roleSelect');
            const selectedRole = roleSelect.value || null;

            // Update local state
            playerRoles[selectedPlayerForRole] = selectedRole;

            // Broadcast role assignment to other storytellers (if any)
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'role_assignment',
                    playerRoles: playerRoles,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeRoleAssignmentModal();
        }


        function randomlyAssignAllSeats() {
            if (players.length === 0) {
                alert('No players');
                return;
            }

            const playerCount = players.length;

            // Assign seats to players
            const shuffledPlayers = [...players];
            for (let i = shuffledPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
            }

            console.log(shuffledPlayers);

            // Assign seats
            players = shuffledPlayers

            // Broadcast the new assignments
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'seat_assignment',
                    players: players,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeRoleAssignmentModal();
        }

        // Template Functions
        function useNightActionTemplate() {
            const targetPlayer = document.getElementById('targetPlayer').value;

            if (!targetPlayer) {
                alert('Please select a target player first');
                return;
            }

            const roleId = playerRoles[targetPlayer];
            if (!roleId) {
                alert('Selected player has no assigned role');
                return;
            }

            const role = getRoleById(roleId);
            if (!role || !role.nightActionTemplates || role.nightActionTemplates.length === 0) {
                alert('This role has no night action templates available');
                return;
            }


            // If there's only one template, use it directly
            if (role.nightActionTemplates.length === 1) {
                const template = role.nightActionTemplates[0];
                processNightActionTemplate(template, targetPlayer, role);
            } else {
                // Show template selection modal
                showTemplateSelectionModal(role.nightActionTemplates, targetPlayer, role);
            }
        }

        function showTemplateSelectionModal(templates, targetPlayer, role) {
            const modal = document.getElementById('templateSelectionModal');
            const title = document.getElementById('templateSelectionTitle');
            const content = document.getElementById('templateSelectionContent');

            title.textContent = `Choose template for ${targetPlayer} (${role.name})`;
            content.innerHTML = '';

            templates.forEach((template, index) => {
                const button = document.createElement('button');
                button.textContent = template[0]; // First string is what storyteller sees
                button.style.width = '100%';
                button.style.margin = '5px 0';
                button.style.padding = '12px';
                button.style.fontSize = '14px';
                button.style.textAlign = 'left';
                button.onclick = () => {
                    closeTemplateSelectionModal();
                    processNightActionTemplate(template, targetPlayer, role);
                };
                content.appendChild(button);
            });

            modal.classList.remove('hidden');
        }

        function closeTemplateSelectionModal() {
            document.getElementById('templateSelectionModal').classList.add('hidden');
        }

        function processNightActionTemplate(template, targetPlayer, role) {
            if (template.length === 1) {
                // Storyteller info template - just send info to player
                const templateText = template[0];

                currentTemplate = {
                    type: 'storyteller_info',
                    template: templateText,
                    to: targetPlayer,
                    fields: extractTemplateFields(templateText)
                };

                showTemplateUI();
            } else if (template.length === 2) {
                // Player prompt template - send prompt and expect response
                const promptText = template[0];
                const responseTemplate = template[1];

                currentTemplate = {
                    type: 'player_prompt',
                    promptText: promptText,
                    responseTemplate: responseTemplate,
                    to: targetPlayer,
                    fields: extractTemplateFields(responseTemplate)
                };

                showTemplateUI();
            }
        }

        function extractTemplateFields(templateText) {
            const fields = [];
            const fieldRegex = /\{(\w+)\}/g;
            let match;

            while ((match = fieldRegex.exec(templateText)) !== null) {
                const fieldName = match[1];
                if (!fields.find(f => f.name === fieldName)) {
                    let fieldType = fieldName;

                    // Map common field names to types
                    if (fieldName.startsWith('player')) {
                        fieldType = 'player';
                    } else if (fieldName.startsWith('bluff_role')) {
                        fieldType = 'bluff_role';
                    } else if (fieldName.startsWith('good_role')) {
                        fieldType = 'good_role';
                    }

                    fields.push({ name: fieldName, type: fieldType });
                }
            }

            return fields;
        }

        function is_role(fieldType) {
            return fieldType === 'role' || fieldType.includes('_role');
        }

        function useSimpleTemplate(template, fieldType) {
            const targetPlayer = document.getElementById('targetPlayer').value;
            if (!targetPlayer) {
                alert('Please select a target player first');
                return;
            }

            currentTemplate = {
                type: 'storyteller_info',
                template: template,
                to: targetPlayer,
                fields: [{ name: fieldType, type: fieldType }]
            };

            showTemplateUI();
        }

        function usePromptTemplate(promptText, responseTemplate, fieldTypes) {
            const targetPlayer = document.getElementById('targetPlayer').value;
            if (!targetPlayer) {
                alert('Please select a target player first');
                return;
            }

            currentTemplate = {
                type: 'player_prompt',
                promptText: promptText,
                responseTemplate: responseTemplate,
                to: targetPlayer,
                fields: fieldTypes.map(type => ({ name: type, type: type }))
            };

            showTemplateUI();
        }

        function showTemplateUI() {
            const templateUI = document.getElementById('templateUI');
            const templateTitle = document.getElementById('templateTitle');
            const templateFields = document.getElementById('templateFields');

            templateUI.classList.remove('hidden');

            if (currentTemplate.type === 'storyteller_info') {
                templateTitle.textContent = `Send Info to ${currentTemplate.to}`;
                templateFields.innerHTML = '';

                // Create inline template with embedded form fields
                const templateContainer = document.createElement('div');
                templateContainer.className = 'inline-template';
                templateContainer.style.fontSize = '1.1rem';
                templateContainer.style.lineHeight = '1.8';
                templateContainer.style.padding = '15px';
                templateContainer.style.background = 'rgba(0,0,0,0.2)';
                templateContainer.style.borderRadius = '8px';

                templateContainer.innerHTML = createInlineTemplate(currentTemplate.template);
                templateFields.appendChild(templateContainer);

            } else if (currentTemplate.type === 'player_prompt') {
                templateTitle.textContent = `Send Prompt to ${currentTemplate.to}`;
                templateFields.innerHTML = '';

                const promptContainer = document.createElement('div');
                promptContainer.innerHTML = `<p><strong>You will send:</strong> "${currentTemplate.promptText}"</p>`;
                templateFields.appendChild(promptContainer);

                // The code below would provide the storyteller with a rendered view (as in combo boxes)
                // of what the player will see when they compose their response. However, such a
                // preview is really overkill for our purposes, and so I have guarded it by an if-false.
                if (false && currentTemplate.fields.length > 0) {
                    const responseContainer = document.createElement('div');
                    responseContainer.className = 'inline-template';
                    responseContainer.style.fontSize = '1.1rem';
                    responseContainer.style.lineHeight = '1.8';
                    responseContainer.style.padding = '15px';
                    responseContainer.style.background = 'rgba(0,0,0,0.2)';
                    responseContainer.style.borderRadius = '8px';
                    responseContainer.style.marginTop = '10px';

                    const responseLabel = document.createElement('p');
                    responseLabel.innerHTML = '<strong>Player will respond with:</strong>';
                    responseLabel.style.marginBottom = '10px';
                    templateFields.appendChild(responseLabel);

                    responseContainer.innerHTML = createInlineTemplate(currentTemplate.responseTemplate);
                    templateFields.appendChild(responseContainer);
                }
            }
        }

        function createInlineTemplate(templateText) {
            let html = templateText;

            // Replace each placeholder with an appropriate form field
            currentTemplate.fields.forEach(field => {
                const placeholder = `{${field.name}}`;
                let fieldHtml = '';

                if (field.type === 'player') {
                    fieldHtml = '<select id="field_' + field.name + '" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc;">';
                    fieldHtml += '<option value="">Select player...</option>';
                    const orderedPlayers = getOrderedPlayersForNight();
                    orderedPlayers.forEach(player => {
                        if (player === '-----') {
                            fieldHtml += '<option value="" disabled>-----</option>';
                        } else {
                            fieldHtml += `<option value="${player}">${player}</option>`;
                        }
                    });
                    fieldHtml += '</select>';

                } else if (is_role(field.type)) {
                    fieldHtml = '<select id="field_' + field.name + '" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc;">';
                    fieldHtml += '<option value="">Select role...</option>';
                    if (currentScript) {
                        let availableRoles = getScriptRoles(currentScript);
                        const defaultGoodTeamRoles = ['townsfolk', 'outsider']

                        // Filter roles based on field type
                        if (field.type === 'townsfolk_role') {
                            availableRoles = availableRoles.filter(role => role.team === 'townsfolk');
                        } else if (field.type === 'outsider_role') {
                            availableRoles = availableRoles.filter(role => role.team === 'outsider');
                        } else if (field.type === 'minion_role') {
                            availableRoles = availableRoles.filter(role => role.team === 'minion');
                        } else if (field.type === 'demon_role') {
                            availableRoles = availableRoles.filter(role => role.team === 'demon');
                        } else if (field.type === 'good_role') {
                            availableRoles = availableRoles.filter((role) => {
                                return defaultGoodTeamRoles.includes(role.team);
                            });
                        } else if (field.type === 'bluff_role') {
                            availableRoles = availableRoles.filter((role) => {
                                let inPlayGoodRoles = []
                                const defaultGoodTeamRoles = ['townsfolk', 'outsider']
                                players.forEach(player => {
                                    const roleId = playerRoles[player];
                                    if (roleId) {
                                        const role = getRoleById(roleId);
                                        if (role) {
                                            if (defaultGoodTeamRoles.includes(role.team)) {
                                                inPlayGoodRoles.push(roleId)
                                            }
                                        }
                                    }
                                })
                                return defaultGoodTeamRoles.includes(role.team) && !inPlayGoodRoles.includes(role.id);
                            })
                        }
                        // field.type === 'role' shows all roles (no filtering)
                        availableRoles.forEach(role => {
                            fieldHtml += `<option value="${role.id}">${role.name}</option>`;
                        });

                    }
                    fieldHtml += '</select>';

                } else if (field.type === 'yesno') {
                    fieldHtml = '<select id="field_' + field.name + '" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc;">';
                    fieldHtml += '<option value="">Choose...</option>';
                    fieldHtml += '<option value="Yes">Yes</option>';
                    fieldHtml += '<option value="No">No</option>';
                    fieldHtml += '</select>';
                } else if (field.type === 'goodevil') {
                    fieldHtml = '<select id="field_' + field.name + '" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc;">';
                    fieldHtml += '<option value="">Choose...</option>';
                    fieldHtml += '<option value="Good">Good</option>';
                    fieldHtml += '<option value="Evil">Evil</option>';
                    fieldHtml += '</select>';
                } else if (field.type === 'number') {
                    fieldHtml = `<input type="number" id="field_${field.name}" placeholder="${field.name}" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc; width: 80px;">`;

                } else {
                    fieldHtml = `<input type="text" id="field_${field.name}" placeholder="${field.name}" style="margin: 0 5px; padding: 4px; border-radius: 4px; border: 1px solid #ccc; width: 120px;">`;
                }

                html = html.replace(placeholder, fieldHtml);
            });

            return html;
        }

        function sendTemplateMessage() {
            if (!currentTemplate) return;

            let messageContent;
            let templateData = {};

            if (currentTemplate.type === 'storyteller_info') {
                // First: Validate ALL fields before processing ANY
                for (const field of currentTemplate.fields) {
                    const inputEl = document.getElementById(`field_${field.name}`);
                    const value = inputEl.value;

                    if (!value) {
                        alert(`Please fill in ${field.name}`);
                        return; // Actually exits the function
                    }
                }

                // Process storyteller template
                messageContent = currentTemplate.template;

                currentTemplate.fields.forEach(field => {
                    const inputEl = document.getElementById(`field_${field.name}`);
                    const value = inputEl.value;
                    // we know value is present (and truthy) because we checked it above

                    templateData[field.name] = value;

                    // Replace placeholder in message
                    if (is_role(field.type) && currentScript) {
                        const role = getRoleById(value);
                        if (role) {
                            messageContent = messageContent.replace(`{${field.name}}`, role.name);
                        } else {
                            console.log('Role not found for ID:', value);
                            messageContent = messageContent.replace(`{${field.name}}`, value);
                        }
                    } else {
                        messageContent = messageContent.replace(`{${field.name}}`, value);
                    }
                });

            } else if (currentTemplate.type === 'player_prompt') {
                messageContent = currentTemplate.promptText;
                templateData.responseTemplate = currentTemplate.responseTemplate;
                templateData.responseFields = currentTemplate.fields;
            }

            const message = {
                gameId: currentGameId,
                type: 'private_message',
                messageType: currentTemplate.type === 'storyteller_info' ? 'info' : 'prompt',
                from: currentUser,
                to: currentTemplate.to,
                content: messageContent,
                templateData: templateData,
                timestamp: Date.now()
            };

            // Display locally first (as "sending")
            displayMessage(message, true);
            sentMessages.set(message.timestamp, true);

            pubnub.publish({
                channel: currentRoom,
                message: message
            });

            cancelTemplate();
        }

        function cancelTemplate() {
            currentTemplate = null;
            document.getElementById('templateUI').classList.add('hidden');
            document.getElementById('responsePreview').classList.add('hidden');
        }

        function sendFreeMessage() {
            const messageInput = document.getElementById('messageInput');
            const messageText = messageInput.value.trim();

            if (!messageText || !isConnected) return;

            let to = 'Storyteller';
            if (userType === 'storyteller') {
                to = document.getElementById('targetPlayer').value;
                if (!to) {
                    alert('Please select a target player');
                    return;
                }
            }

            const message = {
                gameId: currentGameId,
                type: 'private_message',
                messageType: 'response',
                from: currentUser,
                to: to,
                content: messageText,
                timestamp: Date.now()
            };

            // Display locally first (as "sending")
            displayMessage(message, true);
            sentMessages.set(message.timestamp, true);

            pubnub.publish({
                channel: currentRoom,
                message: message
            });

            messageInput.value = '';
        }

        function displayMessage(message, isLocalSend = false) {
            // Only show messages for current user
            if (message.to !== currentUser && message.from !== currentUser) {
                return;
            }

            const messagesContainer = document.getElementById('messages');
            const messageEl = document.createElement('div');

            messageEl.className = 'message';
            if (message.from === 'Storyteller' || userType === 'player' && message.from !== currentUser) {
                messageEl.classList.add('from-storyteller');
            } else {
                messageEl.classList.add('from-player');
            }

            const headerEl = document.createElement('div');
            headerEl.className = 'message-header';
            const time = new Date(message.timestamp).toLocaleTimeString();

            let statusIcon = '';
            if (isLocalSend) {
                statusIcon = ' ⏳'; // Sending indicator
            } else if (message.from === currentUser) {
                statusIcon = ' ✓'; // Delivered indicator
            }

            headerEl.innerHTML = `${message.from} → ${message.to} (${time})<span class="delivery-status">${statusIcon}</span>`;

            const contentEl = document.createElement('div');
            contentEl.textContent = message.content;

            // Store reference for delivery confirmation
            messageEl.dataset.timestamp = message.timestamp;
            messageEl.appendChild(headerEl);
            messageEl.appendChild(contentEl);

            // Insert message in chronological order by timestamp
            const existingMessages = messagesContainer.querySelectorAll('.message');
            let insertPosition = null;

            for (let i = 0; i < existingMessages.length; i++) {
                const existingTimestamp = parseInt(existingMessages[i].dataset.timestamp);
                if (message.timestamp < existingTimestamp) {
                    insertPosition = existingMessages[i];
                    break;
                }
            }

            if (insertPosition) {
                messagesContainer.insertBefore(messageEl, insertPosition);
            } else {
                messagesContainer.appendChild(messageEl);
            }

            // Add response UI for prompts
            if (message.messageType === 'prompt' && message.to === currentUser && userType === 'player') {
                const responseData = message.templateData;
                if (responseData && responseData.responseTemplate) {
                    const responseUI = createResponseUI(responseData, message);
                    messageEl.appendChild(responseUI);
                }
            }

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function setDayPhase() {
            isNightTime = false;
            updatePhaseUI();
            updatePlayerMessageVisibility();
        }

        function setNightPhase() {
            isNightTime = true;
            dayNightCounter++;
            updatePhaseUI();
            updatePlayerMessageVisibility();

            // Update player dropdown ordering for the new night
            if (userType === 'storyteller') {
                populateTargetPlayerDropdown();
            }
        }

        function updatePhaseUI() {
            const button = document.getElementById('phaseToggle');
            if (button) {
                button.textContent = isNightTime ? 'Day Breaks' : 'Night Falls';
                button.style.background = isNightTime ?
                    'linear-gradient(45deg, #ffd93d, #f39c12)' :
                    'linear-gradient(45deg, #4a90e2, #357abd)';
            }

            const timeSpan = document.getElementById('displayTime');
            if (timeSpan) {
                timeSpan.textContent = `${isNightTime ? 'Night' : 'Day'} ${dayNightCounter}`
            }
        }

        function updatePlayerMessageVisibility() {
            if (userType !== 'player') return;

            const messagesContainer = document.getElementById('messages');
            if (!messagesContainer) return;

            const messageElements = messagesContainer.querySelectorAll('.message');
            messageElements.forEach(messageEl => {
                messageEl.style.display = isNightTime ? 'block' : 'none';
            });
        }

        function markMessageDelivered(timestamp) {
            // Find the message element and update its delivery status
            const messageEl = document.querySelector(`[data-timestamp="${timestamp}"]`);
            if (messageEl) {
                const headerEl = messageEl.querySelector('.message-header');
                headerEl.innerHTML = headerEl.innerHTML.replace('⏳', '✓');
            }
        }

        function createResponseUI(responseData, originalMessage) {
            const responseDiv = document.createElement('div');
            responseDiv.className = 'template-ui';
            responseDiv.style.marginTop = '10px';

            const title = document.createElement('h4');
            title.textContent = 'Your Response:';
            responseDiv.appendChild(title);

            const fieldsDiv = document.createElement('div');

            responseData.responseFields.forEach(field => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'template-field';

                const label = document.createElement('label');
                label.textContent = field.name.charAt(0).toUpperCase() + field.name.slice(1) + ':';

                let input;
                if (field.type === 'player') {
                    input = document.createElement('select');
                    input.innerHTML = '<option value="">Select player...</option>';
                    const orderedPlayers = getOrderedPlayersForNight();
                    orderedPlayers.forEach(player => {
                        if (player === '-----') {
                            const separator = document.createElement('option');
                            separator.value = '';
                            separator.textContent = '-----';
                            separator.disabled = true;
                            input.appendChild(separator);
                        } else {
                            const option = document.createElement('option');
                            option.value = player;
                            option.textContent = player;
                            input.appendChild(option);
                        }
                    });
                } else {
                    input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = `Enter ${field.name}...`;
                }

                input.className = 'response-field';
                input.dataset.fieldName = field.name;

                // Update preview on change
                input.addEventListener('input', () => updateResponsePreview(responseDiv, responseData));
                input.addEventListener('change', () => updateResponsePreview(responseDiv, responseData));

                fieldDiv.appendChild(label);
                fieldDiv.appendChild(input);
                fieldsDiv.appendChild(fieldDiv);
            });

            responseDiv.appendChild(fieldsDiv);

            // Preview area
            const previewDiv = document.createElement('div');
            previewDiv.className = 'response-preview';
            previewDiv.textContent = 'Fill in the fields to see your response...';
            responseDiv.appendChild(previewDiv);

            // Send button
            const sendBtn = document.createElement('button');
            sendBtn.textContent = 'Send Response';
            sendBtn.onclick = () => sendPlayerResponse(responseDiv, responseData, originalMessage);
            responseDiv.appendChild(sendBtn);

            return responseDiv;
        }

        function updateResponsePreview(responseDiv, responseData) {
            const preview = responseDiv.querySelector('.response-preview');
            const fields = responseDiv.querySelectorAll('.response-field');

            let responseText = responseData.responseTemplate;
            let allFilled = true;

            fields.forEach(field => {
                const fieldName = field.dataset.fieldName;
                const value = field.value;

                if (value) {
                    responseText = responseText.replace(`{${fieldName}}`, value);
                } else {
                    allFilled = false;
                }
            });

            if (allFilled) {
                preview.textContent = `"${responseText}"`;
                preview.style.color = '#26de81';
            } else {
                preview.textContent = responseText;
                preview.style.color = '#ffd93d';
            }
        }

        function sendPlayerResponse(responseDiv, responseData, originalMessage) {
            const fields = responseDiv.querySelectorAll('.response-field');
            const fieldData = {};
            let responseText = responseData.responseTemplate;
            let allFilled = true;

            fields.forEach(field => {
                const fieldName = field.dataset.fieldName;
                const value = field.value;

                if (!value) {
                    allFilled = false;
                } else {
                    fieldData[fieldName] = value;
                    responseText = responseText.replace(`{${fieldName}}`, value);
                }
            });

            if (!allFilled) {
                alert('Please fill in all fields');
                return;
            }

            const message = {
                gameId: currentGameId,
                type: 'private_message',
                messageType: 'response',
                from: currentUser,
                to: originalMessage.from,
                content: responseText,
                respondingTo: originalMessage.timestamp,
                templateData: fieldData,
                timestamp: Date.now()
            };

            // Display locally first (as "sending")
            displayMessage(message, true);
            sentMessages.set(message.timestamp, true);

            pubnub.publish({
                channel: currentRoom,
                message: message
            });

            // Disable the response UI
            responseDiv.style.opacity = '0.5';
            responseDiv.style.pointerEvents = 'none';
            const sendBtn = responseDiv.querySelector('button');
            if (sendBtn) sendBtn.textContent = 'Response Sent';
        }

        // Script Viewer Functions
        function toggleScriptViewer() {
            const viewer = document.getElementById('scriptViewer');
            viewer.classList.toggle('hidden');

            if (!viewer.classList.contains('hidden') && currentScript) {
                updateScriptViewer();
            }
        }

        function updateScriptViewer() {
            if (!currentScript) return;

            const title = document.getElementById('scriptViewerTitle');
            const content = document.getElementById('scriptContent');

            title.textContent = currentScript.name;

            // Group roles by team
            const rolesByTeam = {
                townsfolk: [],
                outsider: [],
                minion: [],
                demon: []
            };

            getScriptRoles(currentScript).forEach(role => {
                rolesByTeam[role.team].push(role);
            });

            // Build content
            let html = `
                <div style="margin-bottom: 15px;">
                    <strong>Author:</strong> ${currentScript.author || 'Unknown'}<br>
                    <strong>Description:</strong> ${currentScript.description || 'No description'}
                </div>
                <div class="script-viewer-content">
            `;

            // Render each team
            const teamInfo = {
                townsfolk: { name: 'Townsfolk', class: 'team-townsfolk' },
                outsider: { name: 'Outsiders', class: 'team-outsider' },
                minion: { name: 'Minions', class: 'team-minion' },
                demon: { name: 'Demons', class: 'team-demon' }
            };

            Object.entries(rolesByTeam).forEach(([team, roles]) => {
                if (roles.length > 0) {
                    const info = teamInfo[team];
                    html += `
                        <div class="team-section">
                            <div class="team-header ${info.class}">
                                ${info.name} (${roles.length})
                            </div>
                    `;

                    roles.forEach(role => {
                        let timing = '';
                        if (role.firstNight && role.otherNights) {
                            timing = 'Acts first night and other nights';
                        } else if (role.firstNight) {
                            timing = 'Acts first night only';
                        } else if (role.otherNights) {
                            timing = 'Acts other nights only';
                        } else {
                            timing = 'Passive ability';
                        }

                        html += `
                            <div class="role-card ${team}">
                                <div class="role-name">${role.name}</div>
                                <div class="role-ability">${role.ability}</div>
                                <div class="role-timing">${timing}</div>
                            </div>
                        `;
                    });

                    html += '</div>';
                }
            });

            html += '</div>';
            content.innerHTML = html;
        }

        // Handle Enter key in message input
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendFreeMessage();
            }
        });

        // Initialize setup screen
        document.getElementById('userType').dispatchEvent(new Event('change'));

      // generateRoomId(); // Temporarily disabled to preserve default room ID

      populateScriptDropdown();

        // Role Selection Functions
        function showRoleSelectionScreen() {
            document.getElementById('setupScreen').classList.add('hidden');
            document.getElementById('roleSelectionScreen').classList.remove('hidden');

            document.getElementById('roleSelectionScript').textContent = currentScript.name;
            document.getElementById('roleSelectionPlayerCount').textContent = players.length;
            document.getElementById('roleSelectionGameId').textContent = currentGameId || 'Not set';

            // Initialize PubNub connection and send game setup so players can join during role selection
            currentUser = 'Storyteller';
            initializePlayerRoles();
            initializePubNub();
            mostRecentSetupTimestamp = Date.now();

            // Show target distribution
            updateDistributionDisplay();

            // Populate role selection UI
            populateRoleSelectionUI();

            // Initialize empty selection
            selectedRoles = [];
            updateSelectionCounts();
        }

        function updateDistributionDisplay() {
            const display = document.getElementById('distributionDisplay');
            display.innerHTML = `
                Townsfolk: ${targetDistribution.townsfolk} |
                Outsiders: ${targetDistribution.outsider} |
                Minions: ${targetDistribution.minion} |
                Demons: ${targetDistribution.demon}
            `;
        }

        function populateRoleSelectionUI() {
            const teams = ['townsfolk', 'outsider', 'minion', 'demon'];

            teams.forEach(team => {
                const container = document.getElementById(`${team}Roles`);
                container.innerHTML = '';

                const teamRoles = getScriptRoles(currentScript).filter(role => role.team === team);

                teamRoles.forEach(role => {
                    const roleCard = document.createElement('div');
                    roleCard.className = `role-selection-card ${team}`;
                    roleCard.dataset.roleId = role.id;
                    roleCard.onclick = () => toggleRoleSelection(role.id);

                    roleCard.innerHTML = `
                        <div class="role-selection-name">${role.name}</div>
                        <div class="role-selection-ability">${role.ability}</div>
                    `;

                    container.appendChild(roleCard);
                });
            });
        }

        function toggleRoleSelection(roleId) {
            const roleCard = document.querySelector(`[data-role-id="${roleId}"]`);
            const isSelected = selectedRoles.includes(roleId);

            if (isSelected) {
                selectedRoles = selectedRoles.filter(id => id !== roleId);
                roleCard.classList.remove('selected');
            } else {
                selectedRoles.push(roleId);
                roleCard.classList.add('selected');
            }

            updateSelectionCounts();
        }

        function updateSelectionCounts() {
            const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };

            selectedRoles.forEach(roleId => {
                const role = getScriptRoles(currentScript).find(r => r.id === roleId);
                if (role) {
                    counts[role.team]++;
                }
            });

            // Update count displays and styling
            ['townsfolk', 'outsider', 'minion', 'demon'].forEach(team => {
                const countEl = document.getElementById(`${team}Count`);
                const targetEl = document.getElementById(`${team}Target`);

                countEl.textContent = counts[team];
                targetEl.textContent = targetDistribution[team];

                // Update styling based on match
                const headerEl = countEl.closest('.team-header');
                headerEl.classList.remove('distribution-match', 'distribution-over', 'distribution-under');

                if (counts[team] === targetDistribution[team]) {
                    headerEl.classList.add('distribution-match');
                } else if (counts[team] > targetDistribution[team]) {
                    headerEl.classList.add('distribution-over');
                } else {
                    headerEl.classList.add('distribution-under');
                }
            });

            // Update overall status
            updateSelectionStatus(counts);
        }

        function updateSelectionStatus(counts) {
            const statusEl = document.getElementById('currentSelectionStatus');
            const totalSelected = Object.values(counts).reduce((a, b) => a + b, 0);
            const totalTarget = Object.values(targetDistribution).reduce((a, b) => a + b, 0);

            let statusText = `Selected: ${totalSelected}/${totalTarget} roles`;
            let statusClass = 'status ';

            if (totalSelected === totalTarget) {
                const isExactMatch = ['townsfolk', 'outsider', 'minion', 'demon'].every(
                    team => counts[team] === targetDistribution[team]
                );

                if (isExactMatch) {
                    statusText += ' - Perfect match! ✓';
                    statusClass += 'connected';
                } else {
                    statusText += ' - Total matches, but distribution differs';
                    statusClass += 'status'; // neutral
                }
            } else {
                statusClass += 'disconnected';
            }

            statusEl.textContent = statusText;
            statusEl.className = statusClass;
        }

        function randomlySelectRoles() {
            // Clear current selection
            selectedRoles = [];
            document.querySelectorAll('.role-selection-card.selected').forEach(card => {
                card.classList.remove('selected');
            });

            // Select roles randomly based on distribution
            const rolesByTeam = {
                townsfolk: getScriptRoles(currentScript).filter(r => r.team === 'townsfolk'),
                outsider: getScriptRoles(currentScript).filter(r => r.team === 'outsider'),
                minion: getScriptRoles(currentScript).filter(r => r.team === 'minion'),
                demon: getScriptRoles(currentScript).filter(r => r.team === 'demon')
            };

            Object.entries(targetDistribution).forEach(([team, count]) => {
                const availableRoles = [...rolesByTeam[team]];

                for (let i = 0; i < count && availableRoles.length > 0; i++) {
                    const randomIndex = Math.floor(Math.random() * availableRoles.length);
                    const selectedRole = availableRoles.splice(randomIndex, 1)[0];
                    selectedRoles.push(selectedRole.id);

                    const roleCard = document.querySelector(`[data-role-id="${selectedRole.id}"]`);
                    roleCard.classList.add('selected');
                }
            });

            updateSelectionCounts();
        }

        function clearAllRoles() {
            selectedRoles = [];
            document.querySelectorAll('.role-selection-card.selected').forEach(card => {
                card.classList.remove('selected');
            });
            updateSelectionCounts();
        }

        function goBackToSetup() {
            document.getElementById('roleSelectionScreen').classList.add('hidden');
            document.getElementById('setupScreen').classList.remove('hidden');
        }

        function distributeSelectedRolesToPlayers() {
            if (selectedRoles.length === 0 || players.length === 0) {
                return;
            }

            // Create array of selected role objects
            const rolesToDistribute = selectedRoles.map(roleId =>
                getScriptRoles(currentScript).find(role => role.id === roleId)
            ).filter(role => role); // Remove any undefined roles

            // Shuffle the roles
            for (let i = rolesToDistribute.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rolesToDistribute[i], rolesToDistribute[j]] = [rolesToDistribute[j], rolesToDistribute[i]];
            }

            // Shuffle the players
            const shuffledPlayers = [...players];
            for (let i = shuffledPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
            }

            // Clear existing assignments
            initializePlayerRoles();

            // Assign roles to players
            for (let i = 0; i < Math.min(shuffledPlayers.length, rolesToDistribute.length); i++) {
                playerRoles[shuffledPlayers[i]] = rolesToDistribute[i].id;
            }

        console.log('Roles distributed:', playerRoles); // Debug line
        }

        function proceedWithSelectedRoles() {
            if (selectedRoles.length === 0) {
                alert('Please select at least one role');
                return;
            }

            // Hide the role selection screen
            document.getElementById('roleSelectionScreen').classList.add('hidden');

            // Automatically distribute the selected roles to players
            distributeSelectedRolesToPlayers();

            // Update the players list to show the assigned roles AFTER distribution
            setTimeout(() => {
                updatePlayersList();
            }, 100);

            // Populate target player dropdown for new games
            const targetSelect = document.getElementById('targetPlayer');
            const orderedPlayers = getOrderedPlayersForNight();
            targetSelect.innerHTML = '<option value="">Select player...</option>';
            orderedPlayers.forEach(player => {
                if (player === '-----') {
                    const separator = document.createElement('option');
                    separator.value = '';
                    separator.textContent = '-----';
                    separator.disabled = true;
                    targetSelect.appendChild(separator);
                } else {
                    const option = document.createElement('option');
                    option.value = player;
                    option.textContent = player;
                    targetSelect.appendChild(option);
                }
            });

            switchToGameScreen();

            // Broadcast the role assignments
            setTimeout(() => {
                pubnub.publish({
                    channel: currentRoom,
                    message: {
                        gameId: currentGameId,
                        type: 'role_assignment',
                        playerRoles: playerRoles,
                        timestamp: Date.now()
                    }
                });
        }, 1000);
        }

        function distributeAllRoles() {
            if (!playerRoles || Object.keys(playerRoles).length === 0) {
                alert('No roles assigned yet');
                return;
            }


            // Check for roles with believesToBe property
            const playersWithMisimpressions = [];

            players.forEach(player => {
                const roleId = playerRoles[player];
                if (roleId) {
                    const role = getRoleById(roleId);
                    if (role && role.believesToBe) {
                        playersWithMisimpressions.push({
                            player: player,
                            actualRole: role.name,
                            believesToBe: role.believesToBe
                        });
                    }
                }
            });

            // Check for duplicate role assignments
            const roleAssignments = {};
            const duplicateRoles = [];

            players.forEach(player => {
                const roleId = playerRoles[player];
                if (roleId) {
                    if (roleAssignments[roleId]) {
                        // This role is already assigned to someone else
                        if (!duplicateRoles.find(d => d.roleId === roleId)) {
                            const role = getRoleById(roleId);
                            duplicateRoles.push({
                                roleId: roleId,
                                roleName: role ? role.name : roleId,
                                players: [roleAssignments[roleId]]
                            });
                        }
                        duplicateRoles.find(d => d.roleId === roleId).players.push(player);
                    } else {
                        roleAssignments[roleId] = player;
                    }
                }
            });

            // If there are duplicate roles, show confirmation
            if (duplicateRoles.length > 0) {
                const duplicateList = duplicateRoles.map(d =>
                    `• ${d.roleName}: ${d.players.join(', ')}`
                ).join('\n');

                const confirmMessage = `WARNING: The following roles are assigned to multiple players:\n\n${duplicateList}\n\nThis is usually a mistake. Are you sure you want to distribute roles with duplicates?`;

                if (!confirm(confirmMessage)) {
                    return; // Cancel distribution
                }
            }


            // If there are players with misimpressions, show confirmation
            if (playersWithMisimpressions.length > 0) {
                const playerList = playersWithMisimpressions.map(p =>
                    `• ${p.player} (actually ${p.actualRole}, believes to be ${p.believesToBe})`
                ).join('\n');

                const confirmMessage = `WARNING: The following players have roles where they should NOT know their true identity:\n\n${playerList}\n\nThese players should receive tokens for roles they believe they have, not their actual roles. Are you sure you want to distribute roles now?`;

                if (!confirm(confirmMessage)) {
                    return; // Cancel distribution
                }
            }

            let sentCount = 0;

            players.forEach(player => {
                const roleId = playerRoles[player];
                if (roleId) {
                    const role = getRoleById(roleId);
                    if (role) {
                        // Determine team alignment
                        const teamAlignment = (role.team === 'townsfolk' || role.team === 'outsider')
                            ? 'You are good.'
                            : 'You are evil.';

                        const message = {
                            gameId: currentGameId,
                            type: 'private_message',
                            messageType: 'info',
                            from: currentUser,
                            to: player,
                            content: `Your role is ${role.name}. ${teamAlignment} ${role.ability.replace(/night\*/g, 'night (not the first)')}`,
                            templateData: { role: roleId },
                            timestamp: Date.now() + sentCount // Slight offset to prevent timestamp collisions
                        };

                        // Display locally first (as "sending")
                        displayMessage(message, true);
                        sentMessages.set(message.timestamp, true);

                        pubnub.publish({
                            channel: currentRoom,
                            message: message
                        });

                        sentCount++;
                    }
                }
            });

            if (sentCount > 0) {
                alert(`Sent role assignments to ${sentCount} players`);
                storytellerWorkflowState = 'minion_demon_info';
                updateStorytellerWorkflowUI();
            } else {
                alert('No roles to distribute');
            }
        }

        function distributeMinionAndDemonInfo() {
            let sentCount = 0;
            let demon = '';
            let minions = [];

            players.forEach(player => {
                const roleId = playerRoles[player];
                if (roleId) {
                    const role = getRoleById(roleId);
                    if (role?.team === 'demon') {
                        demon = player
                    } else if (role?.team === 'minion') {
                        minions.push(player)
                    }
                }
            });

            // Send Demon Message
            let messageForDemon = minions.length === 1 ? 'Your minion is ' : 'Your minions are '
            messageForDemon += `${minions.join(', ')}.`;
            const message = {
                gameId: currentGameId,
                type: 'private_message',
                messageType: 'info',
                from: currentUser,
                to: demon,
                content: messageForDemon,
                timestamp: Date.now() + sentCount // Slight offset to prevent timestamp collisions
            };

            // Display locally first (as "sending")
            displayMessage(message, true);
            sentMessages.set(message.timestamp, true);

            pubnub.publish({
                channel: currentRoom,
                message: message
            });

            sentCount++;

            // Send Minion Messages
            minions.forEach(minion => {
                let messageForMinions = `The demon is ${demon}.`

                if (minions.length > 1) {
                    messageForMinions += minions.length === 2 ? ' The other minion is ' : ' The other minions are '

                    const otherMinions = minions.filter(innerMinion => minion !== innerMinion)

                    messageForMinions += `${otherMinions.join(', ')}.`
                }

                const message = {
                    gameId: currentGameId,
                    type: 'private_message',
                    messageType: 'info',
                    from: currentUser,
                    to: minion,
                    content: messageForMinions,
                    timestamp: Date.now() + sentCount // Slight offset to prevent timestamp collisions
                };

                // Display locally first (as "sending")
                displayMessage(message, true);
                sentMessages.set(message.timestamp, true);

                pubnub.publish({
                    channel: currentRoom,
                    message: message
                });

                sentCount++;
            })

            if (sentCount > 0) {
                alert(`Sent minion/demon info to ${sentCount} players`);
                storytellerWorkflowState = 'night_action';
                updateStorytellerWorkflowUI();
            } else {
                alert('No minion/demon info to distribute');
            }
        }

        function showChangeRoleModal() {
            if (!selectedPlayerForRole) return;

            const modal = document.getElementById('changeRoleModal');
            const title = document.getElementById('changeRoleTitle');
            const roleSelect = document.getElementById('roleSelect');

            title.textContent = `Change Role for ${selectedPlayerForRole}`;

            // Populate role dropdown (same logic as before)
            roleSelect.innerHTML = '<option value="">No role assigned</option>';

            if (currentScript) {
                const rolesByTeam = {
                    townsfolk: [],
                    outsider: [],
                    minion: [],
                    demon: []
                };

                getScriptRoles(currentScript).forEach(role => {
                    rolesByTeam[role.team].push(role);
                });

                const teamNames = {
                    townsfolk: '👥 Townsfolk',
                    outsider: '🚪 Outsiders',
                    minion: '😈 Minions',
                    demon: '👹 Demons'
                };

                Object.entries(rolesByTeam).forEach(([team, roles]) => {
                    if (roles.length > 0) {
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = teamNames[team];

                        roles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role.id;
                            option.textContent = role.name;
                            optgroup.appendChild(option);
                        });

                        roleSelect.appendChild(optgroup);
                    }
                });
            }

            // Set current role if any
            if (playerRoles[selectedPlayerForRole]) {
                roleSelect.value = playerRoles[selectedPlayerForRole];
            }

            // Hide main modal and show change role modal
            document.getElementById('roleAssignmentModal').classList.add('hidden');
            modal.classList.remove('hidden');
        }

        function closeChangeRoleModal() {
            document.getElementById('changeRoleModal').classList.add('hidden');
            document.getElementById('roleAssignmentModal').classList.remove('hidden');
        }

        function confirmRoleChange() {
            if (!selectedPlayerForRole) return;

            const roleSelect = document.getElementById('roleSelect');
            const selectedRole = roleSelect.value || null;

            // Update local state
            playerRoles[selectedPlayerForRole] = selectedRole;

            // Broadcast role assignment
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'role_assignment',
                    playerRoles: playerRoles,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeChangeRoleModal();
            closeRoleAssignmentModal();
        }

        function showChangeSeatModal() {
            if (!selectedPlayerForRole) return;

            const modal = document.getElementById('changeSeatModal');
            const title = document.getElementById('changeSeatTitle');
            const seatSelect = document.getElementById('seatSelect');

            title.textContent = `Change Seat for ${selectedPlayerForRole}`;

            // Populate seat dropdown
            seatSelect.innerHTML = '<option value="">No seat assigned</option>';

            for (i=0;i<players.length;i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `Seat ${i+1}`;
                seatSelect.appendChild(option);
            }

            // Set current seat if any
            if (playerRoles[selectedPlayerForRole]) {
                seatSelect.value = players.indexOf(selectedPlayerForRole);
            }

            // Hide main modal and show change role modal
            document.getElementById('roleAssignmentModal').classList.add('hidden');
            modal.classList.remove('hidden');
        }

        function closeChangeSeatModal() {
            document.getElementById('changeSeatModal').classList.add('hidden');
            document.getElementById('roleAssignmentModal').classList.remove('hidden');
        }

        function confirmSeatChange() {
            if (!selectedPlayerForRole) return;

            const seatSelect = document.getElementById('seatSelect');
            const selectedSeat = seatSelect.value || null;
            const prevSeat = players.indexOf(selectedPlayerForRole);

            // Update local state
            players.splice(selectedSeat, 0, players.splice(prevSeat, 1)[0]);

            // Broadcast role assignment
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'seat_assignment',
                    players: players,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeChangeSeatModal();
            closeRoleAssignmentModal();
        }

        function showAddReminderModal() {
            if (!selectedPlayerForRole) return;

            const modal = document.getElementById('addReminderModal');
            const title = document.getElementById('addReminderTitle');
            const textArea = document.getElementById('reminderText');

            title.textContent = `Add Reminder for ${selectedPlayerForRole}`;
            textArea.value = '';

            // Hide main modal and show add reminder modal
            document.getElementById('roleAssignmentModal').classList.add('hidden');
            modal.classList.remove('hidden');
            textArea.focus();
        }

        function closeAddReminderModal() {
            document.getElementById('addReminderModal').classList.add('hidden');
            document.getElementById('roleAssignmentModal').classList.remove('hidden');
        }

        function confirmAddReminder() {
            if (!selectedPlayerForRole) return;

            const textArea = document.getElementById('reminderText');
            const reminderText = textArea.value.trim();

            if (!reminderText) {
                alert('Please enter a reminder note');
                return;
            }

            // Initialize reminders array if it doesn't exist
            if (!playerReminders[selectedPlayerForRole]) {
                playerReminders[selectedPlayerForRole] = [];
            }

            // Add reminder
            playerReminders[selectedPlayerForRole].push(reminderText);

            // Broadcast reminder update
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'reminder_update',
                    playerReminders: playerReminders,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeAddReminderModal();
            closeRoleAssignmentModal();
        }

        function togglePlayerDeath() {
            if (!selectedPlayerForRole) return;

            const currentState = playerDeathState[selectedPlayerForRole] || 'alive';
            const newState = currentState === 'alive' ? 'dead' : 'alive';

            // Update local state
            playerDeathState[selectedPlayerForRole] = newState;

            // Broadcast death state update
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'death_update',
                    playerDeathState: playerDeathState,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeRoleAssignmentModal();
        }

        function togglePlayerGhostVote() {
            if (!selectedPlayerForRole) return;

            const currentState = playerGhostVotes[selectedPlayerForRole] ?? true;
            const newState = !currentState;

            // Update local state
            playerGhostVotes[selectedPlayerForRole] = newState;

            // Broadcast ghost vote state update
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'ghost_vote_update',
                    playerGhostVotes: playerGhostVotes,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeRoleAssignmentModal();
        }

        function showRemoveReminderModal() {
            if (!selectedPlayerForRole) return;

            const reminders = playerReminders[selectedPlayerForRole] || [];
            if (reminders.length === 0) {
                alert('No reminders to remove for this player');
                return;
            }

            const modal = document.getElementById('removeReminderModal');
            const title = document.getElementById('removeReminderTitle');
            const select = document.getElementById('reminderSelect');

            title.textContent = `Remove Reminder for ${selectedPlayerForRole}`;

            // Populate reminder dropdown
            select.innerHTML = '<option value="">Select reminder...</option>';
            reminders.forEach((reminder, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = reminder.length > 50 ? reminder.substring(0, 50) + '...' : reminder;
                select.appendChild(option);
            });

            // Hide main modal and show remove reminder modal
            document.getElementById('roleAssignmentModal').classList.add('hidden');
            modal.classList.remove('hidden');
        }

        function closeRemoveReminderModal() {
            document.getElementById('removeReminderModal').classList.add('hidden');
            document.getElementById('roleAssignmentModal').classList.remove('hidden');
        }

        function confirmRemoveReminder() {
            if (!selectedPlayerForRole) return;

            const select = document.getElementById('reminderSelect');
            const reminderIndex = parseInt(select.value);

            if (isNaN(reminderIndex)) {
                alert('Please select a reminder to remove');
                return;
            }

            // Remove reminder
            if (playerReminders[selectedPlayerForRole]) {
                playerReminders[selectedPlayerForRole].splice(reminderIndex, 1);
            }

            // Broadcast reminder update
            pubnub.publish({
                channel: currentRoom,
                message: {
                    gameId: currentGameId,
                    type: 'reminder_update',
                    playerReminders: playerReminders,
                    timestamp: Date.now()
                }
            });

            updatePlayersList();
            closeRemoveReminderModal();
            closeRoleAssignmentModal();
        }

        function editGameId() {
            const modal = document.getElementById('gameIdEditModal');
            const input = document.getElementById('newGameId');

            input.value = currentGameId || '';
            modal.classList.remove('hidden');
            input.focus();
        }

        function closeGameIdEditModal() {
            document.getElementById('gameIdEditModal').classList.add('hidden');
        }

        function confirmGameIdChange() {
            const input = document.getElementById('newGameId');
            const newGameId = input.value.trim();

            if (!newGameId) {
                alert('Please enter a valid game ID');
                return;
            }

            currentGameId = newGameId;
            document.getElementById('displayGameId').textContent = currentGameId;

            // Update URL with new game ID
            updateURL();

            // If we're a storyteller, broadcast the new game state
            if (userType === 'storyteller') {
                sendGameSetup();
            }

            closeGameIdEditModal();
        }

        // URL Parameter Handling Functions
        function getURLParams() {
            const params = new URLSearchParams(window.location.search);
            return {
                gameId: params.get('gameId'),
                player: params.get('player'),
                room: params.get('room'),
                userType: params.get('userType')
            };
        }

        function updateURL() {
            if (!currentGameId && !currentUser) {
                // No state to preserve, don't update URL
                return;
            }

            const params = new URLSearchParams();
            
            if (currentGameId) {
                params.set('gameId', currentGameId);
            }
            if (currentUser && currentUser !== 'Storyteller') {
                params.set('player', currentUser);
            }
            if (currentRoom) {
                params.set('room', currentRoom);
            }
            if (userType) {
                params.set('userType', userType);
            }

            const newURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
            window.history.replaceState(null, '', newURL);
        }

        function restoreFromURL() {
            const urlParams = getURLParams();
            
            if (!urlParams.gameId && !urlParams.player && !urlParams.room) {
                // No URL parameters, start fresh
                return false;
            }

            console.log('Restoring from URL parameters:', urlParams);

            // Restore basic state
            if (urlParams.gameId) {
                currentGameId = urlParams.gameId;
            }
            if (urlParams.room) {
                currentRoom = urlParams.room;
            }
            if (urlParams.userType) {
                userType = urlParams.userType;
                document.getElementById('userType').value = userType;
                
                // Trigger the change event to show appropriate UI
                const userTypeSelect = document.getElementById('userType');
                userTypeSelect.dispatchEvent(new Event('change'));
            }

            // Restore user-specific state
            if (urlParams.player && urlParams.userType === 'player') {
                currentUser = urlParams.player;
                
                // Auto-populate the room field for players
                if (currentRoom) {
                    document.getElementById('gameRoomPlayer').value = currentRoom;
                }
            } else if (urlParams.userType === 'storyteller') {
                currentUser = 'Storyteller';
                
                // Auto-populate the room field for storytellers
                if (currentRoom) {
                    document.getElementById('gameRoom').value = currentRoom;
                }
                
                // Set to reconnect mode since we're restoring state
                selectGameMode('reconnect');
            }

            // If we have enough information, try to rejoin the game
            if (currentRoom && currentUser && userType) {
                console.log('Auto-joining game from URL parameters');
                
                // Initialize PubNub connection
                initializePubNub();
                
                // Switch to game screen
                switchToGameScreen();
                
                // If we're a player, request game state
                if (userType === 'player') {
                    // Request current game state from storyteller
                    setTimeout(() => {
                        pubnub.publish({
                            channel: currentRoom,
                            message: {
                                type: 'request_game_state',
                                from: currentUser,
                                timestamp: Date.now()
                            }
                        });
                    }, 1000); // Wait a moment for connection to establish
                }
                
                return true;
            }
            
            return false;
        }

        // Modified joinGame function to update URL
        const originalJoinGame = joinGame;
        joinGame = function() {
            const result = originalJoinGame.apply(this, arguments);
            
            // Update URL after joining
            setTimeout(() => {
                updateURL();
            }, 100);
            
            return result;
        };

        // Page initialization
        function initializePage() {
            // Fix the bug: populate script dropdown
            populateScriptDropdown();
            
            // Try to restore state from URL
            const restored = restoreFromURL();
            
            if (!restored) {
                console.log('Starting fresh - no URL parameters to restore');
            }
        }

        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', initializePage);
        
        // Handle browser back/forward buttons
        window.addEventListener('popstate', function(event) {
            // Refresh the page when user navigates back/forward
            // This ensures we restore the correct state
            window.location.reload();
        });

