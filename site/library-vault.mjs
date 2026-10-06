import { libraryDB } from "./library-store.mjs?v=0.17.0";

export const VAULT_VERSION = 1;
export const MAX_BACKUP_BYTES = 150_000_000;
const empty = () => ({
  schemaVersion: VAULT_VERSION,
  indexVersion: "lexical-v1/e5-q8-passages-v3",
  shelves: [],
  books: [],
  vectors: [],
});
export const digest = async (text) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export const bookFingerprint = (book) =>
  digest(
    JSON.stringify([
      book.language,
      book.units.map((u) => [u.text, u.reference]),
    ]),
  );
export function validateSnapshot(value) {
  if (
    !value ||
    value.schemaVersion !== VAULT_VERSION ||
    value.indexVersion !== "lexical-v1/e5-q8-passages-v3" ||
    !["shelves", "books", "vectors"].every((k) => Array.isArray(value[k]))
  )
    throw Error("vault-version");
  if (value.shelves.length > 10000 || value.books.length > 10000)
    throw Error("vault-invalid");
  const ids = new Set();
  for (const shelf of value.shelves) {
    if (
      typeof shelf.id !== "string" ||
      !shelf.id ||
      typeof shelf.title !== "string" ||
      !shelf.title.trim() ||
      shelf.title.length > 100 ||
      ids.has(shelf.id)
    )
      throw Error("vault-invalid");
    ids.add(shelf.id);
  }
  const bookIds = new Set();
  for (const b of value.books) {
    if (
      typeof b.id !== "string" ||
      bookIds.has(b.id) ||
      !ids.has(b.shelfId) ||
      !["ar", "en"].includes(b.language) ||
      typeof b.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 200 ||
      !Array.isArray(b.units) ||
      !b.units.length ||
      b.units.length > 5000
    )
      throw Error("vault-invalid");
    bookIds.add(b.id);
    const units = new Set();
    for (const u of b.units) {
      if (
        !Number.isInteger(u.id) ||
        units.has(u.id) ||
        typeof u.text !== "string" ||
        !u.text.trim() ||
        u.text.length > 100000 ||
        typeof u.reference !== "string" ||
        !Array.isArray(u.tokens) ||
        u.tokens.some((t) => typeof t !== "string")
      )
        throw Error("vault-invalid");
      units.add(u.id);
    }
  }
  const vectorIds = new Set();
  for (const v of value.vectors) {
    if (
      !bookIds.has(v.id) ||
      vectorIds.has(v.id) ||
      typeof v.version !== "string" ||
      !Number.isInteger(v.count) ||
      v.count < 0 ||
      !Array.isArray(v.vectors) ||
      v.vectors.length > v.count ||
      v.vectors.some(
        (row) =>
          row !== null &&
          (!Array.isArray(row) ||
            row.length !== 384 ||
            row.some((x) => !Number.isFinite(x))),
      )
    )
      throw Error("vault-invalid");
    vectorIds.add(v.id);
  }
  return value;
}
export async function encodeBackup(snapshot) {
  const payload = JSON.stringify(validateSnapshot(snapshot));
  const text = JSON.stringify({
    format: "raff-library-backup",
    version: 1,
    checksum: await digest(payload),
    payload,
  });
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw Error("vault-size");
  return text;
}
export async function decodeBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw Error("vault-size");
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw Error("vault-invalid");
  }
  if (
    envelope?.format !== "raff-library-backup" ||
    envelope.version !== 1 ||
    typeof envelope.payload !== "string"
  )
    throw Error("vault-version");
  if ((await digest(envelope.payload)) !== envelope.checksum)
    throw Error("vault-checksum");
  return validateSnapshot(JSON.parse(envelope.payload));
}
async function readText(handle, name) {
  return (await (await handle.getFileHandle(name)).getFile()).text();
}
async function writeVerified(handle, name, text) {
  const file = await handle.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(text);
    await writer.close();
  } catch (error) {
    try {
      await writer.abort();
    } catch {}
    throw error;
  }
  if ((await readText(handle, name)) !== text) throw Error("vault-verify");
}
export async function readFolder(handle) {
  let manifest;
  try {
    manifest = await readText(handle, "raff-library.json");
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    // Never call a populated/corrupt directory an empty library.
    for await (const [name] of handle.entries())
      if (name.startsWith("raff-")) throw Error("vault-recovery");
    return empty();
  }
  const pointer = JSON.parse(manifest);
  if (
    pointer.version !== 1 ||
    !/^raff-snapshot-[a-f0-9-]+\.json$/.test(pointer.file)
  )
    throw Error("vault-invalid");
  return decodeBackup(await readText(handle, pointer.file));
}
export async function writeFolder(handle, snapshot) {
  const text = await encodeBackup(snapshot),
    name = `raff-snapshot-${crypto.randomUUID()}.json`;
  // Immutable generation first; failed writing cannot replace the previous data.
  await writeVerified(handle, name, text);
  await decodeBackup(await readText(handle, name));
  let previous;
  try {
    previous = await readText(handle, "raff-library.json");
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }
  if (previous)
    await writeVerified(handle, "raff-library.previous.json", previous);
  await writeVerified(
    handle,
    "raff-library.json",
    JSON.stringify({ version: 1, file: name }),
  );
  return readFolder(handle);
}
export async function mergeSnapshot(current, incoming) {
  validateSnapshot(incoming);
  const next = structuredClone(current),
    fingerprints = new Set();
  for (const b of next.books) fingerprints.add(await bookFingerprint(b));
  const shelfIds = new Map();
  let duplicates = 0;
  for (const s of incoming.shelves) {
    const existing = next.shelves.find((x) => x.title === s.title);
    const id = existing?.id || crypto.randomUUID();
    shelfIds.set(s.id, id);
    if (!existing) next.shelves.push({ id, title: s.title });
  }
  for (const b of incoming.books) {
    const fingerprint = await bookFingerprint(b);
    if (fingerprints.has(fingerprint)) {
      duplicates++;
      continue;
    }
    fingerprints.add(fingerprint);
    const id = `local-${crypto.randomUUID()}`;
    next.books.push({
      ...b,
      id,
      shelfId: shelfIds.get(b.shelfId),
      fingerprint,
    });
    const vector = incoming.vectors.find((v) => v.id === b.id);
    if (vector) next.vectors.push({ ...vector, id });
  }
  return { snapshot: next, duplicates };
}
export class LibraryVault {
  constructor(db = libraryDB) {
    this.db = db;
    this.snapshot = empty();
    this.mode = "browser";
    this.handle = null;
    this.ready = false;
  }
  async init() {
    const location = await this.db("get", "settings", "library-location");
    if (location?.mode === "folder") {
      this.mode = "folder";
      this.handle = location.handle;
      return this.reconnect(false);
    }
    return this.useBrowser(false);
  }
  async useBrowser(persist = true) {
    let saved = await this.db("get", "settings", "library-snapshot");
    if (!saved) {
      const [shelves, books, vectors] = await Promise.all(
        ["shelves", "books", "vectors"].map((s) => this.db("getAll", s)),
      );
      saved = {
        data: {
          ...empty(),
          shelves,
          books,
          vectors: vectors.filter((v) => books.some((b) => b.id === v.id)),
        },
      };
    }
    const snapshot = validateSnapshot(saved.data);
    if (persist)
      await this.db("put", "settings", {
        id: "library-location",
        mode: "browser",
      });
    this.snapshot = snapshot;
    this.mode = "browser";
    this.handle = null;
    this.ready = true;
    return snapshot;
  }
  async reconnect(request) {
    this.ready = false;
    const permission = request
      ? await this.handle.requestPermission({ mode: "readwrite" })
      : await this.handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      this.ready = false;
      throw Error("vault-permission");
    }
    const snapshot = await readFolder(this.handle);
    this.snapshot = snapshot;
    this.ready = true;
    await this.restoreVectors();
    return snapshot;
  }
  async chooseFolder(parent) {
    const handle =
      parent.name === "Raff"
        ? parent
        : await parent.getDirectoryHandle("Raff", { create: true });
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted")
      throw Error("vault-permission");
    const snapshot = await readFolder(handle);
    await this.db("put", "settings", {
      id: "library-location",
      mode: "folder",
      handle,
    });
    this.mode = "folder";
    this.handle = handle;
    this.snapshot = snapshot;
    this.ready = true;
    await this.restoreVectors();
    return snapshot;
  }
  async restoreVectors() {
    for (const v of this.snapshot.vectors) await this.db("put", "vectors", v);
  }
  async recoverPrevious() {
    if (
      !this.handle ||
      (await this.handle.requestPermission({ mode: "readwrite" })) !== "granted"
    )
      throw Error("vault-permission");
    let previous;
    try {
      previous = await readText(this.handle, "raff-library.previous.json");
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      // A first write may finish its snapshot but fail before its first manifest.
      const candidates = [];
      for await (const [name] of this.handle.entries()) {
        if (!/^raff-snapshot-[a-f0-9-]+\.json$/.test(name)) continue;
        try {
          const saved = await decodeBackup(await readText(this.handle, name));
          candidates.push({ name, writtenAt: Number(saved.writtenAt) || 0 });
        } catch (failure) {
          if (failure.name === "NotAllowedError") throw failure;
        }
      }
      candidates.sort((a, b) => b.writtenAt - a.writtenAt);
      if (!candidates.length) throw Error("vault-recovery");
      previous = JSON.stringify({ version: 1, file: candidates[0].name });
    }
    const pointer = JSON.parse(previous);
    if (
      pointer.version !== 1 ||
      !/^raff-snapshot-[a-f0-9-]+\.json$/.test(pointer.file)
    )
      throw Error("vault-invalid");
    await decodeBackup(await readText(this.handle, pointer.file));
    await writeVerified(this.handle, "raff-library.json", previous);
    return this.reconnect(false);
  }
  async save(snapshot) {
    if (this.saving) throw Error("vault-busy");
    this.saving = true;
    try {
      const perform = () => this.commit(snapshot);
      return globalThis.navigator?.locks
        ? await navigator.locks.request("raff-library-write", perform)
        : await perform();
    } finally {
      this.saving = false;
    }
  }
  async commit(snapshot) {
    if (!this.ready) throw Error("vault-permission");
    validateSnapshot(snapshot);
    const expectedRevision = this.snapshot.revision || null;
    snapshot = {
      ...snapshot,
      revision: crypto.randomUUID(),
      writtenAt: Date.now(),
    };
    if (this.mode === "folder") {
      if (
        (await this.handle.queryPermission({ mode: "readwrite" })) !== "granted"
      ) {
        this.ready = false;
        throw Error("vault-permission");
      }
      let current, manifest;
      try {
        manifest = await readText(this.handle, "raff-library.json");
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      if (manifest) {
        const pointer = JSON.parse(manifest);
        if (!/^raff-snapshot-[a-f0-9-]+\.json$/.test(pointer.file))
          throw Error("vault-invalid");
        current = await decodeBackup(await readText(this.handle, pointer.file));
      }
      if ((current?.revision || null) !== expectedRevision)
        throw Error("vault-conflict");
      const result = await writeFolder(this.handle, snapshot);
      this.snapshot = result;
    } else {
      const current = await this.db("get", "settings", "library-snapshot");
      if ((current?.data?.revision || null) !== expectedRevision)
        throw Error("vault-conflict");
      const text = await encodeBackup(snapshot);
      const verified = await decodeBackup(text);
      await this.db("put", "settings", {
        id: "library-snapshot",
        data: verified,
      });
      const saved = await this.db("get", "settings", "library-snapshot");
      if (JSON.stringify(saved?.data) !== JSON.stringify(verified))
        throw Error("vault-verify");
      this.snapshot = verified;
    }
    return this.snapshot;
  }
  async saveVectors() {
    const all = await this.db("getAll", "vectors");
    const vectors = all.filter((v) =>
      this.snapshot.books.some((b) => b.id === v.id),
    );
    if (JSON.stringify(vectors) !== JSON.stringify(this.snapshot.vectors))
      await this.save({ ...this.snapshot, vectors });
  }
  async export() {
    await this.saveVectors();
    return encodeBackup(this.snapshot);
  }
}
