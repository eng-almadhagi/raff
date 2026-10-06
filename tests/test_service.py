import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from raf.embeddings import Embedder,ProviderError
from raf.policy import classify
from raf.server import Application,RateLimiter
from raf.store import Store
from tools.discover import discover


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.app=Application(Store(Path(self.temp.name)/"db.sqlite3"))

    def request(self,path="/api/ask",body=None,method="POST",raw=None,content_type="application/json"):
        raw=raw if raw is not None else json.dumps(body or {"book_id":"fatawa-islamiyyah-1708","question":"ما حكم صلاة الجمعة؟"}).encode()
        env={"REQUEST_METHOD":method,"PATH_INFO":path,"CONTENT_TYPE":content_type,
             "CONTENT_LENGTH":str(len(raw)),"wsgi.input":io.BytesIO(raw),"REMOTE_ADDR":"127.0.0.1"}
        info={}
        def start(status,headers):info.update(status=int(status[:3]),headers=dict(headers))
        data=b"".join(self.app(env,start))
        return info,data

    def test_health(self):
        info,data=self.request("/api/health",method="GET")
        self.assertEqual(info["status"],200);self.assertEqual(json.loads(data)["status"],"ok")

    def test_static_and_csp(self):
        info,data=self.request("/",method="GET")
        self.assertEqual(info["status"],200);self.assertIn(b'dir="rtl"',data)
        self.assertIn("frame-ancestors 'none'",info["headers"]["Content-Security-Policy"])

    def test_no_traversal_or_private_download(self):
        for path in ("/../private/salah-inventory.json","/.env","/raf/store.py","/var/raf.sqlite3"):
            self.assertEqual(self.request(path,method="GET")[0]["status"],404)

    def test_unavailable_response(self):
        info,data=self.request();self.assertEqual(info["status"],200)
        self.assertEqual(json.loads(data)["kind"],"unavailable")

    def test_invalid_json(self):
        self.assertEqual(self.request(raw=b"not json")[0]["status"],400)

    def test_json_array_rejected(self):
        self.assertEqual(self.request(raw=b"[]")[0]["status"],400)

    def test_bad_content_type(self):
        self.assertEqual(self.request(content_type="text/plain")[0]["status"],400)

    def test_long_question_rejected(self):
        self.assertEqual(self.request(body={"book_id":"fatawa-islamiyyah-1708","question":"a"*1001})[0]["status"],400)

    def test_unknown_book_rejected(self):
        self.assertEqual(self.request(body={"book_id":"unknown","question":"what is this"})[0]["status"],400)

    def test_old_source_is_hidden_and_rejected_even_when_stored(self):
        with self.app.store.connect() as db:
            db.execute("INSERT INTO books(id,title,scope) VALUES('salah','old source','old scope')")
        _,data=self.request("/api/books",method="GET")
        self.assertEqual([b["id"] for b in json.loads(data)["books"]],["fatawa-islamiyyah-1708"])
        self.assertEqual(self.request(body={"book_id":"salah","question":"ما حكم الصلاة؟"})[0]["status"],400)

    def test_personal_cases_across_chapters_are_referred(self):
        for question in ("طلقت زوجتي فهل وقع الطلاق؟", "هل راتبي حلال؟", "هل دوائي يبطل صيامي؟", "حلفت على شيء هل علي كفارة؟"):
            with self.subTest(question=question):
                _,data=self.request(body={"book_id":"fatawa-islamiyyah-1708","question":question})
                result=json.loads(data)
                self.assertEqual(result["kind"],"refer")
                self.assertEqual(result["level"],"د")
                self.assertEqual(result["citations"],[])

    def test_bad_history_rejected(self):
        self.assertEqual(self.request(body={"book_id":"fatawa-islamiyyah-1708","question":"what is this","history":[{}]})[0]["status"],400)

    def test_oversized_body(self):
        self.assertEqual(self.request(raw=b"a"*12001)[0]["status"],400)

    def test_rate_limit(self):
        self.app.limiter=RateLimiter(1)
        self.assertEqual(self.request()[0]["status"],200)
        self.assertEqual(self.request()[0]["status"],429)

    def test_provider_failure_returns_safe_error(self):
        with patch("raf.server.answer",side_effect=ProviderError("sensitive provider error")):
            info,data=self.request();self.assertEqual(info["status"],503)
            self.assertNotIn(b"sensitive",data)

    def test_forty_policy_cases(self):
        cases=json.loads(Path("evaluation/policy-cases.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(cases),40)
        for case in cases:
            with self.subTest(question=case["question"]):self.assertEqual(classify(case["question"]),case["expected"])

    def test_inventory_respects_book_boundary(self):
        html='<ul id="mtree"><li><a>كتاب الطهارة</a><ul><li><a href="/feqhia/1">water</a></li></ul></li><li><a>كِتابُ الصَّلاةِ</a><ul><li><a>باب</a><ul><li><a href="/feqhia/2">prayer</a></li></ul></li></ul></li><li><a>كتاب الزكاة</a><ul><li><a href="/feqhia/3">money</a></li></ul></li></ul>'
        inventory=discover(html)
        self.assertEqual([p["page_id"] for p in inventory["pages"]],["2"])

    def test_embedding_protocol(self):
        provider=Embedder();provider.url="http://localhost:11434";provider.model="fixture"
        response=io.BytesIO(b'{"embeddings":[[1.0,0.5]]}')
        with patch("raf.embeddings.urlopen",return_value=response) as call:
            self.assertEqual(provider.embed(["query"]),[[1,0.5]])
            request=call.call_args.args[0]
            self.assertTrue(request.full_url.endswith("/api/embed"))
            self.assertFalse(json.loads(request.data)["truncate"])

    def test_embedding_malformed(self):
        provider=Embedder();provider.url="http://localhost:11434";provider.model="fixture"
        with patch("raf.embeddings.urlopen",return_value=io.BytesIO(b'{"embeddings":[[0,0]]}')):
            with self.assertRaises(ProviderError):provider.embed(["query"])
