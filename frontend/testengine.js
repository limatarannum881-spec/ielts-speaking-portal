/* =====================================================================
   Test Engine — reusable timer, progress bar, question navigator,
   question renderer and submit dialog. Used by Reading + Listening.
   ===================================================================== */

"use strict";

// ----------------------------------------------------------------------
// Timer — remaining time computed from a persisted end-timestamp so a
// refresh cannot reset it.
// ----------------------------------------------------------------------
function createTimer({ key, duration, onTick, onExpire, tickMs = 1000 }) {
  let endTime = null;
  let interval = null;

  function persist() {
    if (key) Store.active.set(Object.assign(Store.active.get() || {}, { [key]: endTime }));
  }
  function restore() {
    const s = Store.active.get();
    return (s && s[key]) || null;
  }

  function remainingMs() {
    return Math.max(0, endTime - Date.now());
  }

  function fmt(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function start() {
    endTime = restore() || (Date.now() + duration * 1000);
    persist();
    if (onTick) onTick(fmt(remainingMs()));
    clearInterval(interval);
    interval = setInterval(() => {
      const rem = remainingMs();
      if (onTick) onTick(fmt(rem));
      if (rem <= 0) {
        stop();
        if (onExpire) onExpire();
      }
    }, tickMs);
  }

  function stop() {
    clearInterval(interval);
    interval = null;
  }

  function destroy() {
    stop();
    if (key) {
      const s = Store.active.get() || {};
      delete s[key];
      Store.active.set(s);
    }
  }

  return { start, stop, destroy, remainingMs, fmt };
}

// ----------------------------------------------------------------------
// Question navigator — grid of numbered buttons with answered / reviewed /
// current state. Does NOT rely on colour alone (uses ✓/✗/? glyphs + aria).
// ----------------------------------------------------------------------
function renderNavigator({ container, count, answers, current, reviewed, onJump }) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "qnavigator";
  wrap.setAttribute("role", "list");
  for (let i = 0; i < count; i++) {
    const b = document.createElement("button");
    b.className = "qnav-btn";
    b.type = "button";
    const answered = answers[i] !== undefined && String(answers[i]).trim() !== "";
    const isReviewed = reviewed[i];
    b.classList.toggle("answered", answered);
    b.classList.toggle("reviewed", isReviewed);
    b.classList.toggle("current", i === current);
    const mark = answered ? "✓" : "";
    const rev = isReviewed ? "?" : "";
    b.innerHTML = `<span>${i + 1}</span><i>${mark}${rev}</i>`;
    b.setAttribute("aria-label", `Question ${i + 1}${answered ? ", answered" : ", unanswered"}${isReviewed ? ", marked for review" : ""}`);
    b.addEventListener("click", () => onJump(i));
    wrap.appendChild(b);
  }
  container.appendChild(wrap);
}

// ----------------------------------------------------------------------
// Question renderer — dynamically renders each question type.
// `value` = current answer; `onChange(newValue)` persists it.
// ----------------------------------------------------------------------
function renderQuestion(question, index, value, onChange) {
  const el = document.createElement("div");
  el.className = "question-block";

  const head = document.createElement("div");
  head.className = "q-head";
  head.innerHTML = `<span class="q-num">Question ${index + 1}</span>`;
  el.appendChild(head);

  const qtext = document.createElement("div");
  qtext.className = "q-text";
  qtext.textContent = question.question || question.prompt || question.text || "";
  el.appendChild(qtext);

  if (question.prompt && question.prompt !== question.question) {
    const p = document.createElement("div");
    p.className = "q-prompt";
    p.textContent = question.prompt;
    el.appendChild(p);
  }

  const type = question.type;
  const body = document.createElement("div");
  body.className = "q-body";

  if (type === "multiple-choice") {
    (question.options || []).forEach((opt, i) => {
      const label = document.createElement("label");
      label.className = "opt";
      const letter = String.fromCharCode(65 + i);
      const checked = normalize(value) === normalize(letter);
      label.innerHTML = `<input type="radio" name="q${index}" value="${letter}" ${checked ? "checked" : ""}>
        <span class="opt-letter">${letter}</span><span class="opt-text"></span>`;
      label.querySelector(".opt-text").textContent = opt;
      label.querySelector("input").addEventListener("change", () => onChange(letter));
      body.appendChild(label);
    });
  } else if (type === "true-false-not-given" || type === "yes-no-not-given") {
    const opts = type === "true-false-not-given" ? ["true", "false", "not-given"] : ["yes", "no", "not-given"];
    const labels = type === "true-false-not-given" ? ["True", "False", "Not Given"] : ["Yes", "No", "Not Given"];
    const row = document.createElement("div");
    row.className = "opt-row";
    opts.forEach((o, i) => {
      const label = document.createElement("label");
      label.className = "opt opt-inline";
      label.innerHTML = `<input type="radio" name="q${index}" value="${o}" ${normalize(value) === o ? "checked" : ""}><span>${labels[i]}</span>`;
      label.querySelector("input").addEventListener("change", () => onChange(o));
      row.appendChild(label);
    });
    body.appendChild(row);
  } else if (type === "matching-headings") {
    const opts = question.options || [];
    (question.subquestions || []).forEach((sub, si) => {
      const row = document.createElement("div");
      row.className = "match-row";
      const lbl = document.createElement("span");
      lbl.className = "match-label";
      lbl.textContent = `${si + 1}. ${sub.text}`;
      const sel = document.createElement("select");
      sel.className = "match-select";
      sel.innerHTML = `<option value="">— select —</option>` +
        opts.map((o) => `<option value="${o.charAt(0)}">${o}</option>`).join("");
      const cur = Array.isArray(value) ? value[si] : "";
      sel.value = cur ? String(cur).charAt(0) : "";
      sel.addEventListener("change", () => {
        const arr = (Array.isArray(value) ? value.slice() : new Array(question.subquestions.length).fill(""));
        arr[si] = sel.value;
        onChange(arr);
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      body.appendChild(row);
    });
  } else if (type === "form-completion") {
    (question.fields || []).forEach((f, fi) => {
      const row = document.createElement("div");
      row.className = "field-row";
      const lbl = document.createElement("label");
      lbl.className = "field-label";
      lbl.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "text-input";
      input.placeholder = "Your answer";
      input.value = Array.isArray(value) ? (value[fi] || "") : "";
      input.addEventListener("input", () => {
        const arr = (Array.isArray(value) ? value.slice() : new Array(question.fields.length).fill(""));
        arr[fi] = input.value;
        onChange(arr);
      });
      row.appendChild(lbl);
      row.appendChild(input);
      body.appendChild(row);
    });
  } else {
    // sentence-completion, short-answer, note-completion, etc.
    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.placeholder = "Type your answer";
    input.value = value || "";
    input.addEventListener("input", () => onChange(input.value));
    body.appendChild(input);
  }

  el.appendChild(body);
  return el;
}

function normalize(a) {
  return String(a == null ? "" : a).trim().toLowerCase().replace(/\s+/g, " ");
}

// ----------------------------------------------------------------------
// Submit dialog — accessible confirmation before submission.
// ----------------------------------------------------------------------
function confirmSubmit({ answered, total, onConfirm, onCancel }) {
  const unanswered = total - answered;
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="dialog">
      <h3>Submit test?</h3>
      <p>You have answered <b>${answered}</b> of <b>${total}</b> questions.
         ${unanswered > 0 ? `<span class="warn-text">${unanswered} unanswered.</span>` : ""}
         You cannot change your answers after submitting.</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" id="dlg-cancel">Keep working</button>
        <button class="btn btn-primary" id="dlg-confirm">Submit now</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#dlg-cancel").addEventListener("click", () => { overlay.remove(); onCancel && onCancel(); });
  overlay.querySelector("#dlg-confirm").addEventListener("click", () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); onCancel && onCancel(); } });
}
