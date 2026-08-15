/* =====================================================================
   Store — lightweight localStorage persistence for a no-login app.
   Holds: user profile (name, target band, version), test history,
   and the currently active test session (so a refresh doesn't lose it).
   ===================================================================== */

"use strict";

const Store = (() => {
  const P = {
    profile: "ielts_profile",
    history: "ielts_history",
    active: "ielts_active_test",
  };

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }
  function set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  // ---- Profile ----
  const defaultProfile = { name: "", targetBand: 7.5, version: "academic" };
  const profile = {
    get() { return Object.assign({}, defaultProfile, get(P.profile, {})); },
    set(p) { set(P.profile, Object.assign(profile.get(), p)); },
  };

  // ---- History ----
  const history = {
    list() { return get(P.history, []); },
    add(record) {
      const list = history.list();
      list.unshift(Object.assign({ id: "t" + Date.now(), date: new Date().toISOString() }, record));
      set(P.history, list.slice(0, 200));
      return list[0];
    },
    clear() { set(P.history, []); },
    latest() { return history.list()[0] || null; },
    best() {
      const list = history.list().filter((r) => typeof r.overall === "number");
      return list.length ? list.reduce((a, b) => (b.overall > a.overall ? b : a)) : null;
    },
    average() {
      const list = history.list().filter((r) => typeof r.overall === "number");
      if (!list.length) return null;
      return list.reduce((s, r) => s + r.overall, 0) / list.length;
    },
  };

  // ---- Active test session (survives refresh) ----
  const active = {
    get() { return get(P.active, null); },
    set(s) { set(P.active, s); },
    clear() { localStorage.removeItem(P.active); },
  };

  return { profile, history, active };
})();
