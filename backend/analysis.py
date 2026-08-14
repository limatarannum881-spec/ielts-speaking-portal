"""Assemble the final analysis result: merge the LLM's structured output with
the deterministic (transparent) language & filler metrics, and compute the
percentage dashboard."""
import language

PROBLEM_CATEGORY = {
    "Grammar": "grammar",
    "Vocabulary": "vocabulary",
    "Naturalness": "naturalness",
    "Fluency": "fluency",
    "Language switching": "language_switching",
}


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return min(100.0, round(100.0 * numerator / denominator, 1))


def assemble(mode: str, history: list, answers: list, llm_result: dict) -> dict:
    user_text = "\n".join(a for a in answers if a and a.strip())

    lang = language.non_english_summary(user_text)
    fillers = language.filler_analysis(user_text)
    sentences = language.split_sentences(user_text)
    n_sentences = max(1, len(sentences))

    corrections = llm_result.get("corrections", []) or []
    category_counts = {"grammar": 0, "vocabulary": 0, "naturalness": 0, "fluency": 0, "language_switching": 0}
    for c in corrections:
        cat = PROBLEM_CATEGORY.get(c.get("problem", ""), "grammar")
        category_counts[cat] += 1

    # Non-English from LLM flags (romanized Bangla etc.) is added on top of the
    # script detection so the percentage stays consistent.
    llm_langswitch = category_counts["language_switching"]

    grammar_pct = _pct(category_counts["grammar"], n_sentences)
    vocabulary_pct = _pct(category_counts["vocabulary"], n_sentences)
    naturalness_pct = _pct(category_counts["naturalness"], n_sentences)
    filler_pct = fillers["percentage"]
    non_english_pct = max(lang["percentage"], _pct(llm_langswitch, n_sentences))

    # Overall = simple average of the main rates (transparent, clearly an estimate).
    rates = [grammar_pct, vocabulary_pct, filler_pct, non_english_pct, naturalness_pct]
    overall = round(sum(rates) / len(rates), 1)

    return {
        "mode": mode,
        "criteria": llm_result.get("criteria", {}),
        "overall_band": llm_result.get("overall_band"),
        "corrections": corrections,
        "improved_answers": llm_result.get("improved_answers", []) or [],
        "vocabulary_suggestions": llm_result.get("vocabulary_suggestions", []) or [],
        "strengths": llm_result.get("strengths", []) or [],
        "weaknesses": llm_result.get("weaknesses", []) or [],
        "suggestions": llm_result.get("suggestions", []) or [],
        "metrics": {
            "grammar_pct": grammar_pct,
            "vocabulary_pct": vocabulary_pct,
            "naturalness_pct": naturalness_pct,
            "filler_pct": filler_pct,
            "non_english_pct": non_english_pct,
            "overall_pct": overall,
            "sentence_count": len(sentences),
            "word_count": fillers["total_words"],
        },
        "language": lang,
        "fillers": fillers,
        "demo": bool(llm_result.get("demo")),
        "methodology": (
            "Grammar / vocabulary / naturalness percentages = flagged issues per 100 sentences. "
            "Fillers = filler words per 100 words. Non-English = non-English characters per 100 characters. "
            "Overall = average of the five rates. These are AI estimates, NOT official IELTS measurements."
        ),
    }
