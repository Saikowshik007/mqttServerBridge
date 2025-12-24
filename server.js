const mqtt = require('mqtt');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Get configuration from environment variables
const MQTT_BROKER = process.env.MQTT_BROKER;
const MQTT_PORT = process.env.MQTT_PORT || '8883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMMAND = process.env.MQTT_TOPIC_COMMAND || 'smartthings/nodemcu/switch/command';
const MQTT_TOPIC_STATE = process.env.MQTT_TOPIC_STATE || 'smartthings/nodemcu/switch/state';
const MQTT_TOPIC_AVAILABILITY = process.env.MQTT_TOPIC_AVAILABILITY || 'smartthings/nodemcu/availability';

const SMARTTHINGS_TOKEN = process.env.SMARTTHINGS_TOKEN;
const SMARTTHINGS_DEVICE_ID = process.env.SMARTTHINGS_DEVICE_ID;

// Validate required environment variables
if (!MQTT_BROKER || !MQTT_USERNAME || !MQTT_PASSWORD) {
    console.error('❌ ERROR: Missing required environment variables!');
    console.error('Required: MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD');
    process.exit(1);
}

console.log('=== MQTT-SmartThings Bridge ===');
console.log(`MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
console.log(`MQTT Username: ${MQTT_USERNAME}`);
console.log(`SmartThings configured: ${SMARTTHINGS_TOKEN ? 'Yes' : 'No'}`);

// Connect to MQTT broker
const mqttClient = mqtt.connect(`mqtts://${MQTT_BROKER}:${MQTT_PORT}`, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    rejectUnauthorized: false,
    reconnectPeriod: 5000,
    keepalive: 60
});

mqttClient.on('connect', () => {
    console.log('✓ Connected to MQTT broker');

    // Subscribe to NodeMCU state updates
    mqttClient.subscribe(MQTT_TOPIC_STATE, (err) => {
        if (!err) {
            console.log(`✓ Subscribed to: ${MQTT_TOPIC_STATE}`);
        } else {
            console.error('✗ Subscribe failed:', err);
        }
    });

    // Subscribe to availability
    mqttClient.subscribe(MQTT_TOPIC_AVAILABILITY, (err) => {
        if (!err) {
            console.log(`✓ Subscribed to: ${MQTT_TOPIC_AVAILABILITY}`);
        }
    });
});

mqttClient.on('error', (error) => {
    console.error('✗ MQTT Error:', error.message);
});

mqttClient.on('reconnect', () => {
    console.log('⟳ Reconnecting to MQTT broker...');
});

mqttClient.on('offline', () => {
    console.log('⚠ MQTT client offline');
});

// When NodeMCU reports state change, update SmartThings
mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();
    console.log(`📨 MQTT message [${topic}]: ${payload}`);

    if (topic === MQTT_TOPIC_STATE) {
        // Update SmartThings device if configured
        if (SMARTTHINGS_TOKEN && SMARTTHINGS_DEVICE_ID) {
            try {
                await axios.post(
                    `https://api.smartthings.com/v1/devices/${SMARTTHINGS_DEVICE_ID}/commands`,
                    {
                        commands: [{
                            component: 'main',
                            capability: 'switch',
                            command: payload.toLowerCase()
                        }]
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${SMARTTHINGS_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                console.log(`✓ Updated SmartThings: ${payload}`);
            } catch (error) {
                console.error('✗ SmartThings update failed:', error.response?.data || error.message);
            }
        }
    } else if (topic === MQTT_TOPIC_AVAILABILITY) {
        console.log(`📡 NodeMCU status: ${payload}`);
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        mqtt: {
            connected: mqttClient.connected,
            broker: MQTT_BROKER
        },
        smartthings: {
            configured: !!(SMARTTHINGS_TOKEN && SMARTTHINGS_DEVICE_ID)
        },
        uptime: process.uptime()
    });
});

// Webhook endpoint for SmartThings to control NodeMCU
app.post('/control', (req, res) => {
    const { command } = req.body;

    if (!command || !['ON', 'OFF', 'on', 'off'].includes(command)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid command. Use ON or OFF'
        });
    }

    const normalizedCommand = command.toUpperCase();
    console.log(`🎛️  Control command received: ${normalizedCommand}`);

    // Publish to MQTT
    mqttClient.publish(MQTT_TOPIC_COMMAND, normalizedCommand, { retain: true }, (err) => {
        if (err) {
            console.error('✗ MQTT publish failed:', err);
            return res.status(500).json({
                success: false,
                error: 'Failed to publish to MQTT'
            });
        }

        console.log(`✓ Published to MQTT: ${normalizedCommand}`);
        res.json({
            success: true,
            message: `Command ${normalizedCommand} sent to NodeMCU`
        });
    });
});

// Get current state
app.get('/status', (req, res) => {
    res.json({
        mqtt_connected: mqttClient.connected,
        topics: {
            command: MQTT_TOPIC_COMMAND,
            state: MQTT_TOPIC_STATE,
            availability: MQTT_TOPIC_AVAILABILITY
        }
    });
});

// Manual publish endpoint (for testing)
app.post('/publish', (req, res) => {
    const { topic, message } = req.body;

    if (!topic || !message) {
        return res.status(400).json({ error: 'Topic and message required' });
    }

    mqttClient.publish(topic, message, { retain: true }, (err) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, topic, message });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/control`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠ SIGTERM received, closing MQTT connection...');
    mqttClient.end();
    process.exit(0);
});