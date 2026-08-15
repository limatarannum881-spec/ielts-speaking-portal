/* =====================================================================
   Navigation — top bar (desktop) + bottom bar (mobile), routing to screens.
   ===================================================================== */

"use strict";

const NAV_TARGETS = {
  dashboard: "screen-dashboard",
  speaking: "screen-home",
  listening: "screen-listening",
  reading: "screen-reading",
  writing: "screen-writing",
  mock: "screen-mock",
  results: "screen-results-history",
  resources: "screen-resources",
};

// Renderers called when a screen is opened (defined in their modules).
const ScreenRenderers = {};
function registerRenderer(name, fn) { ScreenRenderers[name] = fn; }

function goNav(name) {
  const screenId = NAV_TARGETS[name];
  if (!screenId) return;
  hideAllScreens();
  document.getElementById(screenId).classList.remove("hidden");
  window.scrollTo(0, 0);
  // Highlight active nav link
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === name);
  });
  // Render the screen's content
  if (ScreenRenderers[name]) ScreenRenderers[name]();
  return false;
}

function hideAllScreens() {
  document.querySelectorAll("#app .screen").forEach((s) => s.classList.add("hidden"));
}

// The existing app.js `showScreen` also manipulates screen visibility; keep
// them compatible by exposing a global helper that the new modules can use.
window.Go = { nav: goNav, hideAll: hideAllScreens, register: registerRenderer };

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      goNav(el.dataset.nav);
    });
  });
});

// Hide the global nav during a full mock test (anti-accidental-navigation).
function setNavHidden(hidden) {
  const top = document.getElementById("topnav");
  const bottom = document.getElementById("bottomnav");
  document.body.classList.toggle("nav-hidden", hidden);
  if (top) top.classList.toggle("hidden", hidden);
  if (bottom) bottom.classList.toggle("hidden", hidden);
}
window.setNavHidden = setNavHidden;
