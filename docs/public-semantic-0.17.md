# Public source retrieval 0.17.0

This change applies to Ask Raff and its core sources. It does not replace the private-library index.

## Diagnosis and changes

Personal wording previously returned a referral before any retrieval. The UI now offers explicit source lookup, with prayer-role choices when relevant, keeping the original question and conditions. The result remains level D and does not apply a fatwa to the user.

Arabic omission forms and equivalent reading terminology are normalized for retrieval only. Quotations are unchanged. Prayer roles, the omitted object, and substitution cases are checked separately from topical similarity. A rejected highest-ranked candidate no longer masks other eligible candidates. Existing absolute similarity thresholds remain in place. Corpus cache URLs include the verified asset hash.

## Validation

- 79 Node tests pass.
- Python: 119 run, 114 pass, 5 skipped. The first sandboxed attempt failed on temporary-directory permissions; the permitted rerun passed.
- Full 24 Arabic / 6 English bank plus 16 additional questions exercised in the browser worker; result references unchanged by the final compatibility checks. This is regression evidence, not a claim that every returned answer is complete.
- 50 returned citations checked against the stored source records: no differences in text, source question/answer, title or URL where present. This checks stored-source fidelity, not independent verification of the original publisher or a scholarly endorsement.
- Actual UI: original personal question produces choices; choosing alone retrieves the book text “حكم من صلى ونسي الإقامة أو الفاتحة”, with its complete short answer and distinctions between roles. The short answer is quoted, not rewritten.
- Alternative wording “سهوت عن أم الكتاب وأنا أصلي وحدي” retrieves the same relevant book text. A follower question retrieves separate source texts, without merging differing opinions.
- Nearby texts about Amin, recitation continuity, and reading one text instead of another are excluded as direct answers to omission of Al-Fatihah.

## Remaining limitations

This is semantic retrieval with evidence gates, not unrestricted natural-language understanding. Independent questions about forgetting the first tashahhud after standing, and forgetting the number of rakahs, still returned insufficient evidence in this run. Some unrelated broader regression questions remain only partially covered. These are recall limitations, not successful answers. Sources without an accepted answer are not filled with unrelated fatwas.

Measured locally with concurrent test workers: roughly 3–4.5 seconds for warm searches; first-run measurements 8–13 seconds include model preparation. Actual UI measurement: 8.34 seconds total, including 4.66 seconds preparation. Network/device performance varies. No new source data or private user books are included in this commit.
