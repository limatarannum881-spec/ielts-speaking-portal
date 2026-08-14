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
    payload = {
        "model": config.LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {config.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException:
        raise LLMError("timeout")
    except httpx.HTTPError as e:
        raise LLMError("network", str(e))

    if resp.status_code != 200:
        raise LLMError("api", f"status {resp.status_code}: {resp.text[:300]}")

    try:
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError):
        raise LLMError("api", "Unexpected response shape from the AI service")


def parse_json(text: str):
    """Best-effort JSON parse (handles markdown fences / stray text)."""
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
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise LLMError("parse", "Could not parse model output as JSON")
