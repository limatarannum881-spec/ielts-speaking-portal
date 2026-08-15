/* =====================================================================
   Full IELTS Mock Test — orchestrates Listening → Reading → Writing →
   Speaking in one continuous session, then shows the final result.
   Reuses the existing Speaking engine (no second Speaking implementation).
   ===================================================================== */

"use strict";

function roundBand(avg) {
  const halves = Math.round(avg * 2) / 2;
  const frac = Math.round((avg - Math.floor(avg)) * 100) / 100;
  if (frac >= 0.25 && frac < 0.5) return Math.floor(avg) + 0.5;
  if (frac >= 0.75) return Math.floor(avg) + 1.0;
  return halves;
}
function writingBand(t1, t2) { return roundBand((t1 + 2 * t2) / 3); }

const MockFlow = {
  active: false,
  ctx: null,

  // ---------- Step 1: setup ----------
  renderSetup() {
    this.active = false;
    this.ctx = null;
    const wrap = document.getElementById("mock-wrap");
    const profile = Store.profile.get();
    wrap.innerHTML = `
      <div class="module-head">
        <h1>🏆 Full IELTS Mock Test</h1>
        <p class="sub">Complete all four modules in one continuous session: Listening → Reading → Writing → Speaking.</p>
      </div>

      <div class="card mock-setup">
        <h2>Test setup</h2>
        <div class="field-row">
          <label class="field-label">Test version</label>
          <div class="seg-toggle">
            <button class="seg on" id="mock-ver-academic">Academic</button>
            <button class="seg" id="mock-ver-general">General Training</button>
          </div>
        </div>
        <div class="field-row">
          <label class="field-label" for="mock-target">Target band</label>
          <select id="mock-target" class="text-input">
            ${[6.0, 6.5, 7.0, 7.5, 8.0, 8.5].map((b) => `<option value="${b}" ${b === profile.targetBand ? "selected" : ""}>${b.toFixed(1)}</option>`).join("")}
          </select>
        </div>
        <div class="criterion-comment">Your test will contain <b>Listening, Reading, Writing and Speaking</b>. Once you begin, you cannot restart a section.</div>
        <button class="btn btn-primary btn-big" id="mock-begin">Begin test</button>
      </div>`;

    let version = "academic";
    wrap.querySelector("#mock-ver-academic").addEventListener("click", () => { version = "academic"; wrap.querySelectorAll(".seg").forEach((s) => s.classList.remove("on")); wrap.querySelector("#mock-ver-academic").classList.add("on"); });
    wrap.querySelector("#mock-ver-general").addEventListener("click", () => { version = "general"; wrap.querySelectorAll(".seg").forEach((s) => s.classList.remove("on")); wrap.querySelector("#mock-ver-general").classList.add("on"); });
    wrap.querySelector("#mock-begin").addEventListener("click", () => {
      const target = parseFloat(document.getElementById("mock-target").value);
      Store.profile.set({ targetBand: target, version });
      this.begin(version, target);
    });
  },

  begin(version, targetBand) {
    this.active = true;
    this.ctx = {
      version,
      targetBand,
      results: {},       // listening/reading/writing/speaking bands
      writing: { t1: null, t2: null },
      speaking: null,
      startedAt: Date.now(),
    };
    window.setNavHidden(true);
    this.showProgress(0, "Listening");
    this.runListening();
  },

  showProgress(step, label) {
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `
      <div class="mock-progress">
        <div class="progress-track"><div class="progress-fill" style="width:${step * 25}%"></div></div>
        <div class="progress-steps">
          ${["Listening", "Reading", "Writing", "Speaking"].map((s, i) =>
            `<span class="step ${i < step ? "done" : i === step ? "now" : ""}">${i < step ? "✓" : i + 1} ${s}</span>`).join("")}
        </div>
      </div>
      <div class="loading" style="text-align:center;padding:30px">${label}…</div>`;
  },

  // ---------- Step 2: Listening ----------
  runListening() {
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `<div class="loading">Loading Listening…</div>`;
    Listening.startTest("listening-001", {
      mockMode: true,
      container: wrap,
      onComplete: (result) => this.onListeningDone(result),
    });
  },

  onListeningDone(result) {
    this.ctx.results.listening = result.band;
    this.showProgress(1, "Reading");
    this.runReading();
  },

  // ---------- Step 3: Reading ----------
  runReading() {
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `<div class="loading">Loading Reading…</div>`;
    const testId = this.ctx.version === "general" ? "general-reading-001" : "academic-reading-001";
    Reading.startTest(testId, {
      mockMode: true,
      container: wrap,
      onComplete: (result) => this.onReadingDone(result),
    });
  },

  onReadingDone(result) {
    this.ctx.results.reading = result.band;
    this.showProgress(2, "Writing");
    this.runWriting();
  },

  // ---------- Step 4: Writing ----------
  async runWriting() {
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `<div class="loading">Loading Writing…</div>`;
    Writing.setVersion(this.ctx.version);
    try { await Writing.ensureLoaded(); } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not load writing prompts.</div>`;
      return;
    }
    const prompts = Writing.getPrompts();
    const t1 = prompts.task1[0];
    const t2 = prompts.task2[0];

    // Show an interstitial between the two writing tasks.
    const interstitial = (text, next) => {
      wrap.innerHTML = `<div class="card" style="text-align:center;padding:40px">
        <div style="font-size:40px">✍️</div><p style="margin:12px 0">${esc(text)}</p>
        <button class="btn btn-primary btn-big" id="mock-next">Continue</button></div>`;
      wrap.querySelector("#mock-next").addEventListener("click", next);
    };

    interstitial(`Writing Task 1 (min 150 words). You'll then complete Task 2 (min 250 words).`, () => {
      Writing.openEditor(t1.id, "Task 1", "", (r1) => {
        this.ctx.writing.t1 = r1.overallBand;
        interstitial("Great. Now Writing Task 2 (min 250 words). Task 2 is weighted double in your score.", () => {
          Writing.openEditor(t2.id, "Task 2", "", (r2) => {
            this.ctx.writing.t2 = r2.overallBand;
            this.ctx.results.writing = writingBand(r1.overallBand, r2.overallBand);
            this.showProgress(3, "Speaking");
            this.runSpeaking();
          }, wrap);
        });
      }, wrap);
    });
  },

  // ---------- Step 5: Speaking (reuse existing engine) ----------
  runSpeaking() {
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:40px">🎙️</div>
      <h2 style="margin:12px 0">Speaking Test</h2>
      <p class="criterion-comment">The AI examiner will now interview you: Part 1 → Part 2 → Part 3. Use your microphone.</p>
      <button class="btn btn-primary btn-big" id="mock-speaking-start">Start speaking</button></div>`;
    wrap.querySelector("#mock-speaking-start").addEventListener("click", () => {
      // Reuse the existing Speaking mock flow (Part 1 → 2 → 3).
      startSession("mock");
    });
  },

  // Called by app.js endSession when MockFlow is active.
  onSpeakingDone(result) {
    this.ctx.speaking = result;
    this.ctx.results.speaking = result.overall_band;
    this.finish();
  },

  // ---------- Final result ----------
  async finish() {
    const ctx = this.ctx;
    window.setNavHidden(false);
    const wrap = document.getElementById("mock-wrap");
    wrap.innerHTML = `<div class="loading">Calculating your overall result…</div>`;

    let overall = null;
    try {
      const r = await api("/api/tests/score/overall", {
        listening: ctx.results.listening || 0,
        reading: ctx.results.reading || 0,
        writing: ctx.results.writing || 0,
        speaking: ctx.results.speaking || 0,
      });
      overall = r.overall;
    } catch (_) {
      overall = roundBand(((ctx.results.listening || 0) + (ctx.results.reading || 0) + (ctx.results.writing || 0) + (ctx.results.speaking || 0)) / 4);
    }

    const duration = Math.round((Date.now() - ctx.startedAt) / 60000) + " min";
    Store.history.add({
      testType: "full", version: ctx.version, targetBand: ctx.targetBand,
      listening: ctx.results.listening, reading: ctx.results.reading,
      writing: ctx.results.writing, speaking: ctx.results.speaking,
      overall, duration, status: "completed",
    });

    const skills = [
      ["listening", "Listening", ctx.results.listening],
      ["reading", "Reading", ctx.results.reading],
      ["writing", "Writing", ctx.results.writing],
      ["speaking", "Speaking", ctx.results.speaking],
    ];
    const maxBand = Math.max(...skills.map((s) => s[2] || 0));
    const minSkill = skills.reduce((a, b) => ((a[2] || 9) <= (b[2] || 9) ? a : b));
    const maxSkill = skills.reduce((a, b) => ((a[2] || 0) >= (b[2] || 0) ? a : b));

    const gap = ctx.targetBand - overall;
    const focus = skills.slice().sort((a, b) => (a[2] || 0) - (b[2] || 0)).slice(0, 2).map((s) => s[1]);

    const bars = skills.map(([k, label, band]) => `
      <div class="bar-row">
        <div class="bar-label"><span>${label}</span><span class="val">${fmtBand(band)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(band / 9) * 100}%"></div></div>
      </div>`).join("");

    wrap.innerHTML = `
      <div class="result-header">
        <div class="card-kicker">YOUR IELTS ESTIMATED RESULT</div>
        <div class="band-badge">Overall Band
          <div style="margin:6px 0 0"><span class="band">${fmtBand(overall)}</span></div>
        </div>
        <div class="result-sub">AI Estimated Band · Full Mock Test · ${ctx.version === "general" ? "General Training" : "Academic"}</div>
        <div class="result-sub" style="font-size:12px;color:var(--muted)">This is an AI estimate, not an official IELTS score.</div>
      </div>

      <div class="card"><h2>Module Scores</h2>${bars}</div>

      <div class="dash-grid">
        <div class="card">
          <h2>Summary</h2>
          <table class="bands">
            <tr><td>Average score</td><td class="band-cell">${fmtBand(overall)}</td></tr>
            <tr><td>Target score</td><td class="band-cell">${fmtBand(ctx.targetBand)}</td></tr>
            <tr><td>Score gap</td><td class="band-cell">${gap > 0 ? "+" + gap.toFixed(1) : gap.toFixed(1)}</td></tr>
            <tr><td>Strongest skill</td><td class="band-cell">${maxSkill[1]}</td></tr>
            <tr><td>Weakest skill</td><td class="band-cell">${minSkill[1]}</td></tr>
          </table>
        </div>
        <div class="card">
          <h2>Recommended focus</h2>
          <ol class="plain">
            ${focus.map((f) => `<li>${f}</li>`).join("")}
          </ol>
          <p class="criterion-comment" style="margin-top:10px">Work on your weakest skills first to raise your overall band.</p>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-primary" id="mock-dash">Go to dashboard</button>
        <button class="btn btn-ghost" id="mock-history">View history</button>
      </div>`;

    wrap.querySelector("#mock-dash").addEventListener("click", () => Go.nav("dashboard"));
    wrap.querySelector("#mock-history").addEventListener("click", () => Go.nav("results"));

    this.active = false;
  },
};

registerRenderer("mock", () => MockFlow.renderSetup());
window.MockFlow = MockFlow;
