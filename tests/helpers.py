"""Original synthetic fixtures. These are not religious sources."""
from raf.text import digest


def bundle(book="testbook", release="v1", text="alpha beta catalog entry"):
    return {"manifest":{
        "book_id":book,"release_id":release,"title":"Synthetic test book", "scope":"Synthetic testing only",
        "source_name":"Original software fixture","allowed_hosts":["example.org"],
        "rights":{"publish_allowed":True,"evidence":"Original synthetic test fixture",
                  "operations":{"index":True,"embeddings":True,"display_full_units":True}},
        "scientific_review":{"approved":True,"reviewer":"AUTOMATED FIXTURE ONLY"},
        "coverage":{"expected_page_ids":["page1"],"complete":True,"structure_reviewed":True,"note":"Synthetic fixture only"}},
        "units":[{"book_id":book,"id":"unit-one","title":"alpha catalog", "path":["Test","Catalog"],
                  "page_id":"page1","url":"https://example.org/source","text":text,"sha256":digest(text),
                  "fetched_at":"2026-10-03T12:00:00+03:00","verification":"reviewed",
                  "reviewer":"AUTOMATED FIXTURE ONLY","footnotes":[],"previous_id":None,"next_id":None}]}


def cases():
    return [{"question":f"alpha query {i}","expected_ids":["unit-one"],"split":"heldout"} for i in range(40)]


class FakeEmbedder:
    enabled = True
    model = "test-fixture-model"

    def embed(self,texts):
        return [[1.0,0.0] for text in texts]
