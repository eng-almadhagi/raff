const connect = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("raff-personal-library", 2);
    request.onupgradeneeded = () => {
      for (const name of ["shelves", "books", "vectors"]) {
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function libraryDB(action, store, value) {
  const db = await connect();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        store,
        ["get", "getAll"].includes(action) ? "readonly" : "readwrite",
      );
      const request = tx.objectStore(store)[action](value);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("aborted"));
    });
  } finally {
    db.close();
  }
}
