"""Offline E5 ONNX embeddings. No download, pickle, or remote model code execution."""
import hashlib
import json
import threading
from pathlib import Path
from .embeddings import ProviderError


class LocalEmbedder:
    enabled = True

    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.Lock()
        self.session = None
        try:
            self.manifest = json.loads((self.directory/"manifest.json").read_text(encoding="utf-8"))
            self.model = "local-e5:" + hashlib.sha256(
                json.dumps(self.manifest, sort_keys=True).encode()).hexdigest()
            for name in ("model.onnx", "tokenizer.json"):
                file = self.directory/name
                with file.open("rb") as stream:
                    actual = hashlib.file_digest(stream, "sha256").hexdigest()
                if actual != self.manifest["files"][name]["sha256"]:
                    raise ValueError("Model file checksum mismatch")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ProviderError("Local model is missing or its checksum is invalid") from exc

    def _load(self):
        if self.session is not None:
            return
        try:
            import onnxruntime as ort
            from tokenizers import Tokenizer
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.tokenizer = Tokenizer.from_file(str(self.directory/"tokenizer.json"))
            self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
            self.tokenizer.no_truncation()
            self.session = ort.InferenceSession(str(self.directory/"model.onnx"), options,
                                               providers=["CPUExecutionProvider"])
        except (ImportError, OSError, RuntimeError) as exc:
            raise ProviderError("Install requirements-semantic.txt to use local embeddings") from exc

    def embed(self, texts):
        return self.embed_documents(texts)

    def embed_documents(self, texts):
        return self._embed(texts, "passage: ")

    def embed_query(self, text):
        return self._embed([text], "query: ")[0]

    def _embed(self, texts, prefix):
        try:
            import numpy as np
        except ImportError as exc:
            raise ProviderError("Install requirements-semantic.txt to use local embeddings") from exc
        if not texts or len(texts) > 16 or any(not isinstance(t,str) or not t.strip() for t in texts):
            raise ProviderError("Invalid embedding batch")
        with self.lock:
            self._load()
            encoded = self.tokenizer.encode_batch([prefix + text for text in texts])
            if any(len(item.ids) > 512 for item in encoded):
                raise ProviderError("Source unit exceeds 512 model tokens; split at reviewed boundaries")
            ids = np.array([item.ids for item in encoded], dtype=np.int64)
            mask = np.array([item.attention_mask for item in encoded], dtype=np.int64)
            inputs = {"input_ids": ids, "attention_mask": mask}
            names = {item.name for item in self.session.get_inputs()}
            if "token_type_ids" in names:
                inputs["token_type_ids"] = np.zeros_like(ids)
            try:
                hidden = self.session.run(None, {k:v for k,v in inputs.items() if k in names})[0]
                pooled = (hidden * mask[...,None]).sum(axis=1) / mask.sum(axis=1)[:,None]
                pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
                if not np.isfinite(pooled).all():
                    raise ValueError("Non-finite model output")
                return pooled.astype(float).tolist()
            except (RuntimeError, ValueError) as exc:
                raise ProviderError("Local embedding inference failed") from exc
