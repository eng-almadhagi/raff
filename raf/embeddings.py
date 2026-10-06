"""Optional real embeddings through Ollama's /api/embed endpoint."""
import json
import math
import os
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class ProviderError(RuntimeError):
    pass


def valid_vector(vector):
    return (isinstance(vector, list) and 1 <= len(vector) <= 8192
            and all(type(x) in (int, float) and math.isfinite(x) for x in vector)
            and sum(x*x for x in vector) > 0)


class Embedder:
    # Even a loopback HTTP service is a separate processor; approval is explicit.
    uses_network = True

    def __init__(self):
        self.url = os.getenv("RAF_EMBED_URL", "").rstrip("/")
        self.model = os.getenv("RAF_EMBED_MODEL", "")
        self.timeout = float(os.getenv("RAF_EMBED_TIMEOUT", "15"))

    @property
    def enabled(self):
        return bool(self.url and self.model)

    def embed(self, texts):
        if not self.enabled or urlparse(self.url).scheme not in {"http", "https"}:
            raise ProviderError("Embedding provider is not configured")
        payload = json.dumps({"model": self.model, "input": texts, "truncate": False}).encode()
        try:
            request = Request(self.url + "/api/embed", data=payload,
                              headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read(8_000_001)
                if len(raw) > 8_000_000:
                    raise ValueError("Provider response too large")
                vectors = json.loads(raw)["embeddings"]
            if len(vectors) != len(texts) or not all(valid_vector(v) for v in vectors):
                raise ValueError("Invalid vectors")
            if len({len(v) for v in vectors}) != 1:
                raise ValueError("Mixed dimensions")
            return vectors
        except (URLError, TimeoutError, ValueError, KeyError, TypeError, OSError) as exc:
            raise ProviderError("Embedding request failed") from exc

    def embed_documents(self, texts):
        return self.embed(texts)

    def embed_query(self, text):
        return self.embed([text])[0]


def create_embedder():
    backend = os.getenv("RAF_EMBED_BACKEND", "ollama")
    if backend == "local":
        from .local_embeddings import LocalEmbedder
        return LocalEmbedder(os.getenv("RAF_MODEL_DIR", "var/models/multilingual-e5-small"))
    if backend != "ollama":
        raise ProviderError("Unknown embedding backend")
    return Embedder()


def cosine(a, b):
    if not valid_vector(a) or not valid_vector(b) or len(a) != len(b):
        raise ProviderError("Embedding dimension mismatch")
    return sum(x*y for x,y in zip(a,b)) / math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))
