"""IELTS scoring: raw-score -> band conversion and overall-band rounding.

These use widely-published IELTS conversion tables (approximations) and the
official overall-band rounding rule. They are ESTIMATES for practice only.
"""

# Listening conversion (same for Academic & General Training). Raw mark -> band.
LISTENING_TABLE = {
    39: 9.0, 40: 9.0,
    37: 8.5, 38: 8.5,
    35: 8.0, 36: 8.0,
    32: 7.5, 33: 7.5, 34: 7.5,
    30: 7.0, 31: 7.0,
    26: 6.5, 27: 6.5, 28: 6.5, 29: 6.5,
    23: 6.0, 24: 6.0, 25: 6.0,
    18: 5.5, 19: 5.5, 20: 5.5, 21: 5.5, 22: 5.5,
    16: 5.0, 17: 5.0,
    13: 4.5, 14: 4.5, 15: 4.5,
    10: 4.0, 11: 4.0, 12: 4.0,
    8: 3.5, 9: 3.5,
    6: 3.0, 7: 3.0,
    4: 2.5, 5: 2.5,
    3: 2.0,
    2: 1.5,
    1: 1.0,
    0: 0.0,
}

ACADEMIC_READING_TABLE = {
    39: 9.0, 40: 9.0,
    37: 8.5, 38: 8.5,
    35: 8.0, 36: 8.0,
    33: 7.5, 34: 7.5,
    30: 7.0, 31: 7.0, 32: 7.0,
    27: 6.5, 28: 6.5, 29: 6.5,
    23: 6.0, 24: 6.0, 25: 6.0, 26: 6.0,
    19: 5.5, 20: 5.5, 21: 5.5, 22: 5.5,
    15: 5.0, 16: 5.0, 17: 5.0, 18: 5.0,
    13: 4.5, 14: 4.5,
    10: 4.0, 11: 4.0, 12: 4.0,
    8: 3.5, 9: 3.5,
    6: 3.0, 7: 3.0,
    4: 2.5, 5: 2.5,
    3: 2.0,
    2: 1.5,
    1: 1.0,
    0: 0.0,
}

GENERAL_READING_TABLE = {
    40: 9.0,
    39: 8.5,
    37: 8.0, 38: 8.0,
    36: 7.5,
    34: 7.0, 35: 7.0,
    32: 6.5, 33: 6.5,
    30: 6.0, 31: 6.0,
    27: 5.5, 28: 5.5, 29: 5.5,
    23: 5.0, 24: 5.0, 25: 5.0, 26: 5.0,
    19: 4.5, 20: 4.5, 21: 4.5, 22: 4.5,
    15: 4.0, 16: 4.0, 17: 4.0, 18: 4.0,
    12: 3.5, 13: 3.5, 14: 3.5,
    9: 3.0, 10: 3.0, 11: 3.0,
    6: 2.5, 7: 2.5, 8: 2.5,
    4: 2.0, 5: 2.0,
    3: 1.5,
    2: 1.0,
    1: 1.0,
    0: 0.0,
}


def raw_to_band(raw: int, skill: str, version: str = "academic") -> float:
    """Convert a raw mark (0-40) to an estimated IELTS band."""
    raw = max(0, min(40, int(raw)))
    if skill == "listening":
        table = LISTENING_TABLE
    elif skill == "reading":
        table = GENERAL_READING_TABLE if version == "general" else ACADEMIC_READING_TABLE
    else:
        raise ValueError(f"Unknown skill: {skill}")
    return table.get(raw, 0.0)


def score_to_raw_and_band(correct: int, total: int, skill: str, version: str = "academic") -> dict:
    """Score a test with `total` questions (not necessarily 40).

    Normalises to a /40 raw mark so the official conversion tables stay
    meaningful even for shorter practice banks.
    """
    total = max(1, total)
    correct = max(0, min(total, correct))
    raw = round(correct / total * 40)
    band = raw_to_band(raw, skill, version)
    return {
        "correct": correct,
        "total": total,
        "raw": raw,                      # normalised to /40
        "band": band,
        "accuracy": round(100 * correct / total, 1),
    }


def round_overall_band(avg: float) -> float:
    """Apply the official IELTS overall-band rounding rule.

    Average the four component bands; round to the nearest 0.5, rounding
    .25 -> .5 and .75 -> next whole band.
    """
    halves = round(avg * 2) / 2
    frac = round(avg - int(avg), 2)
    if 0.25 <= frac < 0.5:
        return int(avg) + 0.5
    if 0.75 <= frac:
        return int(avg) + 1.0
    return halves


def overall_band(components: dict) -> dict:
    """components: {'listening':x,'reading':x,'writing':x,'speaking':x}"""
    vals = [float(components.get(k, 0.0)) for k in ("listening", "reading", "writing", "speaking")]
    avg = sum(vals) / 4
    return {
        "average": round(avg, 2),
        "overall": round_overall_band(avg),
        "components": components,
    }


def writing_band(task1: float, task2: float) -> float:
    """Writing band = (Task1 + 2*Task2) / 3 (Task 2 weighted double)."""
    weighted = (task1 + 2 * task2) / 3
    return round_overall_band(weighted)
