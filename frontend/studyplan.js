/* =====================================================================
   Personalized Study Plan — turns your history (per-skill bands, weak
   task types, recent grammar errors) + target band + days-until-exam
   into a concrete day-by-day plan. Deterministic (no AI needed), so it's
   instant and always available.
   ===================================================================== */

"use strict";

const StudyPlan = (() => {
  const SKILL_META = {
    listening: { icon: "🎧", label: "Listening" },
    reading: { icon: "📖", label: "Reading" },
    writing: { icon: "✍️", label: "Writing" },
    speaking: { icon: "🎙️", label: "Speaking" },
  };
  const SKILL_ORDER = ["listening", "reading", "writing", "speaking"];

  function currentSkillBands(history) {
    const bands = {};
    SKILL_ORDER.forEach((s) => {
      const r = history.find((x) => typeof x[s] === "number");
      bands[s] = r ? r[s] : null;
    });
    return bands;
  }

  function weakTaskTypes(history) {
    const writingRecords = history.filter((r) => r.testType === "writing" && typeof r.writing === "number");
    const groups = {};
    writingRecords.forEach((r) => {
      const key = (r.taskType || "essay");
      const g = groups[key] || (groups[key] = { key, bands: [], count: 0 });
      g.bands.push(r.writing); g.count++;
    });
    return Object.values(groups)
      .filter((g) => g.count >= 2)
      .map((g) => ({ key: g.key, avg: g.bands.reduce((a, b) => a + b, 0) / g.bands.length, count: g.count }))
      .filter((g) => g.avg < 6.5)
      .sort((a, b) => a.avg - b.avg);
  }

  function recentGrammarErrors(history) {
    // Grab recent speaking/writing corrections if we stored them.
    // (We don't persist corrections yet, so this is a placeholder that
    //  returns [] until corrections are stored in history.)
    return [];
  }

  // Build a weighted rotation: weakest skill appears most often.
  function buildRotation(skillBands, days) {
    const entries = SKILL_ORDER
      .map((s) => ({ skill: s, band: skillBands[s] }))
      .filter((e) => e.band != null)
      .sort((a, b) => (a.band || 9) - (b.band || 9)); // weakest first
    // If some skills have no data, interleave them too.
    const unknown = SKILL_ORDER.filter((s) => skillBands[s] == null);
    const ordered = entries.map((e) => e.skill).concat(unknown);

    // Weights: position-based. Weakest gets highest weight.
    const n = Math.max(1, ordered.length);
    const weights = ordered.map((_, i) => Math.max(1, n - i)); // n, n-1, ...
    const total = weights.reduce((a, b) => a + b, 0);

    const rotation = [];
    // Round-robin with repetition proportional to weight.
    for (let i = 0; i < ordered.length; i++) {
      const reps = Math.max(1, Math.round((weights[i] / total) * days));
      for (let r = 0; r < reps; r++) rotation.push(ordered[i]);
    }
    // Ensure every skill appears at least once.
    ordered.forEach((s) => { if (!rotation.includes(s)) rotation.push(s); });
    return rotation;
  }

  function detailFor(skill, version, band) {
    const v = version === "general" ? "General Training" : "Academic";
    switch (skill) {
      case "reading": return `Take one ${v} Reading test${band ? ` near your level (Band ${fmtBand(band)})` : ""}, and review every wrong answer's explanation.`;
      case "listening": return `Complete one Listening test (audio plays once, like the real exam)${band ? ` near Band ${fmtBand(band)}` : ""}.`;
      case "writing": return `Write one Task 1 and one Task 2 essay, then use the AI evaluation to study your corrections.`;
      case "speaking": return `Do one Speaking session (Part 2 or Full Mock) and read the AI feedback carefully.`;
      default: return "";
    }
  }

  function generate(history, opts) {
    const { targetBand, days, version } = opts;
    const skillBands = currentSkillBands(history);
    const current = history.find((r) => typeof r.overall === "number");
    const currentBand = current ? current.overall : null;
    const weakTypes = weakTaskTypes(history);

    const rotation = buildRotation(skillBands, days);
    const plan = [];

    for (let d = 0; d < days; d++) {
      const primary = rotation[d % rotation.length];
      const secondary = rotation[(d + 1) % rotation.length] || primary;
      const items = [];

      items.push({
        type: "practice",
        skill: primary,
        text: detailFor(primary, version, skillBands[primary]),
      });

      // Secondary lighter activity.
      if (secondary !== primary && skillBands[secondary] != null) {
        items.push({ type: "light", skill: secondary, text: `Quick warm-up: 10 minutes on ${SKILL_META[secondary].label} (re-read your last feedback).` });
      }

      // Weak task-type targeting (every 3 days).
      if (weakTypes.length && d % 3 === 1) {
        const w = weakTypes[d % weakTypes.length];
        items.push({
          type: "target",
          skill: "writing",
          text: `Focus task: you average Band ${fmtBand(w.avg)} on "${w.key.replace(/-/g, " ")}" — write one essay of this type and get it evaluated.`,
        });
      }

      // Review day (every 4 days).
      if (d % 4 === 3) {
        items.push({ type: "review", skill: null, text: "Review day: revisit all corrections from this week and re-read the explanations." });
      }

      plan.push({ day: d + 1, items });
    }

    return { targetBand, currentBand, days, plan, weakTypes, skillBands };
  }

  function render() {
    const wrap = document.getElementById("studyplan-wrap");
    if (!wrap) return;
    const profile = Store.profile.get();
    const history = Store.history.list();

    wrap.innerHTML = `
      <div class="module-head">
        <h1>📅 Your Study Plan</h1>
        <p class="sub">A day-by-day plan built from your results, target band, and exam date.</p>
      </div>

      <div class="card">
        <h2>Plan settings</h2>
        <div class="field-row" style="gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px">
            <label class="field-label" for="plan-days">Days until your exam</label>
            <select id="plan-days" class="text-input">
              ${[7, 14, 21, 30, 45, 60].map((d) => `<option ${d === 14 ? "selected" : ""}>${d} days</option>`).join("")}
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label class="field-label" for="plan-target">Target band</label>
            <select id="plan-target" class="text-input">
              ${[6.0, 6.5, 7.0, 7.5, 8.0, 8.5].map((b) => `<option ${b === (profile.targetBand || 7.5) ? "selected" : ""}>${b.toFixed(1)}</option>`).join("")}
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label class="field-label" for="plan-version">Test version</label>
            <select id="plan-version" class="text-input">
              <option value="academic" ${profile.version !== "general" ? "selected" : ""}>Academic</option>
              <option value="general" ${profile.version === "general" ? "selected" : ""}>General Training</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="plan-generate" style="margin-top:14px">✨ Generate my plan</button>
      </div>

      <div id="plan-output"></div>`;

    document.getElementById("plan-generate").addEventListener("click", () => {
      const days = parseInt(document.getElementById("plan-days").value, 10);
      const targetBand = parseFloat(document.getElementById("plan-target").value);
      const version = document.getElementById("plan-version").value;
      renderPlanOutput(generate(Store.history.list(), { targetBand, days, version }));
    });

    // Auto-generate a first plan on load if there's any history.
    if (history.length) {
      renderPlanOutput(generate(history, { targetBand: profile.targetBand || 7.5, days: 14, version: profile.version || "academic" }));
    } else {
      document.getElementById("plan-output").innerHTML =
        `<div class="card"><p class="hint">Complete a few tests first — your plan gets personalised once there's some history to analyse.</p></div>`;
    }
  }

  function renderPlanOutput(data) {
    const out = document.getElementById("plan-output");
    if (!out) return;
    const gap = data.currentBand != null ? (data.targetBand - data.currentBand) : null;

    const header = `
      <div class="card plan-summary">
        <div class="result-stats" style="margin:0">
          <div class="rstat"><div class="rstat-num">${fmtBand(data.targetBand)}</div><div class="rstat-label">Target</div></div>
          <div class="rstat"><div class="rstat-num">${data.currentBand != null ? fmtBand(data.currentBand) : "—"}</div><div class="rstat-label">Current estimate</div></div>
          <div class="rstat"><div class="rstat-num">${gap != null ? (gap > 0 ? "+" + gap.toFixed(1) : gap.toFixed(1)) : "—"}</div><div class="rstat-label">Gap</div></div>
          <div class="rstat"><div class="rstat-num">${data.days}</div><div class="rstat-label">Days</div></div>
        </div>
      </div>`;

    const daysHtml = data.plan.map((d) => {
      const items = d.items.map((it) => {
        const icon = it.type === "review" ? "🔁" : it.type === "target" ? "🎯" : SKILL_META[it.skill] ? SKILL_META[it.skill].icon : "📌";
        const cls = it.type === "light" ? "plan-item light" : it.type === "target" ? "plan-item target" : it.type === "review" ? "plan-item review" : "plan-item";
        return `<div class="${cls}"><span class="plan-icon">${icon}</span><span>${esc(it.text)}</span></div>`;
      }).join("");
      return `<div class="plan-day">
        <div class="plan-day-num">Day ${d.day}</div>
        <div class="plan-day-items">${items}</div>
      </div>`;
    }).join("");

    out.innerHTML = header + `<div class="card"><h2>Daily plan</h2><div class="plan-list">${daysHtml}</div></div>`;
  }

  return { render };
})();

registerRenderer("studyplan", () => StudyPlan.render());
