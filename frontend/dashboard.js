/* =====================================================================
   Dashboard — current band, target, progress, skill cards, quick actions,
   recent activity and recommended practice.
   ===================================================================== */

"use strict";

function latestSkill(history, skill) {
  const r = history.find((x) => typeof x[skill] === "number");
  return r ? r[skill] : null;
}

function recommendedFocus(history) {
  const order = ["writing", "reading", "listening", "speaking"];
  const bands = order.map((s) => ({ skill: s, band: latestSkill(history, s) }));
  const known = bands.filter((b) => b.band != null);
  if (!known.length) return [];
  known.sort((a, b) => a.band - b.band); // weakest first
  return known.map((b) => b.skill);
}

// Detect specific weak *task types* (e.g. "Problem/Solution essays" or
// "Task 1 reports") so recommendations are targeted, not generic.
function weakTaskTypes(history) {
  const writingRecords = history.filter((r) => r.testType === "writing" && typeof r.writing === "number");
  const groups = {};
  writingRecords.forEach((r) => {
    const key = `${r.task || "Writing"} · ${(r.taskType || "essay").replace(/-/g, " ")}`;
    const g = groups[key] || (groups[key] = { key, bands: [], count: 0 });
    g.bands.push(r.writing);
    g.count++;
  });
  const result = Object.values(groups)
    .filter((g) => g.count >= 2) // only flag patterns we've seen repeatedly
    .map((g) => ({ key: g.key, avg: g.bands.reduce((a, b) => a + b, 0) / g.bands.length, count: g.count }))
    .filter((g) => g.avg < 6.5)  // below a passable band
    .sort((a, b) => a.avg - b.avg);
  return result;
}

const TASK_TYPE_LABEL = {
  "opinion": "Opinion essays",
  "discussion": "Discussion essays",
  "advantages-disadvantages": "Advantages/Disadvantages essays",
  "problem-solution": "Problem/Solution essays",
  "two-part": "Two-part questions",
  "bar-chart": "Bar-chart reports",
  "line-graph": "Line-graph reports",
  "pie-chart": "Pie-chart reports",
  "table": "Table reports",
  "process": "Process descriptions",
  "map": "Map descriptions",
  "mixed": "Mixed-chart reports",
  "letter": "Letters",
};

function humanTaskType(t) {
  return TASK_TYPE_LABEL[t] || (t || "essays").replace(/-/g, " ");
}

function renderDashboard() {
  const wrap = document.getElementById("dashboard-wrap");
  if (!wrap) return;
  const profile = Store.profile.get();
  const history = Store.history.list();
  const latestFull = history.find((r) => r.testType === "full");
  const latestAny = history[0];

  const current = (latestFull || latestAny || {}).overall;
  const target = profile.targetBand || 7.5;

  const skills = ["listening", "reading", "writing", "speaking"];
  const skillBands = {};
  skills.forEach((s) => (skillBands[s] = latestSkill(history, s)));

  const progress = current && target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const focus = recommendedFocus(history);

  const skillCards = skills.map((s) => {
    const icon = { listening: "🎧", reading: "📖", writing: "✍️", speaking: "🎙️" }[s];
    const b = skillBands[s];
    return `<div class="skill-card">
      <div class="skill-emoji">${icon}</div>
      <div class="skill-name">${s.charAt(0).toUpperCase() + s.slice(1)}</div>
      <div class="skill-band">${b != null ? fmtBand(b) : "—"}</div>
      <button class="btn btn-ghost btn-sm" data-quick="${s}">Practice</button>
    </div>`;
  }).join("");

  const recent = history.slice(0, 5).map((r) => {
    const label = { full: "Full Mock Test", reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" }[r.testType] || r.testType;
    return `<div class="activity-row">
      <div>
        <div class="activity-label">${label} · ${r.version ? (r.version === "general" ? "General" : "Academic") : ""}</div>
        <div class="activity-date">${new Date(r.date).toLocaleDateString()}</div>
      </div>
      <div class="activity-band">${fmtBand(r.overall)}</div>
    </div>`;
  }).join("") || '<p class="hint">No tests yet — start one below.</p>';

  const focusList = focus.length
    ? `<ol class="plain">${focus.map((s) => `<li>${s.charAt(0).toUpperCase() + s.slice(1)}</li>`).join("")}</ol>`
    : '<p class="hint">Complete a test to see your focus areas.</p>';

  // Targeted, data-driven recommendations (specific weak task types).
  const weakTypes = weakTaskTypes(history);
  const targetedList = weakTypes.length
    ? `<ul class="plain">${weakTypes.map((w) =>
        `<li>You average <b>${fmtBand(w.avg)}</b> on <b>${esc(humanTaskType(w.key.split("· ")[1] || w.key))}</b> (${w.count} attempts) — practice this next.</li>`
      ).join("")}</ul>`
    : '<p class="hint">Practice more of the same task type to get targeted suggestions here.</p>';

  wrap.innerHTML = `
    <div class="dash-hero">
      <div>
        <h1>Your IELTS Preparation Dashboard</h1>
        <p class="sub">${profile.name ? "Welcome back, " + esc(profile.name) + "." : "Track your progress and keep improving."}</p>
      </div>
      <button class="btn btn-ghost" id="dash-settings">⚙️ Settings</button>
    </div>

    <div class="dash-grid">
      <div class="card dash-band-card">
        <div class="card-kicker">Current Estimated Band</div>
        <div class="dash-band-num">${current != null ? fmtBand(current) : "—"}</div>
        <div class="criterion-comment">Target: <b>${fmtBand(target)}</b></div>
        <div class="bar-row" style="margin-top:14px">
          <div class="bar-label"><span>Progress to target</span><span class="val">${progress}%</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${progress}%"></div></div>
        </div>
        ${current != null && target != null ? `<div class="criterion-comment" style="margin-top:8px">Gap: <b>${(target - current) > 0 ? "+" + (target - current).toFixed(1) : (target - current).toFixed(1)}</b></div>` : ""}
      </div>

      <div class="card">
        <div class="card-kicker">Skill Breakdown</div>
        <div class="skill-grid">${skillCards}</div>
      </div>
    </div>

    <div class="card">
      <h2>Quick Actions</h2>
      <div class="quick-actions">
        <button class="qa-btn qa-primary" data-quick="mock">🏆 Start Full Mock Test</button>
        <button class="qa-btn" data-quick="listening">🎧 Listening</button>
        <button class="qa-btn" data-quick="reading">📖 Reading</button>
        <button class="qa-btn" data-quick="writing">✍️ Writing</button>
        <button class="qa-btn" data-quick="speaking">🎙️ Speaking</button>
        <button class="qa-btn" data-quick="studyplan">📅 Get my study plan</button>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <h2>Recent Activity</h2>
        ${recent}
      </div>
      <div class="card">
        <h2>Recommended Practice</h2>
        <p class="criterion-comment">Focus on your weakest skills first:</p>
        ${focusList}
      </div>
    </div>

    <div class="card">
      <h2>🎯 Targeted Suggestions</h2>
      <p class="criterion-comment">Based on your specific performance patterns:</p>
      ${targetedList}
    </div>
  `;

  // Quick action routing
  wrap.querySelectorAll("[data-quick]").forEach((b) => {
    b.addEventListener("click", () => {
      const q = b.dataset.quick;
      if (q === "mock") Go.nav("mock");
      else if (q === "speaking") Go.nav("speaking");
      else Go.nav(q);
    });
  });
  const settings = wrap.querySelector("#dash-settings");
  if (settings) settings.addEventListener("click", () => {
    if (window.Supa) Supa.openProfile();
  });
}

registerRenderer("dashboard", renderDashboard);
