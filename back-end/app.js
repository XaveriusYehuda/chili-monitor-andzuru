const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mqttService = require('./mqtt-service');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());

// WebSocket Server untuk client lokal
const wss = new WebSocket.Server({ server });
const clients = new Set();

// Cache data sensor (FIFO, max 10 data per sensor)
const sensorDataCache = new Map(); // <-- ini harus muncul lebih atas!

function normalizeTimestamp(timestamp) {
  if (typeof timestamp === 'string') {
    timestamp = parseFloat(timestamp);
  }
  if (timestamp < 10_000_000_000) {
    return Math.round(timestamp * 1000);
  } else {
    return Math.round(timestamp);
  }
}

function addDataToCache(nilaiSensor, dataItem) {
  if (!sensorDataCache.has(nilaiSensor)) {
    sensorDataCache.set(nilaiSensor, []);
  }

  const cache = sensorDataCache.get(nilaiSensor);

  // Normalize timestamp
  const normalizedTimestamp = normalizeTimestamp(dataItem.timestamp);

  cache.push({
    timestamp: normalizedTimestamp,
    value: dataItem.value
  });

  // Sort cache berdasarkan timestamp ascending
  cache.sort((a, b) => a.timestamp - b.timestamp);

  if (cache.length > 10) cache.shift(); // FIFO (maksimal 10 data)
}



// Client WebSocket ke server eksternal (AWS)
const wsExternal = new WebSocket('wss://0p3brxy598.execute-api.ap-southeast-1.amazonaws.com/production');

wsExternal.on('open', () => {
  console.log('Connected to AWS WebSocket');
  setTimeout(() => {
    wsExternal.send(JSON.stringify({ action: 'getLastData' }));
  }, 500);
});

wsExternal.on('message', (message) => {
  try {
    // console.log('Pesan diterima dari server:', message.toString());
    const parsed = JSON.parse(message);
    if (parsed.action === 'initialData') {
      // console.log('Received initial data:', parsed.data);

      Object.entries(parsed.data).forEach(([sensorType, dataArray]) => {
        dataArray.forEach(item => {
          const payload = item.payload;
          const nilaiSensor = item.nilaiSensor;
          const timestamp = item.time || (payload?.timestamp ?? Date.now());

          if (!payload || typeof payload !== 'object') {
            console.warn('Payload tidak sesuai:', payload);
            return;
          }

          function extractSensorValue(payload) {
            return payload.ph ?? payload.Ph ?? payload.kelembapan ?? payload.Kelembapan ?? null;
          }

          const simplifiedData = {
            timestamp: timestamp,
            value: extractSensorValue(payload)
          };

          addDataToCache(nilaiSensor, simplifiedData);
        });
      });

      // Tampilkan isi cache
      // console.log('Isi sensorDataCache:');
      sensorDataCache.forEach((value, key) => {
        // console.log(`Sensor: ${key}`);
        // console.log(value);
        // console.table(value);
      });
    }

    if (parsed.action === 'dataUpdate') {
      // console.log('Accepted Data: ', parsed.data);

      const sensorPayload = parsed.data;
      // Jika `parsed.data` adalah array → forEach
      if (Array.isArray(sensorPayload)) {
        sensorPayload.forEach((item) => {
          const { nilaiSensor, payload, time } = item;

          const simplifiedData = {
            timestamp: payload.timestamp,
            value: payload.Ph ?? payload.Kelembapan,
          };

          addDataToCache(nilaiSensor, simplifiedData);
        });
      } else if (typeof sensorPayload === 'object') {
        // Jika `parsed.data` adalah objek tunggal
        const { nilaiSensor, payload, time } = sensorPayload;

        const simplifiedData = {
          timestamp: payload.timestamp,
          value: payload.ph ?? payload.Ph ?? payload.kelembapan ?? payload.Kelembapan ?? null,
        };

        addDataToCache(nilaiSensor, simplifiedData);
      };

      // Tampilkan isi cache
      // console.log('Isi sensorDataCache:');
      sensorDataCache.forEach((value, key) => {
        // console.log(`Sensor: ${key}`);
        // console.log(value);
        // console.table(value);
      });
    }
  } catch (error) {
    console.error('Error parsing external WebSocket message:', error);
  }
});

wsExternal.on('close', (code, reason) => {
  console.log(`External WebSocket closed. Code: ${code}, Reason: ${reason}`);
});

// Fungsi bantu untuk chart
function extractChartData(sensorArray) {
  return {
    timestamps: sensorArray.map(d => normalizeTimestamp(d.timestamp)),
    values: sensorArray.map(d => d.value)
  };
}

// Broadcast ke WebSocket client lokal dari MQTT
mqttService.setMessageHandler((topic, payload) => {
  try {
    const phKey = 'device/ph';
    const humidityKey = 'device/humidity';
    const phData = sensorDataCache.get(phKey) || [];
    const humidityData = sensorDataCache.get(humidityKey) || [];

    const rawPayload = JSON.parse(payload.toString());

    // Normalisasi payload: ubah dari { S: "8.5" } jadi 8.5
    function normalizePayload(p) {
      const result = {};
      for (const key in p) {
        if (typeof p[key] === 'object' && p[key].S) {
          const val = p[key].S;
          result[key] = isNaN(val) ? val : parseFloat(val);
        } else {
          result[key] = p[key];
        }
      }
      return result;
    }

    const normalizedData = normalizePayload(rawPayload);
    // console.log('Data diterma dari MQTT: ', normalizedData);

    const message = {
      topic,
      data: {
        Ph: (topic === phKey) ? (normalizedData.Ph ?? normalizedData.ph ?? null) : (phData[phData.length - 1]?.value ?? null),
        Kelembapan: (topic === humidityKey) ? (normalizedData.Kelembapan ?? normalizedData.kelembapan ?? null) : (humidityData[humidityData.length - 1]?.value ?? null)
      },
      timestamp: new Date().toISOString(),
      chartData: {
        ph: extractChartData(phData),
        humidity: extractChartData(humidityData)
      }
    };



    // console.log('👋 Ini adalah pesan yang siap dikirim :', message);

    const messageString = JSON.stringify(message);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
        // console.log('🚀 OTW KIRIM :', messageString);
      }
    });
  } catch (error) {
    console.error('Error broadcasting MQTT message:', error);
  }
});

// WebSocket lokal untuk client UI
wss.on('connection', (ws) => {
  // console.log('New WebSocket client connected');
  clients.add(ws);

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  // Saat client baru connect, kirim data cache
  try {
    const phData = sensorDataCache.get('device/ph') || [];
    const humidityData = sensorDataCache.get('device/humidity') || [];

    const latestPh = phData[phData.length - 1]?.value ?? null;
    const latestHumidity = humidityData[humidityData.length - 1]?.value ?? null;

    const message = {
      topic: 'initialCacheData',
      data: {
        Ph: latestPh,
        Kelembapan: latestHumidity
      },
      timestamp: new Date().toISOString(),
      chartData: {
        ph: extractChartData(phData),
        humidity: extractChartData(humidityData)
      }
    };

    const messageString = JSON.stringify(message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageString);
      // console.log('🚀 Kirim data cache awal ke client:', messageString);
    }
  } catch (error) {
    console.error('Error sending initial cache to client:', error);
  }

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});

// Health check
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Serve static files from Vite build output
const staticDir = path.join(__dirname, 'dist');
app.use(express.static(staticDir));

// Fallback to serve index.html for SPA
app.get('*', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('File index.html tidak ditemukan. Pastikan anda telah menjalankan build Vite terlebih dahulu.');
  }

  res.sendFile(indexPath);
});

// Start server
const PORT = process.env.PORT || 3000;
// const HOST = process.env.NODE_ENV !== 'production' ? 'localhost' : '0.0.0.0';
server.listen(PORT, '0.0.0.0', () => {
console.log(`Server running at http://localhost:${PORT}`);
});
