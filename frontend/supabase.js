/* =====================================================================
   Supabase integration — auth + secure, centralized storage of the user's
   profile and test history (Postgres with Row Level Security).

   The Supabase ANON key is safe in the browser; RLS ensures each user can
   only read/write their own rows. The Python backend's API key is never
   exposed here — AI/scoring still happens server-side.

   Falls back gracefully to localStorage when Supabase is not configured
   or the user chooses "device only" mode.
   ===================================================================== */

"use strict";

const Supa = (() => {
  let client = null;
  let user = null;
  const listeners = [];

  function cfg() { return window.APP_CONFIG || {}; }
  function isConfigured() { return !!(cfg().SUPABASE_URL && cfg().SUPABASE_ANON_KEY); }

  function init() {
    client = null;
    user = null;
    if (!isConfigured()) return;
    if (window.supabase && window.supabase.createClient) {
      try {
        client = window.supabase.createClient(cfg().SUPABASE_URL, cfg().SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        client.auth.onAuthStateChange((_evt, session) => {
          user = session ? session.user : null;
          listeners.forEach((cb) => { try { cb(user); } catch (_) {} });
        });
      } catch (_) { client = null; }
    }
  }

  function ready() { return !!client; }
  function currentUser() { return user; }

  function onChange(cb) { listeners.push(cb); }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------
  async function signUp(email, password) {
    if (!ready()) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // If email confirmation is enabled, no session is returned yet.
    if (!data.session && data.user) {
      return { needsConfirmation: true };
    }
    user = data.session ? data.session.user : data.user;
    emit();
    await pullAll();
    return {};
  }

  async function signIn(email, password) {
    if (!ready()) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
    emit();
    await pullAll();
  }

  async function signInAnon() {
    if (!ready()) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    user = data.user;
    emit();
    await pullAll();
  }

  // Shared guest account with a fixed password (e.g. "pharmacy2026").
  // Anyone can use it; the account is auto-provisioned on first use.
  async function signInGuest() {
    if (!ready()) throw new Error("Supabase is not configured.");
    const email = cfg().GUEST_EMAIL || "guest@ielts-ai.app";
    const password = cfg().GUEST_PASSWORD || "pharmacy2026";

    let { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      // Account doesn't exist yet — create it, then sign in.
      const up = await client.auth.signUp({
        email, password,
        options: { data: { name: "Guest" } },
      });
      if (up.error) throw up.error;
      if (up.data.session) {
        user = up.data.session.user;
      } else {
        // Email confirmation may be enabled: fall back to anonymous sign-in
        // so the user still gets in (and can be upgraded later).
        const anon = await client.auth.signInAnonymously();
        if (anon.error) throw up.error || anon.error;
        user = anon.data.user;
        emit();
        await pullAll();
        return;
      }
    } else {
      user = data.user;
    }
    emit();
    await pullAll();
  }

  async function signOut() {
    if (!ready()) return;
    await client.auth.signOut();
    user = null;
    emit();
  }

  function emit() { listeners.forEach((cb) => { try { cb(user); } catch (_) {} }); }

  // ------------------------------------------------------------------
  // Data sync (profile + history)
  // ------------------------------------------------------------------
  async function pushProfile() {
    if (!ready() || !user) return;
    const p = Store.profile.get();
    await client.from("profiles").upsert({
      id: user.id,
      name: p.name || "",
      target_band: p.targetBand,
      version: p.version,
      updated_at: new Date().toISOString(),
    });
  }

  async function pushHistory(record) {
    if (!ready() || !user) return;
    await client.from("test_results").upsert({
      id: record.id,
      user_id: user.id,
      test_type: record.testType,
      version: record.version || null,
      title: record.title || null,
      listening: record.listening ?? null,
      reading: record.reading ?? null,
      writing: record.writing ?? null,
      speaking: record.speaking ?? null,
      overall: record.overall ?? null,
      correct: record.correct ?? null,
      total: record.total ?? null,
      accuracy: record.accuracy ?? null,
      duration: record.duration || null,
      status: record.status || "completed",
      created_at: record.date || new Date().toISOString(),
    });
  }

  async function pullAll() {
    if (!ready() || !user) return;
    // Profile
    const { data: prof } = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (prof) {
      Store.profile.set({ name: prof.name || "", targetBand: parseFloat(prof.target_band) || 7.5, version: prof.version || "academic" });
    }
    // History
    const { data: rows } = await client.from("test_results").select("*").order("created_at", { ascending: false }).limit(200);
    if (rows && rows.length) {
      const mapped = rows.map((r) => ({
        id: r.id, date: r.created_at, testType: r.test_type, version: r.version,
        title: r.title, listening: r.listening, reading: r.reading, writing: r.writing,
        speaking: r.speaking, overall: r.overall, correct: r.correct, total: r.total,
        accuracy: r.accuracy, duration: r.duration, status: r.status,
      }));
      Store.history.merge(mapped);
    }
  }

  // ------------------------------------------------------------------
  // Profile settings (name + target band) — the only user-facing settings.
  // The Supabase connection is developer configuration, kept OUT of this
  // dialog (it lives in config.js and the one-time "connect" prompt below).
  // ------------------------------------------------------------------
  function openProfile() {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const prof = Store.profile.get();
    overlay.innerHTML = `
      <div class="dialog auth-dialog">
        <h3>Profile</h3>
        <label class="field-label" for="set-name">Your name</label>
        <input id="set-name" class="text-input" value="${esc(prof.name || "")}" placeholder="Md Musfiqur Rahaman" style="margin-bottom:8px" />
        <label class="field-label" for="set-target">Target band</label>
        <select id="set-target" class="text-input" style="margin-bottom:8px">
          ${[6.0, 6.5, 7.0, 7.5, 8.0, 8.5].map((b) => `<option ${b === (prof.targetBand || 7.5) ? "selected" : ""}>${b.toFixed(1)}</option>`).join("")}
        </select>
        <label class="field-label" for="set-version">Test version</label>
        <div class="seg-toggle" style="width:100%;margin:0 0 16px">
          <button class="seg ${prof.version !== "general" ? "on" : ""}" id="set-ver-academic" style="flex:1">Academic</button>
          <button class="seg ${prof.version === "general" ? "on" : ""}" id="set-ver-general" style="flex:1">General Training</button>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" id="set-cancel">Cancel</button>
          <button class="btn btn-primary" id="set-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    let version = prof.version || "academic";
    overlay.querySelector("#set-ver-academic").addEventListener("click", () => { version = "academic"; overlay.querySelector("#set-ver-academic").classList.add("on"); overlay.querySelector("#set-ver-general").classList.remove("on"); });
    overlay.querySelector("#set-ver-general").addEventListener("click", () => { version = "general"; overlay.querySelector("#set-ver-general").classList.add("on"); overlay.querySelector("#set-ver-academic").classList.remove("on"); });
    const close = () => overlay.remove();
    overlay.querySelector("#set-cancel").addEventListener("click", close);
    overlay.querySelector("#set-save").addEventListener("click", () => {
      Store.profile.set({
        name: overlay.querySelector("#set-name").value,
        targetBand: parseFloat(overlay.querySelector("#set-target").value) || 7.5,
        version,
      });
      toast("Profile saved.");
      close();
      if (window.renderDashboard) renderDashboard();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  // ------------------------------------------------------------------
  // One-time connection setup — ONLY shown when Supabase isn't configured
  // yet (i.e. the owner is setting up the app). Not a normal user feature.
  // ------------------------------------------------------------------
  function openConnectionSetup() {
    const c = cfg();
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="dialog auth-dialog">
        <h3>Connect Supabase</h3>
        <p class="criterion-comment" style="margin:0 0 12px">Needed once to enable accounts and cloud sync. Find these in Supabase → Project Settings → API.</p>
        <label class="field-label" for="set-supabase-url">Supabase URL</label>
        <input id="set-supabase-url" class="text-input" value="${esc(c.SUPABASE_URL || "")}" placeholder="https://xxxx.supabase.co" style="margin-bottom:8px" />
        <label class="field-label" for="set-anon-key">Anon public key</label>
        <input id="set-anon-key" class="text-input" value="${esc(c.SUPABASE_ANON_KEY || "")}" placeholder="eyJhbGciOi…" style="margin-bottom:8px" />
        <label class="field-label" for="set-api-base">Backend API URL (blank = same origin)</label>
        <input id="set-api-base" class="text-input" value="${esc(c.API_BASE || "")}" placeholder="https://your-app.onrender.com" style="margin-bottom:16px" />
        <div class="dialog-actions">
          <button class="btn btn-ghost" id="set-cancel">Cancel</button>
          <button class="btn btn-primary" id="set-save">Save &amp; connect</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#set-cancel").addEventListener("click", close);
    overlay.querySelector("#set-save").addEventListener("click", () => {
      saveAppConfig({
        SUPABASE_URL: overlay.querySelector("#set-supabase-url").value.trim(),
        SUPABASE_ANON_KEY: overlay.querySelector("#set-anon-key").value.trim(),
        API_BASE: overlay.querySelector("#set-api-base").value.trim().replace(/\/$/, ""),
      });
      init();
      toast("Connection saved.");
      close();
      if (window.Login) Login.render();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  init();
  return {
    init, ready, currentUser, onChange,
    signUp, signIn, signInAnon, signInGuest, signOut,
    pushProfile, pushHistory, pullAll,
    openProfile, openConnectionSetup, isConfigured,
    getClient: () => client,
  };
})();

// Expose for store.js write-through hooks.
window.Supa = Supa;

// On auth state change: signed in -> dashboard, signed out -> login.
Supa.onChange((user) => {
  if (window.goNav) {
    if (user) {
      // Refresh dashboard data after login.
      if (window.renderDashboard && document.getElementById("dashboard-wrap")) renderDashboard();
      if (document.getElementById("screen-login") && !document.getElementById("screen-login").classList.contains("hidden")) {
        goNav("dashboard");
      }
    } else {
      goNav("login");
    }
  }
});

// Attempt to restore session on load; pull fresh data if connected.
if (Supa.ready()) {
  Supa.pullAll().catch(() => {});
  // If a session was restored, land on the dashboard.
  setTimeout(() => {
    if (Supa.currentUser() && window.goNav) goNav("dashboard");
  }, 400);
}

