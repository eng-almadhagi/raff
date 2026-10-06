"""Private loopback-only research server; never use this entry point for deployment."""
from wsgiref.simple_server import make_server
from .catalog import BOOK_ID
from .local_embeddings import LocalEmbedder
from .server import Application, QuietHandler
from .store import Store


class ResearchStore(Store):
    def __init__(self, path="var/local-research.sqlite3"):
        super().__init__(path)
        self.loaded = super().release(BOOK_ID)
        if not self.loaded or not self.loaded["manifest"].get("research_only"):
            raise ValueError("Run python -m tools.import_local first")

    def release(self, book, release=None):
        if book == BOOK_ID and release in {None,self.loaded["id"]}:
            return self.loaded
        return None

    def books(self):
        books=super().books()
        for book in books:
            if book['id']==BOOK_ID:
                book['stored_units']=len(self.loaded['units'])
                book['units']=sum(u.get('retrievable',True) for u in self.loaded['units'])
        return books


def main():
    app = Application(ResearchStore(),LocalEmbedder("var/models/multilingual-e5-small"),research=True)
    print("Private Raf research: http://127.0.0.1:8000",flush=True)
    with make_server("127.0.0.1",8000,app,handler_class=QuietHandler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
