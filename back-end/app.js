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

// Cache data sensor (FIFO, max 10 data per sensor)
const sensorDataCache = new Map();
// Cache khusus untuk initial data dari AWS WebSocket
let sensorInitialDataCache = null;
let sensorInitialDataCacheTimestamp = 0; // Timestamp cache initial data
const INITIAL_DATA_TTL_MS = 5000; // TTL cache initial data (ms)
let pendingInitialDataClients = [];

// WebSocket Server untuk client lokal
const wss = new WebSocket.Server({ server });
const clients = new Set();

// app.js
function normalizeTimestamp(timestamp) {
  if (typeof timestamp === 'string') {
    // Coba parse string ke float, jika gagal fallback ke Date.parse atau Date.now
    const parsed = parseFloat(timestamp);
    if (!isNaN(parsed)) {
        timestamp = parsed;
    } else {
        // Jika string bukan angka murni, coba parse sebagai ISO string atau format lain
        const dateParsed = Date.parse(timestamp);
        if (!isNaN(dateParsed)) {
            timestamp = dateParsed;
        } else {
            console.warn(`Timestamp string tidak dapat dinormalisasi: ${timestamp}. Menggunakan Date.now().`);
            timestamp = Date.now(); // Fallback jika tidak bisa di-parse
        }
    }
  }

  // Jika timestamp sangat kecil (kemungkinan dalam detik)
  let msTimestamp;
  if (timestamp < 10_000_000_000) { // Angka ini sekitar awal 2000-an dalam milidetik
    msTimestamp = Math.round(timestamp * 1000); // Konversi detik ke milidetik
  } else {
    msTimestamp = Math.round(timestamp); // Asumsikan sudah dalam milidetik
  }

  // Tambahkan offset GMT+7 (Jakarta)
  const jakartaOffsetMs = 7 * 60 * 60 * 1000;
  return msTimestamp;
}

// Debounce function
let broadcastTimeout;
const DEBOUNCE_DELAY = 200; // milliseconds

function debouncedBroadcastLatestCacheData() {
  clearTimeout(broadcastTimeout);
  broadcastTimeout = setTimeout(() => {
    broadcastLatestCacheData();
  }, DEBOUNCE_DELAY);
}

function addDataToCache(nilaiSensor, dataItem) {
  if (dataItem.value === null || dataItem.value === undefined || isNaN(dataItem.value)) {
    console.warn(`Data tidak valid (${nilaiSensor}), tidak disimpan:`, dataItem);
    return;
  }

  const normalizedValue = parseFloat(dataItem.value);
  if (isNaN(normalizedValue)) {
    console.warn(`Data nilai sensor tidak bisa dikonversi ke angka (${nilaiSensor}), tidak disimpan:`, dataItem);
    return;
  }

  if (!sensorDataCache.has(nilaiSensor)) {
    sensorDataCache.set(nilaiSensor, []);
  }

  const cache = sensorDataCache.get(nilaiSensor);
  const normalizedTimestamp = normalizeTimestamp(dataItem.timestamp);

  // Periksa apakah ada data yang sama persis (timestamp dan value)
  const isActuallyNewData = !cache.some(item =>
    item.timestamp === normalizedTimestamp && item.value === normalizedValue
  );

  if (isActuallyNewData) {
    // Jika data baru, tambahkan
    cache.push({
        timestamp: normalizedTimestamp,
        value: normalizedValue
    });
    cache.sort((a, b) => a.timestamp - b.timestamp); // Pastikan tetap terurut

    if (cache.length > 10) {
        cache.shift(); // FIFO
    }
    // console.log(`Menambahkan data baru ke cache untuk ${nilaiSensor}: ${new Date(normalizedTimestamp).toISOString()}, Value: ${normalizedValue}`);
    // Panggil debounced broadcast hanya jika ada data baru yang ditambahkan
    debouncedBroadcastLatestCacheData();
  } else {
    // console.log(`Data duplikat terdeteksi untuk ${nilaiSensor}, tidak disimpan.`);
  }
}

// Client WebSocket ke server eksternal (AWS)
const wsExternalUrl  = 'wss://0p3brxy598.execute-api.ap-southeast-1.amazonaws.com/production';

let wsExternal;
let reconnectInterval; // Untuk mengatur interval reconnection

function connectAwsWebSocket() {
  // Clear any existing reconnect interval to prevent multiple connections
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }

  // Hindari membuat koneksi baru jika sudah terbuka atau sedang dalam proses
  if (wsExternal && (wsExternal.readyState === WebSocket.OPEN || wsExternal.readyState === WebSocket.CONNECTING)) {
    console.log('AWS WebSocket sudah terhubung atau sedang menyambung. Tidak membuat koneksi baru.');
    return;
  }

  console.log('🔗 Mencoba menyambung ke AWS WebSocket:', wsExternalUrl);
  wsExternal = new WebSocket(wsExternalUrl);

  wsExternal.onopen = () => {
    console.log('✅ Connected to AWS WebSocket');
    // Request initial data setiap kali terhubung
    setTimeout(() => {
      wsExternal.send(JSON.stringify({ action: 'getLastData' }));
    }, 500);
    // Reset reconnect attempts on successful connection
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  };

  wsExternal.on('message', (message) => {
    try {
      console.log('Pesan diterima dari server:', message.toString());
      const parsed = JSON.parse(message);
      if (parsed.action === 'initialData') {
        console.log('Received initial data:', parsed.data);
        sensorDataCache.clear();

         let initialDataToProcess = [];
        if (Array.isArray(parsed.data)) {
            // Jika parsed.data sudah array (misal: [{nilaiSensor: 'device/ph', ...}])
            initialDataToProcess = parsed.data;
        } else if (typeof parsed.data === 'object' && parsed.data !== null) {
            // Jika parsed.data adalah objek dengan kunci 'ph' dan 'kelembapan'
            if (Array.isArray(parsed.data.ph)) {
                initialDataToProcess = initialDataToProcess.concat(parsed.data.ph);
            }
            if (Array.isArray(parsed.data.kelembapan)) {
                initialDataToProcess = initialDataToProcess.concat(parsed.data.kelembapan);
            }
        } else {
            console.warn('Format parsed.data tidak dikenal di initialData:', parsed.data);
        } // Mengubah objek tunggal menjadi array

        // Simpan initial data ke cache khusus beserta timestamp
        sensorInitialDataCache = Array.isArray(parsed.data) ? parsed.data.map(item => ({...item})) : [];
        sensorInitialDataCacheTimestamp = Date.now();

         initialDataArray.forEach(item => {
          const { nilaiSensor, payload, time } = item;
          if (!payload || typeof payload !== 'object' || !nilaiSensor) {
            console.warn('Payload atau nilaiSensor tidak valid di initialData:', item);
            return;
          }
          let itemTimestamp = time || payload.timestamp;
          if (itemTimestamp === undefined || itemTimestamp === null) {
              itemTimestamp = Date.now();
              console.warn(`Timestamp tidak ditemukan untuk ${nilaiSensor}. Menggunakan Date.now().`);
          }
          const simplifiedData = {
              timestamp: itemTimestamp,
              value: parseFloat(payload.ph ?? payload.Ph ?? payload.kelembapan ?? payload.Kelembapan ?? null),
          };
          if (simplifiedData.value !== null && !isNaN(simplifiedData.value)) {
              addDataToCache(nilaiSensor, simplifiedData);
          } else {
              console.warn(`Nilai sensor tidak valid untuk ${nilaiSensor}:`, simplifiedData);
          }
        });

        // Kirim initial data ke semua client yang sedang menunggu
        if (pendingInitialDataClients.length > 0) {
          const initialDataMsg = {
            topic: 'initialData',
            data: sensorInitialDataCache,
            timestamp: new Date().toISOString()
          };
          pendingInitialDataClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(initialDataMsg));
            }
          });
          pendingInitialDataClients = [];
        }
      }

      if (parsed.action === 'dataUpdate') {
        // console.log('Accepted Data: ', parsed.data);

        const sensorPayload = parsed.data;
        // Jika `parsed.data` adalah array → forEach


        // if (Array.isArray(sensorPayload)) {
        //   sensorPayload.forEach((item) => {
        //     const { nilaiSensor, payload, time } = item;

        //     const simplifiedData = {
        //       timestamp: payload.timestamp,
        //       value: payload.Ph ?? payload.Kelembapan,
        //     };

        //     addDataToCache(nilaiSensor, simplifiedData);
        //   });
        // } else if (typeof sensorPayload === 'object') {
        //   // Jika `parsed.data` adalah objek tunggal
        //   const { nilaiSensor, payload, time } = sensorPayload;

        //   const simplifiedData = {
        //     timestamp: payload.timestamp,
        //     value: payload.ph ?? payload.Ph ?? payload.kelembapan ?? payload.Kelembapan ?? null,
        //   };

        //   addDataToCache(nilaiSensor, simplifiedData);
        // };

        // Perbaikan: Selalu asumsikan `sensorPayload` adalah array atau tangani objek tunggal secara eksplisit
        const itemsToProcess = Array.isArray(sensorPayload) ? sensorPayload : [sensorPayload];

        itemsToProcess.forEach((item) => {
          const { nilaiSensor, payload, time } = item; // `time` juga bisa ada di `dataUpdate`

          if (!payload || typeof payload !== 'object' || !nilaiSensor) {
            console.warn('Payload atau nilaiSensor tidak valid di dataUpdate:', item);
            return;
          }

          const simplifiedData = {
            timestamp: time || payload.timestamp, // Gunakan `time` jika tersedia, atau `payload.timestamp`
            value: parseFloat(payload.ph ?? payload.Ph ?? payload.kelembapan ?? payload.Kelembapan ?? null),
          };

          if (simplifiedData.value !== null && !isNaN(simplifiedData.value)) { // Hanya tambahkan jika nilai valid
              addDataToCache(nilaiSensor, simplifiedData);
          }
        });
        // Tampilkan isi cache
        // console.log('Isi sensorDataCache:');
        // sensorDataCache.forEach((value, key) => {
          // console.log(`Sensor: ${key}`);
          // console.log(value);
          // console.table(value);
        // });
      }
    } catch (error) {
      console.error('Error parsing external WebSocket message:', error);
    }
  });

  wsExternal.on('close', (code, reason) => {
    console.warn(`External WebSocket closed. Code: ${code}, Reason: ${reason}`);
    // Hanya atur interval jika belum ada atau sudah selesai
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        console.log('🔁 Reconnect attempt for AWS WebSocket...');
        connectAwsWebSocket();
      }, 5000); // Coba reconnect setiap 5 detik
    }
  });

  wsExternal.onerror = (error) => {
    console.error('External WebSocket error:', error);
    // Tutup koneksi agar 'onclose' terpicu dan mencoba reconnect
    wsExternal.close();
  };
}

// Fungsi untuk broadcast data cache terbaru ke semua client lokal
function broadcastLatestCacheData() {
  const phData = sensorDataCache.get('device/ph') || [];
  const humidityData = sensorDataCache.get('device/humidity') || [];

  const latestPh = typeof phData[phData.length - 1]?.value === 'number' ? phData[phData.length - 1].value : null;
  const latestHumidity = typeof humidityData[humidityData.length - 1]?.value === 'number' ? humidityData[humidityData.length - 1].value : null;

  // Gunakan waktu Jakarta (WIB, UTC+7)
  const jakartaTime = new Date(Date.now() + (7 * 60 * 60 * 1000));

  const message = {
    topic: 'cacheUpdate', // Gunakan topik yang berbeda untuk update dari cache
    data: {
      Ph: latestPh,
      Kelembapan: latestHumidity
    },
    timestamp: jakartaTime,
    chartData: {
      ph: extractChartData(phData),
      humidity: extractChartData(humidityData)
    }
  };

  const messageString = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageString);
      // console.log('Broadcast cache update ke client:', messageString);
    }
  });
}

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
    // const phData = sensorDataCache.get(phKey) || [];
    // const humidityData = sensorDataCache.get(humidityKey) || [];

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

    // Perbaikan Penting: Tambahkan data MQTT ke cache juga!
    let sensorTypeFromTopic = '';
    let sensorValue = null;
    let timestamp = normalizedData.timestamp; // Ambil timestamp dari MQTT payload
    if (timestamp === undefined || timestamp === null) {
        timestamp = Date.now(); // Fallback jika tidak ada timestamp di MQTT payload
        console.warn(`Timestamp tidak ditemukan di MQTT payload. Menggunakan Date.now().`);
    } // Gunakan timestamp dari payload jika ada, jika tidak, Date.now()

    if (topic === phKey) {
        sensorTypeFromTopic = phKey;
        sensorValue = parseFloat(normalizedData.Ph ?? normalizedData.ph);
    } else if (topic === humidityKey) {
        sensorTypeFromTopic = humidityKey;
        sensorValue = parseFloat(normalizedData.Kelembapan ?? normalizedData.kelembapan);
    }

    if (sensorTypeFromTopic && !isNaN(sensorValue) && sensorValue !== null && sensorValue !== undefined) {
        addDataToCache(sensorTypeFromTopic, { timestamp: timestamp, value: sensorValue });
    }

    // Setelah menambahkan data MQTT ke cache, baru broadcast dari cache
    // broadcastLatestCacheData();

    // const message = {
    //   topic,
    //   data: {
    //     Ph: (topic === phKey) ? (normalizedData.Ph ?? normalizedData.ph ?? null) : (phData[phData.length - 1]?.value ?? null),
    //     Kelembapan: (topic === humidityKey) ? (normalizedData.Kelembapan ?? normalizedData.kelembapan ?? null) : (humidityData[humidityData.length - 1]?.value ?? null)
    //   },
    //   timestamp: new Date().toISOString(),
    //   chartData: {
    //     ph: extractChartData(phData),
    //     humidity: extractChartData(humidityData)
    //   }
    // };

    // // console.log('👋 Ini adalah pesan yang siap dikirim :', message);

    // const messageString = JSON.stringify(message);
    // clients.forEach(client => {
    //   if (client.readyState === WebSocket.OPEN) {
    //     client.send(messageString);
    //     // console.log('🚀 OTW KIRIM :', messageString);
    //   }
    // });
  } catch (error) {
    console.error('Error broadcasting MQTT message:', error);
  }
});

// Panggil fungsi koneksi saat server dimulai
connectAwsWebSocket();

// WebSocket lokal untuk client UI
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  // TTL cache initial data
  const now = Date.now();
  const cacheValid = sensorInitialDataCache && (now - sensorInitialDataCacheTimestamp < INITIAL_DATA_TTL_MS);

  if (cacheValid) {
    // Cache masih valid, langsung kirim ke user
    const initialDataMsg = {
      topic: 'initialData',
      data: sensorInitialDataCache,
      timestamp: new Date().toISOString()
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(initialDataMsg));
    }
  } else {
    // Cache tidak valid, request ke AWS dan masukkan user ke queue
    if (wsExternal && wsExternal.readyState === WebSocket.OPEN) {
      try {
        wsExternal.send(JSON.stringify({ action: 'getLastData' }));
        pendingInitialDataClients.push(ws);
      } catch (err) {
        console.error('Gagal mengirim permintaan initial data ke AWS WebSocket:', err);
      }
    } else {
      console.warn('AWS WebSocket belum siap, initial data tidak dapat diminta sekarang.');
      // Tetap masukkan ke queue, akan dikirim saat initialData diterima
      pendingInitialDataClients.push(ws);
    }
  }

  // Saat client baru connect, kirim data cache
  // try {
  //   const phData = sensorDataCache.get('device/ph') || [];
  //   const humidityData = sensorDataCache.get('device/humidity') || [];

  //   const latestPh = phData[phData.length - 1]?.value ?? null;
  //   const latestHumidity = humidityData[humidityData.length - 1]?.value ?? null;

  //   const message = {
  //     topic: 'initialCacheData',
  //     data: {
  //       Ph: latestPh,
  //       Kelembapan: latestHumidity
  //     },
  //     timestamp: new Date().toISOString(),
  //     chartData: {
  //       ph: extractChartData(phData),
  //       humidity: extractChartData(humidityData)
  //     }
  //   };

  //   const messageString = JSON.stringify(message);
  //   if (ws.readyState === WebSocket.OPEN) {
  //     ws.send(messageString);
  //     // console.log('🚀 Kirim data cache awal ke client:', messageString);
  //   }
  // } catch (error) {
  //   console.error('Error sending initial cache to client:', error);
  // }

  // broadcastLatestCacheData(); // <-- Panggil di sini juga

  // Broadcast data cache terbaru seperti biasa
  broadcastLatestCacheData();

  ws.on('close', () => {
    clients.delete(ws);
    // Hapus dari pending queue jika user disconnect sebelum initial data diterima
    pendingInitialDataClients = pendingInitialDataClients.filter(client => client !== ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
    pendingInitialDataClients = pendingInitialDataClients.filter(client => client !== ws);
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
