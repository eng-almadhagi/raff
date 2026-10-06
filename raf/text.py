"""Search normalization never modifies displayed source text."""
import hashlib
import json
import re
import unicodedata


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]", "", text)
    return text.translate(str.maketrans("أإآى", "اااي"))


def tokens(text: str) -> list[str]:
    return re.findall(r"[\w]+", normalize(text))


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
