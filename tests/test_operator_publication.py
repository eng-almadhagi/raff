import copy
import unittest
from raf.rights import require_publication_decision

class OperatorPublicationTests(unittest.TestCase):
    def setUp(self):
        self.manifest={"explicit_prohibition":False,"scientific_review":{"approved":False},"operator_publication_decision":{"recorded_at":"2026-10-06","publish_current_content":True,"license_status":"unresolved","sources":["source-a"],"instruction":"Publish current source at operator direction"}}
    def test_operator_decision_is_not_a_license_or_scientific_approval(self):
        self.assertEqual(require_publication_decision(self.manifest,"source-a"),"operator-directed-preview")
        self.assertFalse(self.manifest['scientific_review']['approved'])
    def test_scope_and_prohibition_are_not_overridden(self):
        with self.assertRaises(ValueError):require_publication_decision(self.manifest,"source-b")
        self.manifest['explicit_prohibition']=True
        with self.assertRaises(ValueError):require_publication_decision(self.manifest,"source-a")
    def test_missing_decision_does_not_allow_publication(self):
        with self.assertRaises(ValueError):require_publication_decision({},"source-a")
