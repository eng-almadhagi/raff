"""WSGI read-only web service. Run behind a TLS reverse proxy in production."""
import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from wsgiref.simple_server import make_server, WSGIRequestHandler
from .answers import answer
from .embeddings import create_embedder, ProviderError
from .store import Store
from .catalog import public_book_ids

PUBLIC = Path(__file__).resolve().parent.parent / "web"
ASSETS = {"/": ("index.html","text/html"), "/app.js": ("app.js","text/javascript"),
          "/style.css": ("style.css","text/css"), "/favicon.svg": ("favicon.svg","image/svg+xml")}


class RateLimiter:
    def __init__(self, limit=20):
        self.limit = limit
        self.clients = {}
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self.lock:
            for stale in [k for k,v in self.clients.items() if not v or v[-1] < now-60]:
                del self.clients[stale]
            if key not in self.clients and len(self.clients) >= 10000:
                return False
            hits = self.clients.setdefault(key,deque())
            while hits and hits[0] < now-60:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


class Application:
    def __init__(self, store=None, embedder=None, research=False):
        self.research = research
        self.store = store or Store(os.getenv("RAF_DB","var/raf.sqlite3"))
        self.embedder = embedder or create_embedder()
        self.public_books = public_book_ids()
        self.limiter = RateLimiter(int(os.getenv("RAF_REQUESTS_PER_MINUTE","20")))

    def __call__(self, environ, start_response):
        if self.research:
            from urllib.parse import urlsplit
            try:
                host = urlsplit("//" + environ.get("HTTP_HOST", "")).hostname
            except ValueError:
                host = None
            if environ.get("REMOTE_ADDR") not in {"127.0.0.1", "::1"} or host not in {"127.0.0.1", "localhost", "::1"}:
                start_response("403 Forbidden", [("Content-Type","text/plain")])
                return [b"Private local research only"]
        status, data, mime = 200, {}, "application/json"
        try:
            method, path = environ["REQUEST_METHOD"], environ.get("PATH_INFO", "/")
            if method == "GET" and path in ASSETS:
                name,mime = ASSETS[path]
                data = (PUBLIC/name).read_bytes()
            elif method == "GET" and path == "/api/health":
                data = {"status":"ok", "version":"0.5.0"}
            elif method == "GET" and path == "/api/books":
                data = {"books":[b for b in self.store.books() if b["id"] in self.public_books]}
            elif method == "POST" and path == "/api/ask":
                if not self.limiter.allow(environ.get("REMOTE_ADDR","unknown")):
                    status, data = 429, {"error":"طلبات كثيرة؛ حاول بعد دقيقة."}
                else:
                    if environ.get("CONTENT_TYPE", "").split(";")[0] != "application/json":
                        raise ValueError("استخدم طلب JSON صالحًا.")
                    length = int(environ.get("CONTENT_LENGTH") or "0")
                    if not 0 < length <= 12000:
                        raise ValueError("حجم الطلب غير مسموح.")
                    body = json.loads(environ["wsgi.input"].read(length))
                    if not isinstance(body,dict):
                        raise ValueError("صيغة الطلب غير صحيحة.")
                    question,book = body.get("question"),body.get("book_id")
                    history = body.get("history",[])
                    if not isinstance(question,str) or not 2 <= len(question.strip()) <= 1000:
                        raise ValueError("اكتب سؤالًا من حرفين إلى ١٠٠٠ حرف.")
                    if not isinstance(book,str) or book not in self.public_books:
                        raise ValueError("اختر كتابًا من القائمة.")
                    if not isinstance(history,list) or len(history)>4 or any(not isinstance(x,str) or len(x)>1000 for x in history):
                        raise ValueError("سياق المحادثة أطول من المسموح.")
                    data = answer(self.store,book,question.strip(),history,self.embedder,research=self.research)
            else:
                status,data = 404,{"error":"الصفحة غير موجودة."}
        except (ValueError,UnicodeDecodeError) as exc:
            status,data = 400,{"error":str(exc)[:200]}
        except ProviderError:
            status,data = 503,{"error":"تعذر الاتصال بخدمة البحث بالمعنى. حاول لاحقًا."}
        except Exception:
            # Never log questions, source text, provider payloads or credentials.
            status,data = 500,{"error":"تعذر إكمال الطلب الآن."}
        if not isinstance(data,bytes):
            data = json.dumps(data,ensure_ascii=False).encode("utf-8")
        labels = {200:"OK",400:"Bad Request",404:"Not Found",429:"Too Many Requests",500:"Internal Server Error",503:"Service Unavailable"}
        headers = [("Content-Type",mime+"; charset=utf-8"),("Content-Length",str(len(data))),
                   ("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),
                   ("Referrer-Policy","no-referrer"),
                   ("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
                   ("Permissions-Policy","camera=(), microphone=(), geolocation=()")]
        if status == 429:
            headers.append(("Retry-After","60"))
        start_response(f"{status} {labels[status]}",headers)
        return [data]


def create_app():
    return Application()


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    host,port = os.getenv("RAF_HOST","127.0.0.1"),int(os.getenv("PORT","8000"))
    print(f"Raf development server: http://{host}:{port}",flush=True)
    with make_server(host,port,create_app(),handler_class=QuietHandler) as server:
        server.serve_forever()
