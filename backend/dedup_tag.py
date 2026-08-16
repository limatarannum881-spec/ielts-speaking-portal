"""Question-bank hygiene: difficulty tagging + duplicate detection.

Runs offline over backend/data/*.json:

  1. Tags every test with an approximate IELTS band difficulty (readability
     heuristic — avg sentence length, avg word length, advanced-word ratio).
  2. Detects near-duplicate / overlapping tests (identical title slugs, or
     highly-overlapping passages) so generated banks don't repeat topics.

Usage (from repo root, venv active):

    python backend/dedup_tag.py            # tag difficulty + report duplicates
    python backend/dedup_tag.py --dedupe   # also remove exact-duplicate files

This is a heuristic, clearly labelled as approximate — NOT an official band.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

DATA_DIR = Path(__file__).resolve().parent / "data"

# Common function words to exclude from "advanced vocabulary" detection.
COMMON = set("""
the a an and or but of to in on for with at by from as is are was were be been
have has had do does did will would can could should may might must this that
these those i you he she it we they me him her us them my your his its our
their there here what which who whom whose when where why how not no yes all
some any more most other such own same so than too very just about into over
under again further once one two three more new good great big small old
""".split())

ADVANCED_WORDS = set("""
significant substantial considerable consequently furthermore moreover
nevertheless nonetheless notwithstanding subsequently accordingly conversely
predominantly intrinsically fundamentally inherently invariably inevitably
comprehensive sophisticated prevalent ubiquitous pervasive multifaceted
detrimental advantageous implications ramifications phenomenon paradigm
""".split())


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def _norm(x, lo, hi):
    """Normalise x into 0..1 given an observed-range [lo, hi]."""
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def readability_band(text):
    """Estimate IELTS band difficulty from a passage's readability.

    Uses three features normalised against typical IELTS-passage ranges and
    averaged, then mapped onto 4.5..8.5. Clearly a heuristic, not official.
    """
    sentences = re.split(r"[.!?]+", text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 3]
    words = re.findall(r"[A-Za-z']+", text)
    if not sentences or not words:
        return 6.0, {}
    n_sent = len(sentences)
    n_words = len(words)
    avg_sent_len = n_words / n_sent
    avg_word_len = sum(len(w) for w in words) / n_words
    advanced = sum(1 for w in words if w.lower() in ADVANCED_WORDS or (len(w) >= 9 and w.lower() not in COMMON))
    advanced_ratio = advanced / n_words

    # Observed ranges for generated IELTS passages:
    #   sentence length ~12..26 words, word length ~4.5..6.5, advanced ~0.05..0.35
    score = (
        _norm(avg_sent_len, 12.0, 26.0)
        + _norm(avg_word_len, 4.5, 6.5)
        + _norm(advanced_ratio, 0.05, 0.35)
    ) / 3.0

    band = round((4.5 + score * 4.0) * 2) / 2  # 4.5..8.5, snapped to 0.5
    metrics = {
        "avg_sentence_len": round(avg_sent_len, 1),
        "avg_word_len": round(avg_word_len, 2),
        "advanced_ratio": round(advanced_ratio, 3),
    }
    return band, metrics


def passage_text(test):
    if "sections" in test:
        return " ".join(s.get("passage", "") for s in test.get("sections", []))
    if "parts" in test:
        return " ".join(p.get("script", "") for p in test.get("parts", []))
    if "task1" in test or "task2" in test:
        return " ".join(
            q.get("prompt", "") + " " + q.get("title", "")
            for q in (test.get("task1", []) + test.get("task2", []))
        )
    return ""


def shingles(text, n=4):
    t = re.sub(r"[^a-z0-9 ]+", " ", text.lower())
    words = t.split()
    return set(" ".join(words[i:i + n]) for i in range(max(0, len(words) - n + 1)))


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def tag_all():
    changed = 0
    for path in sorted(DATA_DIR.glob("**/*.json")):
        try:
            d = json.load(open(path))
        except (json.JSONDecodeError, OSError):
            continue
        text = passage_text(d)
        if not text:
            continue
        band, metrics = readability_band(text)
        d["difficulty"] = {"band": band, "method": "readability heuristic", "metrics": metrics}
        with open(path, "w") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        changed += 1
    return changed


def find_duplicates():
    items = []
    for path in sorted(DATA_DIR.glob("**/*.json")):
        try:
            d = json.load(open(path))
        except (json.JSONDecodeError, OSError):
            continue
        title = d.get("title", "")
        s = slug(title)
        # Writing files have no top-level title (titles live on prompts) — skip them.
        if not s:
            continue
        text = passage_text(d)
        items.append({
            "path": path,
            "id": d.get("id", ""),
            "title": title,
            "slug": s,
            "text": text,
            "shingles": shingles(text),
        })

    # Group by title slug -> topic concentration.
    groups = {}
    for it in items:
        groups.setdefault(it["slug"], []).append(it)

    return groups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dedupe", action="store_true", help="delete exact-title duplicates (keep 1 per topic)")
    ap.add_argument("--keep", type=int, default=1, help="with --dedupe, how many tests to keep per topic")
    args = ap.parse_args()

    print("Tagging difficulty...")
    n = tag_all()
    print(f"  tagged {n} files with a readability-based difficulty band")

    print("\nScanning for topic overlap...")
    groups = find_duplicates()
    repeated = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"  unique topics: {len(groups)}, topics with repeats: {len(repeated)}")
    for k, v in sorted(repeated.items(), key=lambda x: -len(x[1]))[:25]:
        print(f"    {len(v)}x  {v[0]['title'][:60]!r}")

    if args.dedupe:
        removed = 0
        for k, v in groups.items():
            if len(v) <= args.keep:
                continue
            for it in v[args.keep:]:
                it["path"].unlink()
                removed += 1
                print(f"    removed {Path(it['path']).name} ({k})")
        print(f"\n  removed {removed} repeated-topic file(s) (kept {args.keep} per topic)")


if __name__ == "__main__":
    main()

