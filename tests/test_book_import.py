"""Original fixtures test the importer; never substitute these for the real collection."""
import copy
import tempfile
import unittest
from pathlib import Path
from raf.book_import import archive_source, stage_book, validate_export
from raf.catalog import BOOK_ID
from raf.pipeline import import_bundle, evaluate, publish
from raf.retrieval import search
from raf.store import Store
from tests.helpers import bundle, cases, FakeEmbedder


def export():
    return {"metadata":{"book_id":1472,"title":"فتاوى إسلامية","author":"محمد بن عبد العزيز المسند","page_count":2},
            "parts":[{"part":"1","page_count":2}],"retrieved_at":"2026-10-05",
            "pages":[{"book_id":1472,"page_id":11,"sequence_num":1,"part":"1","page_num":None,
                      "body":"عنوان تجريبي س - سؤال تجريبي؟ ج - بداية جواب", "footnotes":""},
                     {"book_id":1472,"page_id":12,"sequence_num":2,"part":"1","page_num":10,
                      "body":"تتمة جواب تجريبي الشيخ ابن باز * * * * عنوان آخر س - سؤال ثان؟ ج - جواب ثان", "footnotes":""}]}


class BookImportTests(unittest.TestCase):
    def test_toc_boundaries_keep_cross_page_text_without_mixing_next_question(self):
        data=export()
        data['toc']=[{'title_id':1,'parent_id':None,'page_id':11,'title_text':'عنوان تجريبي'},
                     {'title_id':2,'parent_id':1,'page_id':12,'title_text':'عنوان آخر'}]
        result,report=stage_book(data,complete=True)
        self.assertEqual(len(result['units']),2)
        self.assertIn('تتمة جواب',result['units'][0]['text'])
        self.assertNotIn('سؤال ثان',result['units'][0]['text'])
        self.assertEqual(''.join(u['text'] for u in result['units']),
                         ''.join(p['body']+'\n' for p in data['pages']))
        self.assertEqual(report['unmatched_headings'],[])

    def test_cross_page_question_preserves_answer_and_refs(self):
        data, report = stage_book(export(),complete=True)
        first = data["units"][0]
        self.assertIn("بداية جواب\nتتمة جواب", first["text"])
        self.assertEqual([r["page_id"] for r in first["source_refs"]],[11,12])
        self.assertIsNone(first["source_refs"][0]["page_num"])
        self.assertEqual(first["mufti"],"الشيخ ابن باز")
        self.assertNotIn("سؤال ثان", first["text"])
        self.assertEqual(report["staged_characters"],report["stream_characters"])
        self.assertEqual(first["verification"],"pending")

    def test_wrong_namespace_rejected(self):
        data=export();data["metadata"]["book_id"]=1708
        with self.assertRaises(ValueError):validate_export(data)

    def test_missing_page_cannot_claim_complete(self):
        data=export();data["pages"].pop()
        with self.assertRaises(ValueError):validate_export(data,complete=True)

    def test_duplicate_sequence_rejected(self):
        data=export();data["pages"][1]["sequence_num"]=1
        with self.assertRaises(ValueError):validate_export(data)

    def test_gap_never_joins_fatwa(self):
        data=export();data["pages"][1]["sequence_num"]=5
        staged,_=stage_book(data)
        self.assertNotIn("تتمة جواب",staged["units"][0]["text"])

    def test_signed_fatwas_without_separator_are_split(self):
        data=export();data["pages"][1]["body"]=data["pages"][1]["body"].replace("* * * *","")
        staged,_=stage_book(data)
        self.assertEqual(len(staged['units']),2)
        self.assertFalse(staged["units"][0]["boundary_review_required"])
        self.assertEqual(staged["units"][0]["mufti"],'الشيخ ابن باز')
        self.assertNotIn('سؤال ثان',staged['units'][0]['text'])

    def test_raw_snapshot_is_content_addressed_and_tamper_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path,sha=archive_source(export(),tmp)
            self.assertEqual(archive_source(export(),tmp),(path,sha))
            path.write_text("changed")
            with self.assertRaises(ValueError):archive_source(export(),tmp)

    def test_footnotes_are_not_dropped(self):
        data=export();data["pages"][0]["footnotes"]="حاشية تجريبية"
        staged,_=stage_book(data)
        unit=staged["units"][0];note=unit["footnotes"][0]
        self.assertEqual(unit["text"][note["start"]:note["end"]],"حاشية تجريبية")


class ChunkIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.store=Store(Path(self.temp.name)/"db.sqlite3")

    def test_long_unit_kept_whole_cache_reused_and_results_deduplicated(self):
        data=bundle(text="alpha beta "*500)
        data["manifest"]["retrieval"]={"mode":"hybrid","chunk_chars":300}
        provider=FakeEmbedder();calls=[]
        original=provider.embed
        def encode(texts): calls.extend(texts);return original(texts)
        provider.embed=encode
        import_bundle(self.store,data,provider)
        first_count=len(calls)
        release=self.store.release("testbook","v1")
        self.assertGreater(len(release["chunks"]),1)
        self.assertEqual(release["units"][0]["text"],data["units"][0]["text"])
        data["manifest"]["release_id"]="v2"
        import_bundle(self.store,data,provider)
        self.assertEqual(len(calls),first_count)
        found=search(release,"alpha", "hybrid",provider)
        self.assertEqual(len(found),1)

    def test_target_publication_requires_identity_verification(self):
        data=bundle(book=BOOK_ID)
        import_bundle(self.store,data);evaluate(self.store,BOOK_ID,"v1",cases())
        with self.assertRaisesRegex(ValueError,"identity"):
            publish(self.store,BOOK_ID,"v1","fixture")

    def test_embedding_cache_is_book_scoped(self):
        provider=FakeEmbedder();data=bundle()
        data["manifest"]["retrieval"]={"mode":"hybrid","chunk_chars":300}
        import_bundle(self.store,data,provider)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT DISTINCT book_id FROM embedding_cache").fetchone()[0],"testbook")
