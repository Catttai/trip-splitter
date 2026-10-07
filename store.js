// Storage: Firebase Firestore when configured (shared + live), otherwise
// this browser's localStorage. Both expose the same interface.

import { FIREBASE_CONFIG, TRIP_ID } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

export async function openStore(onChange, onStatus) {
  if (FIREBASE_CONFIG) {
    try {
      return await firestoreStore(onChange, onStatus);
    } catch (err) {
      console.error(err);
      onStatus('error', 'Could not connect to the shared database. Saving on this device only.');
    }
  }
  return localStore(onChange, onStatus);
}

async function firestoreStore(onChange, onStatus) {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const fs = await import(FB + 'firebase-firestore.js');
  const app = initializeApp(FIREBASE_CONFIG);
  // Persistent cache: the list shows instantly on reopen and edits made
  // offline sync once the phone is back online.
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const col = fs.collection(db, 'trips', TRIP_ID, 'expenses');

  onStatus('connecting', 'Connecting…');
  fs.onSnapshot(
    col,
    { includeMetadataChanges: true },
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (snap.metadata.hasPendingWrites) onStatus('saving', 'Saving…');
      else if (snap.metadata.fromCache) onStatus('offline', 'Offline. Changes will sync when you reconnect.');
      else onStatus('live', 'Live. Shared with everyone.');
    },
    (err) => {
      console.error(err);
      onStatus('error', 'Lost connection to the shared database: ' + err.message);
    },
  );

  return {
    add: (e) => fs.addDoc(col, e),
    update: (id, e) => fs.setDoc(fs.doc(col, id), e),
    remove: (id) => fs.deleteDoc(fs.doc(col, id)),
  };
}

function localStore(onChange, onStatus) {
  const key = 'trip-splitter:' + TRIP_ID + ':expenses';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    localStorage.setItem(key, JSON.stringify(list));
    onChange(list);
  };
  window.addEventListener('storage', (ev) => {
    if (ev.key === key) onChange(read());
  });
  if (!FIREBASE_CONFIG) onStatus('local', 'Saved on this device only. Set up Firebase to share.');
  onChange(read());

  return {
    add: async (e) => write([...read(), { ...e, id: crypto.randomUUID() }]),
    update: async (id, e) => write(read().map((x) => (x.id === id ? { ...e, id } : x))),
    remove: async (id) => write(read().filter((x) => x.id !== id)),
  };
}
