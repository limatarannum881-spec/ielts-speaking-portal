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
  // Auth dialog
  // ------------------------------------------------------------------
  function openAuth() {
    if (!isConfigured()) {
      toast("Supabase isn't configured yet. Open Settings (⚙️) and add your project URL and anon key.", true);
      openSettings();
      return;
    }
    init();
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="dialog auth-dialog">
        <h3>Sign in to sync your results</h3>
        <p class="criterion-comment">Your profile and test history are stored securely in your own Supabase database.</p>
        <label class="field-label" for="auth-email">Email</label>
        <input id="auth-email" class="text-input" type="email" placeholder="you@example.com" autocomplete="email" style="margin-bottom:10px" />
        <label class="field-label" for="auth-pw">Password</label>
        <input id="auth-pw" class="text-input" type="password" placeholder="••••••••" autocomplete="current-password" style="margin-bottom:16px" />
        <div class="dialog-actions" style="flex-wrap:wrap">
          <button class="btn btn-primary" id="auth-signin">Sign in</button>
          <button class="btn btn-ghost" id="auth-signup">Create account</button>
        </div>
        <div class="auth-divider"><span>or</span></div>
        <button class="btn btn-ghost btn-block" id="auth-anon">👤 Continue anonymously (no email)</button>
        <button class="btn btn-ghost btn-block" id="auth-offline">📱 Use this device only (no cloud sync)</button>
        <div id="auth-msg" class="criterion-comment" style="margin-top:10px;min-height:18px"></div>
      </div>`;
    document.body.appendChild(overlay);

    const msg = (t, err = false) => {
      const m = overlay.querySelector("#auth-msg");
      m.textContent = t;
      m.style.color = err ? "var(--red)" : "var(--muted)";
    };
    const close = () => overlay.remove();

    overlay.querySelector("#auth-signin").addEventListener("click", async () => {
      try { await signIn(overlay.querySelector("#auth-email").value, overlay.querySelector("#auth-pw").value); msg("Signed in ✓"); close(); } catch (e) { msg(e.message || "Sign-in failed", true); }
    });
    overlay.querySelector("#auth-signup").addEventListener("click", async () => {
      try {
        const r = await signUp(overlay.querySelector("#auth-email").value, overlay.querySelector("#auth-pw").value);
        if (r.needsConfirmation) { msg("Check your email to confirm, then sign in.", false); }
        else { msg("Account created ✓"); close(); }
      } catch (e) { msg(e.message || "Sign-up failed", true); }
    });
    overlay.querySelector("#auth-anon").addEventListener("click", async () => {
      try { await signInAnon(); msg("Connected anonymously ✓"); close(); } catch (e) { msg(e.message || "Could not connect", true); }
    });
    overlay.querySelector("#auth-offline").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  // ------------------------------------------------------------------
  // Settings dialog (connection config + profile)
  // ------------------------------------------------------------------
  function openSettings() {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const c = cfg();
    const prof = Store.profile.get();
    overlay.innerHTML = `
      <div class="dialog auth-dialog">
        <h3>Settings</h3>
        <label class="field-label" for="set-name">Your name</label>
        <input id="set-name" class="text-input" value="${esc(prof.name || "")}" placeholder="Md Musfiqur Rahaman" style="margin-bottom:8px" />
        <label class="field-label" for="set-target">Target band</label>
        <select id="set-target" class="text-input" style="margin-bottom:8px">
          ${[6.0, 6.5, 7.0, 7.5, 8.0, 8.5].map((b) => `<option ${b === (prof.targetBand || 7.5) ? "selected" : ""}>${b.toFixed(1)}</option>`).join("")}
        </select>
        <hr class="auth-divider" />
        <p class="field-label" style="margin:0 0 6px">Supabase connection (for cloud sync)</p>
        <label class="field-label" for="set-supabase-url">Supabase URL</label>
        <input id="set-supabase-url" class="text-input" value="${esc(c.SUPABASE_URL || "")}" placeholder="https://xxxx.supabase.co" style="margin-bottom:8px" />
        <label class="field-label" for="set-anon-key">Anon public key</label>
        <input id="set-anon-key" class="text-input" value="${esc(c.SUPABASE_ANON_KEY || "")}" placeholder="eyJhbGciOi…" style="margin-bottom:8px" />
        <label class="field-label" for="set-api-base">Backend API URL (leave blank if same origin)</label>
        <input id="set-api-base" class="text-input" value="${esc(c.API_BASE || "")}" placeholder="https://your-app.onrender.com" style="margin-bottom:16px" />
        <div class="dialog-actions">
          <button class="btn btn-ghost" id="set-cancel">Cancel</button>
          <button class="btn btn-primary" id="set-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#set-cancel").addEventListener("click", close);
    overlay.querySelector("#set-save").addEventListener("click", () => {
      Store.profile.set({
        name: overlay.querySelector("#set-name").value,
        targetBand: parseFloat(overlay.querySelector("#set-target").value) || 7.5,
      });
      saveAppConfig({
        SUPABASE_URL: overlay.querySelector("#set-supabase-url").value.trim(),
        SUPABASE_ANON_KEY: overlay.querySelector("#set-anon-key").value.trim(),
        API_BASE: overlay.querySelector("#set-api-base").value.trim().replace(/\/$/, ""),
      });
      init();
      toast("Settings saved.");
      close();
      if (window.renderDashboard) renderDashboard();
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  init();
  return {
    init, ready, currentUser, onChange,
    signUp, signIn, signInAnon, signOut,
    pushProfile, pushHistory, pullAll,
    openAuth, openSettings, isConfigured,
  };
})();

// Expose for store.js write-through hooks.
window.Supa = Supa;

// Attempt to restore session on load and pull fresh data.
Supa.onChange(() => { if (window.renderDashboard && document.getElementById("dashboard-wrap")) renderDashboard(); });
if (Supa.ready()) {
  Supa.pullAll().catch(() => {});
}
