"""Test data loading + Reading/Listening/Writing/Overall-band endpoints.

Question answer keys are kept server-side: the GET endpoints strip `answer` and
`explanation` so the candidate can't cheat before submission; the submit
endpoints score and return full explanations.
"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import config
import llm
import prompts
import scoring

DATA_DIR = Path(__file__).resolve().parent / "data"
router = APIRouter(prefix="/api/tests")

# ---------------------------------------------------------------------------
# Load question banks at import.
#
# Tests live in subdirectories, one JSON file per test:
#   data/reading/academic/*.json
#   data/reading/general/*.json
#   data/listening/*.json
#   data/writing/*.json
#
# This lets the app hold an unlimited number of practice tests (e.g. 100+).
# ---------------------------------------------------------------------------
def _load_all(subdir):
    d = DATA_DIR / subdir
    if not d.exists():
        return []
    tests = []
    for p in sorted(d.glob("*.json")):
        try:
            with open(p, "r", encoding="utf-8") as f:
                tests.append(json.load(f))
        except (json.JSONDecodeError, OSError):
            continue
    return tests


READING_ACADEMIC = _load_all("reading/academic")
READING_GENERAL = _load_all("reading/general")
LISTENING_TESTS = _load_all("listening")
WRITING_ACADEMIC = _load_all("writing/academic")
WRITING_GENERAL = _load_all("writing/general")

# Writing prompts — combined from any files present (each file is {task1:[...], task2:[...]}).
# A unique id is enforced on every prompt (guards against duplicate ids in
# generated content, which would break the frontend's lookup).
WRITING = {"academic": {"task1": [], "task2": []}, "general": {"task1": [], "task2": []}}
_seen_ids = set()


def _ensure_unique_id(prompt, bucket, idx):
    if not prompt.get("id") or prompt["id"] in _seen_ids:
        prompt["id"] = f"w-{bucket}-{idx:03d}-{len(_seen_ids)}"
    _seen_ids.add(prompt["id"])
    return prompt


for t in WRITING_ACADEMIC:
    for i, p in enumerate(t.get("task1", [])):
        WRITING["academic"]["task1"].append(_ensure_unique_id(p, "task1", i))
    for i, p in enumerate(t.get("task2", [])):
        WRITING["academic"]["task2"].append(_ensure_unique_id(p, "task2", i))
for t in WRITING_GENERAL:
    for i, p in enumerate(t.get("task1", [])):
        WRITING["general"]["task1"].append(_ensure_unique_id(p, "task1", i))
    for i, p in enumerate(t.get("task2", [])):
        WRITING["general"]["task2"].append(_ensure_unique_id(p, "task2", i))


def _all_reading():
    return READING_ACADEMIC + READING_GENERAL


def _strip_answers(test):
    """Deep-copy a test without revealing answer keys."""
    t = json.loads(json.dumps(test))
    for section in t.get("sections", []):
        for q in section.get("questions", []):
            q.pop("answer", None)
            q.pop("answers", None)
            q.pop("explanation", None)
            for sub in q.get("subquestions", []):
                sub.pop("answer", None)
    for part in t.get("parts", []):
        for q in part.get("questions", []):
            q.pop("answer", None)
            q.pop("answers", None)
            q.pop("explanation", None)
    return t


def _flatten_questions(test):
    """Return a flat list of {type, id, question, answer} across sections/parts."""
    out = []
    if "sections" in test:
        for s in test["sections"]:
            for q in s["questions"]:
                out.append({"type": q.get("type"), "id": q.get("id"), "question": q, "answer": q.get("answer")})
    if "parts" in test:
        for p in test["parts"]:
            for q in p["questions"]:
                out.append({"type": q.get("type"), "id": q.get("id"), "question": q, "answer": q.get("answer")})
    return out


def _normalize(x):
    return " ".join(str(x).strip().lower().split())


def _answers_match(user, correct):
    """Compare a user answer to the correct answer. Handles arrays (matching
    headings / form completion) element-by-element."""
    if isinstance(correct, list):
        if not isinstance(user, list):
            return False
        if len(user) != len(correct):
            return False
        return all(_normalize(u) == _normalize(c) for u, c in zip(user, correct))
    return _normalize(user) == _normalize(correct)


def _q_text(q):
    return q.get("text") or q.get("prompt") or q.get("question") or q.get("label") or ""


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
@router.get("/reading")
def list_reading():
    tests = []
    for t in _all_reading():
        tests.append({
            "id": t["id"], "title": t["title"], "version": t["version"],
            "duration": t["duration"],
            "questionCount": len(_flatten_questions(t)),
            "source": t.get("source"),
        })
    return {"tests": tests}


@router.get("/reading/{test_id}")
def get_reading(test_id: str):
    test = _find_reading(test_id)
    return _strip_answers(test)


def _find_reading(test_id):
    for t in _all_reading():
        if t["id"] == test_id:
            return t
    raise HTTPException(status_code=404, detail="Reading test not found.")


class ReadingSubmit(BaseModel):
    answers: dict = Field(default_factory=dict)  # question_id -> selected answer


@router.post("/reading/{test_id}/submit")
def submit_reading(test_id: str, req: ReadingSubmit):
    test = _find_reading(test_id)
    items = _flatten_questions(test)
    total = len(items)
    correct = 0
    review = []
    unanswered = 0

    for it in items:
        q = it["question"]
        qid = it["id"]
        user_ans = req.answers.get(qid, None)
        blank = user_ans is None or (isinstance(user_ans, list) and all(str(u).strip() == "" for u in user_ans)) or (not isinstance(user_ans, list) and str(user_ans).strip() == "")
        if blank:
            unanswered += 1
            is_correct = False
        else:
            is_correct = _answers_match(user_ans, it["answer"])
            if is_correct:
                correct += 1
        review.append({
            "id": qid,
            "type": it["type"],
            "question": _q_text(q),
            "userAnswer": user_ans,
            "correctAnswer": it["answer"],
            "correct": is_correct,
        })

    result = scoring.score_to_raw_and_band(correct, total, "reading", test["version"])
    result.update({
        "testId": test_id,
        "title": test["title"],
        "unanswered": unanswered,
        "incorrect": total - correct - unanswered,
        "review": review,
        "estimated": True,
    })
    return result


# ---------------------------------------------------------------------------
# Listening
# ---------------------------------------------------------------------------
@router.get("/listening")
def list_listening():
    tests = []
    for t in LISTENING_TESTS:
        tests.append({
            "id": t["id"], "title": t["title"],
            "duration": t["duration"],
            "parts": len(t["parts"]),
            "questionCount": len(_flatten_questions(t)),
            "source": t.get("source"),
        })
    return {"tests": tests}


def _find_listening(test_id):
    for t in LISTENING_TESTS:
        if t["id"] == test_id:
            return t
    raise HTTPException(status_code=404, detail="Listening test not found.")


@router.get("/listening/{test_id}")
def get_listening(test_id: str):
    return _strip_answers(_find_listening(test_id))


class ListeningSubmit(BaseModel):
    answers: dict = Field(default_factory=dict)


@router.post("/listening/{test_id}/submit")
def submit_listening(test_id: str, req: ListeningSubmit):
    test = _find_listening(test_id)
    items = _flatten_questions(test)
    total = len(items)
    correct = 0
    unanswered = 0
    review = []

    for it in items:
        q = it["question"]
        qid = it["id"]
        user_ans = req.answers.get(qid, None)
        blank = user_ans is None or (isinstance(user_ans, list) and all(str(u).strip() == "" for u in user_ans)) or (not isinstance(user_ans, list) and str(user_ans).strip() == "")
        if blank:
            unanswered += 1
            is_correct = False
        else:
            is_correct = _answers_match(user_ans, it["answer"])
            if is_correct:
                correct += 1
        review.append({
            "id": qid,
            "type": it["type"],
            "question": _q_text(q),
            "userAnswer": user_ans,
            "correctAnswer": it["answer"],
            "correct": is_correct,
        })

    result = scoring.score_to_raw_and_band(correct, total, "listening")
    result.update({
        "testId": test_id,
        "title": test["title"],
        "unanswered": unanswered,
        "incorrect": total - correct - unanswered,
        "review": review,
        "estimated": True,
    })
    return result


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------
@router.get("/writing")
def get_writing():
    if not WRITING:
        return {"academic": {"task1": [], "task2": []}, "general": {"task1": [], "task2": []}}
    return {
        "academic": {"task1": WRITING["academic"]["task1"], "task2": WRITING["academic"]["task2"]},
        "general": {"task1": WRITING["general"]["task1"], "task2": WRITING["general"]["task2"]},
    }


class WritingEvalReq(BaseModel):
    task: str = "Task 2"
    prompt: str = ""
    essay: str = ""


@router.post("/writing/evaluate")
async def evaluate_writing(req: WritingEvalReq):
    if not req.essay or not req.essay.strip():
        raise HTTPException(status_code=400, detail="Please write your answer before submitting.")
    if config.is_demo():
        raise HTTPException(status_code=502, detail="AI evaluation needs a configured API key.")

    messages = [
        {"role": "system", "content": prompts.WRITING_EVAL_SYSTEM},
        {"role": "user", "content": prompts.writing_eval_prompt(req.task, req.prompt, req.essay)},
    ]

    result = None
    last_err = None
    # Retry a few times: free models occasionally return non-JSON or get
    # rate-limited; a short retry makes the evaluation far more reliable.
    for _ in range(3):
        try:
            raw = await llm.chat(messages, json_mode=True, temperature=0.3, max_tokens=2000)
            result = llm.parse_json(raw)
            break
        except llm.LLMError as e:
            last_err = e
            if e.kind in ("credits", "no_key"):
                break  # no point retrying a hard error
            await __import__("asyncio").sleep(1.5)

    if result is None:
        raise _friendly(last_err or llm.LLMError("parse", "empty response"))

    # Merge in task metadata and word count (server-side truth).
    result["wordCount"] = len(req.essay.split())
    result["task"] = req.task
    result["estimated"] = True
    return result


# ---------------------------------------------------------------------------
# Overall band
# ---------------------------------------------------------------------------
class OverallReq(BaseModel):
    listening: float = 0
    reading: float = 0
    writing: float = 0
    speaking: float = 0


@router.post("/score/overall")
def score_overall(req: OverallReq):
    return scoring.overall_band({
        "listening": req.listening,
        "reading": req.reading,
        "writing": req.writing,
        "speaking": req.speaking,
    })


def _friendly(e: llm.LLMError):
    mapping = {
        "no_key": "AI evaluation needs a configured API key (add OPENAI_API_KEY to .env).",
        "timeout": "The AI took too long to evaluate. Please try again.",
        "network": "Could not reach the AI service. Check your connection and try again.",
        "api": "The AI service returned an error. Check your API key and model name.",
        "credits": "The AI account is out of credits. Add a small top-up at openrouter.ai/settings/credits to enable AI evaluation.",
        "parse": "The AI returned an unexpected response. Please try again.",
    }
    return HTTPException(status_code=502, detail=mapping.get(e.kind, "Something went wrong. Please try again."))
