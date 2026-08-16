/* =====================================================================
   Challenge — multiplayer Bangla→English vocab race (up to 4 players).
   Synchronized start via Supabase Realtime:
     host creates room → quiz generated once → players join & ready-up →
     when all ready, starts_at is set → everyone counts down to the same
     instant → 20 questions, 180s → live leaderboard.
   ===================================================================== */

"use strict";

const Challenge = (() => {
  let room = null;        // { code, quiz, status, starts_at, max_players }
  let me = null;          // { user_id, display_name }
  let participants = [];  // [{ id, user_id, display_name, ready, score, time_taken_ms, finished_at }]
  let channel = null;
  let answers = {};
  let quizEndTime = null;
  let quizTimer = null;
  let countdownTimer = null;
  let myFinished = false;
  let myScore = 0;
  let myTimeMs = 0;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function supabase() { return window.Supa && Supa.ready() ? Supa.getClient() : null; }

  function genCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function displayName() {
    const p = Store.profile.get();
    if (p.name) return p.name;
    const u = Supa.currentUser();
    if (u && u.email) return u.email.split("@")[0];
    return "Player" + Math.floor(Math.random() * 900 + 100);
  }

  function fmtClock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------------
  // Landing
  // ------------------------------------------------------------------
  function renderLanding() {
    const wrap = document.getElementById("challenge-wrap");
    if (!wrap) return;

    const connected = !!supabase();
    const user = Supa.currentUser();

    wrap.innerHTML = `
      <div class="module-head">
        <h1>🏆 Live Challenge</h1>
        <p class="sub">Race up to 3 friends on a Bangla→English vocab quiz. 20 words, 3 minutes, one winner.</p>
      </div>

      ${!connected ? `
        <div class="banner banner-warn">
          ⚠️ Live challenges need Supabase connected. Sign in first (👤), and make sure your
          Supabase project has the <code>challenge_rooms</code> tables (run <code>supabase/schema.sql</code>).
        </div>` : ""}

      <div class="card">
        <h2>Host a challenge</h2>
        <p class="criterion-comment">Create a room, share the 4-letter code with your friends, and start when everyone's ready.</p>
        <button class="btn btn-primary btn-big" id="ch-create" ${!connected ? "disabled" : ""}>🎮 Create challenge room</button>
      </div>

      <div class="card">
        <h2>Join a challenge</h2>
        <p class="criterion-comment">Enter the code your friend shared with you.</p>
        <div class="input-row">
          <input type="text" id="ch-code" class="text-input" placeholder="4-letter code (e.g. X7K2)" maxlength="4" autocomplete="off" style="text-transform:uppercase" />
          <button class="btn btn-primary" id="ch-join" ${!connected ? "disabled" : ""}>Join</button>
        </div>
      </div>`;

    document.getElementById("ch-create").addEventListener("click", createRoom);
    const joinBtn = document.getElementById("ch-join");
    const codeInput = document.getElementById("ch-code");
    const doJoin = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 4) { toast("Enter the 4-letter room code.", true); return; }
      joinRoom(code);
    };
    joinBtn.addEventListener("click", doJoin);
    codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
  }

  // ------------------------------------------------------------------
  // Create / join
  // ------------------------------------------------------------------
  async function createRoom() {
    const wrap = document.getElementById("challenge-wrap");
    wrap.innerHTML = `<div class="loading">Generating your quiz…</div>`;
    let quiz;
    try {
      quiz = await api("/api/vocab/start", {});
    } catch (_) {
      wrap.innerHTML = `<div class="error-box">Could not generate a quiz (the AI may be busy). Please try again.</div>`;
      return;
    }

    const code = genCode();
    const sb = supabase();
    const user = Supa.currentUser();
    const name = displayName();

    const { error: roomErr } = await sb.from("challenge_rooms").upsert({
      code, host_user_id: user ? user.id : null, quiz, status: "waiting", max_players: 4, starts_at: null,
    });
    if (roomErr) {
      wrap.innerHTML = `<div class="error-box">Could not create the room: ${esc(roomErr.message)}</div>`;
      return;
    }
    await sb.from("challenge_participants").insert({
      room_code: code, user_id: user ? user.id : null, display_name: name, ready: false,
    });

    me = { display_name: name };
    room = { code, quiz, status: "waiting", starts_at: null, max_players: 4 };
    await subscribe(code);
    renderRoom();
  }

  async function joinRoom(code) {
    const wrap = document.getElementById("challenge-wrap");
    const sb = supabase();
    const user = Supa.currentUser();
    const name = displayName();

    // Fetch the room (also validates the code exists).
    const { data: rooms, error: fetchErr } = await sb.from("challenge_rooms").select("*").eq("code", code).limit(1);
    if (fetchErr || !rooms || !rooms.length) {
      toast("Room not found. Check the code and try again.", true);
      return;
    }
    const r = rooms[0];
    if (r.status !== "waiting") {
      toast("This room already started. Ask your friend to create a new one.", true);
      return;
    }

    const { error: insErr } = await sb.from("challenge_participants").insert({
      room_code: code, user_id: user ? user.id : null, display_name: name, ready: false,
    });
    if (insErr) {
      toast("Could not join: " + esc(insErr.message), true);
      return;
    }

    me = { display_name: name };
    room = { code, quiz: r.quiz, status: r.status, starts_at: r.starts_at, max_players: r.max_players };
    await subscribe(code);
    renderRoom();
  }

  // ------------------------------------------------------------------
  // Realtime subscription
  // ------------------------------------------------------------------
  async function subscribe(code) {
    const sb = supabase();
    if (channel) { try { await sb.removeChannel(channel); } catch (_) {} }
    channel = sb.channel("room:" + code);
    channel
      .on("postgres_changes",
        { event: "*", schema: "public", table: "challenge_rooms", filter: `code=eq.${code}` },
        (payload) => onRoomChange(payload.new))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "challenge_participants", filter: `room_code=eq.${code}` },
        () => refreshParticipants())
      .subscribe();
    await refreshParticipants();
  }

  function onRoomChange(newRoom) {
    if (!newRoom || !room) return;
    const wasWaiting = room.status === "waiting";
    room.status = newRoom.status;
    room.starts_at = newRoom.starts_at;

    if (room.status === "countdown" && room.starts_at && wasWaiting) {
      startCountdown(new Date(room.starts_at).getTime());
    }
  }

  async function refreshParticipants() {
    const sb = supabase();
    const { data } = await sb.from("challenge_participants").select("*").eq("room_code", room.code);
    participants = data || [];

    // Detect "all ready" → start countdown (first client to see it wins the write).
    const active = participants.filter((p) => p.display_name);
    if (room.status === "waiting" && active.length >= 2 && active.every((p) => p.ready)) {
      const startAt = new Date(Date.now() + 3000).toISOString();
      await sb.from("challenge_rooms")
        .update({ status: "countdown", starts_at: startAt })
        .eq("code", room.code)
        .is("starts_at", null);
    }

    renderRoom();
  }

  // ------------------------------------------------------------------
  // Room (lobby) view
  // ------------------------------------------------------------------
  function renderRoom() {
    const wrap = document.getElementById("challenge-wrap");
    if (!wrap) return;

    // If quiz already started, show the quiz instead.
    if (room.status === "live") { renderQuiz(); return; }

    const active = participants.filter((p) => p.display_name);
    const allReady = active.length >= 2 && active.every((p) => p.ready);
    const myRow = participants.find((p) => p.display_name === me.display_name);

    const roster = active.map((p) => {
      const isMe = p.display_name === me.display_name;
      return `<div class="roster-row ${isMe ? "me" : ""}">
        <span class="roster-avatar">${esc((p.display_name || "?")[0].toUpperCase())}</span>
        <span class="roster-name">${esc(p.display_name)}${isMe ? " (you)" : ""}</span>
        <span class="roster-status ${p.ready ? "ready" : ""}">${p.ready ? "✓ Ready" : "Waiting…"}</span>
      </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="module-head">
        <h1>🏆 Challenge Room</h1>
        <p class="sub">Share this code with up to 3 friends: <b class="room-code">${esc(room.code)}</b></p>
      </div>

      <div class="card">
        <h2>Players (${active.length}/${room.max_players})</h2>
        <div class="roster">${roster || '<p class="hint">Waiting for players…</p>'}</div>
      </div>

      ${allReady ? `
        <div class="card adaptive-card" style="text-align:center">
          <h2>Everyone's ready!</h2>
          <p class="criterion-comment">Starting in a moment…</p>
        </div>` : `
        <div class="card">
          <p class="criterion-comment">${active.length < 2 ? "Waiting for at least one friend to join…" : "Tap Ready when you're set. The race starts when everyone is ready."}</p>
          <button class="btn btn-primary btn-big" id="ch-ready">${myRow && myRow.ready ? "✅ Ready — tap to undo" : "✋ I'm ready"}</button>
        </div>`}

      <div class="card" id="countdown-card" style="display:none;text-align:center">
        <h2>Starting…</h2>
        <div class="countdown-num" id="ch-countdown">3</div>
      </div>

      <button class="btn btn-ghost btn-block" id="ch-leave">Leave room</button>`;

    const readyBtn = document.getElementById("ch-ready");
    if (readyBtn) readyBtn.addEventListener("click", () => setReady(!(myRow && myRow.ready)));
    document.getElementById("ch-leave").addEventListener("click", leaveRoom);
  }

  async function setReady(ready) {
    const sb = supabase();
    await sb.from("challenge_participants")
      .update({ ready })
      .eq("room_code", room.code)
      .eq("display_name", me.display_name);
    refreshParticipants();
  }

  async function leaveRoom() {
    if (confirm("Leave this challenge room?")) {
      const sb = supabase();
      if (channel) { try { await sb.removeChannel(channel); } catch (_) {} }
      await sb.from("challenge_participants").delete().eq("room_code", room.code).eq("display_name", me.display_name);
      room = null;
      renderLanding();
    }
  }

  // ------------------------------------------------------------------
  // Countdown → synchronized start
  // ------------------------------------------------------------------
  function startCountdown(startAtMs) {
    const wrap = document.getElementById("challenge-wrap");
    const card = document.getElementById("countdown-card");
    const num = document.getElementById("ch-countdown");
    if (card) card.style.display = "block";

    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const remain = startAtMs - Date.now();
      if (remain <= 0) {
        clearInterval(countdownTimer);
        if (num) num.textContent = "Go!";
        beginQuiz();
      } else if (num) {
        num.textContent = String(Math.ceil(remain / 1000));
      }
    }, 100);
  }

  function beginQuiz() {
    room.status = "live";
    quizEndTime = Date.now() + 180 * 1000; // 180s
    renderQuiz();
    clearInterval(quizTimer);
    quizTimer = setInterval(() => {
      if (!quizEndTime) return;
      const el = document.getElementById("ch-timer");
      const remain = quizEndTime - Date.now();
      if (el) el.textContent = fmtClock(remain);
      if (remain <= 0) submitQuiz(true);
    }, 250);
  }

  // ------------------------------------------------------------------
  // Quiz view
  // ------------------------------------------------------------------
  let currentQ = 0;

  function renderQuiz() {
    const wrap = document.getElementById("challenge-wrap");
    if (!wrap) return;
    const quiz = room.quiz;
    const q = quiz.questions[currentQ];
    const answered = Object.keys(answers).length;

    wrap.innerHTML = `
      <div class="test-header">
        <div class="test-header-left">
          <div><div class="test-title">${esc(quiz.title || "Bangla→English Challenge")}</div>
          <div class="test-meta">${answered}/${quiz.questions.length} answered</div></div>
        </div>
        <div class="timer-pill" id="ch-timer">3:00</div>
      </div>

      <div class="card">
        <div class="q-progress"><div class="progress-fill" style="width:${(currentQ / quiz.questions.length) * 100}%"></div></div>
        <div class="vocab-question">
          <div class="q-head"><span class="q-num">Question ${currentQ + 1} of ${quiz.questions.length}</span></div>
          <div class="bangla-word">${esc(q.banglaWord)}</div>
          <div class="q-text">What does this mean in English?</div>
          <div class="vocab-options">
            ${q.options.map((opt, i) => `
              <label class="opt ${answers[q.id] === opt ? "selected" : ""}">
                <input type="radio" name="vq" value="${esc(opt)}" ${answers[q.id] === opt ? "checked" : ""}>
                <span class="opt-text">${esc(opt)}</span>
              </label>`).join("")}
          </div>
        </div>
      </div>

      <div class="question-actions">
        <button class="btn btn-ghost" id="ch-prev" ${currentQ === 0 ? "disabled" : ""}>← Prev</button>
        <button class="btn btn-primary" id="ch-next">${currentQ === quiz.questions.length - 1 ? "Finish ✓" : "Next →"}</button>
      </div>`;

    document.querySelectorAll(".vocab-options .opt").forEach((label) => {
      const input = label.querySelector("input");
      input.addEventListener("change", () => {
        answers[q.id] = input.value;
        renderQuiz();
      });
    });
    document.getElementById("ch-prev").addEventListener("click", () => { if (currentQ > 0) { currentQ--; renderQuiz(); } });
    document.getElementById("ch-next").addEventListener("click", () => {
      if (currentQ < quiz.questions.length - 1) { currentQ++; renderQuiz(); }
      else submitQuiz(false);
    });
  }

  // ------------------------------------------------------------------
  // Submit + leaderboard
  // ------------------------------------------------------------------
  async function submitQuiz(timedOut) {
    if (myFinished) return;
    myFinished = true;
    clearInterval(quizTimer);
    clearInterval(countdownTimer);

    const quiz = room.quiz;
    let correct = 0;
    quiz.questions.forEach((q) => { if (answers[q.id] === q.answer) correct++; });
    myScore = correct;
    myTimeMs = timedOut ? 180000 : Math.max(0, Date.now() - (quizEndTime - 180000));

    const sb = supabase();
    await sb.from("challenge_participants")
      .update({ score: myScore, time_taken_ms: myTimeMs, finished_at: new Date().toISOString() })
      .eq("room_code", room.code)
      .eq("display_name", me.display_name);

    renderLeaderboard();
  }

  function renderLeaderboard() {
    const wrap = document.getElementById("challenge-wrap");
    if (!wrap) return;

    const ranked = participants
      .filter((p) => p.score != null)
      .sort((a, b) => (b.score - a.score) || ((a.time_taken_ms || 0) - (b.time_taken_ms || 0)));

    const rows = ranked.map((p, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const isMe = p.display_name === me.display_name;
      return `<div class="lb-row ${isMe ? "me" : ""}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${esc(p.display_name)}${isMe ? " (you)" : ""}</span>
        <span class="lb-score">${p.score}/20</span>
      </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="module-head" style="text-align:center">
        <h1>🏁 Race Results</h1>
        <p class="sub">${me.display_name}, you scored <b>${myScore}/20</b> in ${fmtClock(myTimeMs)}.</p>
      </div>

      <div class="card">
        <h2>Leaderboard</h2>
        <div class="leaderboard">${rows || '<p class="hint">Waiting for results…</p>'}</div>
      </div>

      <div class="actions-row">
        <button class="btn btn-primary" id="ch-again">New challenge</button>
        <button class="btn btn-ghost" id="ch-dash">Back to dashboard</button>
      </div>`;

    document.getElementById("ch-again").addEventListener("click", () => { leaveRoom(); });
    document.getElementById("ch-dash").addEventListener("click", () => Go.nav("dashboard"));

    // Live-refresh the leaderboard as others finish.
    const sb = supabase();
    sb.channel("lb:" + room.code)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "challenge_participants", filter: `room_code=eq.${room.code}` },
        () => refreshParticipants().then(renderLeaderboard))
      .subscribe();
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  return { renderLanding };
})();

registerRenderer("challenge", () => Challenge.renderLanding());
window.Challenge = Challenge;
