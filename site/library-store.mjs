const connect = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("raff-personal-library", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("shelves", { keyPath: "id" });
      request.result.createObjectStore("books", { keyPath: "id" });
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
        action === "getAll" ? "readonly" : "readwrite",
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
