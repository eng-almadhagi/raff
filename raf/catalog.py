"""Current public collection; source identifiers are namespaced, never interchangeable."""
import os
BOOK_ID = "fatawa-islamiyyah-1708"
TITLE = "فتاوى إسلامية"
SCOPE = "كتاب فتاوى إسلامية كاملًا بجميع أبوابه — جمع وترتيب محمد بن عبد العزيز المسند"
SOURCE_IDS = {"turath": 1708, "albahith": 1472}
EXPECTED_RECORDS = 1816


def public_book_ids():
    """Future additions change deployment configuration, not book schemas or indexes."""
    return frozenset(value.strip() for value in os.getenv("RAF_PUBLIC_BOOKS",BOOK_ID).split(",") if value.strip())
