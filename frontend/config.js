/* =====================================================================
   App configuration.
   Edit these values, OR set them at runtime via the in-app Settings
   (⚙️ → Supabase / API), which persists to localStorage and overrides.

   SUPABASE_URL / SUPABASE_ANON_KEY : from your Supabase project dashboard
     (Project Settings → API). The anon key is PUBLIC by design — data is
     protected by Row Level Security, not by hiding this key.
   API_BASE : base URL of the Python backend (Render). Leave "" when the
     frontend and backend are served from the same origin.
   ===================================================================== */

"use strict";

window.APP_CONFIG = {
  SUPABASE_URL: "https://cohhvfcyrtspjblylwyn.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvaGh2ZmN5cnRzcGpibHlsd3luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODc5MjksImV4cCI6MjEwMjQ2MzkyOX0.5S_4ZBFAEZO4HLXCqpPV7z-Ac4e85ao6XcI2HMeDJr8",
  API_BASE: "https://ielts-speaking-ai-86ql.onrender.com",
};

// Runtime override (set from the in-app Settings dialog).
try {
  const saved = JSON.parse(localStorage.getItem("ielts_app_config") || "{}");
  if (saved && typeof saved === "object") {
    Object.assign(window.APP_CONFIG, saved);
  }
} catch (_) {}

function apiUrl(path) {
  return (window.APP_CONFIG.API_BASE || "") + path;
}

function saveAppConfig(cfg) {
  Object.assign(window.APP_CONFIG, cfg);
  try { localStorage.setItem("ielts_app_config", JSON.stringify(window.APP_CONFIG)); } catch (_) {}
}
