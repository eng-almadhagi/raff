"""Opt-in real model checks; normal CI never downloads models."""
import math
import os
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from raf.embeddings import cosine, ProviderError
from raf.local_embeddings import LocalEmbedder
from raf.pipeline import import_bundle
from raf.retrieval import search
from raf.store import Store
from tests.helpers import bundle


@unittest.skipUnless(os.getenv("RAF_RUN_MODEL_TESTS") == "1", "Set RAF_RUN_MODEL_TESTS=1 after model setup")
class LocalModelIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider=LocalEmbedder(os.getenv("RAF_MODEL_DIR","var/models/multilingual-e5-small"))

    def test_inference_works_without_network(self):
        with patch("socket.socket.connect", side_effect=AssertionError("Network must not be used")):
            vector=self.provider.embed_query("كيف أحفظ نسخة إضافية من ملفاتي؟")
        self.assertEqual(len(vector),384)
        self.assertAlmostEqual(math.sqrt(sum(x*x for x in vector)),1,places=5)

    def test_related_passage_ranks_ahead_of_unrelated(self):
        documents=self.provider.embed_documents([
            "النسخة الاحتياطية تحفظ صورة إضافية من البيانات لاستعادتها عند تعطل الجهاز.",
            "التصميم المتجاوب يعيد ترتيب أعمدة الصفحة بحسب عرض شاشة الهاتف."
        ])
        query=self.provider.embed_query("لو خرب الكمبيوتر كيف أرجع شغلي؟")
        self.assertGreater(cosine(query,documents[0]),cosine(query,documents[1]))

    def test_overlength_is_not_silently_truncated(self):
        with self.assertRaises(ProviderError):self.provider.embed_documents(["نص طويل "*1000])

    def test_queries_and_passages_have_distinct_prefixes(self):
        text="فهرسة الكتب للوصول إلى مصادرها"
        self.assertNotEqual(self.provider.embed_query(text),self.provider.embed_documents([text])[0])

    def test_long_source_is_indexed_locally_and_returned_whole(self):
        text="النسخة الاحتياطية تحفظ صورة إضافية من الملفات لاستعادتها بعد تعطل الجهاز. "*20
        data=bundle(text=text)
        data["manifest"]["retrieval"]={"mode":"hybrid","chunk_chars":300}
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(Path(tmp)/"db.sqlite3")
            with patch("socket.socket.connect", side_effect=AssertionError("No source lookup")):
                import_bundle(store,data,self.provider)
                release=store.release("testbook","v1")
                results=search(release,"كيف أستعيد ملفاتي بعد عطل الحاسوب؟","semantic",self.provider)
            self.assertGreater(len(release["chunks"]),1)
            self.assertEqual(results[0]["text"],text)
