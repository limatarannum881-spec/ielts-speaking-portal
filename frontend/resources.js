/* =====================================================================
   Resources — curated links to free, legal IELTS preparation resources
   (indexed from the awesome-IELTS community list). All links point to
   the original sources; nothing is scraped or redistributed.
   ===================================================================== */

"use strict";

const RESOURCES = [
  {
    category: "Official",
    items: [
      { name: "IELTS.org — official test info & format", url: "https://ielts.org" },
      { name: "British Council — IELTS preparation", url: "https://takeielts.britishcouncil.org" },
      { name: "IDP IELTS — free prep materials", url: "https://ielts.idp.com/prepare" },
    ],
  },
  {
    category: "Listening",
    items: [
      { name: "BBC Learning English", url: "https://www.bbc.co.uk/learningenglish" },
      { name: "TED Talks — practice with real talks", url: "https://www.ted.com/talks" },
      { name: "Elllo — free listening lessons", url: "https://www.elllo.org" },
    ],
  },
  {
    category: "Reading",
    items: [
      { name: "British Council Reading practice", url: "https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/reading" },
      { name: "Breaking News English — leveled news", url: "https://breakingnewsenglish.com" },
    ],
  },
  {
    category: "Writing & Speaking",
    items: [
      { name: "IELTS Liz — tips & sample answers", url: "https://ieltsliz.com" },
      { name: "IELTS Simon — daily lessons", url: "https://ielts-simon.com" },
    ],
  },
  {
    category: "Community index",
    items: [
      { name: "awesome-IELTS — community resource list (reference)", url: "https://github.com/shah0150/awesome-IELTS" },
    ],
  },
];

function renderResources() {
  const wrap = document.getElementById("resources-wrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="module-head">
      <h1>Resources</h1>
      <p class="sub">Hand-picked, free and legally-usable preparation materials. Links open the original sources — we don't republish or copy third-party content.</p>
    </div>
    ${RESOURCES.map((c) => `
      <div class="card">
        <h2>${esc(c.category)}</h2>
        <div class="resource-list">
          ${c.items.map((i) => `
            <a class="resource-link" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
              <span class="resource-name">${esc(i.name)}</span>
              <span class="resource-arrow">↗</span>
            </a>`).join("")}
        </div>
      </div>`).join("")}
    <p class="hint">All content in the practice tests on this platform is original; external resources are linked, never copied.</p>`;
}

registerRenderer("resources", renderResources);
