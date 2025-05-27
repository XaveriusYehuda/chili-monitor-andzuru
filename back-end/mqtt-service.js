require('dotenv').config();

const awsIot = require('aws-iot-device-sdk');
const config = require('./config');

class MQTTService {
  constructor() {
    this.messageHandler = null; // Callback untuk handle message
    this.device = this.setupDevice();
  }

  setupDevice() {
    const device = awsIot.device({
      region: config.awsIot.region,
      host: config.awsIot.endpoint,
      clientId: config.awsIot.clientId + '-' + Math.random().toString(36).substring(7),
      protocol: 'wss',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    });

    // Handle MQTT messages
    device.on('connect', () => {
      console.log('Connected to AWS IoT Core');
      device.subscribe(config.awsIot.topic1);
      device.subscribe(config.awsIot.topic2);
      console.log(`Subscribed to topic: ${config.awsIot.topic1}`);
      console.log(`Subscribed to topic: ${config.awsIot.topic2}`);
    });

    device.on('message', (topic, payload) => {
      if (this.messageHandler) {
        this.messageHandler(topic, payload);
      }
    });

    device.on('error', (error) => {
      console.error('MQTT Error:', error);
    });

    return device;
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }
}

module.exports = new MQTTService();