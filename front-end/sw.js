import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration'; // Hanya satu kali

// Precache semua aset yang di-generate oleh injectManifest
precacheAndRoute(self.__WB_MANIFEST || []);

// VAPID Public Key Anda
const VAPID_PUBLIC_KEY = 'BEr7RhsHyH-U39qwfNHjCgsxD3_cBFL17xttbkvTWYbavxeJoED-IKkSf1Ui4CUYiIdGsNeknYBqeEjVuIFQgFc';

// Fungsi untuk urlBase64ToUint8Array (diperlukan untuk konversi VAPID key)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4); 
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/'); 
  const rawData = self.atob(base64); 
  const outputArray = new Uint8Array(rawData.length); 
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i); 
  }
  return outputArray; 
}

// Event listener untuk push notification
self.addEventListener('push', (event) => {
  console.log('Service worker pushing...');
  let notificationData = {
    title: 'Andzuru Monitor',
    options: {
      body: 'Peringatan!',
      icon: 'pwa-196x196.png', // Ganti sesuai path icon Anda
      badge: '148x148.png', // Ganti sesuai path badge Anda
    },
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData.title = data.title || notificationData.title;
      notificationData.options = { ...notificationData.options, ...data.options };
    } catch (e) {
      // Jika parsing gagal, gunakan default
      console.warn('Push event data is not valid JSON:', e);
    }
  }

  event.waitUntil(
    self.registration.showNotification(
      notificationData.title,
      notificationData.options
    )
  );
});

// self.addEventListener('push', (event) => {
//   console.log('Service worker pushing...');
 
//   async function chainPromise() {
//     await self.registration.showNotification('Ada laporan baru untuk Anda!', {
//       body: 'Terjadi kerusakan lampu jalan di Jl. Melati',
//     });
//   }
 
//   event.waitUntil(chainPromise());
// });



// 1. Caching untuk halaman HTML (misalnya index.html)
registerRoute(
  ({ request }) => request.destination === 'document',
  new StaleWhileRevalidate({ // Atau CacheFirst jika halaman jarang berubah
    cacheName: 'html-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 24 * 60 * 60, // 24 jam
      }),
    ],
  })
);

// 2. Caching untuk CSS
registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: 'css-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 hari
      }),
    ],
  })
);

// 3. Caching untuk JavaScript (aplikasi Anda)
registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: 'js-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  })
);

// Caching API untuk daftar cerita menggunakan StaleWhileRevalidate
registerRoute(
  ({ url }) => url.href.startsWith('wss://chili-monitor-data.andzuru.space'), //
  new NetworkFirst({
    cacheName: 'sensor-data-cache', //
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 24 * 60 * 60, //
      }),
    ],
  })
);

// Caching untuk aset gambar statis aplikasi (icon, badge, dsb)
registerRoute(
  ({ request, url }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'app-images-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

