/* =====================================================================
   Listening module — audio player (synthetic speech from an original
   transcript), questions grouped by part, timer, submit. In Full Mock
   Test mode, audio is single-play and the transcript is hidden.
   ===================================================================== */

"use strict";

const Listening = (() => {
  let state = null;

  async function renderLanding() {
    const wrap = document.getElementById("listening-wrap");
    wrap.innerHTML = `<div class="loading">Loading…</div>`;
    let data = { tests: [] };
    try {
      const r = await fetch("/api/tests/listening");
      data = await r.json();
    } catch (_) {}

    const history = Store.history.list().filter((r) => r.testType === "listening").slice(0, 5);
    const prev = history.map((r) => `
      <div class="activity-row">
        <div><div class="activity-label">${esc(r.title || "Listening")}</div>
        <div class="activity-date">${new Date(r.date).toLocaleDateString()} · ${r.correct}/${r.total}</div></div>
        <div class="activity-band">${fmtBand(r.band)}</div>
      </div>`).join("") || '<p class="hint">No listening tests yet.</p>';

    const cards = data.tests.map((t) => `
      <div class="test-card">
        <div class="test-card-head"><span class="mode-emoji">🎧</span>
          <div><div class="test-title">${esc(t.title)}</div>
          <div class="test-meta">${t.parts} parts · ${t.questionCount} questions · ~30 min</div></div>
        </div>
        <button class="btn btn-primary" data-start="${t.id}">Start test</button>
      </div>`).join("");

    wrap.innerHTML = `
      <div class="module-head">
        <h1>IELTS Listening</h1>
        <p class="sub">4 parts, 40 questions, ~30 minutes in the real test. Audio plays once.</p>
      </div>
      <div class="card">
        <h2>Practice Tests</h2>
        <div class="test-list">${cards || '<p class="hint">No tests available yet.</p>'}</div>
      </div>
      <div class="card"><h2>Previous Results</h2>${prev}</div>`;

    wrap.querySelectorAll("[data-start]").forEach((b) => {
      b.addEventListener("click", () => startTest(b.dataset.start, { mockMode: false }));
    });
  }

  async function startTest(testId, opts = {}) {
    const wrap = opts.container || document.getElementById("listening-wrap");
    wrap.innerHTML = `<div class="loading">Loading test…</div>`;
    let test;
    try {
      const r = await fetch(`/api/tests/listening/${testId}`);
      test = await r.json();
    } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not load the test. Please try again.</div>`;
      return;
    }

    const flat = [];
    test.parts.forEach((p) => p.questions.forEach((q) => flat.push(q)));

    state = {
      test, flat, opts,
      answers: {},
      plays: {},       // partIndex -> play count
      playingPart: null,
      showTranscript: false,
      timer: null,
    };

    renderTestUI();
    state.timer = createTimer({
      key: "listeningEnd_" + testId,
      duration: test.duration,
      onTick: (t) => { const el = document.getElementById("listening-timer"); if (el) el.textContent = t; },
      onExpire: () => { toast("Time is up — submitting your test.", true); submitTest(); },
    });
    state.timer.start();
  }

  function playPart(partIndex) {
    if (state.playingPart !== null) return;
    if (state.opts.mockMode && (state.plays[partIndex] || 0) >= 1) {
      toast("In the mock test, audio can only be played once.", true);
      return;
    }
    const part = state.test.parts[partIndex];
    state.plays[partIndex] = (state.plays[partIndex] || 0) + 1;
    state.playingPart = partIndex;

    const btn = document.querySelector(`[data-play="${partIndex}"]`);
    if (btn) { btn.textContent = "🔊 Playing…"; btn.disabled = true; }

    if (!("speechSynthesis" in window)) {
      toast("This browser can't play audio. You can read the transcript (practice mode).", true);
      state.playingPart = null;
      if (btn) { btn.textContent = "▶️ Play audio"; btn.disabled = false; }
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(part.script);
    const v = window.pickVoice ? window.pickVoice() : null;
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = 0.95;
    u.onend = () => {
      state.playingPart = null;
      const b = document.querySelector(`[data-play="${partIndex}"]`);
      if (b) {
        b.textContent = state.opts.mockMode ? "▶️ Played" : "▶️ Replay";
        b.disabled = state.opts.mockMode;
      }
    };
    u.onerror = u.onend;
    speechSynthesis.speak(u);
  }

  function renderTestUI() {
    const wrap = state.opts.container || document.getElementById("listening-wrap");
    const answeredCount = state.flat.filter((x) => {
      const v = state.answers[x.id];
      return v !== undefined && (Array.isArray(v) ? v.some((s) => String(s).trim() !== "") : String(v).trim() !== "");
    }).length;

    wrap.innerHTML = `
      <div class="test-header">
        <div class="test-header-left">
          ${state.opts.mockMode ? "" : `<button class="btn-icon" id="listen-exit" title="Exit test">✕</button>`}
          <div><div class="test-title">${esc(state.test.title)}</div>
          <div class="test-meta" id="listen-answered">${answeredCount}/${state.flat.length} answered</div></div>
        </div>
        <div class="timer-pill" id="listening-timer">--:--</div>
      </div>
      <div class="listen-body" id="listen-body"></div>
      <div class="controls">
        <button class="btn btn-danger btn-block" id="listen-submit">Submit test</button>
      </div>`;

    // Append part + question elements (real DOM nodes so inputs keep listeners).
    const body = document.getElementById("listen-body");
    state.test.parts.forEach((p, pi) => {
      const partEl = document.createElement("div");
      partEl.className = "listen-part";

      const head = document.createElement("div");
      head.className = "listen-part-head";
      const headLeft = document.createElement("div");
      headLeft.innerHTML = `<b>Part ${p.part}</b> <span class="test-meta">${p.questions.length} question${p.questions.length > 1 ? "s" : ""}</span>`;
      const controls = document.createElement("div");
      controls.className = "listen-controls";
      if (!state.opts.mockMode) {
        const tb = document.createElement("button");
        tb.className = "btn btn-ghost btn-sm";
        tb.textContent = "📄 Transcript";
        tb.addEventListener("click", () => { state.showTranscript = !state.showTranscript; renderTestUI(); });
        controls.appendChild(tb);
      }
      const pb = document.createElement("button");
      pb.className = "btn btn-primary btn-sm";
      pb.dataset.play = pi;
      pb.textContent = "▶️ Play audio";
      pb.addEventListener("click", () => playPart(pi));
      controls.appendChild(pb);
      head.appendChild(headLeft);
      head.appendChild(controls);
      partEl.appendChild(head);

      if (!state.opts.mockMode && state.showTranscript) {
        const tb = document.createElement("div");
        tb.className = "transcript-box";
        tb.textContent = p.script;
        partEl.appendChild(tb);
      } else if (state.opts.mockMode) {
        const note = document.createElement("div");
        note.className = "criterion-comment";
        note.style.padding = "0 4px";
        note.textContent = "Audio plays once in mock test mode.";
        partEl.appendChild(note);
      }

      const qWrap = document.createElement("div");
      qWrap.className = "listen-questions";
      p.questions.forEach((q) => {
        const globalIdx = state.flat.indexOf(q);
        const qBox = document.createElement("div");
        qBox.className = "listen-q";
        qBox.appendChild(renderQuestion(q, globalIdx, state.answers[q.id], (val) => {
          state.answers[q.id] = val; updateAnswered();
        }));
        qWrap.appendChild(qBox);
      });
      partEl.appendChild(qWrap);
      body.appendChild(partEl);
    });

    const exitBtn = document.getElementById("listen-exit");
    if (exitBtn) exitBtn.addEventListener("click", () => {
      if (confirm("Exit this test? Your answers will be lost.")) { cleanup(); renderLanding(); }
    });
    document.getElementById("listen-submit").addEventListener("click", () => {
      confirmSubmit({ answered: Object.keys(state.answers).length, total: state.flat.length, onConfirm: submitTest });
    });
  }

  function updateAnswered() {
    const answeredCount = state.flat.filter((x) => state.answers[x.id] !== undefined).length;
    const el = document.getElementById("listen-answered");
    if (el) el.textContent = `${answeredCount}/${state.flat.length} answered`;
  }

  async function submitTest() {
    if (!state) return;
    if (state.timer) state.timer.destroy();
    speechSynthesis.cancel();
    const wrap = state.opts.container || document.getElementById("listening-wrap");
    wrap.innerHTML = `<div class="loading">Marking your answers…</div>`;
    try {
      const result = await api(`/api/tests/listening/${state.test.id}/submit`, { answers: state.answers });
      Store.history.add({
        testType: "listening", title: result.title,
        listening: result.band, overall: result.band, correct: result.correct,
        total: result.total, accuracy: result.accuracy, status: "completed",
      });
      const cb = state.opts.onComplete;
      cleanup();
      if (cb) cb(result);
      else renderResult(result);
    } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not submit the test. Please try again.</div>`;
    }
  }

  function renderResult(r) {
    const wrap = document.getElementById("listening-wrap");
    const review = (r.review || []).map((x, i) => `
      <div class="review-row ${x.correct ? "ok" : "bad"}">
        <div class="review-q">${i + 1}. ${esc(x.question)}</div>
        <div class="review-ans"><span>Your answer:</span> ${Array.isArray(x.userAnswer) ? x.userAnswer.join(", ") || "—" : (x.userAnswer || "—")}</div>
        <div class="review-ans"><span>Correct answer:</span> ${Array.isArray(x.correctAnswer) ? x.correctAnswer.join(", ") : x.correctAnswer}</div>
      </div>`).join("");

    wrap.innerHTML = `
      <div class="result-header">
        <div class="band-badge">Listening Result
          <div style="margin:6px 0 0"><span class="band">${fmtBand(r.band)}</span></div>
        </div>
        <div class="result-sub">AI Estimated Listening Band</div>
        <div class="result-sub" style="font-size:12px;color:var(--muted)">Estimated practice band, not an official IELTS score.</div>
      </div>
      <div class="result-stats">
        <div class="rstat"><div class="rstat-num">${r.correct}/${r.total}</div><div class="rstat-label">Correct</div></div>
        <div class="rstat"><div class="rstat-num">${r.accuracy}%</div><div class="rstat-label">Accuracy</div></div>
        <div class="rstat"><div class="rstat-num">${r.unanswered}</div><div class="rstat-label">Unanswered</div></div>
      </div>
      <div class="card"><h2>Review</h2>${review}</div>
      <div class="actions-row">
        <button class="btn btn-primary" id="listen-again">Try another test</button>
        <button class="btn btn-ghost" id="listen-dash">Back to dashboard</button>
      </div>`;
    document.getElementById("listen-again").addEventListener("click", renderLanding);
    document.getElementById("listen-dash").addEventListener("click", () => Go.nav("dashboard"));
  }

  function cleanup() {
    if (state && state.timer) state.timer.destroy();
    state = null;
  }

  return { renderLanding, startTest, submitTest, cleanup };
})();

registerRenderer("listening", () => Listening.renderLanding());
