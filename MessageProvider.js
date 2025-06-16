/**
 * Abstract MessageProvider interface for handling real-time messaging
 * Used by both storytellers and players with role-specific helper methods
 */
class MessageProvider {
    constructor() {
        this.currentChannel = null;
        this.currentGameId = null;
    }

    /**
     * Connect to the messaging service
     * @param {Object} config - Configuration object containing service-specific settings
     * @param {string} config.publishKey - Publish key for the service
     * @param {string} config.subscribeKey - Subscribe key for the service
     * @param {string} [config.userId] - Optional user identifier
     * @returns {Promise<void>} Resolves when connection is established
     */
    async connect(config) {
        throw new Error('connect() must be implemented');
    }

    /**
     * Subscribe to a channel for real-time messages
     * @param {string} channel - The channel name to subscribe to
     * @param {function(Object): void} messageHandler - Callback function for incoming messages
     * @param {Object} messageHandler.message - The received message object
     * @param {string} messageHandler.message.type - Message type (e.g., 'game_setup', 'private_message')
     * @param {number} messageHandler.message.timestamp - Unix timestamp when message was sent
     * @param {string} messageHandler.message.gameId - Game identifier
     * @param {string} messageHandler.message.from - Sender identifier
     * @param {string} [messageHandler.message.to] - Recipient identifier (for private messages)
     * @returns {void}
     */
    subscribe(channel, messageHandler) {
        throw new Error('subscribe() must be implemented');
    }

    /**
     * Publish a message to a channel
     * @param {string} channel - The channel name to publish to
     * @param {Object} message - The message object to send
     * @param {string} message.type - Message type (e.g., 'game_setup', 'private_message', 'phase_change')
     * @param {number} message.timestamp - Unix timestamp
     * @param {string} message.gameId - Game identifier
     * @param {string} message.from - Sender identifier
     * @param {string} [message.to] - Recipient identifier (for private messages)
     * @returns {Promise<void>} Resolves when message is published
     */
    async publish(channel, message) {
        throw new Error('publish() must be implemented');
    }

    /**
     * Retrieve message history from a channel
     * @param {string} channel - The channel name to get history from
     * @param {number} [limit=100] - Maximum number of messages to retrieve
     * @returns {Promise<Array<Object>>} Array of message objects, oldest first
     */
    async getHistory(channel, limit = 100) {
        throw new Error('getHistory() must be implemented');
    }

    /**
     * Disconnect from the messaging service
     * @returns {void}
     */
    disconnect() {
        throw new Error('disconnect() must be implemented');
    }

    // Configuration helpers
    
    /**
     * Set the current channel for convenience methods
     * @param {string} channel - Channel name
     */
    setChannel(channel) {
        this.currentChannel = channel;
    }

    /**
     * Set the current game ID for convenience methods
     * @param {string} gameId - Game identifier
     */
    setGameId(gameId) {
        this.currentGameId = gameId;
    }

    // Convenience methods for common message patterns

    /**
     * Publish a game-related message with standard fields populated
     * @param {string} messageType - The message type
     * @param {Object} data - Additional message data
     * @param {string} data.from - Sender identifier
     * @param {string} [data.to] - Recipient identifier (for private messages)
     * @returns {Promise<void>}
     */
    async publishGameMessage(messageType, data) {
        if (!this.currentChannel) {
            throw new Error('No channel set. Call setChannel() first.');
        }
        
        const message = {
            type: messageType,
            timestamp: Date.now(),
            gameId: this.currentGameId,
            ...data
        };
        
        return this.publish(this.currentChannel, message);
    }

    /**
     * Publish a game setup message (storyteller -> all players)
     * @param {Object} gameData - Game setup data
     * @param {string} gameData.script - Script name
     * @param {Array<string>} gameData.players - Player names
     * @param {string} gameData.from - Storyteller name
     * @returns {Promise<void>}
     */
    async publishGameSetup(gameData) {
        return this.publishGameMessage('game_setup', gameData);
    }

    /**
     * Publish a role assignment message (storyteller -> specific player)
     * @param {Object} assignmentData - Role assignment data
     * @param {string} assignmentData.to - Player name
     * @param {string} assignmentData.role - Role identifier
     * @param {string} assignmentData.from - Storyteller name
     * @returns {Promise<void>}
     */
    async publishRoleAssignment(assignmentData) {
        return this.publishGameMessage('role_assignment', assignmentData);
    }

    /**
     * Publish a player response (player -> storyteller)
     * @param {Object} responseData - Response data
     * @param {string} responseData.to - Storyteller name
     * @param {string} responseData.response - Player's response
     * @param {string} responseData.from - Player name
     * @returns {Promise<void>}
     */
    async publishPlayerResponse(responseData) {
        return this.publishGameMessage('player_response', responseData);
    }

    /**
     * Publish a phase change message (storyteller -> all players)
     * @param {Object} phaseData - Phase change data
     * @param {string} phaseData.phase - New phase ('day' or 'night')
     * @param {number} [phaseData.nightNumber] - Night number (for night phases)
     * @param {string} phaseData.from - Storyteller name
     * @returns {Promise<void>}
     */
    async publishPhaseChange(phaseData) {
        return this.publishGameMessage('phase_change', phaseData);
    }
}

/**
 * PubNub implementation of MessageProvider
 */
class PubNubProvider extends MessageProvider {
    constructor() {
        super();
        this.pubnub = null;
        this.messageListener = null;
    }

    /**
     * @override
     */
    async connect(config) {
        // Dynamically import PubNub if not already loaded
        if (typeof PubNub === 'undefined') {
            throw new Error('PubNub library not loaded');
        }

        this.pubnub = new PubNub({
            publishKey: config.publishKey,
            subscribeKey: config.subscribeKey,
            userId: config.userId || 'user-' + Date.now()
        });

        // PubNub connection is implicit, but we can test it
        return Promise.resolve();
    }

    /**
     * @override
     */
    subscribe(channel, messageHandler) {
        if (!this.pubnub) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Remove existing listener if present
        if (this.messageListener) {
            this.pubnub.removeListener(this.messageListener);
        }

        // Create new listener
        this.messageListener = {
            message: function(messageEvent) {
                messageHandler(messageEvent.message);
            }
        };

        this.pubnub.addListener(this.messageListener);
        this.pubnub.subscribe({ channels: [channel] });
    }

    /**
     * @override
     */
    async publish(channel, message) {
        if (!this.pubnub) {
            throw new Error('Not connected. Call connect() first.');
        }

        return new Promise((resolve, reject) => {
            this.pubnub.publish({
                channel: channel,
                message: message
            }, (status, response) => {
                if (status.error) {
                    reject(new Error(status.errorData?.message || 'Publish failed'));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * @override
     */
    async getHistory(channel, limit = 100) {
        if (!this.pubnub) {
            throw new Error('Not connected. Call connect() first.');
        }

        return new Promise((resolve, reject) => {
            this.pubnub.history({
                channel: channel,
                count: limit
            }, (status, response) => {
                if (status.error) {
                    reject(new Error(status.errorData?.message || 'History fetch failed'));
                } else {
                    // PubNub returns messages in format: [[message1, message2, ...], startTime, endTime]
                    const messages = response.messages || [];
                    resolve(messages.map(msg => msg.entry || msg));
                }
            });
        });
    }

    /**
     * @override
     */
    disconnect() {
        if (this.pubnub) {
            if (this.messageListener) {
                this.pubnub.removeListener(this.messageListener);
                this.messageListener = null;
            }
            this.pubnub.unsubscribeAll();
            this.pubnub = null;
        }
    }
}

/**
 * Mock implementation for testing
 */
class MockProvider extends MessageProvider {
    constructor() {
        super();
        this.messages = [];
        this.subscribers = new Map();
        this.connected = false;
    }

    /**
     * @override
     */
    async connect(config) {
        this.connected = true;
        console.log('MockProvider: Connected with config', config);
        return Promise.resolve();
    }

    /**
     * @override
     */
    subscribe(channel, messageHandler) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }
        
        this.subscribers.set(channel, messageHandler);
        console.log('MockProvider: Subscribed to channel', channel);
    }

    /**
     * @override
     */
    async publish(channel, message) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Store message
        this.messages.push({ channel, message, timestamp: Date.now() });
        console.log('MockProvider: Published to', channel, message);

        // Notify subscribers
        const handler = this.subscribers.get(channel);
        if (handler) {
            // Simulate async delivery
            setTimeout(() => handler(message), 10);
        }

        return Promise.resolve();
    }

    /**
     * @override
     */
    async getHistory(channel, limit = 100) {
        if (!this.connected) {
            throw new Error('Not connected. Call connect() first.');
        }

        const channelMessages = this.messages
            .filter(msg => msg.channel === channel)
            .slice(-limit)
            .map(msg => msg.message);

        console.log('MockProvider: Retrieved history for', channel, channelMessages.length, 'messages');
        return Promise.resolve(channelMessages);
    }

    /**
     * @override
     */
    disconnect() {
        this.connected = false;
        this.subscribers.clear();
        console.log('MockProvider: Disconnected');
    }

    // Test helpers
    getMessageCount(channel = null) {
        if (channel) {
            return this.messages.filter(msg => msg.channel === channel).length;
        }
        return this.messages.length;
    }

    clearMessages() {
        this.messages = [];
    }
}

/**
 * Factory function to create message providers
 * @param {string} type - Provider type ('pubnub' or 'mock')
 * @param {Object} config - Provider configuration
 * @returns {MessageProvider} Configured provider instance
 */
function createMessageProvider(type, config) {
    const providers = {
        'pubnub': PubNubProvider,
        'mock': MockProvider
    };

    const Provider = providers[type];
    if (!Provider) {
        throw new Error(`Unknown provider type: ${type}. Available: ${Object.keys(providers).join(', ')}`);
    }

    return new Provider();
}

// Export for both CommonJS and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MessageProvider, PubNubProvider, MockProvider, createMessageProvider };
} else if (typeof window !== 'undefined') {
    window.MessageProvider = MessageProvider;
    window.PubNubProvider = PubNubProvider;
    window.MockProvider = MockProvider;
    window.createMessageProvider = createMessageProvider;
}