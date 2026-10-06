import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from raf.collection import collect, source_url

HTML='<div id="cntnt"><h1>Title</h1><div class="w-100 mt-4">نَصٌّ <span class="tip">مرجع</span></div></div>'


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.path=self.root/"inventory.json"
        self.page={"book_id":"salah","page_id":"123","url":"https://dorar.net/feqhia/123",
                   "status":"discovered","path":["Book"],"title":"Title"}
        self.path.write_text(json.dumps({"book_id":"salah","pages":[self.page]}),encoding="utf-8")
        self.permission={"source_origin":"https://dorar.net","book_id":"salah","collection_allowed":True,
                         "permission_reference":"TEST ONLY", "approved_by":"fixture"}
        self.calls=[]

    def fetch(self,url):
        self.calls.append(url)
        return "User-agent: *\nDisallow:" if url.endswith("robots.txt") else HTML

    def test_permission_required_before_network(self):
        self.permission["collection_allowed"]=False
        with self.assertRaises(ValueError):collect(self.path,self.permission,self.root/"cache",fetch=self.fetch,sleep=lambda _:None)
        self.assertEqual(self.calls,[])

    def test_robots_disallow_blocks_page_fetch(self):
        def fetch(url):
            self.calls.append(url)
            return "User-agent: *\nDisallow: /feqhia/"
        result=collect(self.path,self.permission,self.root/"cache",fetch=fetch,sleep=lambda _:None)
        self.assertEqual(len(self.calls),1);self.assertEqual(result["parsed"],0)

    def test_fetch_parse_cache_never_review(self):
        result=collect(self.path,self.permission,self.root/"cache",fetch=self.fetch,sleep=lambda _:None)
        self.assertEqual(result["parsed"],1);self.assertEqual(result["reviewed"],0)
        draft=json.loads((self.root/"cache/123.draft.json").read_text(encoding="utf-8"))
        self.assertEqual(draft["verification"],"pending")
        self.assertEqual(len(draft["footnotes"]),1)
        collect(self.path,self.permission,self.root/"cache",fetch=self.fetch,sleep=lambda _:None)
        self.assertEqual(self.calls.count(self.page["url"]),1)

    def test_rate_limit_stops_without_retry(self):
        def fetch(url):
            if url.endswith("robots.txt"):return "User-agent: *\nDisallow:"
            self.calls.append(url)
            raise HTTPError(url,429,"rate limit",{},None)
        with self.assertRaises(ValueError):collect(self.path,self.permission,self.root/"cache",fetch=fetch,sleep=lambda _:None)
        self.assertEqual(len(self.calls),1)

    def test_challenge_is_not_cached(self):
        def fetch(url):return "User-agent: *\nDisallow:" if url.endswith("robots.txt") else '<html>Challenge</html>'
        result=collect(self.path,self.permission,self.root/"cache",fetch=fetch,sleep=lambda _:None)
        self.assertEqual(result["parsed"],0)
        self.assertFalse((self.root/"cache/123.html").exists())

    def test_only_source_urls_allowed(self):
        for url in ("https://evil.test/feqhia/123","https://dorar.net@evil.test/feqhia/123", "http://dorar.net/feqhia/123", "https://dorar.net/feqhia/123?redirect=1"):
            self.assertFalse(source_url(url))
