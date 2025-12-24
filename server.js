const mqtt = require('mqtt');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// HiveMQ Cloud MQTT settings
const mqttClient = mqtt.connect('mqtts://12d8f977a72b4bc9aa32ffa232d2a65.s1.eu.hivemq.cloud:8883', {
    username: process.env.USERNAME,
    password: process.env.PASSWORD,
    rejectUnauthorized: false
});

// SmartThings settings (you'll add these)
const SMARTTHINGS_TOKEN = process.env.SMARTTHINGS_TOKEN || 'YOUR_TOKEN_HERE';
const SMARTTHINGS_DEVICE_ID = process.env.SMARTTHINGS_DEVICE_ID || 'YOUR_DEVICE_ID_HERE';

mqttClient.on('connect', () => {
    console.log('✓ Connected to HiveMQ Cloud');

    // Subscribe to NodeMCU state updates
    mqttClient.subscribe('smartthings/nodemcu/switch/state', (err) => {
        if (!err) {
            console.log('✓ Subscribed to state topic');
        }
    });
});

// When NodeMCU reports state change, update SmartThings
mqttClient.on('message', async (topic, message) => {
    const state = message.toString();
    console.log(`MQTT: ${topic} = ${state}`);

    if (topic === 'smartthings/nodemcu/switch/state') {
        try {
            // Update SmartThings device
            await axios.post(
                `https://api.smartthings.com/v1/devices/${SMARTTHINGS_DEVICE_ID}/commands`,
                {
                    commands: [{
                        component: 'main',
                        capability: 'switch',
                        command: state.toLowerCase()
                    }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${SMARTTHINGS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`✓ Updated SmartThings: ${state}`);
        } catch (error) {
            console.error('✗ SmartThings update failed:', error.message);
        }
    }
});

// Webhook endpoint for SmartThings to control NodeMCU
app.post('/webhook', (req, res) => {
    const { command } = req.body;

    console.log(`SmartThings command: ${command}`);

    // Publish to MQTT
    mqttClient.publish('smartthings/nodemcu/switch/command', command.toUpperCase(), { retain: true });

    res.json({ success: true, message: `Command ${command} sent to NodeMCU` });
});

app.get('/', (req, res) => {
    res.send('MQTT-SmartThings Bridge Running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
});