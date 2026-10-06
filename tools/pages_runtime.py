"""Pinned build-time downloads. Published pages make no external runtime calls."""
import hashlib
import io
import shutil
import tarfile
from pathlib import Path
from urllib.request import urlopen

REVISION='761b726dd34fb83930e26aab4e9ac3899aa1fa78'
FILES={
    'config.json':'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
    'tokenizer_config.json':'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
    'tokenizer.json':'0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    'onnx/model_quantized.onnx':'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
}


def download(url, expected):
    with urlopen(url,timeout=180) as response: data=response.read()
    if hashlib.sha256(data).hexdigest()!=expected:
        raise ValueError('Downloaded dependency checksum mismatch')
    return data


def install(output):
    output=Path(output)
    vendor=output/'vendor';vendor.mkdir(parents=True,exist_ok=True)
    raw=download('https://registry.npmjs.org/@huggingface/transformers/-/transformers-3.8.1.tgz',
                 '207714c36765b87accfd9b7b0672c3505805af97140990e0d9f8ac6e3cd5471e')
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        for name in ['transformers.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']:
            (vendor/name).write_bytes(archive.extractfile('package/dist/'+name).read())
        (vendor/'TRANSFORMERS-LICENSE.txt').write_bytes(archive.extractfile('package/LICENSE').read())
    for name,sha in FILES.items():
        target=output/'models/e5'/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(download(f'https://huggingface.co/Xenova/multilingual-e5-small/resolve/{REVISION}/{name}',sha))


if __name__=='__main__':
    import sys
    install(sys.argv[1])
