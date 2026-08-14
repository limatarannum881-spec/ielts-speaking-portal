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
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini").strip()
LLM_STT_MODEL = os.getenv("LLM_STT_MODEL", "openai/whisper-large-v3").strip()
DEMO_MODE = os.getenv("DEMO_MODE", "").strip().lower() in ("1", "true", "yes")
PORT = int(os.getenv("PORT", "8000"))


def is_demo() -> bool:
    """True when running without an API key (or when DEMO_MODE is forced)."""
    return (not OPENAI_API_KEY) or DEMO_MODE
