const DB_NAME = "latte-speech";
const DB_VERSION = 1;
const STORE = "clips";

interface SpeechRecord {
  messageId: string;
  model: string;
  voice: string;
  audio: Blob;
}

let opening: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!opening) {
    opening = connect(indexedDB).catch((error: unknown) => {
      opening = null;
      console.warn("Latte could not open speech storage.", error);
      return null;
    });
  }
  return opening;
}

function connect(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) return;
      const store = db.createObjectStore(STORE, { keyPath: ["messageId", "model", "voice"] });
      store.createIndex("byMessage", "messageId");
    };
    request.onsuccess = () => {
      const db = request.result;
      const session = opening;
      const forget = () => {
        if (opening === session) opening = null;
      };
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () => reject(new Error("IndexedDB open blocked."));
  });
}

function finish(tx: IDBTransaction, resolve: () => void, reject: (error: unknown) => void) {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
}

export function readSpeechAudio(messageId: string, model: string, voice: string): Promise<Blob | null> {
  return openDatabase()
    .then((db) => {
      if (!db) return null;
      return new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get([messageId, model, voice]);
        request.onsuccess = () => {
          const record = request.result as SpeechRecord | undefined;
          const audio = record?.audio;
          resolve(audio instanceof Blob && audio.size > 0 ? audio : null);
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
      });
    })
    .catch((error: unknown) => {
      console.warn("Latte could not read speech.", error);
      return null;
    });
}

export function writeSpeechAudio(messageId: string, model: string, voice: string, audio: Blob): Promise<boolean> {
  if (audio.size === 0) return Promise.resolve(false);
  return openDatabase()
    .then((db) => {
      if (!db) return false;
      return new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const record: SpeechRecord = { messageId, model, voice, audio };
        tx.objectStore(STORE).put(record);
        finish(tx, () => resolve(true), reject);
      });
    })
    .catch((error: unknown) => {
      console.warn("Latte could not store speech.", error);
      return false;
    });
}

export function deleteSpeechAudio(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return Promise.resolve();
  return openDatabase()
    .then((db) => {
      if (!db) return;
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const index = tx.objectStore(STORE).index("byMessage");
        for (const messageId of messageIds) {
          const request = index.getAllKeys(messageId);
          request.onsuccess = () => {
            const store = tx.objectStore(STORE);
            for (const key of request.result) store.delete(key);
          };
        }
        finish(tx, resolve, reject);
      });
    })
    .catch((error: unknown) => {
      console.warn("Latte could not delete speech.", error);
    });
}

export function deleteSpeechVariant(messageId: string, model: string, voice: string): Promise<void> {
  return openDatabase()
    .then((db) => {
      if (!db) return;
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete([messageId, model, voice]);
        finish(tx, resolve, reject);
      });
    })
    .catch((error: unknown) => {
      console.warn("Latte could not delete speech.", error);
    });
}

export function clearSpeechAudio(): Promise<void> {
  return openDatabase()
    .then((db) => {
      if (!db) return;
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        finish(tx, resolve, reject);
      });
    })
    .catch((error: unknown) => {
      console.warn("Latte could not clear speech.", error);
    });
}
