import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from raf.answers import resolve_query, answer
from raf.embeddings import ProviderError, create_embedder
from raf.local_embeddings import LocalEmbedder
from raf.pipeline import import_bundle, evaluate
from raf.store import Store
from tests.helpers import bundle, cases, FakeEmbedder


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name)/"test.db")

    def test_followup_uses_context_before_classification(self):
        self.assertIn("صلاة السفر", resolve_query("ومتى؟", ["اشرح وقت صلاة السفر"]))
        response = answer(self.store,"fatawa-islamiyyah-1708","ومتى؟",["اشرح وقت صلاة السفر"])
        self.assertEqual(response["kind"],"unavailable")

    def test_followup_without_context_needs_clarification(self):
        self.assertEqual(answer(self.store,"fatawa-islamiyyah-1708","ومتى؟")["kind"],"clarify")

    def test_new_question_does_not_reuse_previous_topic(self):
        q="ما حكم صلاة الجمعة؟"
        self.assertEqual(resolve_query(q,["اشرح كتاب الطهارة"]),q)

    def test_previous_personal_case_stays_referred(self):
        response=answer(self.store,"fatawa-islamiyyah-1708","وكيف؟",["هل أعيد صلاتي اليوم؟"])
        self.assertEqual(response["kind"],"refer")

    def test_local_model_missing_fails_closed(self):
        with self.assertRaises(ProviderError):LocalEmbedder(self.temp.name)

    def test_local_checksum_rejects_modified_model(self):
        root=Path(self.temp.name)
        (root/"manifest.json").write_text(json.dumps({"files":{"model.onnx":{"sha256":"bad"}}}),encoding="utf-8")
        (root/"model.onnx").write_bytes(b"not a model")
        with self.assertRaises(ProviderError):LocalEmbedder(root)

    def test_unknown_backend_fails_closed(self):
        with patch.dict("os.environ",{"RAF_EMBED_BACKEND":"unknown"}):
            with self.assertRaises(ProviderError):create_embedder()

    def test_baseline_failure_does_not_block_successful_active_mode(self):
        provider=FakeEmbedder()
        import_bundle(self.store,bundle(),provider)
        suite=cases()
        for i,case in enumerate(suite):case["question"]=f"paraphrase unrelated {i}"
        result=evaluate(self.store,"testbook","v1",suite,provider)
        self.assertEqual(result["modes"]["lexical"]["passed"],0)
        self.assertTrue(result["passed"])
        self.assertEqual(result["required_mode"],"hybrid")

    def test_explicit_semantic_mode_requires_index(self):
        data=bundle();data["manifest"]["retrieval"]={"mode":"semantic"}
        with self.assertRaises(ValueError):import_bundle(self.store,data)

    def test_explicit_semantic_mode_has_its_own_release_gate(self):
        data=bundle();data["manifest"]["retrieval"]={"mode":"semantic"}
        provider=FakeEmbedder();import_bundle(self.store,data,provider)
        report=evaluate(self.store,"testbook","v1",cases(),provider)
        self.assertEqual(report["required_mode"],"semantic")

    def test_coverage_contains_counts_not_source_material(self):
        inventory={"book_id":"fatawa-islamiyyah-1708","pages":[{"book_id":"fatawa-islamiyyah-1708","page_id":"123","url":"https://example.org/private",
                    "fetched_at":"2026-10-04T01:00:00Z","parsed":True,"reviewed":False}]}
        self.store.record_coverage(inventory)
        progress=self.store.books()[0]["progress"]
        self.assertEqual(progress["total"],1)
        self.assertEqual(progress["reviewed"],0)
        self.assertNotIn("example.org",json.dumps(progress))

    def test_contradictory_coverage_is_rejected(self):
        inventory={"book_id":"fatawa-islamiyyah-1708","pages":[{"book_id":"fatawa-islamiyyah-1708","page_id":"123","parsed":True}]}
        with self.assertRaises(ValueError):self.store.record_coverage(inventory)
