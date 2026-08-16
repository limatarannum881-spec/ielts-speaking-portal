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
  login: "screen-login",
};

// Renderers called when a screen is opened (defined in their modules).
const ScreenRenderers = {};
function registerRenderer(name, fn) { ScreenRenderers[name] = fn; }

// ----------------------------------------------------------------------
// Auth gate — only signed-in users (or local-device mode) can view the app.
// ----------------------------------------------------------------------
function isAllowed() {
  if (window.Supa && Supa.currentUser()) return true;
  try { if (localStorage.getItem("ielts_local_mode") === "true") return true; } catch (_) {}
  return false;
}

function goNav(name) {
  const screenId = NAV_TARGETS[name];
  if (!screenId) return;

  // Everything except the login screen requires authentication.
  if (name !== "login" && !isAllowed()) {
    goNav("login");
    return false;
  }

  hideAllScreens();
  document.getElementById(screenId).classList.remove("hidden");
  window.scrollTo(0, 0);
  // Hide the nav bars on the login screen (auth-first, clean look).
  const top = document.getElementById("topnav");
  const bottom = document.getElementById("bottomnav");
  if (name === "login") {
    document.body.classList.add("nav-hidden");
    if (top) top.classList.add("hidden");
    if (bottom) bottom.classList.add("hidden");
  } else {
    document.body.classList.remove("nav-hidden");
    if (top) top.classList.remove("hidden");
    if (bottom) bottom.classList.remove("hidden");
  }
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
  // On first load the login screen is visible — hide the nav bars for a
  // clean, auth-first appearance.
  const loginScreen = document.getElementById("screen-login");
  if (loginScreen && !loginScreen.classList.contains("hidden")) {
    document.body.classList.add("nav-hidden");
    const t = document.getElementById("topnav");
    const b = document.getElementById("bottomnav");
    if (t) t.classList.add("hidden");
    if (b) b.classList.add("hidden");
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      goNav(el.dataset.nav);
    });
  });

  // Account button → auth dialog (or sign out).
  const authBtn = document.getElementById("nav-auth");
  if (authBtn) {
    const update = () => {
      const user = window.Supa ? Supa.currentUser() : null;
      const status = document.getElementById("nav-auth-status");
      if (user) {
        authBtn.title = "Signed in — click to sign out";
        authBtn.classList.add("signed-in");
        const email = user.email || "Anonymous";
        status.textContent = email.split("@")[0];
      } else {
        authBtn.title = "Sign in to sync your results";
        authBtn.classList.remove("signed-in");
        status.textContent = "";
      }
    };
    authBtn.addEventListener("click", () => {
      if (window.Supa && Supa.currentUser()) {
        // Signed in → go to the account view on the login screen.
        goNav("login");
      } else {
        // Not signed in → full login page.
        goNav("login");
      }
    });
    if (window.Supa) Supa.onChange(update);
    update();
  }
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
