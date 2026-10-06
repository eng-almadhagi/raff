import unittest
from unittest.mock import Mock

from raf.answers import answer
from raf.pipeline import import_bundle
from raf.rights import require_public_display
from tests.helpers import bundle, FakeEmbedder


class RightsTests(unittest.TestCase):
    def test_legacy_boolean_does_not_authorize_indexing(self):
        data = bundle()
        del data["manifest"]["rights"]["operations"]
        store = Mock()
        with self.assertRaisesRegex(ValueError, "index"):
            import_bundle(store, data)
        store.connect.assert_not_called()

    def test_denied_embeddings_never_call_provider(self):
        data = bundle()
        data["manifest"]["rights"]["operations"]["embeddings"] = False
        provider = Mock(enabled=True)
        with self.assertRaisesRegex(ValueError, "embeddings"):
            import_bundle(Mock(), data, provider)
        provider.embed_documents.assert_not_called()

    def test_network_provider_requires_separate_grant(self):
        provider = FakeEmbedder()
        provider.uses_network = True
        with self.assertRaisesRegex(ValueError, "provider_processing"):
            import_bundle(Mock(), bundle(), provider)

    def test_excerpt_permission_cannot_publish_full_units(self):
        data = bundle()
        grants = data["manifest"]["rights"]["operations"]
        grants["display_full_units"] = False
        grants["display_excerpts"] = True
        with self.assertRaisesRegex(ValueError, "display_full_units"):
            require_public_display(data["manifest"])

    def test_old_active_release_cannot_leak_text(self):
        data = bundle()
        del data["manifest"]["rights"]["operations"]
        store = Mock()
        store.release.return_value = data
        result = answer(store, "testbook", "alpha source please")
        self.assertEqual(result["kind"], "unavailable")
        self.assertEqual(result["citations"], [])

    def test_blank_evidence_is_not_permission(self):
        data = bundle()
        data["manifest"]["rights"]["evidence"] = " "
        with self.assertRaises(ValueError):
            import_bundle(Mock(), data)
