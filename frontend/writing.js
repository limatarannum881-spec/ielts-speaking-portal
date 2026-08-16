/* =====================================================================
   Writing module — Task 1 & Task 2 practice with word count, timer,
   draft saving and AI evaluation against the four IELTS criteria.
   ===================================================================== */

"use strict";

const Writing = (() => {
  let version = "academic";
  let prompts = null;
  let state = null; // {task, prompt, timer}

  async function loadPrompts() {
    if (prompts) return prompts;
    const r = await fetch(apiUrl("/api/tests/writing"));
    prompts = await r.json();
    return prompts;
  }

  function setVersion(v) { version = v; }
  async function ensureLoaded() { await loadPrompts(); }
  function getPrompts() { return prompts ? prompts[version] : null; }

  async function renderLanding() {
    const wrap = document.getElementById("writing-wrap");
    wrap.innerHTML = `<div class="loading">Loading…</div>`;
    try { await loadPrompts(); } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not load writing prompts.</div>`;
      return;
    }

    const p = prompts[version];
    const draft = Store.get("ielts_writing_draft", null);

    const task1 = p.task1.map((t) => card(t, "Task 1")).join("");
    const task2 = p.task2.map((t) => card(t, "Task 2")).join("");

    const history = Store.history.list().filter((r) => r.testType === "writing").slice(0, 5);
    const prev = history.map((r) => `
      <div class="activity-row">
        <div><div class="activity-label">${esc(r.title || "Writing")}</div>
        <div class="activity-date">${new Date(r.date).toLocaleDateString()}</div></div>
        <div class="activity-band">${fmtBand(r.band)}</div>
      </div>`).join("") || '<p class="hint">No writing submissions yet.</p>';

    wrap.innerHTML = `
      <div class="module-head">
        <h1>IELTS Writing</h1>
        <p class="sub">Task 1 (150+ words, ~20 min) and Task 2 (250+ words, ~40 min). Task 2 is weighted double.</p>
      </div>

      <div class="seg-toggle" role="tablist">
        <button class="seg ${version === "academic" ? "on" : ""}" data-ver="academic">Academic</button>
        <button class="seg ${version === "general" ? "on" : ""}" data-ver="general">General Training</button>
      </div>

      ${draft ? `<div class="card draft-banner">
        📝 You have a saved draft. <button class="btn btn-primary btn-sm" id="resume-draft">Resume draft</button>
      </div>` : ""}

      <div class="card"><h2>Task 1 · ${version === "general" ? "Letter" : "Report"} (min 150 words)</h2>
        <div class="test-list">${task1}</div></div>
      <div class="card"><h2>Task 2 · Essay (min 250 words)</h2>
        <div class="test-list">${task2}</div></div>
      <div class="card"><h2>Previous Results</h2>${prev}</div>`;

    wrap.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => {
      version = b.dataset.ver; renderLanding();
    }));
    wrap.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.start;
      const task = b.dataset.task;
      openEditor(id, task);
    }));
    const resume = wrap.querySelector("#resume-draft");
    if (resume) resume.addEventListener("click", () => {
      openEditor(draft.id, draft.task, draft.essay);
    });
  }

  function card(t, task) {
    return `<div class="test-card">
      <div class="test-card-head">
        <div><div class="test-title">${esc(t.title)}</div>
        <div class="test-meta">${esc(t.type)} · ${task}</div></div>
      </div>
      <button class="btn btn-primary" data-start="${t.id}" data-task="${task}">Write answer</button>
    </div>`;
  }

  function openEditor(promptId, task, resumeEssay = "", onComplete = null, container = null) {
    const p = prompts[version];
    const prompt = [...p.task1, ...p.task2].find((x) => x.id === promptId);
    if (!prompt) return;

    const minWords = task === "Task 1" ? 150 : 250;
    const duration = task === "Task 1" ? 1200 : 2400;

    state = { task, prompt, minWords, timer: null, version, onComplete, container };

    const wrap = container || document.getElementById("writing-wrap");
    wrap.innerHTML = `
      <div class="test-header">
        <div class="test-header-left">
          <button class="btn-icon" id="write-exit" title="Back">✕</button>
          <div><div class="test-title">${task} · ${esc(prompt.title)}</div>
          <div class="test-meta">${version === "general" ? "General Training" : "Academic"}</div></div>
        </div>
        <div class="timer-pill" id="writing-timer">--:--</div>
      </div>

      <div class="writing-layout">
        <div class="writing-prompt card">
          <h3>Prompt</h3>
          <p style="white-space:pre-wrap">${esc(prompt.prompt)}</p>
          ${prompt.chart ? renderChart(prompt.chart) : ""}
        </div>
        <div class="writing-editor card">
          <div class="editor-bar">
            <span id="word-count" class="word-count">0 words</span>
            <span class="test-meta">min ${minWords}</span>
            <button class="btn btn-ghost btn-sm" id="write-save">💾 Save draft</button>
          </div>
          <textarea id="writing-textarea" class="writing-textarea" placeholder="Write your answer here…" aria-label="Your answer">${resumeEssay ? esc(resumeEssay) : ""}</textarea>
          <div id="word-warning" class="warn-text hidden"></div>
          <button class="btn btn-primary btn-block" id="write-submit">Submit for AI evaluation</button>
        </div>
      </div>`;

    const ta = document.getElementById("writing-textarea");
    ta.addEventListener("input", () => {
      const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      document.getElementById("word-count").textContent = `${words} words`;
      const warn = document.getElementById("word-warning");
      if (words > 0 && words < minWords) {
        warn.classList.remove("hidden");
        warn.textContent = `⚠️ Your answer is ${words} words — the minimum is ${minWords}. You can still submit.`;
      } else {
        warn.classList.add("hidden");
      }
    });
    ta.dispatchEvent(new Event("input"));

    document.getElementById("write-save").addEventListener("click", () => {
      Store.set("ielts_writing_draft", { id: prompt.id, task, essay: ta.value, version });
      toast("Draft saved.");
    });
    document.getElementById("write-exit").addEventListener("click", () => {
      if (confirm("Back to writing topics? (Save a draft first if you want to keep your work.)")) { cleanup(); renderLanding(); }
    });
    document.getElementById("write-submit").addEventListener("click", () => submitEssay(ta.value));

    state.timer = createTimer({
      key: "writingEnd_" + prompt.id,
      duration,
      onTick: (t) => { const el = document.getElementById("writing-timer"); if (el) el.textContent = t; },
      onExpire: () => { toast("Time is up — submitting your answer.", true); submitEssay(ta.value); },
    });
    state.timer.start();
  }

  function renderChart(chart) {
    const w = 340, h = 180, pad = 30;
    const data = (chart && chart.data) || [];
    if (!data.length) return ""; // no data → no chart (don't crash)
    const max = Math.max(...data.map((d) => d.value)) || 1;
    let svg = "";
    if (chart.kind === "bar") {
      const bw = (w - pad * 2) / data.length;
      data.forEach((d, i) => {
        const bh = ((h - pad * 2) * d.value) / max;
        const x = pad + i * bw + bw * 0.2;
        const y = h - pad - bh;
        svg += `<rect x="${x}" y="${y}" width="${bw * 0.6}" height="${bh}" rx="4" fill="#4f46e5"/>`;
        svg += `<text x="${x + bw * 0.3}" y="${h - pad + 14}" font-size="10" text-anchor="middle" fill="#6b7385">${d.label}</text>`;
        svg += `<text x="${x + bw * 0.3}" y="${y - 5}" font-size="10" text-anchor="middle" fill="#1e2433">${d.value}</text>`;
      });
    } else if (chart.kind === "line") {
      const pts = data.map((d, i) => {
        const x = pad + ((w - pad * 2) * i) / (data.length - 1);
        const y = h - pad - ((h - pad * 2) * d.value) / max;
        return `${x},${y}`;
      });
      svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="#4f46e5" stroke-width="3"/>`;
      data.forEach((d, i) => {
        const [x, y] = pts[i].split(",").map(Number);
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5"/>`;
        svg += `<text x="${x}" y="${h - pad + 14}" font-size="10" text-anchor="middle" fill="#6b7385">${d.label}</text>`;
      });
    }
    return `<div class="chart-box">
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="auto" role="img" aria-label="Chart">${svg}</svg>
    </div>`;
  }

  async function submitEssay(essay) {
    if (!state) return;
    if (!essay.trim()) { toast("Please write your answer before submitting.", true); return; }
    if (state.timer) state.timer.destroy();
    const wrap = state.container || document.getElementById("writing-wrap");
    wrap.innerHTML = `<div class="loading">AI is evaluating your writing…</div>`;
    try {
      const result = await api("/api/tests/writing/evaluate", {
        task: state.task, prompt: state.prompt.prompt, essay,
      });
      // Remove the saved draft once submitted.
      Store.set("ielts_writing_draft", null);
      Store.history.add({
        testType: "writing", version: state.version, title: state.prompt.title,
        task: state.task,
        taskType: state.prompt.type || null,
        writing: result.overallBand, overall: result.overallBand, status: "completed",
      });
      const cb = state.onComplete;
      cleanup();
      if (cb) cb(result);
      else renderResult(result);
    } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not evaluate your writing. Please try again.</div>`;
    }
  }

  function renderResult(r) {
    const wrap = document.getElementById("writing-wrap");
    const crit = [
      ["taskAchievement", r.task === "Task 1" ? "Task Achievement" : "Task Response"],
      ["coherence", "Coherence & Cohesion"],
      ["lexicalResource", "Lexical Resource"],
      ["grammar", "Grammatical Range & Accuracy"],
    ];
    const critRows = crit.map(([k, label]) => `
      <div class="bar-row">
        <div class="bar-label"><span>${label}</span><span class="val">${fmtBand(r[k])}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r[k] / 9) * 100}%"></div></div>
      </div>`).join("");

    const corrections = (r.corrections || []).map((c) => `
      <div class="correction"><span class="tag grammar">Correction</span>
        <div class="orig">“${esc(c.original)}”</div>
        <div class="fix">→ “${esc(c.correction)}”</div>
        <div class="expl">${esc(c.explanation || "")}</div>
      </div>`).join("");

    const vocab = (r.vocabulary || []).map((v) => `
      <div class="vocab-row"><span class="from">“${esc(v.word)}”</span> → <span class="to">${esc((v.better || []).join(", "))}</span></div>`).join("");

    wrap.innerHTML = `
      <div class="result-header">
        <div class="band-badge">Writing Result
          <div style="margin:6px 0 0"><span class="band">${fmtBand(r.overallBand)}</span></div>
        </div>
        <div class="result-sub">AI Estimated Writing Band · ${esc(r.task)} · ${r.wordCount} words</div>
        <div class="result-sub" style="font-size:12px;color:var(--muted)">AI estimate for practice — not an official IELTS score.</div>
      </div>
      <div class="card"><h2>Criteria</h2>${critRows}</div>
      <div class="card"><h2>✅ Strengths</h2><ul class="plain">${(r.strengths || []).map((s) => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ul></div>
      <div class="card"><h2>⚠️ Weaknesses</h2><ul class="plain">${(r.weaknesses || []).map((s) => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ul></div>
      ${corrections ? `<div class="card"><h2>Sentence-level corrections</h2>${corrections}</div>` : ""}
      ${vocab ? `<div class="card"><h2>Vocabulary improvements</h2>${vocab}</div>` : ""}
      ${r.organization ? `<div class="card"><h2>Paragraph organization</h2><p class="criterion-comment">${esc(r.organization)}</p></div>` : ""}
      <div class="card"><h2>🎯 How to reach the next band</h2><ul class="plain">${(r.improvementPlan || []).map((s) => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ul></div>
      <div class="actions-row">
        <button class="btn btn-primary" id="write-again">Another task</button>
        <button class="btn btn-ghost" id="write-dash">Back to dashboard</button>
      </div>`;
    document.getElementById("write-again").addEventListener("click", renderLanding);
    document.getElementById("write-dash").addEventListener("click", () => Go.nav("dashboard"));
  }

  function cleanup() {
    if (state && state.timer) state.timer.destroy();
    state = null;
  }

  return { renderLanding, setVersion, ensureLoaded, getPrompts, openEditor };
})();

registerRenderer("writing", () => Writing.renderLanding());
