"""Explicit one-time download of a public ONNX model; never runs on web startup."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

REPOSITORY = "Xenova/multilingual-e5-small"
FILES = {"onnx/model_quantized.onnx": "model.onnx", "tokenizer.json": "tokenizer.json"}
BASE = "https://huggingface.co"


def download(url, target, maximum=160_000_000):
    target = Path(target)
    partial = target.with_suffix(target.suffix + ".part")
    digest = hashlib.sha256()
    size = 0
    with urlopen(Request(url, headers={"User-Agent": "Raf-model-setup/0.2"}), timeout=45) as response:
        with partial.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > maximum:
                    raise ValueError("Download exceeded expected size")
                stream.write(chunk)
                digest.update(chunk)
    partial.replace(target)
    return {"sha256": digest.hexdigest(), "bytes": size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="var/models/multilingual-e5-small")
    args = parser.parse_args()
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    with urlopen(f"{BASE}/api/models/{REPOSITORY}", timeout=30) as response:
        info = json.load(response)
    revision = info["sha"]
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Invalid remote revision")
    manifest = {"repository": REPOSITORY, "revision": revision, "format": "onnx-q8",
                "pooling": "masked-mean-l2", "prefixes": True, "max_tokens": 512, "files": {},
                "upstream_model": "intfloat/multilingual-e5-small", "upstream_license": "MIT"}
    for remote, local in FILES.items():
        print(f"Downloading {local} at revision {revision}", flush=True)
        manifest["files"][local] = download(f"{BASE}/{REPOSITORY}/resolve/{revision}/{remote}", directory/local)
        print(f"Saved {local}: {manifest['files'][local]['bytes']} bytes", flush=True)
    (directory/"manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Model saved to {directory}; set RAF_EMBED_BACKEND=local and RAF_MODEL_DIR.")


if __name__ == "__main__":
    main()
