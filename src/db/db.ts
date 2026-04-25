const DB_NAME = 'gea_db';
const DB_VERSION = 1;
const STORES = ['notes', 'images', 'settings'];

let DB: IDBDatabase | null = null;

export function initDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (DB) {
      resolve();
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      STORES.forEach(s => {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = (e: Event) => {
      DB = (e.target as IDBOpenDBRequest).result;
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export function dbAdd(store: string, data: any): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!DB) return reject("DB not initialized");
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(data);
    req.onsuccess = (e: Event) => resolve((e.target as IDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export function dbGetAll(store: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    if (!DB) return reject("DB not initialized");
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = (e: Event) => resolve((e.target as IDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export function dbGet(store: string, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!DB) return reject("DB not initialized");
    const tx = DB.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = (e: Event) => resolve((e.target as IDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export function dbPut(store: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!DB) return reject("DB not initialized");
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function dbDelete(store: string, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!DB) return reject("DB not initialized");
    const tx = DB.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
