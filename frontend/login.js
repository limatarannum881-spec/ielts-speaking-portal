/* =====================================================================
   Login / Signup screen — a dedicated, full-page authentication view
   built on top of the Supabase auth layer (supabase.js).
   ===================================================================== */

"use strict";

const Login = (() => {
  let mode = "signin"; // "signin" | "signup"

  function render() {
    const wrap = document.getElementById("login-wrap");
    if (!wrap) return;

    const configured = Supa.isConfigured();
    const user = Supa.currentUser();

    // If already signed in, show the account view.
    if (user) {
      wrap.innerHTML = `
        <div class="login-card">
          <div class="login-brand"><span class="brand-logo">🎙️</span><h1>IELTS AI</h1></div>
          <div class="login-avatar">${user.user_metadata && user.user_metadata.name ? esc(user.user_metadata.name.charAt(0).toUpperCase()) : "👤"}</div>
          <h2>You're signed in</h2>
          <p class="criterion-comment">${user.email ? esc(user.email) : "Anonymous session"} · your results sync securely to Supabase.</p>
          <button class="btn btn-primary btn-big" id="login-go-dashboard">Go to dashboard →</button>
          <button class="btn btn-ghost btn-block" id="login-settings">⚙️ Settings</button>
          <button class="btn btn-ghost btn-block danger-text" id="login-signout">Sign out</button>
        </div>`;
      wrap.querySelector("#login-go-dashboard").addEventListener("click", () => Go.nav("dashboard"));
      wrap.querySelector("#login-settings").addEventListener("click", () => Supa.openSettings());
      wrap.querySelector("#login-signout").addEventListener("click", async () => { await Supa.signOut(); render(); });
      return;
    }

    wrap.innerHTML = `
      <div class="login-card">
        <div class="login-brand"><span class="brand-logo">🎙️</span><h1>IELTS AI</h1></div>
        <p class="criterion-comment" style="text-align:center">Sign in to save your scores and progress securely in the cloud.</p>

        <div class="seg-toggle login-tabs" role="tablist">
          <button class="seg ${mode === "signin" ? "on" : ""}" id="tab-signin" role="tab">Sign in</button>
          <button class="seg ${mode === "signup" ? "on" : ""}" id="tab-signup" role="tab">Create account</button>
        </div>

        <form id="login-form" autocomplete="on">
          <label class="field-label" for="login-email">Email</label>
          <input id="login-email" class="text-input" type="email" autocomplete="email" placeholder="you@example.com" />

          <label class="field-label" for="login-pw">Password</label>
          <div class="pw-row">
            <input id="login-pw" class="text-input" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="••••••••" />
            <button type="button" class="btn-icon" id="login-showpw" title="Show password">👁️</button>
          </div>

          ${mode === "signup" ? `
            <label class="field-label" for="login-name">Your name (optional)</label>
            <input id="login-name" class="text-input" type="text" autocomplete="name" placeholder="Md Musfiqur Rahaman" />
            <div class="criterion-comment" style="margin-top:6px">Password must be at least 6 characters.</div>` : ""}

          <div id="login-msg" class="login-msg" role="alert" aria-live="polite"></div>

          <button type="submit" class="btn btn-primary btn-big" id="login-submit">
            ${mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div class="auth-divider"><span>or</span></div>

        <button class="btn btn-ghost btn-block" id="login-anon">👤 Continue anonymously</button>
        <button class="btn btn-ghost btn-block" id="login-offline">📱 Use this device only</button>

        ${!configured ? `<div class="banner banner-warn" style="margin-top:16px">Supabase isn't connected yet. <button class="btn btn-ghost btn-sm" id="login-config-now">Configure now</button></div>` : ""}
      </div>`;

    const msg = (text, err = false) => {
      const m = wrap.querySelector("#login-msg");
      m.textContent = text;
      m.className = "login-msg " + (err ? "err" : "ok");
    };

    wrap.querySelector("#tab-signin").addEventListener("click", () => { mode = "signin"; render(); });
    wrap.querySelector("#tab-signup").addEventListener("click", () => { mode = "signup"; render(); });

    // Show/hide password
    const pw = wrap.querySelector("#login-pw");
    wrap.querySelector("#login-showpw").addEventListener("click", () => {
      pw.type = pw.type === "password" ? "text" : "password";
    });

    // Submit
    wrap.querySelector("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = wrap.querySelector("#login-email").value.trim();
      const password = pw.value;
      const name = mode === "signup" ? wrap.querySelector("#login-name").value.trim() : "";

      if (!email) { msg("Please enter your email.", true); return; }
      if (!password) { msg("Please enter your password.", true); return; }
      if (mode === "signup" && password.length < 6) { msg("Password must be at least 6 characters.", true); return; }

      const btn = wrap.querySelector("#login-submit");
      btn.disabled = true;
      btn.textContent = "Please wait…";
      msg("");

      try {
        if (mode === "signup") {
          if (name) Store.profile.set({ name });
          const r = await Supa.signUp(email, password);
          if (r.needsConfirmation) {
            msg("Check your email to confirm your account, then sign in.", false);
            mode = "signin";
          } else {
            msg("Account created — signing you in…", false);
            setTimeout(() => Go.nav("dashboard"), 400);
          }
        } else {
          await Supa.signIn(email, password);
          msg("Signed in — syncing your results…", false);
          setTimeout(() => Go.nav("dashboard"), 400);
        }
      } catch (err) {
        msg(err.message || "Something went wrong. Please try again.", true);
      } finally {
        btn.disabled = false;
        btn.textContent = mode === "signup" ? "Create account" : "Sign in";
      }
    });

    wrap.querySelector("#login-anon").addEventListener("click", async () => {
      try { await Supa.signInAnon(); Go.nav("dashboard"); }
      catch (e) { msg(e.message || "Could not connect anonymously.", true); }
    });
    wrap.querySelector("#login-offline").addEventListener("click", () => Go.nav("dashboard"));
    const cfgBtn = wrap.querySelector("#login-config-now");
    if (cfgBtn) cfgBtn.addEventListener("click", () => Supa.openSettings());
  }

  return { render };
})();

registerRenderer("login", () => Login.render());
