/* =====================================================================
   IELTS Speaking AI — frontend logic
   Voice flow: AI speaks (TTS) -> user speaks (Web Speech API) ->
   backend turn -> AI speaks again. Session ends -> analysis -> PDF.
   ===================================================================== */

"use strict";

// ----------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------
const MODES = {
  free:  { name: "Free Conversation", phaseLabel: "" },
  part1: { name: "IELTS Part 1",      phaseLabel: "Part 1" },
  part2: { name: "IELTS Part 2",      phaseLabel: "Part 2" },
  part3: { name: "IELTS Part 3",      phaseLabel: "Part 3" },
  mock:  { name: "Full Mock Test",    phaseLabel: "Mock Test" },
};

// Ordered flow per mode. Phase types:
//   chat   -> AI asks questions; `limit` = how many questions in this phase
//   cue    -> fetch a Part 2 cue card, show 1-min prep
//   speech -> user speaks a 1-2 min long turn
const FLOWS = {
  free:  [{ type: "chat", stage: "main", limit: Infinity }],
  part1: [{ type: "chat", stage: "part1", limit: 6 }],
  part2: [
    { type: "cue" },
    { type: "speech" },
    { type: "chat", stage: "part2_followup", limit: 1 },
  ],
  part3: [{ type: "chat", stage: "part3", limit: 5 }],
  mock:  [
    { type: "chat", stage: "part1", limit: 4 },
    { type: "cue" },
    { type: "speech" },
    { type: "chat", stage: "part2_followup", limit: 1 },
    { type: "chat", stage: "part3", limit: 4 },
  ],
};

const TRANSITIONS = {
  part2_cue: "Now I'm going to give you a topic. You'll have one minute to prepare, and then you should speak for one to two minutes.",
  part3: "Thank you. Now I'd like to ask you some more general questions related to this topic.",
};

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------
const state = {
  mode: null,
  phaseIndex: 0,
  questionCount: 0,
  history: [],        // [{role:'examiner'|'user', text}]
  answers: [],        // user's spoken answers only
  questions: [],      // examiner questions only
  cueCard: null,
  voiceEnabled: true,
  speaking: false,
  listening: false,
  busy: false,
  ended: false,
  recognition: null,
};

const $ = (id) => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSR = !!SR;

// Mobile / browser detection
const UA = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(UA);
const isSafari = /safari/i.test(UA) && !/chrome|crios|edg|android/i.test(UA);
const isAndroid = /android/i.test(UA);
// In-app browsers (WhatsApp / Facebook / Messenger / Instagram / TikTok etc.)
const isInAppBrowser = /FBAN|FBAV|FB_IAB|FB4A|Instagram|WhatsApp|Messenger|Line\/|Twitter|TikTok|MicroMessenger/i.test(UA);
const isMobile = isIOS || isAndroid;

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(`screen-${name}`).classList.remove("hidden");
}

function toast(msg, isError = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(path, body, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let resp;
    try {
      resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt < retries) { await sleep(1500); continue; }
      toast("Network error — the server may be waking up (free tier). Please wait a few seconds and try again.", true);
      throw e;
    }

    if (!resp.ok) {
      let detail = null;
      try {
        const j = await resp.json();
        if (j.detail) detail = j.detail;
      } catch (_) {
        // Non-JSON response (e.g. an HTML error page while the free-tier
        // service is still waking up after being idle).
        detail = "The server is still waking up after being idle. Please wait a few seconds and try again.";
      }
      if (resp.status >= 500 && attempt < retries) { await sleep(2000); continue; }
      toast(detail || "Something went wrong. Please try again.", true);
      throw new Error(detail);
    }
    return resp.json();
  }
  toast("Something went wrong. Please try again.", true);
  throw new Error("request failed after retries");
}

function setStatus(kind) {
  const pill = $("status-pill");
  pill.className = "status-pill";
  if (kind === "speaking") {
    pill.classList.add("speaking");
    pill.textContent = "🔊 AI is speaking…";
  } else if (kind === "listening") {
    pill.classList.add("listening");
    pill.textContent = "🎙️ Listening…";
  } else if (kind === "thinking") {
    pill.textContent = "💭 Thinking…";
  } else {
    pill.textContent = "⏸️ Paused";
  }
}

function addMessage(role, text, opts = {}) {
  const wrap = $("transcript");
  const div = document.createElement("div");
  div.className = "msg " + role + (opts.interim ? " interim" : "");
  if (!opts.interim && !opts.sys) {
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = role === "user" ? "You" : "AI Examiner";
    div.appendChild(who);
  }
  div.appendChild(document.createTextNode(text));
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

// ----------------------------------------------------------------------
// Text-to-Speech
// ----------------------------------------------------------------------
let voicesLoaded = [];
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  voicesLoaded = window.speechSynthesis.getVoices();
}
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice() {
  const v = voicesLoaded.find((x) => /google/i.test(x.name) && x.lang.startsWith("en")) ||
            voicesLoaded.find((x) => x.lang.startsWith("en")) ||
            voicesLoaded.find((x) => x.lang.startsWith("en-GB"));
  return v || null;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!state.voiceEnabled || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onstart = () => { state.speaking = true; setStatus("speaking"); };
    u.onend = () => { state.speaking = false; setStatus("idle"); resolve(); };
    u.onerror = () => { state.speaking = false; setStatus("idle"); resolve(); };
    window.speechSynthesis.speak(u);
  });
}

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
}

// ----------------------------------------------------------------------
// Speech Recognition (microphone)
// ----------------------------------------------------------------------

// Prime the microphone and surface the permission prompt early.
// SpeechRecognition can be flaky on first use on mobile; warming up the
// mic via getUserMedia first greatly improves reliability.
let micWarmed = false;
async function warmMic() {
  if (micWarmed) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micWarmed = true;
    return true;
  } catch (e) {
    return false;
  }
}

function startListening({ continuous = false, onFinal, onInterim, onEnd }) {
  if (!hasSR) {
    if (isIOS && isSafari) {
      toast("iPhone Safari doesn't support voice recognition. Please open this site in Chrome, or type your answer below.", true);
    } else {
      toast("Speech recognition isn't supported in this browser. Use Chrome/Edge, or type your answer.", true);
    }
    return null;
  }
  if (state.listening) return null;

  stopSpeaking();
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let interimDiv = null;

  rec.onstart = () => {
    state.listening = true;
    state.recognition = rec;
    setStatus("listening");
    $("btn-mic").classList.add("listening");
    $("mic-hint").textContent = "Listening… speak now";
  };

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (interim) {
      if (!interimDiv) interimDiv = addMessage("user", interim, { interim: true });
      else interimDiv.lastChild.textContent = interim;
    }
    if (final) {
      if (interimDiv) { interimDiv.remove(); interimDiv = null; }
      onFinal(final.trim());
    }
    if (interim && onInterim) onInterim(interim);
  };

  rec.onerror = (e) => {
    state.listening = false;
    $("btn-mic").classList.remove("listening");
    $("mic-hint").textContent = "Tap the mic, then speak";
    const msg = {
      "not-allowed": "Microphone permission was denied. Allow mic access in your browser settings.",
      "service-not-allowed": "Microphone permission was denied. Allow mic access in your browser settings.",
      "no-speech": "I didn't hear anything. Tap the mic and try speaking again.",
      "audio-capture": "No microphone was found. Connect a microphone and try again.",
      "network": "Speech recognition network error. Check your connection.",
      "aborted": "",
    }[e.error] || "Speech recognition failed. Please try again.";
    if (msg) toast(msg, e.error !== "no-speech");
    setStatus("idle");
  };

  rec.onend = () => {
    state.listening = false;
    state.recognition = null;
    $("btn-mic").classList.remove("listening");
    $("mic-hint").textContent = "Tap the mic, then speak";
    if (interimDiv) interimDiv.remove();
    if (!state.ended) setStatus("idle");
    if (onEnd) onEnd();
  };

  try {
    rec.start();
  } catch (_) {
    toast("Could not start the microphone. Please try again.", true);
  }
  return rec;
}

function stopListening() {
  if (state.recognition) {
    try { state.recognition.stop(); } catch (_) {}
  }
}

// ----------------------------------------------------------------------
// Voice input mode (live speech recognition vs. record + server STT)
// ----------------------------------------------------------------------
function pickDefaultVoiceMode() {
  if (!hasSR) return "record";         // no browser speech recognition at all
  if (isInAppBrowser) return "record"; // in-app browsers block speech recognition
  if (isIOS) return "record";          // iOS has no reliable speech recognition
  return "sr";                         // desktop Chrome/Edge, Android Chrome
}
let voiceMode = pickDefaultVoiceMode();

// ----------------------------------------------------------------------
// Recording (MediaRecorder -> backend /api/transcribe)
// Works on iPhone Safari, Android, and in-app browsers that expose the mic.
// ----------------------------------------------------------------------
let mediaRecorder = null;
let audioChunks = [];
let recording = false;
let recordingOnDone = null; // set by the caller before stopping

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (!window.MediaRecorder) return "";
  for (const c of candidates) {
    if (window.MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function startRecording(onDone) {
  if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Recording isn't supported in this browser. Open the site in Chrome, or type your answer.", true);
    return;
  }
  if (recording) return;
  stopListening();
  stopSpeaking();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    audioChunks = [];
    recordingOnDone = onDone;
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recording = false;
      const cb = recordingOnDone;
      recordingOnDone = null;
      if (cb) cb(blob);
    };
    mediaRecorder.start(250); // gather chunks every 250ms
    recording = true;
    setStatus("listening");
    $("btn-mic").classList.add("listening");
    $("mic-hint").textContent = "● Recording… tap again to stop";
  } catch (e) {
    toast("Microphone permission was denied. Allow mic access in your browser settings, then try again.", true);
  }
}

function stopRecording() {
  if (mediaRecorder && recording) {
    try { mediaRecorder.stop(); } catch (_) {}
  }
}

async function transcribeBlob(blob) {
  setStatus("thinking");
  const fd = new FormData();
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  fd.append("file", blob, "recording." + ext);
  let resp;
  try {
    resp = await fetch("/api/transcribe", { method: "POST", body: fd });
  } catch (e) {
    toast("Network error — please check your connection.", true);
    setStatus("idle");
    throw e;
  }
  let j = null;
  try { j = await resp.json(); } catch (_) {}
  setStatus("idle");
  if (!resp.ok) {
    toast((j && j.detail) || "Couldn't transcribe the recording. Please try again.", true);
    throw new Error("transcribe failed");
  }
  return ((j && j.text) || "").trim();
}

// ----------------------------------------------------------------------
// Session controller
// ----------------------------------------------------------------------
function phase() {
  return FLOWS[state.mode][state.phaseIndex];
}

async function startSession(mode) {
  state.mode = mode;
  state.phaseIndex = 0;
  state.questionCount = 0;
  state.history = [];
  state.answers = [];
  state.questions = [];
  state.ended = false;

  $("session-title").textContent = MODES[mode].name;
  $("session-phase-tag").textContent = MODES[mode].phaseLabel || "";
  $("transcript").innerHTML = "";
  showScreen("session");
  setStatus("idle");

  // Prime the mic early (surfaces the permission prompt now, not mid-turn).
  warmMic();

  await runPhase(phase());
}

async function runPhase(p) {
  if (state.ended) return;

  if (p.type === "cue") {
    // Transition line then fetch cue card
    state.questionCount = 0;
    if (state.mode === "mock") {
      addMessage("sys", "— Part 2 —");
      addMessage("examiner", TRANSITIONS.part2_cue);
      await speak(TRANSITIONS.part2_cue);
    }
    try {
      const data = await api("/api/session/start", {
        mode: state.mode, stage: "part2_cue", history: state.history,
      });
      state.cueCard = data.cue_card || {};
      showPrep(state.cueCard);
    } catch (_) {}
    return;
  }

  if (p.type === "speech") {
    startSpeechPhase();
    return;
  }

  // chat phase
  state.questionCount = 0;
  if (state.mode === "mock" && p.stage === "part3") {
    addMessage("sys", "— Part 3 —");
    addMessage("examiner", TRANSITIONS.part3);
    await speak(TRANSITIONS.part3);
  }

  try {
    const data = await api("/api/session/start", {
      mode: state.mode, stage: p.stage, history: state.history,
    });
    if (data.reply) {
      examinerSay(data.reply);
    }
  } catch (_) {}
}

function examinerSay(text) {
  state.history.push({ role: "examiner", text });
  state.questions.push(text);
  addMessage("examiner", text);
  speak(text);
}

function userSaid(text) {
  state.history.push({ role: "user", text });
  state.answers.push(text);
  addMessage("user", text);
}

async function handleUserTurn(text) {
  if (!text.trim() || state.busy || state.ended) return;
  state.busy = true;
  userSaid(text);

  const p = phase();
  state.questionCount += 1;

  // After the last question in a chat phase, advance instead of asking more.
  const limitReached = p.type === "chat" && state.questionCount >= p.limit;

  if (limitReached) {
    state.busy = false;
    advancePhase();
    return;
  }

  try {
    setStatus("thinking");
    const data = await api("/api/session/turn", {
      mode: state.mode, stage: p.stage, history: state.history, user_text: text,
    });
    if (data.reply) {
      examinerSay(data.reply);
    }
  } catch (_) {
  } finally {
    state.busy = false;
    setStatus("idle");
  }
}

function advancePhase() {
  state.phaseIndex += 1;
  const p = FLOWS[state.mode][state.phaseIndex];
  if (!p) {
    endSession();
    return;
  }
  runPhase(p);
}

// ----------------------------------------------------------------------
// Part 2 prep & speech
// ----------------------------------------------------------------------
let prepTimer = null;
let speechTimer = null;

function showPrep(cue) {
  showScreen("prep");
  $("prep-phase-tag").textContent = state.mode === "mock" ? "Part 2" : "Part 2";
  $("prep-topic").textContent = cue.topic || "Describe a topic…";
  const list = $("prep-bullets");
  list.innerHTML = "";
  (cue.bullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    list.appendChild(li);
  });

  let seconds = 60;
  $("prep-timer-text").textContent = "1:00";
  clearInterval(prepTimer);
  prepTimer = setInterval(() => {
    seconds -= 1;
    const m = Math.floor(Math.max(0, seconds) / 60);
    const s = Math.max(0, seconds) % 60;
    $("prep-timer-text").textContent = `${m}:${String(s).padStart(2, "0")}`;
    if (seconds <= 0) {
      clearInterval(prepTimer);
      $("prep-timer-text").textContent = "0:00";
      prepDone();
    }
  }, 1000);
}

function prepDone() {
  clearInterval(prepTimer);
  advancePhase(); // -> speech phase
}

function startSpeechPhase() {
  showScreen("session");
  addMessage("sys", "🎤 Speak now for 1–2 minutes. Tap the mic to stop.");
  $("speech-timer-bar").classList.remove("hidden");

  const DURATION = 120; // seconds
  let remaining = DURATION;
  $("speech-timer-text").textContent = "2:00";

  let collected = "";
  let speechActive = true;   // false once the long turn is finished
  let restartTimer = null;

  clearInterval(speechTimer);
  speechTimer = setInterval(() => {
    remaining -= 1;
    const m = Math.floor(Math.max(0, remaining) / 60);
    const s = Math.max(0, remaining) % 60;
    $("speech-timer-text").textContent = `${m}:${String(s).padStart(2, "0")}`;
    $("speech-timer-fill").style.width = `${(remaining / DURATION) * 100}%`;
    if (remaining <= 0) finishSpeech();
  }, 1000);

  function finishSpeech() {
    if (!speechActive) return;
    speechActive = false;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    clearInterval(speechTimer);
    $("btn-mic").onclick = defaultMicClick;
    $("speech-timer-bar").classList.add("hidden");

    if (voiceMode === "record") {
      // Stop recording; the onDone callback handles transcription + advance.
      if (recording) {
        stopRecording();
      } else {
        toast("I didn't catch any speech. Let's try that again.", true);
        startSpeechPhase();
      }
      return;
    }

    stopListening();
    if (!collected.trim()) {
      toast("I didn't catch any speech. Let's try that again.", true);
      startSpeechPhase();
      return;
    }
    userSaid(collected.trim());
    advancePhase(); // -> follow-up chat phase
  }

  // On mobile, the speech recognizer often stops after a short silence.
  // Keep restarting it (with a small delay) until the turn is over, so the
  // user can keep speaking for the full 1–2 minutes.
  function keepListening() {
    if (!speechActive || state.ended) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!speechActive || state.ended) return;
      startListening({
        continuous: true,
        onFinal: (t) => { if (speechActive) collected += (collected ? " " : "") + t; },
        onEnd: () => keepListening(),
      });
    }, 500);
  }

  // Tap mic to stop early
  $("btn-mic").onclick = () => finishSpeech();

  if (voiceMode === "record") {
    // Record the whole long turn as one continuous clip.
    startRecording(async (blob) => {
      $("btn-mic").classList.remove("listening");
      $("mic-hint").textContent = "Transcribing…";
      try {
        const text = await transcribeBlob(blob);
        if (text) {
          userSaid(text);
          advancePhase(); // -> follow-up chat phase
        } else {
          toast("I didn't catch any speech. Let's try that again.", true);
          startSpeechPhase();
        }
      } catch (_) {
        startSpeechPhase();
      } finally {
        $("mic-hint").textContent = "Tap the mic, then speak";
      }
    });
    return;
  }

  warmMic().then(() => {
    if (!speechActive) return;
    startListening({
      continuous: true,
      onFinal: (t) => { if (speechActive) collected += (collected ? " " : "") + t; },
      onEnd: () => keepListening(),
    });
  });
}

// ----------------------------------------------------------------------
// Analysis + results
// ----------------------------------------------------------------------
async function endSession() {
  if (state.ended) return;
  state.ended = true;
  clearInterval(speechTimer);
  clearInterval(prepTimer);
  stopListening();
  stopSpeaking();

  if (state.answers.length === 0) {
    toast("You didn't speak yet. Start a new session to try again.", true);
    showScreen("home");
    return;
  }

  showScreen("results");
  const wrap = $("results-wrap");
  wrap.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted)">
    <div style="font-size:32px;margin-bottom:12px">🔍</div>Analysing your speech…</div>`;

  try {
    const result = await api("/api/analyze", {
      mode: state.mode, history: state.history,
      questions: state.questions, answers: state.answers,
    });
    renderResults(result);
  } catch (_) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px 0">
      <div style="font-size:32px;margin-bottom:12px">😕</div>
      <p>We couldn't analyse your session. Please try again.</p>
      <button class="btn btn-primary" onclick="showScreen('home')">Back to home</button></div>`;
  }
}

function pctFill(p) {
  if (p >= 25) return "bad";
  if (p >= 10) return "warn";
  return "";
}

function renderResults(r) {
  const wrap = $("results-wrap");
  const band = r.overall_band ?? null;
  const c = r.criteria || {};
  const m = r.metrics || {};

  let criteriaRows = "";
  const keys = [
    ["fluency_coherence", "Fluency & Coherence"],
    ["lexical_resource", "Lexical Resource"],
    ["grammatical_range_accuracy", "Grammatical Range & Accuracy"],
    ["pronunciation", "Pronunciation"],
  ];
  for (const [k, label] of keys) {
    const obj = c[k] || {};
    criteriaRows += `<tr><td>${label}</td><td class="band-cell">${fmtBand(obj.band)}</td></tr>
      <tr><td colspan="2" class="criterion-comment">${esc(obj.comment || "—")}</td></tr>`;
  }

  const corrections = (r.corrections || []).map((x) => {
    const tagCls = ({ Grammar: "grammar", Vocabulary: "vocab", Naturalness: "nat", Fluency: "fluency", "Language switching": "lang" })[x.problem] || "grammar";
    return `<div class="correction">
      <span class="tag ${tagCls}">${esc(x.problem || "Issue")}</span>
      <div class="orig">You said: “${esc(x.original)}”</div>
      <div class="fix">Better: “${esc(x.correction)}”</div>
      <div class="expl">${esc(x.explanation || "")}</div>
    </div>`;
  }).join("");

  const improved = (r.improved_answers || []).map((x) => `
    <div class="improved">
      <div class="orig"><b>Your answer:</b> ${esc(x.original)}</div>
      <div class="imp"><b>Improved version:</b> ${esc(x.improved)}</div>
      ${x.note ? `<div class="note">${esc(x.note)}</div>` : ""}
    </div>`).join("");

  const vocab = (r.vocabulary_suggestions || []).map((v) => `
    <div class="vocab-row">
      <span class="from">“${esc(v.word)}”</span> → <span class="to">${esc((v.better || []).join(", "))}</span>
      ${v.example ? `<div class="criterion-comment">e.g. ${esc(v.example)}</div>` : ""}
    </div>`).join("");

  const langItems = Object.entries(r.language?.scripts || {}).map(([k, v]) =>
    `<span class="chip warn">${esc(k)}: ${v} char(s)</span>`).join("");

  const fillerItems = (r.fillers?.items || []).map((f) =>
    `<span class="chip">“${esc(f.word)}” ×${f.count}</span>`).join("") || '<span class="hint">No filler words detected.</span>';

  const list = (arr) => (arr && arr.length ? arr.map((s) => `<li>${esc(s)}</li>`).join("") : "<li>—</li>");

  wrap.innerHTML = `
    <div class="result-header">
      <div class="band-badge">Your IELTS Speaking Result
        <div style="margin:6px 0 0"><span class="band">${fmtBand(band)}</span></div>
      </div>
      <div class="result-sub">AI Estimated IELTS Band · ${MODES[state.mode].name}</div>
      <div class="result-sub" style="font-size:12px;color:var(--muted)">This is an AI estimate, not an official IELTS score.</div>
    </div>

    <div class="card">
      <h2>Performance by Criterion</h2>
      <table class="bands">${criteriaRows}
        <tr><td><b>Overall Estimated Band</b></td><td class="band-cell">${fmtBand(band)}</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>Speech Analysis</h2>
      ${barRow("Grammar errors", m.grammar_pct)}
      ${barRow("Vocabulary issues", m.vocabulary_pct)}
      ${barRow("Fillers / repetition", m.filler_pct)}
      ${barRow("Non-English usage", m.non_english_pct)}
      ${barRow("Sentence naturalness", m.naturalness_pct)}
      ${barRow("Overall problematic speech", m.overall_pct, true)}
      <div class="method-note">📐 ${esc(r.methodology || "")}</div>
    </div>

    ${r.language && r.language.percentage > 0 ? `
    <div class="card">
      <h2>Language Detection</h2>
      <p class="criterion-comment">Non-English usage: <b>${r.language.percentage}%</b> (${r.language.non_english_chars} of ${r.language.total_chars} characters).</p>
      ${langItems || '<p class="criterion-comment">No non-English script detected.</p>'}
    </div>` : ""}

    <div class="card">
      <h2>Filler Words</h2>
      <p class="criterion-comment">${r.fillers?.total ?? 0} filler word(s) out of ${r.fillers?.total_words ?? 0} words (${r.fillers?.percentage ?? 0}%).</p>
      ${fillerItems}
    </div>

    ${corrections ? `<div class="card"><h2>Sentence-by-Sentence Corrections</h2>${corrections}</div>` : ""}

    ${improved ? `<div class="card"><h2>Improved Answers</h2>${improved}</div>` : ""}

    ${vocab ? `<div class="card"><h2>Vocabulary Suggestions</h2>${vocab}</div>` : ""}

    <div class="card"><h2>✅ Strengths</h2><ul class="plain">${list(r.strengths)}</ul></div>
    <div class="card"><h2>⚠️ Weaknesses</h2><ul class="plain">${list(r.weaknesses)}</ul></div>
    <div class="card"><h2>🎯 Personalized Suggestions</h2><ul class="plain">${list(r.suggestions)}</ul></div>

    <div class="actions-row">
      <button class="btn btn-primary" onclick="generatePdf()">📄 Generate PDF Report</button>
      <button class="btn btn-ghost" onclick="showScreen('home')">Start over</button>
    </div>
  `;

  window._lastResult = r;
}

function barRow(label, pct, highlight = false) {
  const val = (pct ?? 0).toFixed(1);
  return `<div class="bar-row">
    <div class="bar-label"><span>${label}</span><span class="val">${val}%</span></div>
    <div class="bar-track"><div class="bar-fill ${highlight ? "" : pctFill(pct)}" style="width:${Math.min(100, pct || 0)}%"></div></div>
  </div>`;
}

function fmtBand(b) {
  return (b === null || b === undefined) ? "—" : (Number(b) % 1 === 0 ? Number(b).toFixed(1) : String(b));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----------------------------------------------------------------------
// PDF generation
// ----------------------------------------------------------------------
function generatePdf() {
  const r = window._lastResult;
  if (!r) { toast("No result to export yet.", true); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const M = 48;
    const CW = W - M * 2;
    let y = 60;

    const ensure = (needed) => {
      if (y + needed > doc.internal.pageSize.getHeight() - 50) {
        doc.addPage();
        y = 60;
      }
    };
    const title = (t) => {
      ensure(40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 36, 51);
      doc.text(t, M, y);
      y += 22;
    };
    const body = (t, opts = {}) => {
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(opts.size || 10.5);
      doc.setTextColor(opts.color || [60, 66, 80]);
      const lines = doc.splitTextToSize(t || "", CW);
      for (const ln of lines) {
        ensure(16);
        doc.text(ln, M, y);
        y += 15;
      }
      y += 4;
    };
    const rule = () => {
      ensure(20);
      doc.setDrawColor(230, 233, 240);
      doc.line(M, y, W - M, y);
      y += 18;
    };

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(79, 70, 229);
    doc.text("IELTS Speaking — AI Report", M, y);
    y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(107, 115, 133);
    const date = new Date().toLocaleString();
    doc.text(`Date: ${date}    ·    Mode: ${MODES[state.mode].name}`, M, y);
    y += 16;
    doc.text("AI Estimated IELTS Band: " + fmtBand(r.overall_band) + "  (not an official IELTS score)", M, y);
    y += 8;
    rule();

    // Criteria
    title("1. Performance by Criterion");
    const crit = r.criteria || {};
    for (const [k, label] of [["fluency_coherence", "Fluency & Coherence"], ["lexical_resource", "Lexical Resource"], ["grammatical_range_accuracy", "Grammatical Range & Accuracy"], ["pronunciation", "Pronunciation"]]) {
      const o = crit[k] || {};
      body(`${label}:  Band ${fmtBand(o.band)}`, { bold: true });
      body(o.comment || "—");
    }
    rule();

    // Speech analysis
    title("2. Speech Analysis (percentages)");
    const mm = r.metrics || {};
    for (const [lbl, v] of [["Grammar errors", mm.grammar_pct], ["Vocabulary issues", mm.vocabulary_pct], ["Fillers / repetition", mm.filler_pct], ["Non-English usage", mm.non_english_pct], ["Sentence naturalness", mm.naturalness_pct], ["Overall problematic speech", mm.overall_pct]]) {
      body(`${lbl}:  ${(v ?? 0).toFixed(1)}%`);
    }
    body("Methodology: " + (r.methodology || ""), { size: 9, color: [140, 146, 160] });
    rule();

    // Language detection
    if (r.language && r.language.percentage > 0) {
      title("3. Language Detection");
      body(`Non-English usage: ${r.language.percentage}% (${r.language.non_english_chars} of ${r.language.total_chars} characters).`);
      const scripts = Object.entries(r.language.scripts || {}).map(([k, v]) => `${k}: ${v} char(s)`).join("; ");
      if (scripts) body("Scripts detected: " + scripts);
      rule();
    }

    // Filler words
    title("4. Filler Word Analysis");
    const fz = r.fillers || {};
    body(`${fz.total || 0} filler word(s) in ${fz.total_words || 0} words (${fz.percentage || 0}%).`);
    if (fz.items && fz.items.length) {
      body(fz.items.map((f) => `"${f.word}" × ${f.count}`).join(",  "));
    }
    rule();

    // Corrections
    if (r.corrections && r.corrections.length) {
      title("5. Sentence-by-Sentence Corrections");
      r.corrections.forEach((x, i) => {
        ensure(40);
        body(`${i + 1}. [${x.problem}]  You said: "${x.original}"`, { bold: true });
        body(`   Better: "${x.correction}"`, { color: [22, 163, 74] });
        if (x.explanation) body(`   ${x.explanation}`, { color: [107, 115, 133] });
        y += 4;
      });
      rule();
    }

    // Improved answers
    if (r.improved_answers && r.improved_answers.length) {
      title("6. Improved Answers");
      r.improved_answers.forEach((x) => {
        body("Your answer: " + x.original);
        body("Improved version: " + x.improved, { color: [22, 163, 74] });
        if (x.note) body(x.note, { color: [107, 115, 133] });
        y += 4;
      });
      rule();
    }

    // Vocabulary
    if (r.vocabulary_suggestions && r.vocabulary_suggestions.length) {
      title("7. Vocabulary Suggestions");
      r.vocabulary_suggestions.forEach((v) => {
        body(`"${v.word}"  ->  ${(v.better || []).join(", ")}`);
        if (v.example) body(`   e.g. ${v.example}`, { color: [107, 115, 133] });
      });
      rule();
    }

    // Transcript
    title("8. Conversation Transcript");
    for (const h of state.history) {
      body((h.role === "user" ? "You: " : "AI: ") + h.text);
    }
    rule();

    // Strengths / weaknesses / suggestions
    title("9. Strengths");
    (r.strengths || []).forEach((s) => body("• " + s));
    y += 4;
    title("10. Weaknesses");
    (r.weaknesses || []).forEach((s) => body("• " + s));
    y += 4;
    title("11. Personalized Suggestions");
    (r.suggestions || []).forEach((s) => body("• " + s));

    doc.save(`IELTS-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (e) {
    console.error(e);
    toast("Could not generate the PDF. Please try again.", true);
  }
}

// ----------------------------------------------------------------------
// Event wiring
// ----------------------------------------------------------------------
let selectedMode = null;

document.querySelectorAll(".mode-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-card").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedMode = btn.dataset.mode;
    $("btn-start").disabled = false;
  });
});

$("btn-start").addEventListener("click", () => {
  if (!selectedMode) return;
  startSession(selectedMode);
});

async function defaultMicClick() {
  if (state.listening) {
    stopListening();
    return;
  }
  if (recording) {
    stopRecording();
    return;
  }
  if (state.speaking) stopSpeaking();

  if (voiceMode === "record") {
    await startRecording(async (blob) => {
      $("btn-mic").classList.remove("listening");
      $("mic-hint").textContent = "Transcribing…";
      try {
        const text = await transcribeBlob(blob);
        if (text) {
          handleUserTurn(text);
        } else {
          toast("I couldn't hear any speech. Please try again.", true);
        }
      } catch (_) {
        /* error already surfaced in transcribeBlob */
      } finally {
        $("mic-hint").textContent = "Tap the mic, then speak";
      }
    });
    return;
  }

  // Warm the mic first (primes permission + hardware on mobile).
  await warmMic();
  startListening({
    continuous: false,
    onFinal: (t) => handleUserTurn(t),
  });
}

$("btn-mic").onclick = defaultMicClick;

$("btn-send").addEventListener("click", () => {
  const inp = $("text-input");
  const t = inp.value.trim();
  if (!t) return;
  inp.value = "";
  handleUserTurn(t);
});
$("text-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-send").click();
});

$("btn-voice").addEventListener("click", () => {
  state.voiceEnabled = !state.voiceEnabled;
  if (!state.voiceEnabled) stopSpeaking();
  $("btn-voice").textContent = state.voiceEnabled ? "🔊" : "🔇";
});

function renderModeToggle() {
  const btn = $("btn-mode");
  if (!btn) return;
  if (voiceMode === "record") {
    btn.textContent = "⏺️ Record";
    btn.title = "Voice input: Record mode (tap to record, tap again to stop). Tap to switch to Live.";
  } else {
    btn.textContent = "🎙️ Live";
    btn.title = "Voice input: Live speech recognition. Tap to switch to Record.";
  }
}

$("btn-mode").addEventListener("click", () => {
  voiceMode = voiceMode === "record" ? "sr" : "record";
  renderModeToggle();
  toast(
    voiceMode === "record"
      ? "Voice input switched to ⏺️ Record (tap mic to record, tap again to stop)."
      : "Voice input switched to 🎙️ Live speech recognition."
  );
});

$("btn-end").addEventListener("click", endSession);
$("btn-back").addEventListener("click", () => {
  if (confirm("End this session and go back? Your progress will be lost.")) {
    state.ended = true;
    stopListening();
    stopSpeaking();
    clearInterval(speechTimer);
    clearInterval(prepTimer);
    showScreen("home");
  }
});

$("btn-prep-done").addEventListener("click", prepDone);
$("btn-prep-skip").addEventListener("click", prepDone);

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------
(async function boot() {
  renderModeToggle();
  const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!hasSR) {
    if (isIOS && isSafari) {
      $("mic-hint").textContent = "iPhone Safari: voice needs Chrome — or just type your answers.";
    } else if (!hasMic) {
      $("mic-hint").textContent = "Mic not detected — you can still type your answers.";
    }
  }
  // Warn users inside in-app browsers (WhatsApp/Facebook/etc.) that the mic
  // won't work there and they should open the link in a real browser.
  if (isInAppBrowser) {
    $("inapp-banner").classList.remove("hidden");
  }
  try {
    const h = await fetch("/api/health");
    const data = await h.json();
    if (data.demo) $("demo-banner").classList.remove("hidden");
  } catch (_) {}
})();
