"""Offline DEMO mode.

When no OPENAI_API_KEY is configured the app still works end-to-end using
these canned (but context-aware-ish) responses, so the user can test the full
flow: voice -> transcript -> turn -> analysis -> PDF.

Deterministic analysis (language detection, filler counting) is still REAL even
in demo mode. The band scores and corrections here are illustrative placeholders
and are clearly labelled "demo".
"""
import re

GREETINGS = {
    "free": "Hi! I'm your English practice partner. Let's just chat. So, tell me — what do you study, or what keeps you busy these days?",
    "part1": "Good morning. Let's begin. Can you tell me a little about the place where you live?",
    "part3": "Thank you. Now I'd like to ask some more general questions. In your opinion, why do people enjoy travelling to new places?",
}

FOLLOWUPS = {
    "free": [
        "That's interesting! Why did you choose that?",
        "Tell me more about that — what do you enjoy most about it?",
        "How long have you been doing that?",
        "And what about your family — are they supportive?",
        "If you could change one thing about it, what would it be?",
        "What do you usually do to relax after a long day?",
        "Have you travelled anywhere recently you really liked?",
        "What kind of food do you enjoy the most?",
    ],
    "part1": [
        "I see. And what do you usually do in your free time?",
        "That's nice. Do you prefer spending time with friends or alone?",
        "Tell me, what is your favourite type of food?",
        "And how often do you use technology in your daily life?",
        "What part of your daily routine do you enjoy the most?",
    ],
    "part3": [
        "Interesting. Do you think that has changed over the last twenty years?",
        "And how might technology change this in the future?",
        "Some people disagree with that. What would you say to them?",
        "How does this affect younger people compared to older generations?",
        "In your view, what is the best way for society to improve in this area?",
    ],
}

DEMO_CUE = {
    "topic": "Describe a place you would like to visit.",
    "bullets": [
        "you should say: where the place is",
        "how you would get there",
        "what you would do there",
        "and explain why you want to visit it",
    ],
}

DEMO_FOLLOWUP = "Thank you. Just a quick question — would you prefer to visit that place alone or with friends, and why?"

# Simple, honest rule-based corrections used only in demo mode.
_ING = {"study": "studying", "work": "working", "go": "going", "live": "living", "learn": "learning"}
_BASE = {"went": "go", "saw": "see", "ate": "eat", "drank": "drink", "took": "take", "came": "come"}

DEMO_RULES = [
    (
        re.compile(r"\bi am (study|work|go|live|learn)\b", re.I),
        lambda m: f"I am {_ING[m.group(1).lower()]}",
        "Grammar",
        "After 'am', use the -ing form (e.g. 'I am studying'), or drop the auxiliary (e.g. 'I study').",
    ),
    (
        re.compile(r"\bi very like\b", re.I),
        lambda m: "I really like",
        "Naturalness",
        "'Very like' is unnatural. Use 'really like' or 'like ... a lot'.",
    ),
    (
        re.compile(r"\b(from|since)\s+(two|three|four|five|six|seven|eight|nine|ten)\s+years?\b", re.I),
        lambda m: f"for {m.group(2).lower()} years",
        "Grammar",
        "Use 'for' with a duration ('for two years') and 'since' with a starting point ('since 2021').",
    ),
    (
        re.compile(r"\bmore better\b", re.I),
        lambda m: "better",
        "Grammar",
        "'Better' is already comparative, so 'more better' is a double comparative.",
    ),
    (
        re.compile(r"\bdid not (went|saw|ate|drank|took|came)\b", re.I),
        lambda m: f"did not {_BASE[m.group(1).lower()]}",
        "Grammar",
        "After 'did not', use the base form of the verb (e.g. 'did not go').",
    ),
]


def _pick(pool, history_len):
    return pool[history_len % len(pool)]


def demo_start(mode: str, stage: str, history: list):
    if stage == "part2_cue":
        return {"reply": None, "cue_card": DEMO_CUE}
    if stage == "part2_followup":
        return {"reply": DEMO_FOLLOWUP, "cue_card": None}
    if stage == "part3":
        return {"reply": GREETINGS["part3"], "cue_card": None}
    if stage == "part1":
        return {"reply": GREETINGS["part1"], "cue_card": None}
    return {"reply": GREETINGS["free"], "cue_card": None}


def demo_turn(mode: str, stage: str, history: list, user_text: str):
    pool = FOLLOWUPS.get(stage, FOLLOWUPS["free"])
    n_user = sum(1 for m in history if m.get("role") == "user")
    reply = _pick(pool, n_user)
    return {"reply": reply, "cue_card": None}


def _demo_corrections(text: str):
    corrections = []
    for rule, replacement, problem, explanation in DEMO_RULES:
        m = rule.search(text)
        if not m:
            continue
        if callable(replacement):
            corrected = replacement(m)
        else:
            corrected = replacement
        # Build a readable "original" snippet around the match.
        corrections.append(
            {
                "original": m.group(0),
                "problem": problem,
                "correction": corrected,
                "explanation": explanation,
            }
        )
    return corrections


def demo_analyze(mode: str, history: list, answers: list):
    user_text = "\n".join(answers)
    corrections = _demo_corrections(user_text)
    return {
        "criteria": {
            "fluency_coherence": {"band": 6.0, "comment": "Demo estimate: reasonably connected speech, with some hesitation."},
            "lexical_resource": {"band": 6.0, "comment": "Demo estimate: adequate range of everyday vocabulary."},
            "grammatical_range_accuracy": {"band": 5.5, "comment": "Demo estimate: some grammatical errors affect clarity."},
            "pronunciation": {"band": 6.0, "comment": "Demo estimate: pronunciation cannot be measured from text alone."},
        },
        "overall_band": 6.0,
        "corrections": corrections,
        "improved_answers": [
            {
                "original": (answers[0] if answers else "—"),
                "improved": (answers[0] if answers else "—") + " (demo improved version)",
                "note": "Demo placeholder — connect your AI key to get real improvements.",
            }
        ] if answers else [],
        "vocabulary_suggestions": [
            {"word": "good", "better": ["excellent", "beneficial", "enjoyable"], "example": "It was an enjoyable experience."}
        ],
        "strengths": [
            "You attempted to answer every question.",
            "You stayed on topic.",
            "Your ideas were understandable.",
        ],
        "weaknesses": [
            "Some grammar errors (tense and word form).",
            "A few filler words used.",
            "Limited range of advanced vocabulary.",
        ],
        "suggestions": [
            "Practise present perfect continuous for ongoing situations.",
            "Try to reduce 'um' and 'like' by pausing instead.",
            "Learn 5 new topic-specific words per week.",
        ],
        "demo": True,
    }
