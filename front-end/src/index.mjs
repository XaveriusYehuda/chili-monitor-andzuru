const mqttHost = 'a2spluztzgsdhl-ats.iot.ap-southeast-1.amazonaws.com'; // Ganti sesuai endpoint AWS IoT Core kamu
const region = 'ap-southeast-1'; // contoh: ap-southeast-1
const identityPoolId = 'ap-southeast-1:e9f502ea-58c5-459a-bfa3-3ce6e1fc9bff'; // contoh: ap-southeast-1:xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx

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

  const wsUrl = "wss://chili-monitor.andzuru.space";

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ WebSocket connected to', wsUrl);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Data diterima:', data);

      const { topic, data: sensorData, chartData } = data;

      // Ambil nilai mentah Ph dan Kelembapan
      const phRaw = sensorData?.Ph ?? null;
      const humidityRaw = sensorData?.Kelembapan ?? null;

      // Update tampilan nilai Ph dan Kelembapan
      const fixPh = typeof phRaw === 'number' ? phRaw.toFixed(2) : 'N/A';
      const fixHumidity = typeof humidityRaw === 'number' ? humidityRaw.toFixed(2) : 'N/A';

      const phElement = document.getElementById('phValue');
      const humidityElement = document.getElementById('humidityValue');
      const goodGroundStatus = document.getElementById('ground-good-status');
      const poorGroundStatus = document.getElementById('ground-poor-status');

      if (fixPh > 8.5 || fixPh < 5.5 || fixHumidity > 90.00 || fixHumidity < 10.00) {
        goodGroundStatus.classList.add('hidden');
        poorGroundStatus.classList.remove('hidden');
      } else {
        poorGroundStatus.classList.add('hidden');
        goodGroundStatus.classList.remove('hidden');
      }

      if (phElement) phElement.textContent = fixPh;
      if (humidityElement) humidityElement.textContent = fixHumidity;

      /// Update Chart Data jika tersedia
      if (chartData) {
      const { ph, humidity } = chartData;

      if (ph && Array.isArray(ph.timestamps) && Array.isArray(ph.values)) {
        const phTimestamps = ph.timestamps.map(t => Number(t));
        const phValues = ph.values.map(v => Number(v));

        console.log('📊 pH timestamps:', phTimestamps);
        console.log('📊 pH values:', phValues);

        updateDataPh(phTimestamps, phValues);
      }

      if (humidity && Array.isArray(humidity.timestamps) && Array.isArray(humidity.values)) {
        const humidityTimestamps = humidity.timestamps.map(t => Number(t));
        const humidityValues = humidity.values.map(v => Number(v));

        console.log('💧 Humidity timestamps:', humidityTimestamps);
        console.log('💧 Humidity values:', humidityValues);

        updateDataHumidity(humidityTimestamps, humidityValues);
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
  const phValue = document.getElementById('phValue');
  const humidityValue = document.getElementById('humidityValue');
});

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
  console.log(fixTimePh);

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
  type: 'bar',
  data: dataPh,
  options: {
    scales: {
      y: {
        beginAtZero: true
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
  type: 'bar',
  data: dataHumidity,
  options: {
    scales: {
      y: {
        beginAtZero: true
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
const modalMain = document.getElementById('modal-main');
const infoButton = document.getElementById('info-button');
const closeButton = document.getElementById('close-modal');

infoButton.addEventListener('click', () => {
  modal1.classList.remove('hidden');
  modal2.classList.remove('hidden');
});
closeButton.addEventListener('click', () => {
  modal1.classList.add('hidden');
  modal2.classList.add('hidden');
});

window.addEventListener('click', function (e) {
  if (!modalMain.contains(e.target) && !infoButton.contains(e.target)) {
    modal1.classList.add('hidden');
    modal2.classList.add('hidden');
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
