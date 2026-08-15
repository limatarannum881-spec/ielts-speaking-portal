/* =====================================================================
   Results / History — previous attempts, progression, best & average.
   ===================================================================== */

"use strict";

function renderHistory() {
  const wrap = document.getElementById("history-wrap");
  if (!wrap) return;
  const history = Store.history.list();
  const best = Store.history.best();
  const avg = Store.history.average();

  const attempts = history.filter((r) => typeof r.overall === "number").slice().reverse();

  // Progression chart (Attempt N -> band)
  const chart = attempts.length >= 2
    ? `<div class="card"><h2>Score Progression</h2>
        <div class="prog-chart">
          ${attempts.map((a, i) => `
            <div class="prog-col" style="height:${Math.max(8, (a.overall / 9) * 220)}px">
              <span class="prog-val">${fmtBand(a.overall)}</span>
              <span class="prog-bar"></span>
              <span class="prog-label">#${i + 1}</span>
            </div>`).join("")}
        </div></div>`
    : "";

  const skillProg = skillProgression(history);

  const rows = history.map((r) => {
    const label = { full: "Full Mock Test", reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" }[r.testType] || r.testType;
    return `<div class="activity-row">
      <div>
        <div class="activity-label">${label} ${r.version ? "· " + (r.version === "general" ? "General" : "Academic") : ""}</div>
        <div class="activity-date">${new Date(r.date).toLocaleString()} ${r.duration ? "· " + r.duration : ""}</div>
      </div>
      <div class="activity-band">${fmtBand(r.overall)}</div>
    </div>`;
  }).join("") || '<p class="hint">No results yet. Complete a test to see it here.</p>';

  wrap.innerHTML = `
    <div class="module-head">
      <h1>Results &amp; History</h1>
      <p class="sub">Track your progress across attempts and skills.</p>
      ${history.length ? `<button class="btn btn-ghost btn-sm" id="history-clear">Clear history</button>` : ""}
    </div>

    <div class="result-stats">
      <div class="rstat"><div class="rstat-num">${best ? fmtBand(best.overall) : "—"}</div><div class="rstat-label">Best score</div></div>
      <div class="rstat"><div class="rstat-num">${avg != null ? fmtBand(avg) : "—"}</div><div class="rstat-label">Average score</div></div>
      <div class="rstat"><div class="rstat-num">${history.length}</div><div class="rstat-label">Total attempts</div></div>
    </div>

    ${chart}

    ${skillProg}

    <div class="card"><h2>All attempts</h2>${rows}</div>`;

  const clearBtn = wrap.querySelector("#history-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (confirm("Clear all result history? This cannot be undone.")) { Store.history.clear(); renderHistory(); }
  });
}

function skillProgression(history) {
  const skills = ["listening", "reading", "writing", "speaking"];
  const rows = skills.map((s) => {
    const vals = history.filter((r) => typeof r[s] === "number").map((r) => ({ band: r[s], date: r.date })).slice().reverse();
    if (vals.length < 2) return `<div class="skill-prog-row"><span class="skill-prog-name">${s.charAt(0).toUpperCase() + s.slice(1)}</span><span class="skill-prog-vals">${vals.map((v) => fmtBand(v.band)).join(" → ")}</span></div>`;
    return `<div class="skill-prog-row"><span class="skill-prog-name">${s.charAt(0).toUpperCase() + s.slice(1)}</span><span class="skill-prog-vals">${vals.map((v) => fmtBand(v.band)).join(" → ")}</span></div>`;
  });
  if (rows.every((r) => r.includes("</span><span") === false && !r.includes("→"))) {
    // Only show if there's meaningful data
  }
  const any = rows.filter((r) => r.includes("→")).length;
  if (!any) return "";
  return `<div class="card"><h2>Skill-by-skill progression</h2>${rows.join("")}</div>`;
}

registerRenderer("results", renderHistory);
