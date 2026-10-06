import test from "node:test";
import assert from "node:assert/strict";
import {
  LibraryVault,
  encodeBackup,
  decodeBackup,
  writeFolder,
  readFolder,
  mergeSnapshot,
} from "../site/library-vault.mjs";
import { importBook, searchLibrary } from "../site/library-core.mjs";
const blank = () => ({
  schemaVersion: 1,
  indexVersion: "lexical-v1/e5-q8-passages-v3",
  shelves: [{ id: "s1", title: "My shelf" }],
  books: [],
  vectors: [],
});
const book = (content = "تفتح المكتبة الساعة التاسعة صباحًا.", id = "b1") => ({
  ...importBook({
    content,
    filename: "guide.txt",
    title: "Guide",
    author: "Test",
    language: "ar",
    shelfId: "s1",
  }),
  id,
});
function dbMock() {
  const data = new Map(
    ["settings", "books", "shelves", "vectors"].map((n) => [n, new Map()]),
  );
  const db = async (a, s, v) => {
    const m = data.get(s);
    if (a === "put") {
      m.set(v.id, s === "settings" && v.handle ? { ...v } : structuredClone(v));
      return v.id;
    }
    if (a === "get") return m.get(v);
    if (a === "getAll") return [...m.values()];
  };
  return { db, data };
}
function folder(name = "Raff") {
  const files = new Map(),
    dirs = new Map();
  return {
    name,
    files,
    dirs,
    permission: "granted",
    fail: null,
    corrupt: null,
    async queryPermission() {
      return this.permission;
    },
    async requestPermission() {
      return this.permission;
    },
    async *entries() {
      for (const x of files) yield x;
    },
    async getDirectoryHandle(n, { create } = {}) {
      if (!dirs.has(n)) {
        if (!create) throw new DOMException("missing", "NotFoundError");
        dirs.set(n, folder(n));
      }
      return dirs.get(n);
    },
    async getFileHandle(n, { create } = {}) {
      const f = this;
      if (!files.has(n)) {
        if (!create) throw new DOMException("missing", "NotFoundError");
        files.set(n, "");
      }
      return {
        async getFile() {
          return { text: async () => files.get(n) };
        },
        async createWritable() {
          let pending;
          return {
            async write(text) {
              pending = text;
            },
            async close() {
              if (f.fail?.(n))
                throw new DOMException("full", "QuotaExceededError");
              files.set(n, f.corrupt?.(n) ? "corrupt" : pending);
            },
            async abort() {},
          };
        },
      };
    },
  };
}

test("full backup retains references, text indexes and semantic vectors; corruption is rejected", async () => {
  const s = blank();
  s.books.push(book());
  s.vectors.push({
    id: "b1",
    version: "e5-q8-passages-v3",
    count: 1,
    vectors: [Array(384).fill(0.1)],
  });
  assert.deepEqual(await decodeBackup(await encodeBackup(s)), s);
  const envelope = JSON.parse(await encodeBackup(s));
  envelope.payload = envelope.payload.replace("Guide", "Other");
  await assert.rejects(decodeBackup(JSON.stringify(envelope)), /checksum/);
});
test("folder save is readable after a new instance with remembered handle; failed permission never empties it", async () => {
  const { db } = dbMock(),
    dir = folder();
  const first = new LibraryVault(db);
  await first.chooseFolder(dir);
  const s = blank();
  s.books.push(book());
  await first.save(s);
  const manifest = dir.files.get("raff-library.json");
  dir.permission = "prompt";
  const reopened = new LibraryVault(db);
  await assert.rejects(reopened.init(), /permission/);
  assert.equal(reopened.ready, false);
  assert.equal(dir.files.get("raff-library.json"), manifest);
  await assert.rejects(reopened.save(blank()), /permission/);
  dir.permission = "granted";
  await reopened.reconnect(true);
  assert.equal(reopened.snapshot.books.length, 1);
  assert.equal(
    searchLibrary(reopened.snapshot.books, "الساعة التاسعة", {
      language: "ar",
      bookIds: ["b1"],
    })[0].bookId,
    "b1",
  );
});
test("write failure and read-back corruption preserve previous committed snapshot and do not mark new book ready", async () => {
  const { db } = dbMock(),
    dir = folder(),
    v = new LibraryVault(db);
  await v.chooseFolder(dir);
  await v.save({ ...blank(), books: [book()] });
  const pointer = dir.files.get("raff-library.json");
  dir.fail = (n) => n.startsWith("raff-snapshot-");
  await assert.rejects(
    v.save({
      ...v.snapshot,
      books: [
        ...v.snapshot.books,
        book("يغلق المتحف الساعة الخامسة مساءً.", "b2"),
      ],
    }),
    { name: "QuotaExceededError" },
  );
  assert.equal(v.snapshot.books.length, 1);
  assert.equal(dir.files.get("raff-library.json"), pointer);
  dir.fail = null;
  dir.corrupt = (n) => n.startsWith("raff-snapshot-");
  await assert.rejects(v.save({ ...v.snapshot, books: [] }), /verify/);
  assert.equal((await readFolder(dir)).books.length, 1);
});
test("switching folders does not move data and reconnecting restores each separate library", async () => {
  const { db } = dbMock(),
    a = folder(),
    parent = folder("Parent"),
    v = new LibraryVault(db);
  await v.chooseFolder(a);
  await v.save({ ...blank(), books: [book()] });
  await v.chooseFolder(parent);
  assert.equal(v.handle.name, "Raff");
  assert.equal(v.snapshot.books.length, 0);
  await v.chooseFolder(a);
  assert.equal(v.snapshot.books.length, 1);
});
test("missing manifest with existing snapshots is a recovery error, never an empty library", async () => {
  const dir = folder();
  dir.files.set("raff-snapshot-abc.json", "saved");
  await assert.rejects(readFolder(dir), /recovery/);
  dir.files.set(
    "raff-library.json",
    JSON.stringify({ version: 1, file: "../outside.json" }),
  );
  await assert.rejects(readFolder(dir), /invalid/);
});
test("browser migration preserves old books and reload reads committed snapshot without reimport", async () => {
  const { db } = dbMock();
  await db("put", "shelves", { id: "s1", title: "My shelf" });
  await db("put", "books", book());
  const v = new LibraryVault(db);
  await v.init();
  assert.equal(v.snapshot.books.length, 1);
  await v.save(v.snapshot);
  const reopened = new LibraryVault(db);
  await reopened.init();
  assert.equal(reopened.snapshot.books[0].units[0].text, book().units[0].text);
});
test("backup merge deduplicates content while retaining old books and index vectors", async () => {
  const s = { ...blank(), books: [book()] },
    incoming = {
      ...blank(),
      books: [
        book(undefined, "duplicate"),
        book("مدة الاستعارة أربعة عشر يومًا.", "new"),
      ],
    };
  incoming.vectors = [
    {
      id: "new",
      version: "e5-q8-passages-v3",
      count: 1,
      vectors: [Array(384).fill(0.2)],
    },
  ];
  const merged = await mergeSnapshot(s, incoming);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.snapshot.books.length, 2);
  assert.equal(merged.snapshot.vectors[0].id, merged.snapshot.books[1].id);
  assert.equal(s.books.length, 1);
});
test("newer changes in another tab cannot be overwritten by an old snapshot", async () => {
  const { db } = dbMock(),
    a = new LibraryVault(db),
    b = new LibraryVault(db);
  await a.init();
  await b.init();
  await a.save({ ...blank(), books: [book()] });
  await assert.rejects(b.save(blank()), /conflict/);
  assert.equal(
    (await db("get", "settings", "library-snapshot")).data.books.length,
    1,
  );
});
test("corrupt manifest can explicitly recover previous verified generation", async () => {
  const { db } = dbMock(),
    dir = folder(),
    v = new LibraryVault(db);
  await v.chooseFolder(dir);
  await v.save({ ...blank(), books: [book()] });
  await v.save({
    ...v.snapshot,
    books: [...v.snapshot.books, book("وقت فتح المتحف يوم السبت.", "b2")],
  });
  dir.files.set("raff-library.json", "broken");
  await assert.rejects(v.reconnect(false));
  assert.equal(v.ready, false);
  await v.recoverPrevious();
  assert.equal(v.snapshot.books.length, 1);
});

test("first save with a failed manifest explicitly recovers its verified snapshot", async () => {
  const { db } = dbMock(),
    dir = folder(),
    v = new LibraryVault(db);
  await v.chooseFolder(dir);
  dir.fail = (name) => name === "raff-library.json";
  await assert.rejects(v.save({ ...blank(), books: [book()] }));
  assert.equal(v.snapshot.books.length, 0);
  dir.fail = null;
  const reopened = new LibraryVault(db);
  await assert.rejects(reopened.init());
  await reopened.recoverPrevious();
  assert.equal(reopened.snapshot.books[0].units[0].text, book().units[0].text);
});
