"""Thin client for any OpenAI-compatible chat-completions API."""
import json

import httpx

import config


class LLMError(Exception):
    """An error with a stable `kind` so the API layer can map it
    to a friendly user-facing message."""

    def __init__(self, kind: str, detail: str = ""):
        self.kind = kind
        self.detail = detail
        super().__init__(detail)


async def chat(messages, json_mode=False, temperature=0.7, max_tokens=700):
    if config.is_demo():
        raise LLMError("no_key")

    url = f"{config.OPENAI_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    # Try each configured model in order (fallback chain for free models,
    # which can be rate-limited). The first successful call wins.
    models = config.llm_models()
    last_err = None
    i = 0
    while i < len(models):
        model = models[i]
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException:
            last_err = LLMError("timeout")
            i += 1
            continue
        except httpx.HTTPError as e:
            last_err = LLMError("network", str(e))
            i += 1
            continue

        if resp.status_code == 402:
            # Out of credits on this model. If we have free fallbacks available
            # (and aren't already using them), keep trying so the app keeps
            # working at $0. Otherwise surface a friendly credits error.
            if not any(m.endswith(":free") for m in models) and config.FREE_FALLBACK_MODELS:
                models = models + config.FREE_FALLBACK_MODELS
                last_err = LLMError("credits", "paid model out of credits — trying free fallback")
                i += 1
                continue
            raise LLMError("credits", resp.text[:300])
        # 429 rate limit / 5xx — try the next model in the chain.
        if resp.status_code in (429, 500, 502, 503, 504):
            last_err = LLMError("api", f"model {model} unavailable ({resp.status_code})")
            i += 1
            continue
        if resp.status_code != 200:
            raise LLMError("api", f"status {resp.status_code}: {resp.text[:300]}")

        try:
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, json.JSONDecodeError):
            last_err = LLMError("api", "Unexpected response shape from the AI service")
            i += 1
            continue

    raise last_err or LLMError("api", "All configured models failed")


async def transcribe_audio(audio_bytes: bytes, filename: str, mime_type: str) -> str:
    """Transcribe an audio file via the OpenAI-compatible audio/transcriptions endpoint."""
    if config.is_demo():
        raise LLMError("no_key")

    url = f"{config.OPENAI_BASE_URL}/audio/transcriptions"
    files = {"file": (filename, audio_bytes, mime_type or "audio/webm")}
    data = {"model": config.LLM_STT_MODEL}
    headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}"}

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, data=data, files=files)
    except httpx.TimeoutException:
        raise LLMError("timeout")
    except httpx.HTTPError as e:
        raise LLMError("network", str(e))

    if resp.status_code == 402:
        raise LLMError("audio_balance", resp.text[:300])
    if resp.status_code != 200:
        raise LLMError("api", f"status {resp.status_code}: {resp.text[:300]}")

    try:
        data = resp.json()
        return (data.get("text") or "").strip()
    except (json.JSONDecodeError, AttributeError):
        raise LLMError("api", "Unexpected transcription response")


def chat_sync(messages, json_mode=False, temperature=0.7, max_tokens=700):
    """Synchronous wrapper around chat() for CLI tools (e.g. generate.py)."""
    import asyncio

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(chat(messages, json_mode, temperature, max_tokens))


def parse_json(text: str):
    """Best-effort JSON parse (handles markdown fences / stray text)."""
    if not text:
        raise LLMError("parse", "empty response")
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    # Some models wrap the object in an array, e.g. [{...}]
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            arr = json.loads(text[start : end + 1])
            if isinstance(arr, list) and arr and isinstance(arr[0], dict):
                return arr[0]
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise LLMError("parse", "Could not parse model output as JSON")
