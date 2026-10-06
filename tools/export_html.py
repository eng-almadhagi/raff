"""Export the current interface as one self-contained, offline HTML preview."""
import base64
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    web = root / "web"
    html = (web / "index.html").read_text(encoding="utf-8")
    css = (web / "style.css").read_text(encoding="utf-8")
    script = (web / "app.js").read_text(encoding="utf-8")
    icon = base64.b64encode((web / "favicon.svg").read_bytes()).decode("ascii")
    html = html.replace('href="/favicon.svg"', f'href="data:image/svg+xml;base64,{icon}"')
    html = html.replace('<link rel="stylesheet" href="/style.css">', f"<style>{css}</style>")
    html = html.replace('<script src="/app.js" defer></script>', "")
    html = html.replace('href="/" class="brand"', 'href="#" class="brand"')
    html = html.replace("نسخة تطوير · ٠.٣", "معاينة HTML مستقلة")
    html = html.replace("جارٍ قراءة حالة كتاب فتاوى إسلامية…", "معاينة للواجهة؛ البحث الفعلي يحتاج تشغيل خادم المنصة.")
    # This preview never sends questions or fetches content. It is not a search engine.
    script = script.replace('fetch("/api/ask",', 'previewRequest("/api/ask",')
    script = script.replace('fetch("/api/books")', 'previewRequest("/api/books")')
    offline = '''
async function previewRequest(path) {
  return {ok: true, json: async () => path === "/api/books" ? {books: [{
    id: "fatawa-islamiyyah-1708", title: "فتاوى إسلامية", available: false, units: 0,
    scope: "معاينة مستقلة دون اتصال — فتاوى إسلامية بجميع أبوابه. البحث الفعلي يحتاج خادم المنصة."
  }]} : {
    citations: [],
    message: "هذه معاينة HTML للواجهة، ولا تنفذ البحث أو تولّد إجابات. البحث الفعلي يحتاج تشغيل خادم رَف وإضافة محتوى مرخّص ومراجع. نص الكتاب غير مضمّن في هذه المعاينة؛ إتاحته تتطلب استكمال الاستيراد والمراجعة وحقوق الاستخدام."
  }};
}
'''
    html = html.replace("</body>", f"<script>{offline}\n{script}</script></body>")
    destination = root / "dist" / "raf.html"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(html, encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
