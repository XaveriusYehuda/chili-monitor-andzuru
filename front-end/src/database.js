const DB_NAME = 'SensorMonitorDB';
const DB_VERSION = 1;
const STORE_NAME_1 = 'humidityUpdates'; // Nama object store untuk menyimpan update
const STORE_NAME_2 = 'phUpdates'; // Nama object store untuk menyimpan update

let db; // Variabel untuk menyimpan instance database

// Fungsi untuk membuka IndexedDB
export function openDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = (event) => {
			console.error('Error opening IndexedDB:', event.target.errorCode);
			reject(event.target.errorCode);
		};

		request.onsuccess = (event) => {
			db = event.target.result;
			console.log('IndexedDB opened successfully');
			resolve(db);
		};

		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			// Buat object store untuk pH
			if (!db.objectStoreNames.contains(STORE_NAME_2)) {
				const phStore = db.createObjectStore(STORE_NAME_2, { keyPath: 'id', autoIncrement: true });
				phStore.createIndex('timestampCloudReceived', 'timestampCloudReceived', { unique: false });
				phStore.createIndex('timestampBrowserReceived', 'timestampBrowserReceived', { unique: false });
				console.log(`Object store '${STORE_NAME_2}' created.`);
			}
			// Buat object store untuk kelembapan
			if (!db.objectStoreNames.contains(STORE_NAME_1)) {
				const humidityStore = db.createObjectStore(STORE_NAME_1, { keyPath: 'id', autoIncrement: true });
				humidityStore.createIndex('timestampCloudReceived', 'timestampCloudReceived', { unique: false });
				humidityStore.createIndex('timestampBrowserReceived', 'timestampBrowserReceived', { unique: false });
				console.log(`Object store '${STORE_NAME_1}' created.`);
			}
		};
	});
}

// Fungsi untuk menyimpan data ke IndexedDB
// Simpan data ke object store pH
export function savePhDataToDb(data) {
  if (!db) {
	console.warn('IndexedDB not open. Cannot save pH data.');
	return;
  }
  if (!data || typeof data !== 'object') {
	console.warn('Invalid pH data. Not saving to IndexedDB.');
	return;
  }
  // Remove id if exists to avoid DataError
  if ('id' in data) {
	delete data.id;
  }
  const transaction = db.transaction([STORE_NAME_2], 'readwrite');
  const objectStore = transaction.objectStore(STORE_NAME_2);
  const request = objectStore.add(data);
  request.onsuccess = () => {
	// console.log('pH data saved to IndexedDB:', data);
  };
  request.onerror = (event) => {
	console.error('Error saving pH data to IndexedDB:', event.target.errorCode);
  };
}

// Simpan data ke object store kelembapan
export function saveHumidityDataToDb(data) {
  if (!db) {
	console.warn('IndexedDB not open. Cannot save humidity data.');
	return;
  }
  const transaction = db.transaction([STORE_NAME_1], 'readwrite');
  const objectStore = transaction.objectStore(STORE_NAME_1);
  const request = objectStore.add(data);
  request.onsuccess = () => {
	// console.log('Humidity data saved to IndexedDB:', data);
  };
  request.onerror = (event) => {
	console.error('Error saving humidity data to IndexedDB:', event.target.errorCode);
  };
}

// Fungsi untuk membaca semua data dari IndexedDB (opsional, jika Anda ingin menampilkan history)
export function getHumidityDataFromDb(limit = 8) {
  return new Promise((resolve, reject) => {
	if (!db) {
	  console.warn('IndexedDB not open. Cannot get data.');
	  resolve([]);
	  return;
	}

	const transaction = db.transaction([STORE_NAME_1], 'readonly');
	const objectStore = transaction.objectStore(STORE_NAME_1);
	const request = objectStore.openCursor(null, 'prev'); // ambil dari data terbaru
	const results = [];

	request.onsuccess = (event) => {
	  const cursor = event.target.result;
	  if (cursor && results.length < limit) {
		results.push(cursor.value);
		cursor.continue();
	  } else {
		resolve(results);
	  }
	};

	request.onerror = (event) => {
	  console.error('Error getting data from IndexedDB:', event.target.errorCode);
	  reject(event.target.errorCode);
	};
  });
}

export function getPhDataFromDb(limit = 10) {
  return new Promise((resolve, reject) => {
	if (!db) {
	  console.warn('IndexedDB not open. Cannot get data.');
	  resolve([]);
	  return;
	}

	const transaction = db.transaction([STORE_NAME_2], 'readonly');
	const objectStore = transaction.objectStore(STORE_NAME_2);
	const request = objectStore.openCursor(null, 'prev'); // ambil dari data terbaru
	const results = [];

	request.onsuccess = (event) => {
	  const cursor = event.target.result;
	  if (cursor && results.length < limit) {
		results.push(cursor.value);
		cursor.continue();
	  } else {
		resolve(results);
	  }
	};

	request.onerror = (event) => {
	  console.error('Error getting data from IndexedDB:', event.target.errorCode);
	  reject(event.target.errorCode);
	};
  });
}

// Tidak dipakai
// Fungsi untuk menghapus data lama dari IndexedDB (opsional, untuk menjaga ukuran DB)
export function cleanOldDataFromDb(maxEntries = 100) {
	return new Promise((resolve, reject) => {
		if (!db) {
			console.warn('IndexedDB not open. Cannot clean data.');
			resolve();
			return;
		}

		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const objectStore = transaction.objectStore(STORE_NAME);
		const request = objectStore.count();

		request.onsuccess = (event) => {
			const count = event.target.result;
			if (count > maxEntries) {
				const numToDelete = count - maxEntries;
				const deleteRequest = objectStore.openCursor();
				let deletedCount = 0;

				deleteRequest.onsuccess = (cursorEvent) => {
					const cursor = cursorEvent.target.result;
					if (cursor && deletedCount < numToDelete) {
						cursor.delete();
						deletedCount++;
						cursor.continue();
					} else {
						console.log(`Cleaned ${deletedCount} old entries from IndexedDB.`);
						resolve();
					}
				};

				deleteRequest.onerror = (err) => {
					console.error('Error cleaning old data:', err);
					reject(err);
				};
			} else {
				resolve();
			}
		};

		request.onerror = (err) => {
			console.error('Error counting data for cleanup:', err);
			reject(err);
		};
	});
}