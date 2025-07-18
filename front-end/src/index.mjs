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

let ws;

const setupWebSocket = () => {
  if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
    console.log('WebSocket sudah aktif. Tidak membuat koneksi baru.');
    return;
  }

  const wsUrl = "wss://chili-monitor-data.andzuru.space";

  ws = new WebSocket(wsUrl);

  ws.onopen = async () => {
    console.log('✅ WebSocket connected to', wsUrl);
    // Saat pertama kali terhubung, muat data historical dari IndexedDB
    // await updateDataPhFromDb();
    // await updateDataHumidityFromDb();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Data diterima:', data);

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
      if (!isNaN(phRaw) && !isNaN(humidityRaw) && (phRaw > 8.5 || phRaw < 5.5 || humidityRaw > 90.00 || humidityRaw < 10.00)) {
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

document.addEventListener('DOMContentLoaded', () => {
  setupWebSocket();
  setupMQTT();

  openDb().then(() => {
  }).catch(err => console.error('Failed to open IndexedDB:', err));
});

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

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
  document.getElementById('myChart1'),
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

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
    borderWidth: 2
  }]
};

const configHumidity = {
  type: 'line',
  data: dataHumidity,
  options: {
    scales: {
      y: {
        beginAtZero: false,
        // min dan max akan diatur otomatis oleh Chart.js sesuai data
      }
    }
  }
};

const myChartHumidity = new Chart(
  document.getElementById('myChart'),
  configHumidity
)

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

//modal
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

function updateClock() {
  const now = moment(); // Mendapatkan objek Moment saat ini
  const nowHour = now.hour();
  const nowMinute = now.minute();
  const nowSecond = now.second();
  const formattedTime = now.format('HH : mm : ss'); // Format waktu menjadi HH : mm : ss
  document.getElementById('clock').textContent = formattedTime; // Memperbarui elemen HTML dengan waktu


  let targetTime;

  if (nowHour < 7 || (nowHour === 7 && nowMinute === 0 && nowSecond === 0)) {
    targetTime = moment().hour(7).minute(0).second(0);
  } else {
    targetTime = moment().add(1, 'days').hour(7).minute(0).second(0);
  }

  // Jalankan pompa hanya jika tepat jam 7:00:00
  if (nowHour === 7 && nowMinute === 0 && nowSecond === 0) {
    nyalakanPompa();
  }


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
