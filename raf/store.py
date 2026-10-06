"""SQLite storage. A release is immutable; publication is an atomic pointer change."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from .catalog import BOOK_ID, TITLE, SCOPE

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL,
 active_release TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS releases (
 book_id TEXT NOT NULL REFERENCES books(id), id TEXT NOT NULL,
 manifest TEXT NOT NULL, fingerprint TEXT NOT NULL, model TEXT NOT NULL,
 report TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(book_id,id)
);
CREATE TABLE IF NOT EXISTS units (
 book_id TEXT NOT NULL, release_id TEXT NOT NULL, id TEXT NOT NULL,
 payload TEXT NOT NULL, search_text TEXT NOT NULL, vector TEXT,
 PRIMARY KEY(book_id,release_id,id),
 FOREIGN KEY(book_id,release_id) REFERENCES releases(book_id,id)
);
CREATE INDEX IF NOT EXISTS units_namespace ON units(book_id,release_id);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY, book_id TEXT NOT NULL, release_id TEXT NOT NULL,
 action TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coverage_snapshots (
 book_id TEXT PRIMARY KEY REFERENCES books(id), summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS embedding_cache (
 book_id TEXT NOT NULL, model TEXT NOT NULL, text_hash TEXT NOT NULL,
 vector TEXT NOT NULL, PRIMARY KEY(book_id,model,text_hash)
);
CREATE TABLE IF NOT EXISTS chunks (
 book_id TEXT NOT NULL, release_id TEXT NOT NULL, unit_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, vector TEXT NOT NULL,
 PRIMARY KEY(book_id,release_id,unit_id,ordinal),
 FOREIGN KEY(book_id,release_id) REFERENCES releases(book_id,id)
);
"""


class Store:
    def __init__(self, path="var/raf.sqlite3"):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
            db.execute("INSERT OR IGNORE INTO books(id,title,scope) VALUES(?,?,?)",
                       (BOOK_ID, TITLE, SCOPE))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def books(self):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM books ORDER BY id").fetchall()
            result = []
            for row in rows:
                book = dict(row)
                release = db.execute("SELECT manifest,model FROM releases WHERE book_id=? AND id=?",
                                     (row["id"], row["active_release"])).fetchone()
                book["units"] = db.execute("SELECT count(*) FROM units WHERE book_id=? AND release_id=?",
                                           (row["id"], row["active_release"])).fetchone()[0]
                book["coverage"] = json.loads(release["manifest"])["coverage"] if release else None
                default_mode = "hybrid" if release and release["model"] else "lexical"
                book["search_mode"] = json.loads(release["manifest"]).get("retrieval",{}).get("mode",default_mode) if release else default_mode
                book["available"] = bool(row["active_release"])
                progress=db.execute("SELECT summary FROM coverage_snapshots WHERE book_id=?",(row["id"],)).fetchone()
                book["progress"]=json.loads(progress["summary"]) if progress else None
                result.append(book)
            return result

    def record_coverage(self, inventory):
        """Publish aggregate progress only; URLs, drafts, and source bodies stay private."""
        pages=inventory.get("pages",[])
        book=inventory.get("book_id")
        if (not pages or any(p.get("book_id")!=book for p in pages)
                or len({p.get("page_id") for p in pages}) != len(pages)):
            raise ValueError("Invalid or duplicate coverage inventory")
        summary={"total":len(pages),"fetched":sum(bool(p.get("fetched_at")) for p in pages),
                 "parsed":sum(p.get("parsed") is True for p in pages),
                 "reviewed":sum(p.get("reviewed") is True for p in pages),
                 "unreachable":sum(p.get("status")=="unreachable" for p in pages)}
        if summary["reviewed"]>summary["parsed"] or summary["parsed"]>summary["fetched"]:
            raise ValueError("Coverage counts contradict the review lifecycle")
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM books WHERE id=?",(book,)).fetchone():
                raise ValueError("Register the book before recording its progress")
            db.execute("INSERT INTO coverage_snapshots VALUES(?,?) ON CONFLICT(book_id) DO UPDATE SET summary=excluded.summary",
                       (book,json.dumps(summary)))
        return summary

    def release(self, book, release=None):
        with self.connect() as db:
            if release is None:
                row = db.execute("SELECT active_release FROM books WHERE id=?", (book,)).fetchone()
                release = row[0] if row else None
            row = db.execute("SELECT * FROM releases WHERE book_id=? AND id=?", (book, release)).fetchone()
            if row is None:
                return None
            result = dict(row)
            result["manifest"] = json.loads(result["manifest"])
            result["report"] = json.loads(result["report"]) if result["report"] else None
            result["units"] = [dict(json.loads(u["payload"]), vector=json.loads(u["vector"]) if u["vector"] else None)
                               for u in db.execute("SELECT * FROM units WHERE book_id=? AND release_id=? ORDER BY id", (book, release))]
            result["chunks"] = [dict(c, vector=json.loads(c["vector"])) for c in db.execute(
                "SELECT * FROM chunks WHERE book_id=? AND release_id=? ORDER BY unit_id,ordinal", (book,release))]
            return result
