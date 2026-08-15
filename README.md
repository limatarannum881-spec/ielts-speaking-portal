# 🎙️ IELTS AI — Complete IELTS Practice & Mock-Test Platform

A complete **IELTS preparation platform**: practise **Listening, Reading,
Writing and Speaking** — including a **Full Realtime Mock Test** — with an AI
examiner and tutor that speaks aloud, listens to your voice, scores your
answers and produces detailed **estimated band** reports and **PDF downloads**.

The Speaking module uses a natural **voice conversation** with an AI examiner,
with context-aware follow-up questions and sentence-by-sentence analysis.

---

## ✨ Features

- 🗣️ **Free Conversation** — casual chat with gentle, in-line corrections.
- 🎓 **IELTS Part 1** — familiar topics, one question at a time.
- 📝 **IELTS Part 2** — cue card + 1-minute prep timer + 1–2 minute long turn.
- 💬 **IELTS Part 3** — analytical, opinion-based questions of increasing difficulty.
- 🏆 **Full Mock Test** — Part 1 → 2 → 3, **no corrections during the test**.
- 🎤 **Two voice-input modes** — **Live** (browser speech recognition) and **Record**
  (records your voice → transcribes server-side via Whisper). Record mode works on
  **iPhone Safari** and inside apps where live recognition is blocked.
- 🎧 **Listening** — 4 parts, 40 questions, audio player, single-play in mock mode.
- 📖 **Reading** — Academic & General Training, split-screen passage/questions, 12+ question types.
- ✍️ **Writing** — Task 1 & Task 2 with word count, timer, drafts, and AI evaluation on the 4 criteria.
- 🏆 **Full Mock Test** — Listening → Reading → Writing → Speaking in one session, with an overall band.
- 📊 **Dashboard & History** — skill cards, progression charts, best/average score, recommended focus.
- 🔍 **Language detection** — flags Bangla / Hindi / other non-English usage (e.g. *"I am studying because আমি subject টা পছন্দ করি"* → *Non-English usage: 8%*).
- 📊 **Sentence-by-sentence corrections** with problem type, correction & explanation.
- 🧮 **Transparent error percentages** + an **AI Estimated IELTS Band** (4 criteria).
- 📄 **PDF report** generation with everything in one document.
- 📱 Mobile-friendly (tested for Android/Chrome).

> ⚠️ **Important:** the band score and percentages are **AI estimates**, not
> official IELTS measurements. The app is clearly labelled as such.

---

## ☁️ One-click deploy (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/limatarannum881-spec/ielts-speaking-portal)

1. Click the button, sign in with GitHub, and Render will read `render.yaml`.
2. During setup, add your key as an env var: `OPENAI_API_KEY` (your OpenRouter key).
3. Deploy. Render gives you an **HTTPS URL** (required for the microphone).

> No key yet? It still deploys in **demo mode** so you can test the flow.

---

## 🧱 Tech stack

| Layer     | Choice                                              |
|-----------|-----------------------------------------------------|
| Backend   | **Python + FastAPI** (serves the frontend + AI API) |
| Frontend  | **Vanilla HTML/CSS/JS** (no build step, easy deploy)|
| AI        | Any **OpenAI-compatible** chat API (see below)      |
| Speech→Text | **Live**: browser Web Speech API · **Record**: MediaRecorder → server Whisper |
| Text→Speech | Browser **speechSynthesis** (free, no key needed)|
| PDF       | **jsPDF** (client-side, bundled locally)            |

The voice pipeline is the simple, cost-efficient version:
**Record (mic) → Transcribe (browser or server) → AI response → Text-to-speech (browser)**.
Only *one* AI request per turn, and *one* analysis request at the end — no
streaming/real-time voice, so cost stays low. The architecture (stateless
`/start`, `/turn`, `/transcribe`, `/analyze` endpoints) makes it easy to swap in
a real-time voice API later.

**Voice input modes** (toggle in the session screen):
- **🎙️ Live** — browser speech recognition. Free & instant, but needs Chrome/Edge
  on desktop or Android (no iPhone, no in-app browsers).
- **⏺️ Record** — records your voice and transcribes it server-side via
  OpenRouter's Whisper (`/api/transcribe`). Works on iPhone Safari and Android.
  ⚠️ OpenRouter requires a **$0.50 minimum account balance** for audio requests.

---

## 📁 Project structure

```
ielts-speaking-portal/
├── backend/
│   ├── main.py          # FastAPI app + routes (serves frontend too)
│   ├── tests_api.py     # Reading/Listening/Writing/Overall-band endpoints
│   ├── scoring.py       # IELTS raw→band conversion + overall rounding
│   ├── llm.py           # OpenAI-compatible chat + transcription client
│   ├── prompts.py       # System prompts (Speaking + Writing evaluation)
│   ├── language.py      # Deterministic language + filler detection
│   ├── analysis.py      # Merges LLM + deterministic metrics
│   ├── demo.py          # Offline demo responses (no API key needed)
│   ├── config.py        # Env loading
│   ├── data/            # Original question banks (reading/listening/writing)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js           # Speaking: voice, session state machine, results, PDF
│   ├── store.js         # localStorage persistence (history, profile, session)
│   ├── nav.js           # top/bottom navigation
│   ├── testengine.js    # reusable timer, navigator, question renderer, dialog
│   ├── dashboard.js     # dashboard
│   ├── reading.js       # Reading module
│   ├── listening.js     # Listening module
│   ├── writing.js       # Writing module + AI evaluation
│   ├── mocktest.js      # Full Mock Test orchestration
│   ├── history.js       # results / history
│   ├── resources.js     # curated external resource links
│   └── vendor/jspdf.umd.min.js   # bundled PDF library
├── .env.example         # copy to .env
├── .gitignore
├── render.yaml          # Render one-click deploy
└── README.md
```

---

## 🚀 Run locally

### 1. Install Python (3.9+) and get the code

```bash
git clone <your-repo> && cd ielts-speaking-portal
# or just copy the folder
```

### 2. Create a virtual environment & install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

### 3. Set your API key (environment variables)

```bash
cp .env.example .env
# now edit .env and paste your key
```

Open `.env` and set:

```env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

### 4. Run the server

```bash
uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000** in **Chrome or Edge** (Web Speech API
requires Chromium — Firefox/Safari will show a message and let you **type**
instead).

> On Android: open Chrome, visit `http://<your-computer-ip>:8000` (same Wi-Fi),
> allow microphone permission when prompted.

---

## 🔑 Where do I put my API key?

**Only in the backend's `.env` file** (or real environment variables).
The key is **never** sent to the browser and **never** hard-coded in frontend code.

The backend uses any **OpenAI-compatible** endpoint, so you can use the cheapest
option you prefer:

| Provider     | `OPENAI_BASE_URL`                    | Example `LLM_MODEL`            |
|--------------|--------------------------------------|--------------------------------|
| OpenAI       | `https://api.openai.com/v1`          | `gpt-4o-mini`                  |
| Groq (fast)  | `https://api.groq.com/openai/v1`     | `llama-3.3-70b-versatile`      |
| OpenRouter   | `https://openrouter.ai/api/v1`       | `openai/gpt-4o-mini`           |
| Together AI  | `https://api.together.xyz/v1`        | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Ollama (local, free) | `http://localhost:11434/v1` | `llama3.2`               |

`gpt-4o-mini` is a good cheap default. Groq is free-tier friendly and very fast.

---

## 🧪 Demo mode (no API key)

If no `OPENAI_API_KEY` is set, the app **automatically runs in demo mode** so
you can test the *entire* flow — voice, transcript, turn-taking, Part 2 timer,
analysis, and PDF — using canned responses. A yellow banner tells you it's demo
mode. The **language detection and filler-word analysis are still real** in demo
mode (they run locally, not via AI).

Force demo mode even with a key: `DEMO_MODE=true`.

---

## 🌐 Deploying

The backend is a single FastAPI app that also serves the frontend, so deploying
is just deploying one process.

**Option A — Render (one click, recommended):**
Use the **Deploy to Render** button above, or:
1. Push the repo to GitHub (done).
2. On [render.com](https://render.com) → **New → Blueprint** → select this repo.
3. It reads `render.yaml` automatically. Add `OPENAI_API_KEY` when prompted.
4. Deploy — you get an HTTPS URL immediately.

**Option B — Railway / Fly.io:**
1. Create a new **Web Service** pointing at this repo.
2. Build command: `pip install -r backend/requirements.txt`
3. Start command: `uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT`
4. Add the environment variables (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_MODEL`).

**Option C — any VPS:**
```bash
pip install -r backend/requirements.txt
cp .env.example .env   # fill in your key
uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
# optional: put behind nginx + HTTPS (needed for mic on non-localhost origins)
```

> ⚠️ Browsers require **HTTPS** (or `localhost`) to access the microphone.
> `http://localhost` works for local dev. For a public deployment, use HTTPS
> (Render/Railway provide it automatically).

---

## 🔌 API reference

| Method | Path                | Body                                    | Returns                                  |
|--------|---------------------|-----------------------------------------|------------------------------------------|
| GET    | `/api/health`       | —                                       | `{status, demo}`                         |
| POST   | `/api/session/start`| `{mode, stage, history}`                | `{reply, cue_card}`                      |
| POST   | `/api/session/turn` | `{mode, stage, history, user_text}`     | `{reply, cue_card}`                      |
| POST   | `/api/transcribe`   | `multipart/form-data` (`file`)          | `{text}`                                 |
| POST   | `/api/analyze`      | `{mode, history, questions, answers}`   | full Speaking analysis                   |
| GET    | `/api/tests/reading`| —                                       | list of reading tests                    |
| GET    | `/api/tests/reading/{id}` | —                                 | test **without** answer keys             |
| POST   | `/api/tests/reading/{id}/submit` | `{answers}`               | scored result + review                   |
| GET    | `/api/tests/listening` | —                                     | list of listening tests                  |
| GET    | `/api/tests/listening/{id}` | —                                | test **without** answer keys             |
| POST   | `/api/tests/listening/{id}/submit` | `{answers}`              | scored result + review                   |
| GET    | `/api/tests/writing`| —                                       | Task 1 & Task 2 prompts                  |
| POST   | `/api/tests/writing/evaluate` | `{task, prompt, essay}`      | 4-criteria AI evaluation                 |
| POST   | `/api/tests/score/overall` | `{listening, reading, writing, speaking}` | overall band (IELTS rounding) |

- `mode`: `free` | `part1` | `part2` | `part3` | `mock`
- `stage`: `main` | `part1` | `part2_cue` | `part2_followup` | `part3`

Answer keys for Reading/Listening are kept **server-side** and only revealed
in the post-submission review (no cheating before submission).

---

## 📐 How the percentages & band are calculated (transparency)

- **Grammar / vocabulary / naturalness %** = flagged issues **per 100 sentences**.
- **Fillers %** = filler words (um, uh, like, you know, actually, …) **per 100 words**.
- **Non-English %** = non-English characters (detected by Unicode script ranges
  for Bangla, Devanagari, etc.) **per 100 characters**.
- **Overall problematic speech %** = the **average** of the five rates above.
- **Band score** = AI estimate across the four official criteria (Fluency &
  Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation),
  each 0–9 in 0.5 steps, with a one-line justification.

All of these are **AI estimates for practice only**, never official IELTS scores.

Pronunciation is **not** measured from audio — the system only comments
cautiously and labels it an estimate (it does not invent precise pronunciation
errors). A real-time audio pipeline could be added later.

---

## 🛠️ Known limitations (first version)

- **Live** voice needs **Chrome / Edge** (Web Speech API). **Record** mode works
  more widely but needs the OpenRouter audio balance. Fallback = type answers.
- STT accuracy varies with accent (both the browser recognizer and Whisper).
- Romanized Bangla (e.g. "kemon acho") may not be flagged by the script detector;
  the AI's analysis layer catches obvious non-English phrases instead.
- Only English (en-US) recognition is enabled for now.

---

## 📝 Licence

Personal learning project. Use freely.
