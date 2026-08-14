"""Deterministic language detection & filler-word analysis.

These helpers run locally (no LLM call) so that the "non-English usage %"
and "filler word" metrics are transparent and reproducible.
"""
import re

# Unicode ranges for common non-Latin scripts we can detect reliably.
SCRIPT_RANGES = [
    ("Bangla", 0x0980, 0x09FF),
    ("Hindi (Devanagari)", 0x0900, 0x097F),
    ("Arabic", 0x0600, 0x06FF),
    ("Urdu", 0x0750, 0x077F),
    ("Chinese", 0x4E00, 0x9FFF),
    ("Japanese (Kana)", 0x3040, 0x30FF),
    ("Korean", 0xAC00, 0xD7AF),
    ("Cyrillic", 0x0400, 0x04FF),
]

# Filler / hesitation words & discourse markers (lowercase).
# Note: "like", "well", "actually", "so" also have legitimate uses;
# we count occurrences conservatively and label the metric an estimate.
FILLER_WORDS = [
    "um", "umm", "ummm", "uh", "uhh", "uhhh", "er", "erm", "err",
    "hmm", "hmmm", "hm", "ah", "ahh", "eh", "uh-huh", "huh",
    "you know", "i mean", "sort of", "kind of", "actually",
    "basically", "literally", "like", "well", "so", "right",
]


def _script_name(cp: int):
    for name, lo, hi in SCRIPT_RANGES:
        if lo <= cp <= hi:
            return name
    return None


def non_english_summary(text: str) -> dict:
    """Detect non-Latin (non-English) characters and return a summary."""
    counts: dict = {}
    non_english_chars = 0
    total_chars = 0
    for ch in text:
        if ch.isspace():
            continue
        total_chars += 1
        name = _script_name(ord(ch))
        if name:
            counts[name] = counts.get(name, 0) + 1
            non_english_chars += 1
    percentage = round(100 * non_english_chars / max(1, total_chars), 1)
    return {
        "scripts": counts,
        "non_english_chars": non_english_chars,
        "total_chars": total_chars,
        "percentage": percentage,
    }


def filler_analysis(text: str) -> dict:
    """Count filler words/phrases in the transcript."""
    lower = " " + text.lower() + " "
    items = []
    for f in FILLER_WORDS:
        pattern = r"(?<![a-z])" + re.escape(f) + r"(?![a-z])"
        count = len(re.findall(pattern, lower))
        if count:
            items.append({"word": f, "count": count})
    total_words = len(re.findall(r"[A-Za-z0-9']+", text))
    total_fillers = sum(i["count"] for i in items)
    return {
        "items": items,
        "total": total_fillers,
        "total_words": total_words,
        "percentage": round(100 * total_fillers / max(1, total_words), 1),
    }


def split_sentences(text: str) -> list:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]
