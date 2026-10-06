import unittest
from raf.source_adapter import parse_dorar_page
from raf.pipeline import validate
from tests.helpers import bundle

PAGE={"book_id":"testbook","page_id":"page1","title":"Title","path":["Book","Chapter"],"url":"https://example.org/source"}


class SourceAdapterTests(unittest.TestCase):
    def test_preserves_text_and_footnote_offsets(self):
        html='<div id="cntnt"><h1>عنوان</h1><div class="w-100 mt-4"><br>نَصٌّ أصلي <span class="tip">إحالةٌ [1]</span> وشرطُه.<br>دليلٌ</div><section>مادة إضافية لا تدخل النص</section></div>'
        unit=parse_dorar_page(html,PAGE)
        self.assertEqual(unit["text"],"نَصٌّ أصلي إحالةٌ [1] وشرطُه.\nدليلٌ")
        note=unit["footnotes"][0]
        self.assertEqual(unit["text"][note["start"]:note["end"]],"إحالةٌ [1]")
        self.assertEqual(unit["verification"],"pending")
        self.assertNotIn("مادة إضافية",unit["text"])

    def test_changed_layout_fails_closed(self):
        with self.assertRaises(ValueError):parse_dorar_page('<div>unrecognized page</div>',PAGE)

    def test_draft_cannot_be_imported(self):
        html='<div id="cntnt"><div class="w-100 mt-4">نص</div></div>'
        data=bundle();data["units"]=[parse_dorar_page(html,PAGE)]
        with self.assertRaises(ValueError):validate(data)

    def test_reviewed_offset_notes_validate(self):
        html='<div id="cntnt"><div class="w-100 mt-4">نص <span class="tip">مرجع</span></div></div>'
        unit=parse_dorar_page(html,PAGE)
        unit.update(verification="reviewed",reviewer="fixture")
        data=bundle();data["units"]=[unit]
        validate(data)
        unit["footnotes"][0]["start"]+=1
        with self.assertRaises(ValueError):validate(data)

    def test_empty_note_rejected(self):
        with self.assertRaises(ValueError):parse_dorar_page('<div id="cntnt"><div class="w-100 mt-4">نص<span class="tip"></span></div></div>',PAGE)
