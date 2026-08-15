"""FastAPI backend for the IELTS Speaking AI portal.

Serves the frontend and exposes three endpoints:
  GET  /api/health
  POST /api/session/start   -> first AI utterance or a Part 2 cue card
  POST /api/session/turn    -> next AI utterance given the user's speech
  POST /api/analyze         -> full IELTS-style analysis of the session
"""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import analysis
import config
import demo
import llm
import prompts
import tests_api

app = FastAPI(title="IELTS Speaking AI", version="1.0.0")
app.include_router(tests_api.router)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------
class StartReq(BaseModel):
    mode: str
    stage: str = "main"
    history: list = Field(default_factory=list)


class TurnReq(BaseModel):
    mode: str
    stage: str = "main"
    history: list = Field(default_factory=list)
    user_text: str = ""


class AnalyzeReq(BaseModel):
    mode: str
    history: list = Field(default_factory=list)
    questions: list = Field(default_factory=list)
    answers: list = Field(default_factory=list)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
FRIENDLY = {
    "no_key": "No AI key is configured. Add OPENAI_API_KEY to your .env file (see README).",
    "timeout": "The AI took too long to respond. Please try again.",
    "network": "Could not reach the AI service. Please check your internet connection and try again.",
    "api": "The AI service returned an error. Check your API key and model name in .env.",
    "parse": "The AI returned an unexpected response. Please try again.",
    "empty": "It looks like that recording was empty. Please try speaking again.",
    "audio_balance": "Voice transcription needs a small credit top-up (about $0.50) on OpenRouter. Until then, open the site in Chrome and use live voice, or type your answers.",
}


def friendly_error(e: llm.LLMError) -> HTTPException:
    return HTTPException(status_code=502, detail=FRIENDLY.get(e.kind, "Something went wrong. Please try again."))


def history_to_messages(history: list, system: str) -> list:
    msgs = [{"role": "system", "content": system}]
    for m in history[-24:]:
        role = "assistant" if m.get("role") in ("examiner", "assistant") else "user"
        text = (m.get("text") or "").strip()
        if text:
            msgs.append({"role": role, "content": text})
    return msgs


async def _generate_cue_card() -> dict:
    raw = await llm.chat(
        [{"role": "system", "content": prompts.PART2_CUE_SYSTEM},
         {"role": "user", "content": "Generate a Part 2 cue card."}],
        json_mode=True,
        temperature=0.8,
        max_tokens=400,
    )
    return llm.parse_json(raw)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "demo": config.is_demo()}


@app.post("/api/session/start")
async def session_start(req: StartReq):
    try:
        if config.is_demo():
            return demo.demo_start(req.mode, req.stage, req.history)

        if req.stage == "part2_cue":
            cue = await _generate_cue_card()
            return {"reply": None, "cue_card": cue}

        system = prompts.system_prompt(req.mode, req.stage)
        msgs = history_to_messages(req.history, system)
        msgs.append({"role": "user", "content": prompts.opening_instruction(req.mode, req.stage)})
        reply = await llm.chat(msgs, temperature=0.8, max_tokens=300)
        return {"reply": reply, "cue_card": None}
    except llm.LLMError as e:
        raise friendly_error(e)


@app.post("/api/session/turn")
async def session_turn(req: TurnReq):
    text = (req.user_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail=FRIENDLY["empty"])
    try:
        if config.is_demo():
            return demo.demo_turn(req.mode, req.stage, req.history, text)

        system = prompts.system_prompt(req.mode, req.stage)
        msgs = history_to_messages(req.history, system)
        reply = await llm.chat(msgs, temperature=0.8, max_tokens=300)
        return {"reply": reply, "cue_card": None}
    except llm.LLMError as e:
        raise friendly_error(e)


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if config.is_demo():
        return {"text": "This is a demo transcription. Add your OpenAI/OpenRouter key to enable real voice transcription."}
    try:
        audio = await file.read()
        if not audio:
            raise HTTPException(status_code=400, detail="That recording was empty. Please try speaking again.")
        text = await llm.transcribe_audio(audio, file.filename or "recording.webm", file.content_type or "audio/webm")
        if not text:
            raise HTTPException(status_code=422, detail="I couldn't make out any speech. Please try speaking again, a little louder.")
        return {"text": text}
    except llm.LLMError as e:
        raise friendly_error(e)


@app.post("/api/analyze")
async def analyze(req: AnalyzeReq):
    if not req.answers or not any((a or "").strip() for a in req.answers):
        raise HTTPException(
            status_code=400,
            detail="There was nothing to analyse. Please start a session and speak first.",
        )
    try:
        if config.is_demo():
            result = demo.demo_analyze(req.mode, req.history, req.answers)
            return analysis.assemble(req.mode, req.history, req.answers, result)

        raw = await llm.chat(
            [
                {"role": "system", "content": prompts.ANALYSIS_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        "Practice mode: " + req.mode + "\n\n"
                        "--- Conversation ---\n"
                        + "\n".join(
                            f"{'Examiner' if m.get('role') in ('examiner', 'assistant') else 'Candidate'}: {m.get('text', '')}"
                            for m in req.history
                        )
                        + "\n\nAnalyse the candidate's speech and return the JSON."
                    ),
                },
            ],
            json_mode=True,
            temperature=0.3,
            max_tokens=2500,
        )
        result = llm.parse_json(raw)
        return analysis.assemble(req.mode, req.history, req.answers, result)
    except llm.LLMError as e:
        raise friendly_error(e)


# --------------------------------------------------------------------------
# Static frontend
# --------------------------------------------------------------------------
if FRONTEND_DIR.exists():
    app.mount("/vendor", StaticFiles(directory=FRONTEND_DIR / "vendor"), name="vendor")
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


@app.get("/favicon.ico")
def favicon():
    ico = FRONTEND_DIR / "favicon.ico"
    if ico.exists():
        return FileResponse(ico)
    return HTTPException(status_code=404)
