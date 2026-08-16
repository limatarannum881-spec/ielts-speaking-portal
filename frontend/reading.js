/* =====================================================================
   Reading module — landing + computer-style test interface with
   split-screen passage/questions, timer, navigator, review, submit.
   ===================================================================== */

"use strict";

const Reading = (() => {
  let tests = [];
  let version = "academic";
  let state = null; // {test, flat, answers, reviewed, current, timer}
  let adaptive = { active: false, band: null, version: "academic" };

  // Current reading band from history (for adaptive starting point).
  function readingBand() {
    const r = Store.history.list().find((x) => typeof x.reading === "number");
    return r ? r.reading : 6.5;
  }

  // Pick the test whose difficulty is closest to a target band.
  function nearestTest(band, versionFilter) {
    const pool = tests.filter((t) => t.version === versionFilter && t.difficulty != null);
    if (!pool.length) return null;
    pool.sort((a, b) => Math.abs(a.difficulty - band) - Math.abs(b.difficulty - band));
    return pool[0];
  }

  // After a result, adjust the adaptive band and continue.
  function adaptiveNext(result) {
    const accuracy = result.accuracy || 0;
    let next = adaptive.band;
    if (accuracy >= 80) next = Math.min(9, next + 0.5);
    else if (accuracy <= 50) next = Math.max(4.5, next - 0.5);
    const dir = accuracy >= 80 ? "harder" : accuracy <= 50 ? "easier" : "same";
    return { next, dir, accuracy };
  }

  // ---------- Landing ----------
  async function renderLanding() {
    const wrap = document.getElementById("reading-wrap");
    wrap.innerHTML = `<div class="loading">Loading…</div>`;
    let data = { tests: [] };
    try {
      const r = await fetch(apiUrl("/api/tests/reading"));
      data = await r.json();
      tests = data.tests;
    } catch (_) {}

    const history = Store.history.list().filter((r) => r.testType === "reading");
    const prev = history.slice(0, 5).map((r) => `
      <div class="activity-row">
        <div><div class="activity-label">${esc(r.title || "Reading")}</div>
        <div class="activity-date">${new Date(r.date).toLocaleDateString()} · ${r.correct}/${r.total}</div></div>
        <div class="activity-band">${fmtBand(r.band)}</div>
      </div>`).join("") || '<p class="hint">No reading tests yet.</p>';

    const filtered = tests.filter((t) => t.version === version);
    const cards = filtered.map((t) => `
      <div class="test-card">
        <div class="test-card-head"><span class="mode-emoji">📖</span>
          <div><div class="test-title">${esc(t.title)}</div>
          <div class="test-meta">${t.version === "general" ? "General Training" : "Academic"} · ${t.questionCount} questions · ${Math.round(t.duration / 60)} min</div></div>
        </div>
        ${t.difficulty ? `<span class="diff-badge" title="Approximate difficulty (readability heuristic)">Band ${fmtBand(t.difficulty)}</span>` : ""}
        <button class="btn btn-primary" data-start="${t.id}">Start test</button>
      </div>`).join("");

    const startBand = readingBand();
    wrap.innerHTML = `
      <div class="module-head">
        <h1>IELTS Reading</h1>
        <p class="sub">3 sections, 40 questions, 60 minutes in the real test. Practise Academic or General Training.</p>
      </div>

      <div class="card adaptive-card">
        <h2>🎯 Adaptive Practice</h2>
        <p class="criterion-comment">The difficulty adjusts to you: answer correctly and it gets harder, struggle and it gets easier — a more credible way to estimate your real band.</p>
        <div class="adaptive-row">
          <span class="criterion-comment">Current level: <b>Band ${fmtBand(startBand)}</b></span>
          <button class="btn btn-primary" id="adaptive-start">Start adaptive session</button>
        </div>
      </div>

      <div class="seg-toggle" role="tablist">
        <button class="seg ${version === "academic" ? "on" : ""}" data-ver="academic" role="tab" aria-selected="${version === "academic"}">Academic Reading</button>
        <button class="seg ${version === "general" ? "on" : ""}" data-ver="general" role="tab" aria-selected="${version === "general"}">General Training</button>
      </div>

      <div class="card">
        <h2>Practice Tests</h2>
        <div class="test-list">${cards || '<p class="hint">No tests available for this version yet.</p>'}</div>
      </div>

      <div class="card">
        <h2>Previous Results</h2>
        ${prev}
      </div>`;

    wrap.querySelectorAll("[data-ver]").forEach((b) => {
      b.addEventListener("click", () => { version = b.dataset.ver; renderLanding(); });
    });
    wrap.querySelectorAll("[data-start]").forEach((b) => {
      b.addEventListener("click", () => startTest(b.dataset.start));
    });
    const adaptiveBtn = wrap.querySelector("#adaptive-start");
    if (adaptiveBtn) adaptiveBtn.addEventListener("click", () => {
      adaptive = { active: true, band: readingBand(), version };
      const t = nearestTest(adaptive.band, version);
      if (t) startTest(t.id, { adaptive: true });
      else toast("No difficulty-tagged tests available for this version yet.", true);
    });
  }

  // ---------- Test ----------
  async function startTest(testId, opts = {}) {
    const wrap = opts.container || document.getElementById("reading-wrap");
    wrap.innerHTML = `<div class="loading">Loading test…</div>`;
    let test;
    try {
      const r = await fetch(apiUrl(`/api/tests/reading/${testId}`));
      test = await r.json();
    } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not load the test. Please try again.</div>`;
      return;
    }

    const flat = [];
    test.sections.forEach((s) => s.questions.forEach((q) => flat.push(q)));

    state = {
      test,
      flat,
      answers: {},   // qid -> value (string | array)
      reviewed: {},  // qid -> bool
      current: 0,
      timer: null,
      version: test.version,
      opts,
    };

    renderTestUI();
    state.timer = createTimer({
      key: "readingEnd_" + testId,
      duration: test.duration,
      onTick: (t) => { const el = document.getElementById("reading-timer"); if (el) el.textContent = t; },
      onExpire: () => { toast("Time is up — submitting your test.", true); submitTest(); },
    });
    state.timer.start();
  }

  function currentQuestion() {
    return state.flat[state.current];
  }

  function renderTestUI() {
    const wrap = state.opts.container || document.getElementById("reading-wrap");
    const q = currentQuestion();
    const answeredCount = state.flat.filter((x) => {
      const v = state.answers[x.id];
      return v !== undefined && (Array.isArray(v) ? v.some((s) => String(s).trim() !== "") : String(v).trim() !== "");
    }).length;

    wrap.innerHTML = `
      <div class="test-header">
        <div class="test-header-left">
          ${state.opts.mockMode ? "" : `<button class="btn-icon" id="read-exit" title="Exit test">✕</button>`}
          <div><div class="test-title">${esc(state.test.title)}</div>
          <div class="test-meta">${answeredCount}/${state.flat.length} answered</div></div>
        </div>
        <div class="timer-pill" id="reading-timer">--:--</div>
      </div>

      <div class="reading-layout">
        <div class="passage-pane">
          ${state.test.sections.map((s) => `
            <div class="passage">
              <h3>${esc(s.heading || "Reading Passage")}</h3>
              <p>${esc(s.passage).replace(/\n/g, "</p><p>")}</p>
            </div>`).join("")}
        </div>

        <div class="question-pane">
          <div class="question-view" id="reading-question"></div>
          <div class="qnav-wrap">
            <div class="qnav-head">Questions</div>
            <div id="reading-navigator"></div>
          </div>
          <div class="question-actions">
            <button class="btn btn-ghost" id="read-prev" ${state.current === 0 ? "disabled" : ""}>← Prev</button>
            <button class="btn btn-ghost" id="read-review">📌 Mark for review</button>
            <button class="btn btn-ghost" id="read-clear">Clear</button>
            <button class="btn btn-primary" id="read-next">Next →</button>
          </div>
          <button class="btn btn-danger btn-block" id="read-submit">Submit test</button>
        </div>
      </div>`;

    renderCurrentQuestion();
    renderNav();

    document.getElementById("read-prev").addEventListener("click", () => { state.current = Math.max(0, state.current - 1); renderTestUI(); });
    document.getElementById("read-next").addEventListener("click", () => {
      if (state.current >= state.flat.length - 1) { submitTest(); return; }
      state.current += 1; renderTestUI();
    });
    document.getElementById("read-review").addEventListener("click", () => {
      state.reviewed[q.id] = !state.reviewed[q.id]; renderNav();
    });
    document.getElementById("read-clear").addEventListener("click", () => {
      delete state.answers[q.id]; renderTestUI();
    });
    document.getElementById("read-submit").addEventListener("click", () => {
      const answered = Object.keys(state.answers).length;
      confirmSubmit({ answered, total: state.flat.length, onConfirm: submitTest });
    });
    const exitBtn = document.getElementById("read-exit");
    if (exitBtn) exitBtn.addEventListener("click", () => {
      if (confirm("Exit this test? Your answers will be lost.")) { cleanup(); renderLanding(); }
    });
  }

  function renderCurrentQuestion() {
    const q = currentQuestion();
    const container = document.getElementById("reading-question");
    container.appendChild(renderQuestion(q, state.current, state.answers[q.id], (val) => {
      state.answers[q.id] = val;
      renderNav();
      const nav = document.getElementById("reading-navigator");
      // update answered count label
      const answeredCount = state.flat.filter((x) => state.answers[x.id] !== undefined).length;
      const meta = document.querySelector(".test-meta");
      if (meta) meta.textContent = `${answeredCount}/${state.flat.length} answered`;
    }));
  }

  function renderNav() {
    const answered = state.flat.map((x) => state.answers[x.id]);
    const reviewed = state.flat.map((x) => !!state.reviewed[x.id]);
    renderNavigator({
      container: document.getElementById("reading-navigator"),
      count: state.flat.length,
      answers: answered,
      reviewed,
      current: state.current,
      onJump: (i) => { state.current = i; renderTestUI(); },
    });
  }

  async function submitTest() {
    if (!state) return;
    if (state.timer) state.timer.destroy();
    const wrap = state.opts.container || document.getElementById("reading-wrap");
    wrap.innerHTML = `<div class="loading">Marking your answers…</div>`;
    try {
      const result = await api(`/api/tests/reading/${state.test.id}/submit`, { answers: state.answers });
      Store.history.add({
        testType: "reading", version: state.version, title: result.title,
        reading: result.band, overall: result.band, correct: result.correct,
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
    const wrap = document.getElementById("reading-wrap");
    const review = (r.review || []).map((x, i) => `
      <div class="review-row ${x.correct ? "ok" : "bad"}">
        <div class="review-q">${i + 1}. ${esc(x.question)}</div>
        <div class="review-ans"><span>Your answer:</span> ${fmtAns(x.userAnswer) || "—"}</div>
        <div class="review-ans"><span>Correct answer:</span> ${fmtAns(x.correctAnswer)}</div>
      </div>`).join("");

    // Adaptive session continuation.
    let adaptiveBlock = "";
    if (adaptive.active) {
      const { next, dir } = adaptiveNext(r);
      adaptive.band = next;
      const label = dir === "harder" ? "⬆️ Harder" : dir === "easier" ? "⬇️ Easier" : "➡️ Same level";
      adaptiveBlock = `
        <div class="card adaptive-card">
          <h2>🎯 Adaptive Next Step</h2>
          <p class="criterion-comment">Accuracy ${r.accuracy}% → ${label}. Next difficulty: <b>Band ${fmtBand(next)}</b></p>
          <div class="adaptive-row">
            <button class="btn btn-primary" id="adaptive-continue">Continue → Band ${fmtBand(next)}</button>
            <button class="btn btn-ghost" id="adaptive-stop">Stop adaptive</button>
          </div>
        </div>`;
    }

    wrap.innerHTML = `
      <div class="result-header">
        <div class="band-badge">Reading Result
          <div style="margin:6px 0 0"><span class="band">${fmtBand(r.band)}</span></div>
        </div>
        <div class="result-sub">AI Estimated Reading Band · ${esc(r.title)}</div>
        <div class="result-sub" style="font-size:12px;color:var(--muted)">This is an estimated practice band, not an official IELTS score.</div>
      </div>
      <div class="result-stats">
        <div class="rstat"><div class="rstat-num">${r.correct}/${r.total}</div><div class="rstat-label">Correct</div></div>
        <div class="rstat"><div class="rstat-num">${r.accuracy}%</div><div class="rstat-label">Accuracy</div></div>
        <div class="rstat"><div class="rstat-num">${r.unanswered}</div><div class="rstat-label">Unanswered</div></div>
      </div>
      ${adaptiveBlock}
      <div class="card"><h2>Review</h2>${review}</div>
      <div class="actions-row">
        <button class="btn btn-primary" id="read-again">Try another test</button>
        <button class="btn btn-ghost" id="read-dash">Back to dashboard</button>
      </div>`;
    document.getElementById("read-again").addEventListener("click", renderLanding);
    document.getElementById("read-dash").addEventListener("click", () => Go.nav("dashboard"));
    const cont = document.getElementById("adaptive-continue");
    if (cont) cont.addEventListener("click", () => {
      const t = nearestTest(adaptive.band, adaptive.version);
      if (t) startTest(t.id, { adaptive: true });
      else { adaptive.active = false; renderLanding(); }
    });
    const stop = document.getElementById("adaptive-stop");
    if (stop) stop.addEventListener("click", () => { adaptive.active = false; renderLanding(); });
  }

  function fmtAns(a) {
    if (Array.isArray(a)) return a.join(", ") || "—";
    return a || "—";
  }

  function cleanup() {
    if (state && state.timer) state.timer.destroy();
    state = null;
  }

  return { renderLanding, startTest };
})();

registerRenderer("reading", () => Reading.renderLanding());
