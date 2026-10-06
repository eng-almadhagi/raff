import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.fetch_pages_content import unpack


class ContentBundleTests(unittest.TestCase):
    def bundle(self, root, extra):
        archive = root / "content.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for name in ("catalog.json", "settings.json", "vocabulary.json"):
                output.writestr(name, "{}")
            for name, value in extra:
                output.writestr(name, value)
        return archive

    def test_extracts_only_expected_content_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = self.bundle(root, [("data/example/text/0001.json.gz", "bytes")])
            unpack(archive, root / "output")
            self.assertEqual((root / "output/data/example/text/0001.json.gz").read_text(), "bytes")

    def test_traversal_and_code_paths_rejected_before_extraction(self):
        for name in ("../outside", "data/example/../../outside", "site/app.mjs", "C:/escape"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = self.bundle(root, [(name, "bad")])
                with self.assertRaises(ValueError):
                    unpack(archive, root / "output")
                self.assertFalse((root / "output").exists())


if __name__ == "__main__":
    unittest.main()
