import { openDb, saveHumidityDataToDb, savePhDataToDb, getHumidityDataFromDb, getPhDataFromDb, downloadHumidityToCSV, downloadPhToCSV} from './database.js';

// ini untuk akun xyehuda3@gmail.com
// const mqttHost = 'a2spluztzgsdhl-ats.iot.ap-southeast-1.amazonaws.com'; // Ganti sesuai endpoint AWS IoT Core kamu

// ini untuk akun kutusapi99@gmail.com
const mqttHost = 'ae2f0qpfo130e-ats.iot.ap-southeast-1.amazonaws.com'; // Ganti sesuai endpoint AWS IoT Core kamu

const region = 'ap-southeast-1'; // contoh: ap-southeast-1

// ini untuk akun xyehuda3@gmail.com
// const identityPoolId = 'ap-southeast-1:e9f502ea-58c5-459a-bfa3-3ce6e1fc9bff'; // contoh: ap-southeast-1:xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx

// ini untuk akun kutusapi99@gmail.com
const identityPoolId = 'ap-southeast-1:66f016b1-04c1-4719-8774-bf55d732f161'; // contoh: ap-southeast-1:xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx

// Konfigurasi Amplify
AWS.config.region = region;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: identityPoolId
});

let client;

const setupMQTT = async () => {
  try {
    // await AWS.config.credentials.getPromise();
    await new Promise((resolve, reject) => {
      AWS.config.credentials.get((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    console.log('✅ Cognito Credentials loaded.');

    const requestUrl = SigV4Utils.getSignedUrl(
      mqttHost,
      region,
      AWS.config.credentials.accessKeyId,
      AWS.config.credentials.secretAccessKey,
      AWS.config.credentials.sessionToken
    );

    client = mqtt.connect(requestUrl, {
      reconnectPeriod: 5000,
      clientId: 'webclient_' + Math.floor(Math.random() * 10000),
      protocol: 'wss',
      clean: true
    });

    client.on('connect', () => {
      console.log('✅ MQTT connected');
    });

    client.on('error', (err) => {
      console.error('❌ MQTT Error:', err);
    });

  } catch (error) {
    console.error('❌ Gagal load Cognito credentials:', error);
  }
};

window.nyalakanPompa = () => {
  if (!client || !client.connected) {
    console.error('🚫 MQTT belum terkoneksi. Tidak bisa publish.');
    return;
  }

  const uploadTime = moment().format('YYYY-MM-DD HH:mm:ss');
  const flushButton = document.getElementById('flushButton');

  flushButton.classList.add('opacity-80');
  flushButton.disabled = true; // Nonaktifkan tombol flush
  flushButton.textContent = 'Sending ...'; // Ubah teks tombol
  setTimeout(() => {
    flushButton.textContent = 'Flushing ...'; // Kembalikan teks tombol
  }, 2000);
  setTimeout(() => {
    flushButton.classList.remove('opacity-80');
    flushButton.disabled = false; // Aktifkan kembali tombol setelah 5 detik
    flushButton.textContent = 'Flush'; // Kembalikan teks tombol
  }, 30000);


  const payload = JSON.stringify({ action: 'nyala' });

  client.publish('device/pompa', payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('🚫 Publish error:', err);
    } else {
      console.log('📤 Pompa nyala command dikirim pada', uploadTime);
    }
  });
};

// Helper untuk generate AWS SigV4 signed URL
const SigV4Utils = {
  getSignedUrl: function (endpoint, region, accessKeyId, secretAccessKey, sessionToken) {
    const time = new Date();
    const dateStamp = time.toISOString().slice(0, 10).replace(/-/g, '');
    const amzdate = time.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const service = 'iotdevicegateway';
    const algorithm = 'AWS4-HMAC-SHA256';
    const method = 'GET';
    const canonicalUri = '/mqtt';

    const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
    const canonicalQuerystring = 'X-Amz-Algorithm=' + algorithm
        + '&X-Amz-Credential=' + encodeURIComponent(accessKeyId + '/' + credentialScope)
        + '&X-Amz-Date=' + amzdate
        + '&X-Amz-SignedHeaders=host';

    const canonicalHeaders = 'host:' + endpoint + '\n';
    const payloadHash = AWS.util.crypto.sha256('', 'hex');
    const canonicalRequest = method + '\n' + canonicalUri + '\n' + canonicalQuerystring + '\n' + canonicalHeaders + '\nhost\n' + payloadHash;

    const stringToSign = algorithm + '\n' + amzdate + '\n' + credentialScope + '\n' + AWS.util.crypto.sha256(canonicalRequest, 'hex');
    const signingKey = AWS.util.crypto.hmac(AWS.util.crypto.hmac(AWS.util.crypto.hmac(AWS.util.crypto.hmac('AWS4' + secretAccessKey, dateStamp, 'buffer'), region, 'buffer'), service, 'buffer'), 'aws4_request', 'buffer');
    const signature = AWS.util.crypto.hmac(signingKey, stringToSign, 'hex');

    let url = 'wss://' + endpoint + canonicalUri + '?' + canonicalQuerystring + '&X-Amz-Signature=' + signature;

    if (sessionToken) {
      url += '&X-Amz-Security-Token=' + encodeURIComponent(sessionToken);
    }

    return url;
  }
};

function formatAndFillSensorData(data, typeData) {
  const result = [];

  // Map awal: jam (HH:00) => nilai
  const resultMap = {};

  data.forEach(entry => {
    const timestamp = new Date(entry.timestamp);
    const jakartaTime = new Date(timestamp.getTime() + 7 * 60 * 60 * 1000); // UTC+7
    const hour = timestamp.getHours().toString().padStart(2, '0') + ':00';

    const sensorData = entry[typeData];
    if (sensorData && typeof sensorData.average === 'number') {
      resultMap[hour] = parseFloat(sensorData.average.toFixed(2));
    }
  });

  // Isi data 24 jam (00:00 - 23:00) dengan forward fill
  let lastValue = null;
  for (let h = 0; h < 24; h++) {
    const hourStr = h.toString().padStart(2, '0') + ':00';

    if (resultMap[hourStr] != null) {
      lastValue = resultMap[hourStr];
    }

    result.push({
      time: hourStr,
      value: lastValue !== null ? lastValue : null
    });
  }

  return result;
}

let ws;
let isHumidity = false;
let pendingHistoryRequest = false;

const initIsHumidity = () => {
  const currentView = sessionStorage.getItem('currentView');
  const humidityDetailData = sessionStorage.getItem('humidityDetailData');

  if (currentView === 'second' && humidityDetailData === 'true') {
    isHumidity = true;
  } else if (currentView === 'second' && humidityDetailData === 'false') {
    isHumidity = false;
  }
};

function requestHistoryDataIfReady() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'getHistoryData' }));
    pendingHistoryRequest = false;
  } else {
    // Simpan permintaan untuk nanti
    pendingHistoryRequest = true;
  }
}

const setupWebSocket = () => {
  if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
    console.log('WebSocket sudah aktif. Tidak membuat koneksi baru.');
    return;
  }

  const wsUrl = "wss://chili-monitor-data.andzuru.space";

  ws = new WebSocket(wsUrl);

  ws.onopen = async () => {
    console.log('✅ WebSocket connected to', wsUrl);
    if (pendingHistoryRequest) {
    ws.send(JSON.stringify({ action: 'getHistoryData' }));
    pendingHistoryRequest = false;
  }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Data diterima:', data);

      if (data.topic === 'historicalData') {
        const filterData = data.data;
        console.log(filterData);
        if (isHumidity === true) {    
          if (filterData && Array.isArray(filterData)) {
            const formattedFilled = formatAndFillSensorData(filterData, 'kelembapan'); 
            console.log(formattedFilled);
            const timeLabels = formattedFilled.map(item => item.time);
            const kelembapanValues = formattedFilled.map(item => item.value);
            updateDataDetail(timeLabels, kelembapanValues);
          }
        } else {
          if (filterData && Array.isArray(filterData)) {
            const formattedFilled = formatAndFillSensorData(filterData, 'ph'); 
            console.log(formattedFilled);
            const timeLabels = formattedFilled.map(item => item.time);
            const phValues = formattedFilled.map(item => item.value);
            updateDataDetail(timeLabels, phValues);
          }
        }
      }

      // Destructure data
      const { topic, data: sensorData, chartData, timestamp: timestampCloudRaw } = data;
      const { ph, humidity } = chartData || {};

      // Simpan data terbaru ke IndexedDB setelah di-render ke grafik
      // Perbaikan konversi phDataReceivedAtFix
      let phDataReceivedAtFix = null;
      if (ph && Array.isArray(ph.timestamps) && ph.timestamps.length > 0) {
        let phDataReceivedAt = ph.timestamps[ph.timestamps.length - 1];
        if (typeof phDataReceivedAt === 'string' && phDataReceivedAt) {
          phDataReceivedAtFix = new Date(phDataReceivedAt).toISOString();
        } else if (typeof phDataReceivedAt === 'number' && !isNaN(phDataReceivedAt)) {
          if (phDataReceivedAt < 10000000000) {
            phDataReceivedAt *= 1000;
          }
          phDataReceivedAtFix = new Date(phDataReceivedAt).toISOString();
        }
      }

      // Perbaikan konversi humidityDataReceivedAtFix
      let humidityDataReceivedAtFix = null;
      if (humidity && Array.isArray(humidity.timestamps) && humidity.timestamps.length > 0) {
        let humidityDataReceivedAt = humidity.timestamps[humidity.timestamps.length - 1];
        if (typeof humidityDataReceivedAt === 'string' && humidityDataReceivedAt) {
          humidityDataReceivedAtFix = new Date(humidityDataReceivedAt).toISOString();
        } else if (typeof humidityDataReceivedAt === 'number' && !isNaN(humidityDataReceivedAt)) {
          if (humidityDataReceivedAt < 10000000000) {
            humidityDataReceivedAt *= 1000;
          }
          humidityDataReceivedAtFix = new Date(humidityDataReceivedAt).toISOString();
        }
      }

      // Waktu saat browser menerima data (epoch milidetik UTC)
      const browserReceivedTimestampRaw = Date.now();

      // Hitung Latency (dalam milidetik)
      const latencyMs = !isNaN(Number(timestampCloudRaw))
        ? browserReceivedTimestampRaw - Number(timestampCloudRaw)
        : 0;

      // Konversi timestamp yang diterima dari cloud ke format ISOString untuk penyimpanan/display (opsional, bisa juga simpan raw)
      // Pastikan timestampCloudRaw adalah angka sebelum dikonversi
      const timestampCloudReceivedFix = !isNaN(Number(timestampCloudRaw))
          ? new Date(Number(timestampCloudRaw) + (7 * 60 * 60 * 1000)).toISOString() // Konversi ke WIB ISO
          : null;

      // Konversi waktu browserReceived ke format ISOString (WIB)
      const browserReceivedTimestampFix = new Date(browserReceivedTimestampRaw + (7 * 60 * 60 * 1000)).toISOString(); // Konversi ke WIB ISO

      // Data yang akan disimpan ke IndexedDB
      let recordHumidity;
      let recordPh;
      if (sensorData) {
        // Humidity
        if (sensorData.Kelembapan !== undefined && sensorData.Kelembapan !== null && !isNaN(parseFloat(sensorData.Kelembapan))) {
          // Simpan recordHumidity ke variabel global agar bisa diakses di luar fungsi
          window.latestRecordHumidity = {
            timestampCloudReceived: timestampCloudReceivedFix,
            timestampBrowserReceived: browserReceivedTimestampFix,
            latency: parseFloat(latencyMs),
            humidityValue: parseFloat(sensorData.Kelembapan),
            humidityDataReceivedAt: humidityDataReceivedAtFix,
          };
          recordHumidity = window.latestRecordHumidity;
        } else {
          console.log('Kelembapan tidak ada pembaharuan data');
        }

        // pH
        if (sensorData.Ph !== undefined && sensorData.Ph !== null && !isNaN(parseFloat(sensorData.Ph))) {
          // Simpan recordPh ke variabel global agar bisa diakses di luar fungsi
          window.latestRecordPh = {
            timestampCloudReceived: timestampCloudReceivedFix,
            timestampBrowserReceived: browserReceivedTimestampFix,
            latency: parseFloat(latencyMs),
            phValue: parseFloat(sensorData.Ph),
            phDataReceivedAt: phDataReceivedAtFix,
          };
          recordPh = window.latestRecordPh;
        } else {
          console.log('PH tidak ada pembaharuan data');
        }
      }

      // Ambil nilai mentah Ph dan Kelembapan
      const phRaw = parseFloat(sensorData?.Ph ?? 'NaN');
      const humidityRaw = parseFloat(sensorData?.Kelembapan ?? 'NaN');

      // Update tampilan nilai Ph dan Kelembapan
      const fixPh = !isNaN(phRaw) ? phRaw.toFixed(1) : 'N/A';
      const fixHumidity = !isNaN(humidityRaw) ? humidityRaw.toFixed(1) : 'N/A';

      const phElement = document.getElementById('phValue');
      const humidityElement = document.getElementById('humidityValue');
      const goodGroundStatus = document.getElementById('ground-good-status');
      const poorGroundStatus = document.getElementById('ground-poor-status');

      // Validasi nilai untuk status tanah
      if (!isNaN(phRaw) && !isNaN(humidityRaw) && (phRaw > 9.5 || phRaw < 5 || humidityRaw > 90.00 || humidityRaw < 10.00)) {
        goodGroundStatus.classList.add('hidden');
        poorGroundStatus.classList.remove('hidden');
      } else {
        poorGroundStatus.classList.add('hidden');
        goodGroundStatus.classList.remove('hidden');
      }

      if (phElement) phElement.textContent = fixPh;
      if (humidityElement) humidityElement.textContent = fixHumidity;

      // Update chart jika data tersedia
      if (chartData) {
        if (ph && Array.isArray(ph.timestamps) && Array.isArray(ph.values)) {
          const phTimestamps = ph.timestamps.map(Number);
          const phValues = ph.values.map(Number);
          // Jika offline, pakai data dari IndexedDB. Jika online, cek IndexedDB dulu, jika kosong baru pakai data WebSocket
          if (!navigator.onLine) {
            getPhDataFromDb(1).then(phFromDb => {
              if (phFromDb && phFromDb.length > 0) {
                setTimeout(updateDataPhFromDb, 200);
              }
            })
          } else {
            updateDataPh(phTimestamps, phValues);
            savePhDataToDb(recordPh);
          }
        }

        if (humidity && Array.isArray(humidity.timestamps) && Array.isArray(humidity.values)) {
          const humidityTimestamps = humidity.timestamps.map(Number);
          const humidityValues = humidity.values.map(Number);
          if (!navigator.onLine) {
            getHumidityDataFromDb(1).then(humidityFromDb => {
              if (humidityFromDb && humidityFromDb.length > 0) {
                setTimeout(updateDataHumidityFromDb, 200);
              }
            })
          } else {
            updateDataHumidity(humidityTimestamps, humidityValues);
            saveHumidityDataToDb(recordHumidity);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('⚠️ WebSocket error:', error);
  };

  ws.onclose = (event) => {
    console.warn(`⚠️ WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
    // Coba reconnect setelah delay
    setTimeout(() => {
      console.log('🔁 Mencoba reconnect WebSocket...');
      setupWebSocket();
    }, 5000);
  };
};

// --- LOGIKA PUSH NOTIFICATION ---
const VAPID_PUBLIC_KEY = 'BEr7RhsHyH-U39qwfNHjCgsxD3_cBFL17xttbkvTWYbavxeJoED-IKkSf1Ui4CUYiIdGsNeknYBqeEjVuIFQgFc'; //

// Helper function from NotificationModel and sw.js
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4); //
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/'); //
  const rawData = window.atob(base64); //
  const outputArray = new Uint8Array(rawData.length); //
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i); //
  }
  return outputArray; //
}

// Fungsi untuk mengirim langganan ke backend
async function sendSubscriptionToBackend(subscription, token) {
  if (!token) {
    console.error('No auth token found'); //
    throw new Error('Authentication token is missing.'); //
  }

  const subscribeUrl = 'https://chili-monitor-data.andzuru.space/api/save-subscription'; //

  console.log('Preparing subscription data for backend...'); //
  const p256dhKey = subscription.getKey('p256dh'); //
  const authKey = subscription.getKey('auth'); //
  if (!p256dhKey || !authKey) {
    console.error('Subscription keys are missing'); //
    throw new Error('Subscription keys are missing'); //
  }
  const body = {
    endpoint: subscription.endpoint, //
    keys: {
      p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dhKey))), //
      auth: btoa(String.fromCharCode(...new Uint8Array(authKey))), //
    },
  };

  console.log('Sending subscription to backend:', body); //

  try {
    const response = await fetch(subscribeUrl, {
      method: 'POST', //
      headers: {
        'Content-Type': 'application/json', //
        'Authorization': `Bearer ${token}`, //
      },
      body: JSON.stringify(body), //
    });

    const data = await response.json(); //
    if (!response.ok) {
      console.error('Backend subscription error:', data); //
      throw new Error(data.message || 'Failed to send subscription to backend'); //
    }
    console.log('Backend subscription successful:', data); //
    return data; //
  } catch (error) {
    console.error('Subscription error:', error); //
    throw error; //
  }
}

// Fungsi untuk mengirim unsubscription ke backend
async function sendUnsubscriptionToBackend(endpoint, token) {
  if (!token) {
    console.error('No auth token found'); //
    throw new Error('Authentication token is missing.'); //
  }

  const unsubscribeUrl = 'https://chili-monitor-data.andzuru.space/api/delete-subscription'; //

  const body = {
    endpoint: endpoint, //
  };

  try {
    const response = await fetch(unsubscribeUrl, {
      method: 'DELETE', //
      headers: {
        'Content-Type': 'application/json', //
        'Authorization': `Bearer ${token}`, //
      },
      body: JSON.stringify(body), //
    });

    const data = await response.json(); //
    if (!response.ok) {
      throw new Error(data.message || 'Failed to send unsubscription to backend'); //
    }
    console.log('Unsubscription sent to backend successfully:', data); //
    return data; //
  } catch (error) {
    console.error('Error sending unsubscription to backend:', error); //
    throw error; //
  }
}

// Fungsi untuk mengecek status langganan push
async function getPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, subscribed: false, error: 'Push notification not supported' }; //
  }
  try {
    const registration = await navigator.serviceWorker.ready; //
    const subscription = await registration.pushManager.getSubscription(); //
    return { supported: true, subscribed: !!subscription, subscriptionObject: subscription }; //
  } catch (error) {
    return { supported: true, subscribed: false, error: 'Failed to check subscription status.' }; //
  }
}

// Fungsi untuk memperbarui tampilan tombol subscribe/unsubscribe
function updateSubscriptionButtons(isSubscribed) {
  const subscribeBtn = document.getElementById('subscribeBtn'); //
  const subscribeBtnMobile = document.getElementById('subscribeBtnMobile'); //

  if (subscribeBtn && subscribeBtnMobile) {
    if (isSubscribed) {
      subscribeBtn.textContent = 'Unsubscribe'; //
      subscribeBtn.classList.remove('text-primary', 'hover:text-tersier');
      subscribeBtn.classList.add('bg-primary', 'px-6', 'text-white', 'rounded-full', 'transition-colors', 'hover:text-primary', 'hover:bg-white'); // Menambahkan gaya dari index.mjs asli

      subscribeBtnMobile.textContent = 'Unsubscribe'; //
      subscribeBtnMobile.classList.remove('group-hover:text-tersier');
      subscribeBtnMobile.classList.add('bg-primary', 'px-6', 'text-white', 'rounded-full', 'transition-colors', 'hover:text-primary', 'hover:bg-white'); // Menambahkan gaya dari index.mjs asli
    } else {
      subscribeBtn.textContent = 'Subscribe'; //
      subscribeBtn.classList.remove('bg-primary', 'px-6', 'text-white', 'rounded-full', 'hover:bg-white', 'hover:text-primary'); // Menghapus gaya unsubscribe
      subscribeBtn.classList.add('text-primary', 'hover:text-tersier'); // Mengembalikan gaya subscribe default

      subscribeBtnMobile.textContent = 'Subscribe'; //
      subscribeBtnMobile.classList.remove('bg-primary', 'px-6', 'text-white', 'rounded-full', 'hover:bg-white', 'hover:text-primary'); // Menghapus gaya unsubscribe
      subscribeBtnMobile.classList.add('group-hover:text-tersier'); // Mengembalikan gaya subscribe default
    }
  }
}

// Fungsi untuk setup push notification dan service worker
async function setupPushNotification() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notification tidak didukung.');
    // Tampilkan peringatan di UI jika ada elemen untuk itu
    // showNotifStatus('Push notification tidak didukung di browser ini.', true);
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js'); //
    console.log('Service Worker terdaftar:', registration); //

    const permission = await Notification.requestPermission(); //
    if (permission === 'denied') {
      console.warn('Izin notifikasi tidak diberikan'); //
      // showNotifStatus('Izin notifikasi ditolak. Anda tidak akan menerima push notifikasi.', true);
      updateSubscriptionButtons(false); // Pastikan tombol menunjukkan 'Subscribe' jika denied
      return;
    }

    const subscriptionStatus = await getPushSubscriptionStatus(); // Mengambil status langganan
    updateSubscriptionButtons(subscriptionStatus.subscribed); //

  } catch (error) {
    console.error('Gagal setup push notification:', error); //
    // showGenericNotificationError(error.message);
  }
}

function generateRandomString(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}

function notificationAlert(title, content) {

  const notifModalContainer = document.getElementById('modal-notif-container');
  const notifModal = document.getElementById('modal-notif-alert');
  const notifMain = document.getElementById('modal-main-notif');
  const notifTitle = document.getElementById('title-notif-modal');
  const notifContent = document.getElementById('content-notif-modal');
  const notifCloseButton = document.getElementById('close-notif');

  if (!notifModalContainer || !notifModal || !notifMain || !notifContent || !notifCloseButton) {
    console.error('Modal elements not found in the DOM');
    return;
  }

  notifContent.textContent = content; // Set content
  notifTitle.textContent = title; // Set title
  notifModalContainer.classList.remove('hidden'); // Show modal
  notifModal.classList.remove('hidden'); // Show modal content

  // Add event listener to close button
  notifCloseButton.onclick = () => {
    notifModalContainer.classList.add('hidden'); // Hide modal
    notifModal.classList.add('hidden'); // Hide modal content
  };

  // Close modal when clicking outside of it
  window.onclick = (event) => {
    if (!notifMain.contains(event.target) && event.target === notifModalContainer) {
      notifModalContainer.classList.add('hidden');
      notifModal.classList.add('hidden');
    }
  };
}

function detailDataConfirmAlert(title, content) {
  const notifModalContainer = document.getElementById('modal-notif-container');
  const notifModal = document.getElementById('modal-notif-alert');
  const notifMain = document.getElementById('modal-main-notif');
  const notifTitle = document.getElementById('title-notif-modal');
  const notifContent = document.getElementById('content-notif-modal');
  const notifCloseButton = document.getElementById('close-notif');
  const buttonContainer = document.getElementById('button-container');
  const confirmButton = document.getElementById('detail-confirm');  

  if (!notifModalContainer || !notifModal || !notifMain || !notifContent || !notifCloseButton || !buttonContainer) {
    console.error('Modal elements not found in the DOM');
    return;
  }

  if (confirmButton) {
    confirmButton.remove();
  }

  // Buat tombol konfirmasi baru
  const newConfirmButton = document.createElement('button');
  newConfirmButton.id = 'detail-confirm';
  newConfirmButton.className = 'bg-primary w-[200px] text-white px-4 py-2 rounded-lg hover:bg-tersier active:bg-secondary';
  newConfirmButton.textContent = 'OK';
  let humidityChart = document.getElementById('myChart');
  let phChart = document.getElementById('myChart1');

  const humidityDetailData = sessionStorage.getItem('humidityDetailData');

  newConfirmButton.onclick = (event) => {
    const detailIsActive = {
      "action": "getHistoryData",
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(detailIsActive));
    }
    isHumidity = humidityDetailData === 'true' ? true : false;

    showSecondView();

    myChartDetail.data.datasets[0].label = humidityDetailData === 'true' ? 'Soil Moisture' : 'Soil pH';
    myChartDetail.update();

    notifModalContainer.classList.add('hidden');
    notifModal.classList.add('hidden');

    // Hapus tombol sebelumnya jika ada
     event.currentTarget.remove();
  };

  buttonContainer.appendChild(newConfirmButton);
  notifTitle.textContent = title;
  notifContent.textContent = content;
  notifModalContainer.classList.remove('hidden');
  notifModal.classList.remove('hidden');

  notifCloseButton.onclick = () => {
    notifModalContainer.classList.add('hidden');
    notifModal.classList.add('hidden');

    // Hapus tombol sebelumnya jika ada
    if (confirmButton) {
      confirmButton.remove();
    }
  };

  window.onclick = (event) => {
    if (!notifMain.contains(event.target) && !confirmButton.contains(event.target) && !notifCloseButton.contains(event.target) && !humidityChart.contains(event.target) && !phChart.contains(event.target)) {
      notifModalContainer.classList.add('hidden');
      notifModal.classList.add('hidden');

      // Hapus tombol sebelumnya jika ada
      if (confirmButton) {
        confirmButton.remove();
      }
    }
  };
}

function pumpConfirmAlert(title, content) {
  const notifModalContainer = document.getElementById('modal-notif-container');
  const notifModal = document.getElementById('modal-notif-alert');
  const notifMain = document.getElementById('modal-main-notif');
  const notifTitle = document.getElementById('title-notif-modal');
  const notifContent = document.getElementById('content-notif-modal');
  const notifCloseButton = document.getElementById('close-notif');
  const buttonContainer = document.getElementById('button-container');
  const inputColumnContainer = document.getElementById('input-column-container');
  const passwordInput = document.getElementById('password-input');
  const togglePassword =document.getElementById('toggle-password');
  const confirmButton = document.getElementById('detail-confirm');
  // const flushButton = document.getElementById('flushButton');

  if (!notifModalContainer || !notifModal || !notifMain || !notifContent || !notifCloseButton || !buttonContainer) {
    console.error('Modal elements not found in the DOM');
    return;
  }

  // Hapus tombol sebelumnya jika ada
  if (confirmButton) {
    confirmButton.remove();
  }

  // Buat tombol konfirmasi baru
  const newConfirmButton = document.createElement('button');
  newConfirmButton.id = 'detail-confirm';
  newConfirmButton.className = 'bg-primary w-[200px] text-white px-4 py-2 rounded-lg hover:bg-tersier active:bg-secondary';
  newConfirmButton.textContent = 'Confirm';

  buttonContainer.appendChild(newConfirmButton);
  
  inputColumnContainer.classList.remove('hidden'); // Tampilkan input kolom
  inputColumnContainer.classList.add('flex');

  newConfirmButton.onclick = (event) => {
  const realPassword = "Ok!";
  const checkPassword = passwordInput.value;
    if (checkPassword === realPassword) {
      passwordInput.value = ''; // Kosongkan input password
      inputColumnContainer.classList.add('hidden'); // Sembunyikan input kolom setelah konfirmasi
      inputColumnContainer.classList.remove('flex'); // Sembunyikan input kolom setelah konfirmasi

      const title = "Pump Activated";
      const content = "Pump activated for 15 seconds";
      window.nyalakanPompa();

      const pumpIsActive = { action: 'pumpIsActive' };

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(pumpIsActive));
      }

      notifModalContainer.classList.add('hidden');
      notifModal.classList.add('hidden');

      event.currentTarget.remove();

      notificationAlert(title, content);

    } else if (checkPassword === '' || checkPassword !== realPassword) {
      passwordInput.value = ''; // Kosongkan input password
      inputColumnContainer.classList.add('hidden'); // Sembunyikan input kolom setelah konfirmasi
      inputColumnContainer.classList.remove('flex'); // Sembunyikan input kolom setelah konfirmasi

      const title = "Incorrect Password";
      const content = "The password you entered is incorrect. Please try again.";
      
      notifModalContainer.classList.add('hidden');
      notifModal.classList.add('hidden');

      event.currentTarget.remove();

      notificationAlert(title, content); 
    }
  };

  notifTitle.textContent = title;
  notifContent.textContent = content;
  notifModalContainer.classList.remove('hidden');
  notifModal.classList.remove('hidden');

  notifCloseButton.onclick = () => {
    notifModalContainer.classList.add('hidden');
    notifModal.classList.add('hidden');
    if (confirmButton) {
      confirmButton.remove();
    }
    passwordInput.value = ''; // Kosongkan input password
    inputColumnContainer.classList.add('hidden'); // Sembunyikan input kolom setelah konfirmasi
    inputColumnContainer.classList.remove('flex'); // Sembunyikan input kolom setelah konfirmasi
  };

  window.onclick = (event) => {
    if (!notifMain.contains(event.target) 
        && !(confirmButton && confirmButton.contains(event.target)) 
        && !notifCloseButton.contains(event.target) 
        // && !(flushButton && flushButton.contains(event.target)) 
        && !inputColumnContainer.contains(event.target) 
        && !(togglePassword && togglePassword.closest(event.target))
    ) {
      notifModalContainer.classList.add('hidden');
      notifModal.classList.add('hidden');

      if (confirmButton) {
        confirmButton.remove();
      }

      passwordInput.value = ''; // Kosongkan input password
      inputColumnContainer.classList.add('hidden'); // Sembunyikan input kolom setelah konfirmasi
      inputColumnContainer.classList.remove('flex'); // Sembunyikan input kolom setelah konfirmasi
    }
  };
}


async function registerAndAutoLogin(attempt = 0) {
  const maxAttempts = 5; // Batasi percobaan untuk menghindari loop tak terbatas

  if (attempt >= maxAttempts) {
    console.error("Failed to auto-register after multiple attempts due to duplicate username/email.");
    const title = "Registration Failed";
    const content = "Failed to auto-register after multiple attempts due to duplicate username/email.";
    notificationAlert(title, content);
    return false;
  }

  const randomString = generateRandomString(6);
  const username = `user${randomString}`;
  const email = `user${randomString}@example.com`; // Gunakan example.com atau domain eksperimen Anda
  const password = "password123"; // Tetap diingat ini untuk eksperimen!

  try {
    console.log(`Attempting to register with: Username=${username}, Email=${email}`);
    const response = await fetch('https://chili-monitor-data.andzuru.space/api/register-auto-login', { // Sesuaikan URL backend Anda
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('Registration successful, token received:', data.token);
      localStorage.setItem('userToken', data.token); // Simpan token di localStorage
      localStorage.setItem('userToken_createdAt', Date.now()); // Simpan waktu pembuatan token
      const title = 'Registration Successful';
      const content = 'Registration successful! You have automatically logged in.';
      notificationAlert(title, content);
      return true;
    } else if (response.status === 409) { // Konflik, username/email sudah ada
      console.warn('Username or email already exists. Retrying with new random values.');
      return registerAndAutoLogin(attempt + 1); // Coba lagi dengan data baru
    } else {
      console.error('Registration failed:', data.message || 'Unknown error', data);
      const title = "Registration Failed";
      const content = `Registration failed: ${data.message || 'An error occurred during registration.'}`;
      notificationAlert(title, content);
      return false;
    }
  } catch (error) {
    console.error('Error during registration:', error);
    const title = "Registration Failed";
    const content = 'An error occurred during registration.';
    notificationAlert(title, content);
    return false;
  }
}

// Fungsi untuk memverifikasi token di frontend (valid secara format & belum kedaluwarsa)**
function isTokenLocallyValid(token) {
  if (!token) return false;
  try {
    // Memecah JWT (header.payload.signature)
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const payload = JSON.parse(atob(parts[1])); // Decode payload Base64

    // Periksa expiration time (exp) jika ada
    if (payload.exp) {
      const currentTime = Math.floor(Date.now() / 1000); // Waktu saat ini dalam detik Unix
      if (payload.exp < currentTime) {
        console.log("Token expired locally.");
        return false; // Token sudah kedaluwarsa
      }
    }
    return true; // Token valid secara format dan belum kedaluwarsa
  } catch (e) {
    console.error("Error decoding or validating token locally:", e);
    return false; // Token tidak valid secara format
  }
}

// Fungsi untuk menampilkan secondView
function showSecondView() {
    mainView.classList.add('hidden');
    secondView.classList.remove('hidden');
    sessionStorage.setItem('currentView', 'second'); // Simpan status
}

// Fungsi untuk menampilkan mainView
function showMainView() {
    secondView.classList.add('hidden');
    mainView.classList.remove('hidden');
    sessionStorage.setItem('currentView', 'main'); // Simpan status
}

document.addEventListener('DOMContentLoaded', async () => {
  initIsHumidity();

  setupWebSocket();
  setupMQTT();

  openDb().then(() => {
  }).catch(err => console.error('Failed to open IndexedDB:', err));

  const savedView = sessionStorage.getItem('currentView');
  const humidityDetailData = sessionStorage.getItem('humidityDetailData');

  if (savedView === 'second') {
    mainView.classList.add('hidden');
    secondView.classList.remove('hidden');
    myChartDetail.data.datasets[0].label = humidityDetailData === 'true' ? 'Soil Moisture' : 'Soil pH';
    myChartDetail.update(); 
    console.log("web dalam tampilan second view, bersiap mengirim getHistoryData");
    try { 
      requestHistoryDataIfReady()
    } catch (e) {
      console.log("terjadi error saat mengirimkan getHistoryData :", e);
    }
  } else {
    mainView.classList.remove('hidden');
    secondView.classList.add('hidden'); // Default ke mainView jika tidak ada atau tidak dikenal
    sessionStorage.removeItem('humidityDetailData');
  }

  let userToken = localStorage.getItem('userToken');
  let tokenCreatedAt = localStorage.getItem('userToken_createdAt');
  const twentyFourHours = 24 * 60 * 60 * 1000; // 24 jam dalam milidetik

  // Lakukan cross-check token di localStorage: valid secara format dan belum berusia 24 jam
  if (userToken && isTokenLocallyValid(userToken) && (Date.now() - tokenCreatedAt < twentyFourHours)) {
    console.log("Valid user token found in localStorage:", userToken);
  } else {
    console.log("No valid user token found or token expired/too old. Attempting to auto-register and login.");
    localStorage.removeItem('userToken'); // Hapus token lama/invalid
    localStorage.removeItem('userToken_createdAt'); // Hapus waktu pembuatan token lama/invalid

    // Coba registrasi dan auto-login
    const registered = await registerAndAutoLogin();
    if (registered) {
      userToken = localStorage.getItem('userToken'); // Dapatkan token yang baru disimpan
      console.log("Auto-registration and login successful. New Token:", userToken);
    } else {
      console.error("Auto-registration and login failed. User cannot proceed without a token.");
      const title = "Registration Failed";
      const content = "Failed to obtain a user session. Certain functions may not work.";
      notificationAlert(title, content);
      // Anda mungkin ingin menonaktifkan fitur yang memerlukan token di sini
      return; // Hentikan eksekusi lebih lanjut jika tidak ada token
    }
  }

  // Panggil rute backend untuk membersihkan user yang kedaluwarsa secara periodik (opsional, bisa juga via cron job)
  // Untuk eksperimen, kita panggil saat load halaman. Di produksi, sebaiknya diatur di server.
  // fetch('https://chili-monitor-data.andzuru.space/api/clean-expired-users', { method: 'DELETE' })
  //   .then(res => res.json())
  //   .then(data => console.log('Expired user cleanup result:', data))
  //   .catch(err => console.error('Error cleaning expired users:', err));


  // Daftarkan Service Worker dan setup notifikasi push
  await setupPushNotification();

  const subscribeBtn = document.getElementById('subscribeBtn'); //
  const subscribeBtnMobile = document.getElementById('subscribeBtnMobile'); //

  // Event listener untuk tombol Subscribe
  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', async () => {
      const currentToken = localStorage.getItem('userToken');
      if (!currentToken) {
        const title = "Subscription Failed";
        const content = "User session not found. Please refresh the page to get a new session.";
        notificationAlert(title, content);
        return;
      }

      const status = await getPushSubscriptionStatus();
      if (status.subscribed) {
        try {
          // Token di sini sudah dipastikan valid oleh flow sebelumnya
          await sendUnsubscriptionToBackend(status.subscriptionObject.endpoint, currentToken);
          await status.subscriptionObject.unsubscribe();
          console.log('Successfully unsubscribed!');
          updateSubscriptionButtons(false);
          const title = 'Successfully Unsubscribed';
          const content = 'You have successfully unsubscribed from push notifications.';
          notificationAlert(title, content);
        } catch (error) {
          console.error('Error unsubscribing:', error);
          const title = 'Unsubscription Failed';
          const content = 'Failed to unsubscribe. Please try again.';
          notificationAlert(title, content);
        }
      } else {
        try {
          const registration = await navigator.serviceWorker.ready;
          const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey,
          });
          // Token di sini sudah dipastikan valid oleh flow sebelumnya
          await sendSubscriptionToBackend(subscription, currentToken);
          console.log('Successfully subscribed!');
          updateSubscriptionButtons(true);
          const title = 'Successful Subscription';
          const content = 'You have successfully subscribed to push notifications!';
          notificationAlert(title, content);
        } catch (error) {
          console.error('Error subscribing:', error);
          const title = 'Subscription Failed';
          const content = 'Failed to subscribe. Please ensure notifications are enabled and try again.';
          notificationAlert(title, content);
        }
      }
    });
  }

  if (subscribeBtnMobile) {
    subscribeBtnMobile.addEventListener('click', async () => {
      const currentToken = localStorage.getItem('userToken');
      if (!currentToken) {
        const title = 'Unsubscription Failed';
        const content = "User session not found. Please refresh the page to get a new session.";
        notificationAlert(title, content);
        return;
      }

      const status = await getPushSubscriptionStatus();
      if (status.subscribed) {
        try {
          await sendUnsubscriptionToBackend(status.subscriptionObject.endpoint, currentToken);
          await status.subscriptionObject.unsubscribe();
          console.log('Successfully unsubscribed (Mobile)!');
          updateSubscriptionButtons(false);
          const title = 'Unsubscription Failed';
          const content = 'You have successfully unsubscribed from push notifications.';
          notificationAlert(title, content);
        } catch (error) {
          console.error('Error unsubscribing (Mobile):', error);
          const title = 'Unsubscription Failed';
          const content = 'Failed to unsubscribe. Please try again.';
          notificationAlert(title, content);
        }
      } else {
        try {
          const registration = await navigator.serviceWorker.ready;
          const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey,
          });
          await sendSubscriptionToBackend(subscription, currentToken);
          console.log('Successfully subscribed (Mobile)!');
          updateSubscriptionButtons(true);
          const title = 'Successfully subscribed (Mobile)!';
          const content = 'You have successfully subscribed to push notifications!';
          notificationAlert(title, content);
        } catch (error) {
          console.error('Error subscribing (Mobile):', error);
          const title = 'Successfully subscribed (Mobile)!';
          const content = 'Failed to subscribe. Please ensure notifications are enabled and try again.';
          notificationAlert(title, content);
        }
      }
    });
  }

  // Logic to show "Welcome Back!" notification every 6 hours
  const lastWelcomeBackShown = localStorage.getItem('lastWelcomeBackShown');
  const sixHoursInMs = 6 * 60 * 60 * 1000;
  const currentTime = Date.now();

  if (!lastWelcomeBackShown || (currentTime - parseInt(lastWelcomeBackShown) > sixHoursInMs)) {
    const title = "Welcome Back!";
    const content = "It's good to see you again. ✨😊";
    notificationAlert(title, content);
    localStorage.setItem('lastWelcomeBackShown', currentTime);
  }
});

let humidityChart = document.getElementById('myChart');
let phChart = document.getElementById('myChart1');
let detailChart = document.getElementById('detailChart');

// Update grafik pH menggunakan data dari array phFromDb
async function updateDataPhFromDb() {
  // Ambil data dari IndexedDB
  const phFromDb = await getPhDataFromDb(); // ambil 20 data terbaru (atau sesuai kebutuhan)
  if (!phFromDb || phFromDb.length === 0) {
    myChartPh.data.datasets[0].data = [];
    myChartPh.data.labels = [];
    myChartPh.update();
    return;
  }

  // Urutkan data dari lama ke baru (karena getPhDataFromDb mengembalikan data terbaru duluan)
  const sorted = phFromDb.slice().reverse();

  // Ambil label waktu dan nilai pH
  const labels = sorted.map(item => {
    const date = new Date(item.phDataReceivedAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  });
  const values = sorted.map(item => item.phValue);

  myChartPh.data.datasets[0].data = values;
  myChartPh.data.labels = labels;
  myChartPh.update();
}

function updateDataPh(phTimestamps, phValues) {

  function isoToCustomFormat(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${hours}:${minutes}`;
  }

  const fixTimePh = phTimestamps.map(time => isoToCustomFormat(time));

  myChartPh.data.datasets[0].data = phValues;
  myChartPh.data.labels = fixTimePh;
  myChartPh.update();
}

// setup
const dataPh = {
  labels: [],
  datasets: [{
    label: 'Soil pH',
    data: [],
    borderColor: 'rgba(75, 192, 192, 1)',
    backgroundColor: 'rgba(75, 192, 192, 0.2)',
    borderWidth: 2
  }]
};

// config
const configPh = {
  type: 'line',
  data: dataPh,
  options: {
    scales: {
      y: {
        beginAtZero: false,
        // min dan max akan diatur otomatis oleh Chart.js sesuai data
        // suggestedMin dan suggestedMax bisa diatur jika ingin range lebih "longgar"
        // suggestedMin: 5, // contoh: bisa dihapus jika ingin full auto
        // suggestedMax: 9
      }
    }
  }
};

// render init block
const myChartPh = new Chart(
  phChart,
  configPh
);

// Fetch data
async function updateDataHumidityFromDb() {
  const humidityFromDb = await getHumidityDataFromDb(); // ambil 20 data terbaru (atau sesuai kebutuhan)
  if (!humidityFromDb || humidityFromDb.length === 0) {   
    myChartHumidity.data.datasets[0].data = [];
    myChartHumidity.data.labels = [];
    myChartHumidity.update();
    return; 
  }

  // Urutkan data dari lama ke baru (karena getHumidityDataFromDb mengembalikan data terbaru duluan)
  const sorted = humidityFromDb.slice().reverse();
  
  // Ambil label waktu dan nilai kelembapan
  const labels = sorted.map(item => {
    const date = new Date(item.humidityDataReceivedAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  });
  const values = sorted.map(item => item.humidityValue);

  myChartHumidity.data.datasets[0].data = values;
  myChartHumidity.data.labels = labels;
  myChartHumidity.update();
}

function updateDataHumidity(humidityTimestamps, humidityValues) {

  function isoToCustomFormat(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return `${hours}:${minutes}`;
  }

  const fixTimeHumidity = humidityTimestamps.map(time => isoToCustomFormat(time));
  console.log(fixTimeHumidity);

  myChartHumidity.data.datasets[0].data = humidityValues;
  myChartHumidity.data.labels = fixTimeHumidity;
  myChartHumidity.update();
}

const dataHumidity = {
  labels: [],
  datasets: [{
    label: 'Soil Moisture',
    data: [],
    borderColor: 'rgba(54, 162, 235, 1)',
    backgroundColor: 'rgba(54, 162, 235, 0.2)',
    borderWidth: 2,
  }]
};

const configHumidity = {
  type: 'line',
  data: dataHumidity,
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: false,
        // ticks: {
        //   stepSize: 0.2, // <- ini yang mengatur jarak antar garis grid Y
        // }
        // min dan max akan diatur otomatis oleh Chart.js sesuai data
      }
    }
  }
};

const myChartHumidity = new Chart(
  humidityChart,
  configHumidity
)

function updateDataDetail(detailTimestamps, detailValues) {

  function isoToCustomFormat(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return `${hours}:${minutes}`;
  }

  const fixTimeDetail = detailTimestamps.map(time => isoToCustomFormat(time));
  // console.log(fixTimeDetail);

  myChartDetail.data.datasets[0].data = detailValues;
  myChartDetail.data.labels = detailTimestamps;
  myChartDetail.update();
}

// const humidityDetailData = sessionStorage.getItem('humidityDetailData');
// let detailLabels = humidityDetailData === 'true' ? 'Soil Moisture' : 'Soil pH';

const detailData = {
  labels: [],
  datasets: [{
    // label: detailLabels,
    data: [],
    borderColor: 'rgba(54, 162, 235, 1)',
    backgroundColor: 'rgba(54, 162, 235, 0.2)',
    borderWidth: 2,
  }]
};

const configDetail = {
  type: 'line',
  data: detailData,
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: false,
        // ticks: {
        //   stepSize: 0.2, // <- ini yang mengatur jarak antar garis grid Y
        // }
        // min dan max akan diatur otomatis oleh Chart.js sesuai data
      }
    }
  }
};

const myChartDetail = new Chart(
  detailChart,
  configDetail
)

// Detail Chart
const mainView = document.getElementById('main-view');
const secondView = document.getElementById('second-view');
const backToMainView = document.getElementById('backToMainView');

humidityChart.addEventListener('click', () => {
  sessionStorage.setItem('humidityDetailData', 'true');
  const title = "Details of Humidity Data";
  const content = "Would you like to view details of humidity data?";
  detailDataConfirmAlert(title, content);
});

phChart.addEventListener('click', () => {
  sessionStorage.setItem('humidityDetailData', 'false');
  const title = "Details of PH Data";
  const content = "Would you like to view details of pH data?";
  detailDataConfirmAlert(title, content);
});

backToMainView.addEventListener('click', () => {
  showMainView();
  sessionStorage.removeItem('humidityDetailData');
  const getMainViewData = {
    "action": "getMainViewData",
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(getMainViewData));
  }
});

// Hamburger
const Hamburger = document.querySelector('#hamburger');
const navMenu = document.querySelector('#nav-menu');

Hamburger.addEventListener('click', function () {
  Hamburger.classList.toggle('hamburger-active');
  navMenu.classList.toggle('hidden');
});

//klik di luar hamburger
window.addEventListener('click', function (e) {
  if (e.target != Hamburger && e.target != navMenu) {
    Hamburger.classList.remove('hamburger-active');
    navMenu.classList.add('hidden');
  }
});

document.getElementById('toggle-password').addEventListener('click', function () {
  const passwordInput = document.getElementById('password-input');
  const eyeIcon = document.getElementById('eye-icon');
  // const labelPasswordInput = document.getElementById('label-password-input');

  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';

  // if (isPassword) {
  //   labelPasswordInput.classList.add('peer-[&:not(:placeholder-shown)]:text-tersier');
  //   labelPasswordInput.classList.remove('peer-[&:not(:placeholder-shown)]:text-primary');
  //   labelPasswordInput.classList.add('peer-focus:text-tersier');
  //   labelPasswordInput.classList.remove('peer-focus:text-primary');
  // } else {
  //   labelPasswordInput.classList.remove('peer-[&:not(:placeholder-shown)]:text-tersier');
  //   labelPasswordInput.classList.add('peer-[&:not(:placeholder-shown)]:text-primary');
  //   labelPasswordInput.classList.remove('peer-focus:text-tersier');
  //   labelPasswordInput.classList.add('peer-focus:text-primary');

  // };

  // Ganti ikon
  eyeIcon.outerHTML = isPassword
    ? `
      <svg id="eye-icon" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none"
        viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.054 10.054 0 012.387-3.773M6.7 6.7A10.05 10.05 0 0112 5c4.477 0 8.268 2.943 9.542 7a10.05 10.05 0 01-4.233 5.605M3 3l18 18" />
      </svg>
    `
    : `
      <svg id="eye-icon" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none"
        viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    `;
});

// Modal
const modal1 = document.getElementById('modal-container-1');
const modal2 = document.getElementById('modal-container-2');

const modalConfirmContainer = document.getElementById('modal-confirm-download-container');
const modalConfirmDownload = document.getElementById('modal-confirm-download-alert');

const modalMain = document.getElementById('modal-main');
const modalMainDownload = document.getElementById('modal-main-download');

const infoButton = document.getElementById('info-button');
const closeButton = document.getElementById('close-modal');

const downloadDataButton = document.getElementById('download-data');
const cancelDownloadButton = document.getElementById('cancel-download');

const getPhDataModal = document.getElementById('get-ph-data-modal');
const getHumidityDataModal = document.getElementById('get-humidity-data-modal');

const contectDownloadModal = document.getElementById('content-download-modal');
const titleDownloadModal = document.getElementById('title-download-modal');

let currentDownloadType = null;

infoButton.addEventListener('click', () => {
  modal1.classList.remove('hidden');
  modal2.classList.remove('hidden');
});

getPhDataModal.addEventListener('click', () => {
  modalConfirmContainer.classList.remove('hidden');
  modalConfirmDownload.classList.remove('hidden');
  currentDownloadType = 'ph'; // Set jenis unduhan
  titleDownloadModal.textContent = 'Download PH Data'; // Set teks langsung di sini
  contectDownloadModal.textContent = 'Do you want to download the pH data?'; // Sesuaikan pertanyaan
});

getHumidityDataModal.addEventListener('click', () => {
  modalConfirmContainer.classList.remove('hidden');
  modalConfirmDownload.classList.remove('hidden');
  currentDownloadType = 'humidity'; // Set jenis unduhan
  titleDownloadModal.textContent = 'Download Humidity Data'; // Set teks langsung di sini
  contectDownloadModal.textContent = 'Do you want to download the humidity data?'; // Sesuaikan pertanyaan
});

// Event listener untuk tombol "Download" utama di modal konfirmasi
downloadDataButton.addEventListener('click', () => {
  if (currentDownloadType === 'ph') {
    downloadDataButton.disabled = true; // Nonaktifkan tombol download untuk mencegah klik ganda
    contectDownloadModal.textContent = 'Mengunduh data pH...'; // Ubah teks modal konfirmasi
    // Panggil fungsi downloadPhToCSV
    setTimeout(async () => {
      await downloadPhToCSV();
    }, 4000); // Tambahkan delay 1,5 detik untuk memberikan waktu bagi pengguna melihat pesan
    setTimeout(() => {
      downloadDataButton.disabled = false; // Aktifkan kembali tombol download setelah selesai
      contectDownloadModal.textContent = 'Data pH berhasil diunduh.'; 
    }, 1500);
  } else if (currentDownloadType === 'humidity') {
    downloadDataButton.disabled = true; // Nonaktifkan tombol download untuk mencegah klik ganda
    contectDownloadModal.textContent = 'Mengunduh data kelembapan...'; // Ubah teks modal konfirmasi
    // Panggil fungsi downloadHumidityToCSV
    setTimeout(async () => {
      await downloadHumidityToCSV();
    }, 4000); // Tambahkan delay 1,5 detik untuk memberikan waktu bagi pengguna melihat pesan
    setTimeout(() => {
      downloadDataButton.disabled = false; // Aktifkan kembali tombol download setelah selesai
      contectDownloadModal.textContent = 'Data humidity berhasil diunduh.'; 
    }, 1500);
  }

  // Sembunyikan modal konfirmasi setelah unduhan
  setTimeout(() => {
    modalConfirmContainer.classList.add('hidden');
    modalConfirmDownload.classList.add('hidden');
    currentDownloadType = null; // Reset setelah selesai
  }, 5000);
});

cancelDownloadButton.addEventListener('click', () => {
  modalConfirmContainer.classList.add('hidden');
  modalConfirmDownload.classList.add('hidden');
  currentDownloadType = null;
});

closeButton.addEventListener('click', () => {
  modal1.classList.add('hidden');
  modal2.classList.add('hidden');
});

window.addEventListener('click', function (e) {
  // 1. Cek apakah modal konfirmasi download sedang terbuka (baik overlay maupun kontennya)
  if (!modalConfirmContainer.classList.contains('hidden') && !modalConfirmDownload.classList.contains('hidden')) {
    // Jika klik terjadi di luar modal konten download DAN bukan pada tombol yang terkait dengan modal download
    // Penting: Sertakan juga tombol getPhDataModal dan getHumidityDataModal dalam pengecualian
    // karena klik pada mereka akan membuka modal konfirmasi, jadi jangan langsung tutup
    if (!modalMainDownload.contains(e.target) &&
      e.target !== downloadDataButton &&
      e.target !== cancelDownloadButton &&
      e.target !== getPhDataModal && // Tambahkan ini
      e.target !== getHumidityDataModal) { // Tambahkan ini
      modalConfirmContainer.classList.add('hidden');
      modalConfirmDownload.classList.add('hidden');
      currentDownloadType = null; // Reset jika ditutup dengan klik luar
    }
  }
  // 2. Jika modal konfirmasi download TIDAK terbuka, cek apakah modal info utama sedang terbuka
  // (baik overlay maupun kontennya)
  else if (!modal1.classList.contains('hidden') && !modal2.classList.contains('hidden')) {
    // Jika klik terjadi di luar modal konten info DAN bukan pada tombol yang terkait dengan modal info
    if (!modalMain.contains(e.target) &&
      e.target !== downloadDataButton &&
      e.target !== infoButton &&
      e.target !== closeButton &&
      e.target !== cancelDownloadButton &&
      e.target !== getPhDataModal && // Ini juga penting jika tombol ini bisa memicu penutupan modal info
      e.target !== getHumidityDataModal) { // Ini juga penting
      modal1.classList.add('hidden');
      modal2.classList.add('hidden');
    }
  }
});

flushButton.addEventListener('click', () => {
  const title = "Flush Confirmation";
  const content = "Are you sure you want to flush the pump?";
  pumpConfirmAlert(title, content);
});

function updateClock() {
  const now = moment(); // Mendapatkan objek Moment saat ini
  const nowHour = now.hour();
  const nowMinute = now.minute();
  const nowSecond = now.second();
  const formattedTime = now.format('HH : mm : ss'); // Format waktu menjadi HH : mm : ss
  const formattedDate = now.format('ddd, D MMMM YYYY'); // Format tanggal menjadi YYYY-MM-DD
  document.getElementById('clock').textContent = formattedTime; // Memperbarui elemen HTML dengan waktu
  document.getElementById('date').textContent = formattedDate; // Memperbarui elemen HTML dengan tanggal

  let targetTime;

  if (nowHour < 7 || (nowHour === 7 && nowMinute === 0 && nowSecond === 0)) {
    targetTime = moment().hour(7).minute(0).second(0);
  } else {
    targetTime = moment().add(1, 'days').hour(7).minute(0).second(0);
  }

  // Jalankan pompa hanya jika tepat jam 7:00:00
  // if (nowHour === 7 && nowMinute === 0 && nowSecond === 0) {
  //   nyalakanPompa();
  // }

  const timeDifference = moment.duration(targetTime.diff(now));

  const hours = String(timeDifference.hours()).padStart(2, '0');
  const minutes = String(timeDifference.minutes()).padStart(2, '0');
  const seconds = String(timeDifference.seconds()).padStart(2, '0');

  const formattedCountdownHour = `${hours}`;
  const formattedCountdownMinute = `${minutes}`;
  const formattedCountdownSecond = `${seconds}`;
  document.getElementById('countdownHour').textContent = formattedCountdownHour;
  document.getElementById('countdownMinute').textContent = formattedCountdownMinute;
  document.getElementById('countdownSecond').textContent = formattedCountdownSecond;
}

  // Panggil fungsi updateClock setiap detik (1000 milidetik)
setInterval(updateClock, 1000);

 // Panggil updateClock sekali saat halaman dimuat untuk menampilkan waktu awal
updateClock();
