"""Configuration loaded from environment variables / .env file."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root or backend dir if present.
for candidate in (
    Path.cwd() / ".env",
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent / ".env",
):
    if candidate.exists():
        load_dotenv(candidate)
        break

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-oss-20b:free,google/gemma-4-26b-a4b-it:free").strip()
LLM_STT_MODEL = os.getenv("LLM_STT_MODEL", "openai/whisper-large-v3").strip()
DEMO_MODE = os.getenv("DEMO_MODE", "").strip().lower() in ("1", "true", "yes")
PORT = int(os.getenv("PORT", "8000"))

# Free models to fall back to when the configured (paid) model runs out of
# credits (OpenRouter returns 402). Lets the app keep working at $0.
# NOTE: ordered so JSON-mode-friendly models come FIRST — the nemotron
# reasoning model outputs chain-of-thought instead of JSON, which breaks
# json_object calls (cue cards, analysis, quizzes), so it goes last.
FREE_FALLBACK_MODELS = [
    "openai/gpt-oss-20b:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
]


def llm_models() -> list:
    """The model(s) to use for chat. A comma-separated LLM_MODEL becomes a
    fallback chain — useful with free models, which occasionally rate-limit."""
    return [m.strip() for m in LLM_MODEL.split(",") if m.strip()]


def is_demo() -> bool:
    """True when running without an API key (or when DEMO_MODE is forced)."""
    return (not OPENAI_API_KEY) or DEMO_MODE
