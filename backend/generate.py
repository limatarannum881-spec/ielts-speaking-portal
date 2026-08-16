"""IELTS question-bank generator.

Generates ORIGINAL IELTS-style practice tests (Reading / Listening / Writing)
using the configured LLM, and saves them into `backend/data/...` in the exact
schema the app already serves — so you can build 100+ practice sessions per
section without copying copyrighted Cambridge material.

Usage (run from the project root with the venv active):

    python backend/generate.py --section reading --version academic --count 100
    python backend/generate.py --section listening --count 50
    python backend/generate.py --section writing --version academic --count 100
    python backend/generate.py --section reading --count 1 --sample   # test run

Requirements:
    - OPENAI_API_KEY / OPENAI_BASE_URL / LLM_MODEL set in .env
    - Each generated test is validated before saving.

All generated content is ORIGINAL (created by the model), never scraped.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

# Allow running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
import llm  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent / "data"

READING_SCHEMA = """{
  "id": "academic-reading-002",
  "type": "reading",
  "version": "academic",
  "title": "A short descriptive title",
  "duration": 3600,
  "sections": [
    {
      "id": "section-1",
      "heading": "Reading Passage 1",
      "passage": "A 300-500 word original passage on an academic-style topic.",
      "questions": [
        {"id": "q1", "type": "true-false-not-given", "question": "...", "answer": "true|false|not-given", "explanation": "..."},
        {"id": "q2", "type": "multiple-choice", "question": "...", "options": ["A","B","C","D"], "answer": "B", "explanation": "..."},
        {"id": "q3", "type": "sentence-completion", "question": "Complete the sentence. Choose no more than two words.", "prompt": "...", "answer": "...", "explanation": "..."},
        {"id": "q4", "type": "short-answer", "question": "...", "answer": "...", "explanation": "..."}
      ]
    }
  ],
  "source": {"name": "AI-generated original content", "url": "", "license": "original", "attributionRequired": false}
}"""

LISTENING_SCHEMA = """{
  "id": "listening-002",
  "type": "listening",
  "title": "A short descriptive title",
  "duration": 1800,
  "parts": [
    {
      "part": 1,
      "audioUrl": "",
      "script": "A short original conversation or talk script (150-250 words).",
      "questions": [
        {"id": "lq1", "type": "multiple-choice", "question": "...", "options": ["A","B","C","D"], "answer": "C", "explanation": "..."},
        {"id": "lq2", "type": "form-completion", "question": "Complete the form. Write no more than TWO WORDS.", "fields": ["Label 1", "Label 2"], "answer": ["answer1", "answer2"], "explanation": "..."},
        {"id": "lq3", "type": "short-answer", "question": "...", "answer": "...", "explanation": "..."}
      ]
    }
  ],
  "source": {"name": "AI-generated original content", "url": "", "license": "original", "attributionRequired": false}
}"""

WRITING_SCHEMA = """{
  "task1": [
    {"id": "w-academic-task1-003", "type": "bar-chart|line-graph|pie-chart|table|process|map", "title": "...", "prompt": "A complete Task 1 prompt (min 150 words).", "chart": {"kind": "bar|line", "unit": "unit", "data": [{"label": "X", "value": 1}]}}
  ],
  "task2": [
    {"id": "w-task2-003", "type": "opinion|discussion|advantages-disadvantages|problem-solution|two-part", "title": "...", "prompt": "A complete Task 2 prompt (min 250 words)."}
  ]
}"""

PROMPTS = {
    ("reading", "academic"): (
        "You are an expert IELTS exam writer. Create ONE original Academic Reading practice "
        "passage with 8-10 questions. The passage must be entirely original (never copied from "
        "any book). Vary the question types (true/false/not given, multiple choice, "
        "sentence completion, short answer, matching). Return ONLY a JSON object matching this schema:\n"
        + READING_SCHEMA
    ),
    ("reading", "general"): (
        "You are an expert IELTS exam writer. Create ONE original General Training Reading practice "
        "section with 6-8 questions about an everyday/public-information topic. The passage must be "
        "entirely original. Return ONLY a JSON object matching this schema (set version to 'general'):\n"
        + READING_SCHEMA
    ),
    ("listening", "academic"): (
        "You are an expert IELTS exam writer. Create ONE original Listening practice part "
        "(a conversation or talk script) with 6-8 questions. The script must be entirely original. "
        "Return ONLY a JSON object matching this schema:\n" + LISTENING_SCHEMA
    ),
    ("writing", "academic"): (
        "You are an expert IELTS exam writer. Create ONE original Academic Task 1 prompt (with chart "
        "data) and ONE original Task 2 essay prompt. Everything must be original. Return ONLY a JSON "
        "object matching this schema:\n" + WRITING_SCHEMA
    ),
    ("writing", "general"): (
        "You are an expert IELTS exam writer. Create ONE original General Training Task 1 letter "
        "prompt and ONE original Task 2 essay prompt. Everything must be original. Return ONLY a JSON "
        "object matching this schema:\n" + WRITING_SCHEMA
    ),
}

OUT_DIRS = {
    ("reading", "academic"): "reading/academic",
    ("reading", "general"): "reading/general",
    ("listening", "academic"): "listening",
    ("writing", "academic"): "writing/academic",
    ("writing", "general"): "writing/general",
}


def clean_id(text, prefix):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]
    return f"{prefix}-{slug or int(time.time())}"


def parse_llm(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    return json.loads(text)


def validate_reading(test, version):
    assert "sections" in test and test["sections"], "missing sections"
    assert test["sections"][0].get("passage"), "missing passage"
    for s in test["sections"]:
        for q in s.get("questions", []):
            assert q.get("question") or q.get("prompt"), "question missing text"
            assert "answer" in q, "question missing answer"
    test["type"] = "reading"
    test["version"] = version
    test.setdefault("duration", 3600)
    test.setdefault("source", {"name": "AI-generated original content", "url": "", "license": "original", "attributionRequired": False})
    return test


def validate_listening(test):
    assert "parts" in test and test["parts"], "missing parts"
    for p in test["parts"]:
        assert p.get("script"), "part missing script"
        for q in p.get("questions", []):
            assert q.get("question") or q.get("prompt") or q.get("fields"), "question missing text"
            assert "answer" in q, "question missing answer"
    test["type"] = "listening"
    test.setdefault("duration", 1800)
    test.setdefault("source", {"name": "AI-generated original content", "url": "", "license": "original", "attributionRequired": False})
    return test


def validate_writing(test):
    for q in test.get("task1", []) + test.get("task2", []):
        assert q.get("prompt"), "prompt missing"
    return test


def _unique_writing_ids(data, index):
    """Force unique ids on generated writing prompts (the model tends to reuse
    the example id across runs, which breaks the frontend's id lookup)."""
    import re
    for key in ("task1", "task2"):
        prefix = "task1" if key == "task1" else "task2"
        for i, q in enumerate(data.get(key, [])):
            base = re.sub(r"[^a-z0-9]+", "-", str(q.get("title", "")).lower()).strip("-")[:20] or "prompt"
            q["id"] = f"w-{prefix}-{base}-{index:03d}-{i}"
    return data


def generate_one(section, version, index):
    key = (section, version)
    if key not in PROMPTS:
        print(f"  ! unsupported: {section}/{version}")
        return None
    system = PROMPTS[key]
    try:
        raw = llm.chat_sync([{"role": "user", "content": system}], json_mode=True, temperature=0.9, max_tokens=2500)
        data = parse_llm(raw)
        if section == "reading":
            data = validate_reading(data, version)
        elif section == "listening":
            data = validate_listening(data)
        else:
            data = validate_writing(data)
            data = _unique_writing_ids(data, index)
        return data
    except Exception as e:
        print(f"  ! failed (#{index}): {e}")
        return None


def save(section, version, data, index):
    out_dir = DATA_DIR / OUT_DIRS[(section, version)]
    out_dir.mkdir(parents=True, exist_ok=True)
    # Always force a unique id based on the index (the model may reuse ids).
    if section == "writing":
        fname = f"writing_{version}_{index:03d}.json"
    else:
        data["id"] = f"{section}-{version}-{index:03d}"
        fname = f"{data['id']}.json"
    with open(out_dir / fname, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return out_dir / fname


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--section", required=True, choices=["reading", "listening", "writing"])
    ap.add_argument("--version", default="academic", choices=["academic", "general"])
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--sample", action="store_true", help="generate a single test and print it")
    ap.add_argument("--retries", type=int, default=2, help="retries per test on validation failure")
    args = ap.parse_args()

    if config.is_demo():
        print("ERROR: no API key configured. Set OPENAI_API_KEY in .env first.")
        sys.exit(1)

    if args.sample:
        args.count = 1

    print(f"Generating {args.count} {args.version} {args.section} test(s) via {config.LLM_MODEL} ...")
    ok = 0
    for i in range(args.count):
        data = None
        for attempt in range(1 + args.retries):
            data = generate_one(args.section, args.version, i)
            if data is not None:
                break
            if attempt < args.retries:
                time.sleep(1.0)
        if data is None:
            continue
        if args.sample:
            print(json.dumps(data, indent=2, ensure_ascii=False))
            ok += 1
            continue
        path = save(args.section, args.version, data, i)
        print(f"  ✓ saved {path.relative_to(DATA_DIR)}")
        ok += 1
        time.sleep(0.3)  # gentle rate limiting

    print(f"\nDone: {ok}/{args.count} generated successfully.")
    print(f"Restart the server (or redeploy) to serve the new tests.")


if __name__ == "__main__":
    main()
