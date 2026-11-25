export interface LocalStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  entries<T>(prefix: string): Promise<[string, T][]>;
  clear(): Promise<void>;
}

/** Listening data stays in this origin's IndexedDB. No cloud backup or AI requests. */
export function indexedStore(): LocalStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(Error("BROWSER_STORAGE_UNAVAILABLE")); return; }
    const request = indexedDB.open("zmusicstats-local-report-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("BROWSER_STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(Error("BROWSER_STORAGE_UNAVAILABLE"));
  });
  async function operation<T>(mode: IDBTransactionMode, action: (object: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("records", mode), request = action(transaction.objectStore("records"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(Error("BROWSER_STORAGE_UNAVAILABLE"));
    });
  }
  return {
    get: key => operation("readonly", object => object.get(key)),
    set: async (key, value) => { await operation("readwrite", object => object.put(value, key)); },
    entries: async <T>(prefix: string) => {
      const db = await open();
      return new Promise<[string, T][]>((resolve, reject) => {
        const transaction = db.transaction("records", "readonly"), found: [string, T][] = [];
        const cursor = transaction.objectStore("records").openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        cursor.onsuccess = () => { if (cursor.result) { found.push([String(cursor.result.key), cursor.result.value]); cursor.result.continue(); } };
        transaction.oncomplete = () => resolve(found);
        transaction.onerror = () => reject(Error("BROWSER_STORAGE_UNAVAILABLE"));
      });
    },
    clear: async () => { await operation("readwrite", object => object.clear()); },
  };
}
