/* =====================================================================
   BIURO ŚLEDCZE — wspólna gra detektywistyczna
   Logowanie przez Discord (Supabase Auth), pokoje, tablica dowodów,
   wspólny notatnik, wnioski odblokowujące dokumenty, podpowiedzi,
   jedna wspólna odpowiedź drużyny. Sprawy wgrywa admin z pliku JSON.
   ===================================================================== */
(() => {
"use strict";

const CFG = window.CONFIG || {};
const SITE = CFG.SITE_NAME || "Biuro Śledcze";
const CASE_FORMAT = "detektyw-case/1";
const configured = CFG.SUPABASE_URL && !/TWOJ/.test(CFG.SUPABASE_URL) && CFG.SUPABASE_ANON_KEY && !/TWOJ/.test(CFG.SUPABASE_ANON_KEY);
const sb = window.supabase.createClient(
  configured ? CFG.SUPABASE_URL : "https://example.supabase.co",
  configured ? CFG.SUPABASE_ANON_KEY : "public-anon-key",
  { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } }
);

/* ------------------------------------------------------------------ */
/*  Narzędzia                                                          */
/* ------------------------------------------------------------------ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Bezpieczne formatowanie: dozwolone tylko <b> <i> <u> <br> i **pogrubienie**
function inline(s) {
  let t = esc(s);
  t = t.replace(/&lt;(\/?)(b|i|u|strong|em)&gt;/gi, "<$1$2>");
  t = t.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return t;
}
function plain(s) { return String(s ?? "").replace(/<[^>]+>/g, "").replace(/\*\*/g, ""); }
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
function errMsg(e) { return (e && (e.message || e.error_description || e.details)) || String(e); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function timeAgo(iso) {
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "przed chwilą";
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function toast(msg, kind = "info", ms = 3800) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = inline(msg);
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("hide"), ms);
  setTimeout(() => el.remove(), ms + 400);
}
function avatarHtml(p, size = 28, title = true) {
  const name = p?.name || "?";
  const t = title ? ` title="${esc(name)}"` : "";
  if (p?.avatar && /^https:\/\//.test(p.avatar)) {
    return `<img class="ava" src="${esc(p.avatar)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px"${t}>`;
  }
  return `<span class="ava ava-txt" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px"${t}>${esc(name.slice(0, 1).toUpperCase())}</span>`;
}
function safeImgSrc(src) {
  return /^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) ? src : null;
}
function confirmBox(text, okLabel = "Tak", cancelLabel = "Anuluj") {
  return new Promise(res => {
    const wrap = document.createElement("div");
    wrap.className = "modal-back";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p>${inline(text)}</p>
      <div class="row end"><button class="btn ghost" data-v="0">${esc(cancelLabel)}</button><button class="btn primary" data-v="1">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]");
      if (b || e.target === wrap) { wrap.remove(); res(b ? b.dataset.v === "1" : false); }
    });
    $("button[data-v='1']", wrap).focus();
  });
}

/* ------------------------------------------------------------------ */
/*  Renderowanie dokumentów (bloki z pliku sprawy)                     */
/* ------------------------------------------------------------------ */
function renderBlocks(blocks) { return (blocks || []).map(renderBlock).join(""); }

function renderBlock(b) {
  if (!b || typeof b !== "object") return "";
  switch (b.type) {
    case "p": return `<p>${inline(b.text)}</p>`;
    case "h": return `<h3>${inline(b.text)}</h3>`;
    case "small": return `<p class="small">${inline(b.text)}</p>`;
    case "note": return `<p class="note">${inline(b.text)}</p>`;
    case "signature": return `<p class="signature">${inline(b.text)}</p>`;
    case "stamp": return `<div class="stamp-wrap"><span class="stamp">${inline(b.text)}</span></div>`;
    case "divider": return `<hr>`;
    case "list": return `<ul class="list">${(b.items || []).map(i => `<li>${inline(i)}</li>`).join("")}</ul>`;
    case "kv": return `<table class="kv">${(b.rows || []).map(r => `<tr><th>${inline(r[0])}</th><td>${inline(r[1])}</td></tr>`).join("")}</table>`;
    case "table": return `<div class="tablewrap"><table class="grid${b.mono ? " mono" : ""}">
        ${b.head ? `<thead><tr>${b.head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : ""}
        <tbody>${(b.rows || []).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "qa": return `<div class="qa">${(b.items || []).map(([qq, aa]) =>
        `<div class="q"><span>P:</span>${inline(qq)}</div><div class="a"><span>O:</span>${inline(aa)}</div>`).join("")}</div>`;
    case "receipts": return `<div class="receipts">${(b.items || []).map(r => renderReceipt(r.lines || [])).join("")}</div>`;
    case "receipt": return `<div class="receipts">${renderReceipt(b.lines || [])}</div>`;
    case "handwriting": return `<div class="notebook">${(b.entries || []).map(e =>
        `<div class="nb-date">${inline(e.date)}</div>${(e.lines || []).map(l => `<p>${inline(l)}</p>`).join("")}`).join("")}</div>`;
    case "email": return `<div class="email"><div class="email-head">${(b.headers || []).map(([k, v]) =>
        `<div><span>${inline(k)}:</span> ${inline(v)}</div>`).join("")}</div>
        <div class="email-body">${(b.body || []).map(x => `<p>${inline(x)}</p>`).join("")}</div></div>`;
    case "svg": {
      const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(b.svg || ""));
      return `<figure class="figure"><img src="${src}" alt="${esc(plain(b.caption || "Rysunek"))}">${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "image": {
      const src = safeImgSrc(b.src || "");
      if (!src) return `<p class="small">[nieprawidłowy adres obrazka]</p>`;
      return `<figure class="figure"><img src="${esc(src)}" alt="${esc(plain(b.caption || "Zdjęcie"))}" loading="lazy">${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "box": return `<div class="box">${b.title ? `<div class="box-title">${inline(b.title)}</div>` : ""}${renderBlocks(b.blocks)}</div>`;
    default: return `<p class="small">[nieznany typ bloku: ${esc(b.type)}]</p>`;
  }
}
function renderReceipt(lines) {
  return `<div class="receipt">${lines.map(l => {
    if (l === "---") return `<div class="r-sep"></div>`;
    if (String(l).startsWith("##")) return `<div class="r-title">${esc(String(l).slice(2).trim())}</div>`;
    return `<div class="r-line">${esc(l)}</div>`;
  }).join("")}</div>`;
}
function renderDoc(doc, extra = "") {
  return `<article class="paper">
    <header class="doc-head">
      ${doc.no ? `<span class="doc-no">DOKUMENT ${esc(doc.no)}</span>` : ""}
      <h2>${inline(doc.title)}</h2>
    </header>
    ${doc.subtitle ? `<p class="doc-sub">${inline(doc.subtitle)}</p>` : ""}
    ${extra}
    <div class="doc-body">${renderBlocks(doc.blocks)}</div>
  </article>`;
}

/* ------------------------------------------------------------------ */
/*  Plik sprawy: walidacja i podział na część jawną i tajną            */
/* ------------------------------------------------------------------ */
function validateCase(c) {
  const errs = [];
  if (!c || typeof c !== "object") return ["Plik nie zawiera obiektu JSON."];
  if (typeof c.format !== "string" || !c.format.startsWith("detektyw-case/")) errs.push(`Pole "format" musi mieć wartość "${CASE_FORMAT}".`);
  if (!/^[a-z0-9-]{3,60}$/.test(c.id || "")) errs.push(`Pole "id": 3–60 znaków, tylko małe litery, cyfry i myślniki (np. "pod-zegarem").`);
  if (!c.title) errs.push(`Brak pola "title".`);
  if (!Array.isArray(c.documents) || !c.documents.length) errs.push(`Pole "documents" musi być niepustą listą.`);
  const ids = new Set();
  const checkDoc = (d, where) => {
    if (!d || !d.id) { errs.push(`${where}: dokument bez "id".`); return; }
    if (ids.has(d.id)) errs.push(`${where}: powtórzone id dokumentu "${d.id}".`);
    ids.add(d.id);
    if (!d.title) errs.push(`${where}: dokument "${d.id}" bez tytułu.`);
    if (!Array.isArray(d.blocks)) errs.push(`${where}: dokument "${d.id}" nie ma listy "blocks".`);
  };
  (c.documents || []).forEach(d => checkDoc(d, "documents"));
  const uids = new Set();
  (c.unlocks || []).forEach(u => {
    if (!u.id) errs.push(`unlocks: wniosek bez "id".`);
    if (uids.has(u.id)) errs.push(`unlocks: powtórzone id "${u.id}".`);
    uids.add(u.id);
    if (!u.prompt) errs.push(`unlocks "${u.id}": brak "prompt".`);
    if (!Array.isArray(u.answers) || !u.answers.length) errs.push(`unlocks "${u.id}": brak listy "answers".`);
    (u.documents || []).forEach(d => checkDoc(d, `unlocks "${u.id}"`));
  });
  if (!Array.isArray(c.questions) || !c.questions.length) errs.push(`Pole "questions" musi być niepustą listą.`);
  const qids = new Set();
  (c.questions || []).forEach(qq => {
    if (!qq.id) errs.push(`questions: pytanie bez "id".`);
    qids.add(qq.id);
    if (qq.type === "choice") {
      if (!Array.isArray(qq.options) || qq.options.length < 2) errs.push(`Pytanie "${qq.id}": potrzeba co najmniej 2 opcji.`);
      else if (!qq.options.some(o => o.id === qq.answer)) errs.push(`Pytanie "${qq.id}": "answer" nie pasuje do żadnej opcji.`);
    } else if (qq.type === "text") {
      if (!Array.isArray(qq.keywords) || !qq.keywords.length) errs.push(`Pytanie "${qq.id}": pytanie tekstowe wymaga listy "keywords".`);
    } else errs.push(`Pytanie "${qq.id}": "type" musi być "choice" albo "text".`);
  });
  Object.keys(c.hints || {}).forEach(k => {
    if (!qids.has(k)) errs.push(`hints: klucz "${k}" nie odpowiada żadnemu pytaniu.`);
    if (!Array.isArray(c.hints[k])) errs.push(`hints "${k}": musi być listą tekstów.`);
  });
  return errs;
}

function splitCase(c) {
  const pub = {
    format: c.format, id: c.id, title: c.title, subtitle: c.subtitle || "", meta: c.meta || {},
    intro: c.intro || [], documents: c.documents || [],
    unlocks: (c.unlocks || []).map(u => ({ id: u.id, title: u.title || "Wniosek", prompt: u.prompt, placeholder: u.placeholder || "" })),
    questions: (c.questions || []).map(qq => ({ id: qq.id, label: qq.label, type: qq.type, points: qq.points || 0,
      options: qq.type === "choice" ? qq.options : undefined, placeholder: qq.placeholder || "" })),
    hint_counts: Object.fromEntries(Object.entries(c.hints || {}).map(([k, v]) => [k, (v || []).length])),
    hint_penalty: c.hint_penalty ?? 1,
    ranks: c.ranks || [],
  };
  const sec = {
    unlocks: (c.unlocks || []).map(u => ({ id: u.id, title: u.title || "Wniosek", answers: u.answers, match: u.match || "exact",
      message: u.message || "", documents: u.documents || [] })),
    questions: (c.questions || []).map(qq => ({ id: qq.id, type: qq.type, points: qq.points || 0, answer: qq.answer ?? null,
      keywords: qq.keywords || null, min_keywords: qq.min_keywords || null })),
    hints: c.hints || {}, hint_penalty: c.hint_penalty ?? 1, solution: c.solution || [],
  };
  return { pub, sec };
}
function mergeCase(pub, sec) {
  const out = { ...pub };
  delete out.hint_counts;
  const su = Object.fromEntries((sec.unlocks || []).map(u => [u.id, u]));
  out.unlocks = (pub.unlocks || []).map(u => ({ ...u, ...(su[u.id] || {}) }));
  const sq = Object.fromEntries((sec.questions || []).map(x => [x.id, x]));
  out.questions = (pub.questions || []).map(x => {
    const m = { ...x, ...(sq[x.id] || {}) };
    Object.keys(m).forEach(k => (m[k] === null || m[k] === undefined) && delete m[k]);
    return m;
  });
  out.hints = sec.hints || {}; out.hint_penalty = sec.hint_penalty ?? 1; out.solution = sec.solution || [];
  return out;
}
function rankFor(ranks, total) {
  return [...(ranks || [])].sort((a, b) => b.min - a.min).find(r => total >= r.min)?.label || "";
}
function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ */
/*  Stan aplikacji                                                     */
/* ------------------------------------------------------------------ */
let me = null;            // { id, name, avatar }
let isAdmin = false;
let channel = null;
let R = null;             // stan aktualnego pokoju

function newRoomState(room, caseData) {
  return {
    room, caseData,
    tab: "akta", docId: "__intro",
    unlocked: [],                     // [{id, message, documents}]
    unlockIds: new Set(),
    hints: [],                        // wiersze room_hints
    events: [],                       // wiersze room_events (najnowsze pierwsze)
    members: new Map(),               // user_id -> {name, avatar}
    profiles: new Map(),              // cache profili
    items: new Map(), links: new Map(),
    notes: { text: "", updated_by: null, updated_at: null },
    presence: {},                     // user_id -> {name, avatar, viewing}
    solution: null,
    linkMode: false, linkFrom: null,
    dragging: null,
    notesLocalEdit: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Start i logowanie                                                  */
/* ------------------------------------------------------------------ */
let notConfigured = false;
async function init() {
  window.addEventListener("hashchange", route);
  if (!configured) { notConfigured = true; route(); return; }
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) { console.error(e); }
  if (location.search.includes("code=") || location.search.includes("error")) {
    const params = new URLSearchParams(location.search);
    if (params.get("error_description")) toast("Logowanie nieudane: " + params.get("error_description"), "error", 7000);
    history.replaceState(null, "", location.pathname + location.hash);
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; leaveChannel(); renderLogin(); } });
  if (!session) {
    const m = location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
    if (m) localStorage.setItem("pendingJoin", m[1]);
    route(); return;
  }
  await loadMe(session.user);
  const pending = localStorage.getItem("pendingJoin");
  if (pending) { localStorage.removeItem("pendingJoin"); location.hash = `#/join/${pending}`; }
  route();
}

async function loadMe(user) {
  const md = user.user_metadata || {};
  me = {
    id: user.id,
    name: md.custom_claims?.global_name || md.full_name || md.name || md.user_name || (user.email || "Detektyw").split("@")[0],
    avatar: md.avatar_url || md.picture || null,
  };
  try { await q(sb.from("profiles").upsert({ id: me.id, name: me.name, avatar: me.avatar })); }
  catch (e) { toast("Nie udało się zapisać profilu: " + errMsg(e), "error"); }
  try { isAdmin = !!(await q(sb.from("admins").select("user_id").eq("user_id", me.id).maybeSingle())); }
  catch { isAdmin = false; }
}

function renderLogin(notConfigured = false) {
  leaveChannel();
  app.innerHTML = `
  <div class="login">
    <div class="login-card">
      <div class="login-badge">AKTA · ŚCIŚLE TAJNE</div>
      <h1>${esc(SITE)}</h1>
      <p class="lead">Rozwiązujcie zagadki kryminalne razem. Akta, tablica dowodów z czerwonymi nitkami, wspólny notatnik — wszystko na żywo.</p>
      ${notConfigured
        ? `<div class="warn">Strona nie jest jeszcze skonfigurowana. Uzupełnij <b>config.js</b> danymi z Supabase (instrukcja w README).</div>`
        : `<button class="btn discord" id="loginBtn">${discordIcon()} Zaloguj przez Discord</button>`}
      <div class="login-sep"><span>albo</span></div>
      <label class="btn ghost file-btn">📂 Podgląd pliku sprawy (offline)
        <input type="file" accept=".json,application/json" id="previewFile" hidden></label>
      <p class="small center">Podgląd pokazuje całą sprawę razem z rozwiązaniem — do sprawdzania plików przed wgraniem.</p>
      <a class="help-link" href="#/instrukcja">📖 Instrukcja gry i generator nowych spraw</a>
    </div>
  </div>`;
  $("#loginBtn")?.addEventListener("click", async () => {
    const m = location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
    if (m) localStorage.setItem("pendingJoin", m[1]);
    const { error } = await sb.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: location.origin + location.pathname } });
    if (error) toast(errMsg(error), "error");
  });
  $("#previewFile").addEventListener("change", e => openPreviewFromFile(e.target.files[0], () => renderLogin(notConfigured)));
}
function discordIcon() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>`;
}

/* ------------------------------------------------------------------ */
/*  Routing                                                            */
/* ------------------------------------------------------------------ */
async function route() {
  const h = location.hash;
  if (h.startsWith("#/instrukcja")) { leaveChannel(); R = null; renderHelp(); return; }
  if (!me) { R = null; renderLogin(notConfigured); return; }
  let m;
  if ((m = h.match(/^#\/join\/([A-Za-z0-9]+)/))) {
    try {
      const id = await q(sb.rpc("join_room", { p_code: m[1] }));
      location.replace(`#/room/${id}`);
    } catch (e) { toast(errMsg(e), "error"); location.replace("#/"); }
    return;
  }
  if ((m = h.match(/^#\/room\/([0-9a-f-]{36})/))) {
    if (R && R.room.id === m[1]) return;
    return openRoom(m[1]);
  }
  leaveChannel(); R = null;
  renderLobby();
}

function topbarUser() {
  return `<div class="userchip">${avatarHtml(me, 28)}<span>${esc(me.name)}</span>
    <button class="btn tiny ghost" id="logoutBtn" title="Wyloguj">Wyloguj</button></div>`;
}
function bindLogout() { $("#logoutBtn")?.addEventListener("click", () => sb.auth.signOut()); }

/* ------------------------------------------------------------------ */
/*  Lobby                                                              */
/* ------------------------------------------------------------------ */
async function renderLobby() {
  app.innerHTML = `
  <div class="lobby">
    <header class="lobby-top"><div class="brand">🔎 ${esc(SITE)}</div><a class="btn tiny ghost" href="#/instrukcja">📖 Instrukcja</a>${topbarUser()}</header>
    <main class="lobby-grid">
      <section class="panel span2">
        <h2>Twoje śledztwa</h2>
        <div id="myRooms" class="rooms"><p class="small">Wczytywanie…</p></div>
      </section>
      <section class="panel">
        <h2>Nowe śledztwo</h2>
        <div class="case-card custom">
          <div class="cc-title">📂 Własna sprawa z pliku</div>
          <div class="small">Masz plik <b>.json</b> wygenerowany przez AI? Załóż z nim pokój — sprawa będzie widoczna <b>tylko w tym pokoju</b>.
            <a href="#/instrukcja" class="ink-link">Jak zrobić plik?</a></div>
          <label class="btn ghost file-btn">Wybierz plik .json<input type="file" id="customCaseFile" accept=".json,application/json" hidden></label>
          <div id="customInfo"></div>
        </div>
        <div id="caseList" class="cases"><p class="small">Wczytywanie spraw…</p></div>
      </section>
      <section class="panel">
        <h2>Dołącz do drużyny</h2>
        <p class="small">Wpisz kod pokoju, który dostałeś od znajomego (albo po prostu otwórz link-zaproszenie).</p>
        <form id="joinForm" class="row"><input id="joinCode" maxlength="6" placeholder="np. 7F3A9C" autocomplete="off" required>
          <button class="btn primary">Dołącz</button></form>
      </section>
      ${isAdmin ? `
      <section class="panel span2 admin">
        <h2>Panel admina — sprawy</h2>
        <div class="row wrap">
          <label class="btn primary file-btn">⬆ Wgraj sprawę (.json)<input type="file" id="uploadCase" accept=".json,application/json" hidden></label>
          <label class="btn ghost file-btn">👁 Podgląd pliku<input type="file" id="previewCase" accept=".json,application/json" hidden></label>
        </div>
        <div id="uploadInfo"></div>
        <div id="adminCases" class="admin-cases"></div>
      </section>` : ""}
    </main>
  </div>`;
  bindLogout();
  $("#joinForm").addEventListener("submit", e => {
    e.preventDefault();
    const c = $("#joinCode").value.trim().toUpperCase();
    if (c) location.hash = `#/join/${c}`;
  });
  if (isAdmin) {
    $("#uploadCase").addEventListener("change", e => handleUpload(e.target.files[0]));
    $("#previewCase").addEventListener("change", e => openPreviewFromFile(e.target.files[0], () => { location.hash = "#/"; renderLobby(); }));
  }
  $("#customCaseFile").addEventListener("change", e => handleCustomFile(e.target.files[0]));
  loadMyRooms(); loadCases();
}

async function loadMyRooms() {
  const box = $("#myRooms");
  try {
    const rows = await q(sb.from("room_members")
      .select("room_id, rooms(id, code, name, status, created_at, score, cases(title, visibility))")
      .eq("user_id", me.id));
    const rooms = rows.map(r => r.rooms).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!rooms.length) { box.innerHTML = `<p class="empty">Nie masz jeszcze żadnych śledztw. Wybierz sprawę obok i zaproś znajomych!</p>`; return; }
    box.innerHTML = rooms.map(r => `
      <a class="room-card" href="#/room/${r.id}">
        <div class="rc-title">${esc(r.name)}</div>
        <div class="rc-case">${esc(r.cases?.title || "")}${r.cases?.visibility === "private" ? ` <span class="badge">własna</span>` : ""}</div>
        <div class="rc-meta"><span class="code">${esc(r.code)}</span>
          ${r.status === "solved" ? `<span class="badge ok">rozwiązana · ${r.score?.total ?? "?"}/${r.score?.max ?? "?"}</span>` : `<span class="badge">w toku</span>`}
          <span class="small">${timeAgo(r.created_at)}</span></div>
      </a>`).join("");
  } catch (e) { box.innerHTML = `<p class="error">${esc(errMsg(e))}</p>`; }
}

async function loadCases() {
  const box = $("#caseList");
  try {
    const cases = await q(sb.from("cases").select("id, title, data, created_at").eq("visibility", "public").order("created_at", { ascending: false }));
    if (!cases.length) {
      box.innerHTML = `<p class="empty">Brak spraw w archiwum.${isAdmin ? " Wgraj pierwszą w panelu admina poniżej." : " Poproś admina o wgranie sprawy."}</p>`;
    } else {
      box.innerHTML = cases.map(c => `
        <div class="case-card">
          <div class="cc-title">${esc(c.title)}</div>
          ${c.data?.subtitle ? `<div class="small">${esc(c.data.subtitle)}</div>` : ""}
          <div class="cc-meta">${c.data?.meta?.players ? `👥 ${esc(c.data.meta.players)}` : ""} ${c.data?.meta?.time ? `· ⏱ ${esc(c.data.meta.time)}` : ""} ${c.data?.meta?.difficulty ? `· 🎯 ${esc(c.data.meta.difficulty)}` : ""}</div>
          <form class="row newroom" data-case="${esc(c.id)}">
            <input name="name" maxlength="40" placeholder="Nazwa drużyny (opcjonalnie)">
            <button class="btn primary">Rozpocznij</button>
          </form>
        </div>`).join("");
      $$(".newroom", box).forEach(f => f.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = $("button", f); btn.disabled = true;
        try {
          const id = await q(sb.rpc("create_room", { p_case: f.dataset.case, p_name: f.name.value }));
          location.hash = `#/room/${id}`;
        } catch (err) { toast(errMsg(err), "error"); btn.disabled = false; }
      }));
    }
    if (isAdmin) renderAdminCases(cases);
  } catch (e) { box.innerHTML = `<p class="error">${esc(errMsg(e))}</p>`; }
}

function renderAdminCases(cases) {
  const box = $("#adminCases");
  if (!box) return;
  box.innerHTML = cases.length ? `<table class="grid"><thead><tr><th>Sprawa</th><th>id</th><th>Dok.</th><th></th></tr></thead><tbody>
    ${cases.map(c => `<tr><td>${esc(c.title)}</td><td><code>${esc(c.id)}</code></td><td>${(c.data?.documents || []).length}</td>
      <td class="nowrap"><button class="btn tiny ghost" data-dl="${esc(c.id)}">Pobierz JSON</button>
      <button class="btn tiny danger" data-del="${esc(c.id)}">Usuń</button></td></tr>`).join("")}</tbody></table>` : "";
  $$("[data-dl]", box).forEach(b => b.addEventListener("click", async () => {
    try {
      const c = await q(sb.from("cases").select("data").eq("id", b.dataset.dl).single());
      const s = await q(sb.from("case_secrets").select("data").eq("case_id", b.dataset.dl).single());
      downloadJson(mergeCase(c.data, s.data), `${b.dataset.dl}.json`);
    } catch (e) { toast(errMsg(e), "error"); }
  }));
  $$("[data-del]", box).forEach(b => b.addEventListener("click", async () => {
    if (!await confirmBox(`Usunąć sprawę <b>${esc(b.dataset.del)}</b>? Usunięte zostaną też <b>wszystkie pokoje</b> z tą sprawą.`, "Usuń")) return;
    try { await q(sb.from("cases").delete().eq("id", b.dataset.del)); toast("Sprawa usunięta.", "ok"); loadCases(); loadMyRooms(); }
    catch (e) { toast(errMsg(e), "error"); }
  }));
}

async function handleCustomFile(file) {
  const info = $("#customInfo");
  const input = $("#customCaseFile");
  const c = await readCaseFile(file);
  input.value = "";
  if (!c) return;
  const errs = validateCase(c);
  if (errs.length) {
    info.innerHTML = `<div class="error-box"><b>Plik ma błędy (${errs.length}):</b><ul>${errs.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="small">Skopiuj tę listę i poproś AI o poprawienie pliku.</p></div>`;
    return;
  }
  const { pub, sec } = splitCase(c);
  info.innerHTML = `
    <div class="ok-box"><b>${esc(c.title)}</b><br><span class="small">${pub.documents.length} dokumentów · ${pub.unlocks.length} wniosków · ${pub.questions.length} pytań</span></div>
    <form class="row newroom" id="customForm">
      <input name="name" maxlength="40" placeholder="Nazwa drużyny (opcjonalnie)">
      <button class="btn primary">Utwórz pokój</button>
    </form>
    <button class="btn tiny ghost" id="customPreview" type="button">👁 Podgląd (zdradza rozwiązanie!)</button>`;
  $("#customPreview").addEventListener("click", async () => {
    if (await confirmBox("Podgląd pokazuje <b>całą sprawę razem z rozwiązaniem</b>. Otworzyć?", "Pokaż")) renderPreview(c, [], () => { location.hash = "#/"; renderLobby(); });
  });
  $("#customForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button", e.target); btn.disabled = true;
    try {
      const id = await q(sb.rpc("create_room_with_case", { p_pub: pub, p_sec: sec, p_name: e.target.name.value }));
      location.hash = `#/room/${id}`;
    } catch (err) { toast(errMsg(err), "error", 6000); btn.disabled = false; }
  });
}

async function readCaseFile(file) {
  if (!file) return null;
  let c;
  try { c = JSON.parse(await file.text()); }
  catch (e) { toast("To nie jest poprawny plik JSON: " + errMsg(e), "error", 7000); return null; }
  return c;
}

async function handleUpload(file) {
  const info = $("#uploadInfo");
  const c = await readCaseFile(file);
  $("#uploadCase").value = "";
  if (!c) return;
  const errs = validateCase(c);
  if (errs.length) {
    info.innerHTML = `<div class="error-box"><b>Plik ma błędy (${errs.length}):</b><ul>${errs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    return;
  }
  const exists = await q(sb.from("cases").select("id").eq("id", c.id).maybeSingle()).catch(() => null);
  if (exists && !await confirmBox(`Sprawa o id <b>${esc(c.id)}</b> już istnieje. Nadpisać ją? (Pokoje zostaną, ale zobaczą nową wersję.)`, "Nadpisz")) return;
  const { pub, sec } = splitCase(c);
  try {
    await q(sb.from("cases").upsert({ id: c.id, title: c.title, data: pub, updated_at: new Date().toISOString() }));
    await q(sb.from("case_secrets").upsert({ case_id: c.id, data: sec }));
    info.innerHTML = `<div class="ok-box">Wgrano: <b>${esc(c.title)}</b> — ${pub.documents.length} dokumentów, ${pub.unlocks.length} wniosków, ${pub.questions.length} pytań.</div>`;
    loadCases();
  } catch (e) { info.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
}

/* ------------------------------------------------------------------ */
/*  Podgląd offline (cała sprawa z rozwiązaniem, bez logowania)        */
/* ------------------------------------------------------------------ */
async function openPreviewFromFile(file, onBack) {
  const c = await readCaseFile(file);
  if (!c) return;
  const errs = validateCase(c);
  renderPreview(c, errs, onBack);
}

function renderPreview(c, errs, onBack) {
  leaveChannel();
  const groups = groupDocs([
    ...(c.documents || []),
    ...(c.unlocks || []).flatMap(u => (u.documents || []).map(d => ({ ...d, _lockedBy: u }))),
  ]);
  let current = "__intro";
  const special = {
    __intro: () => renderDoc({ title: c.title, subtitle: c.subtitle, blocks: c.intro || [] }),
    __unlocks: () => `<article class="paper"><header class="doc-head"><h2>Wnioski i odpowiedzi</h2></header><div class="doc-body">
      ${(c.unlocks || []).map(u => `<div class="box"><div class="box-title">${inline(u.title || u.id)}</div><p>${inline(u.prompt)}</p>
        <p class="small">Akceptowane (${esc(u.match || "exact")}): ${(u.answers || []).map(a => `<code>${esc(a)}</code>`).join(" ")}</p>
        <p class="small">Po odblokowaniu: ${inline(u.message || "—")} · dokumenty: ${(u.documents || []).map(d => esc(d.no || d.id)).join(", ")}</p></div>`).join("") || "<p>Brak wniosków.</p>"}
      </div></article>`,
    __questions: () => `<article class="paper"><header class="doc-head"><h2>Pytania, odpowiedzi i podpowiedzi</h2></header><div class="doc-body">
      ${(c.questions || []).map(qq => `<div class="box"><div class="box-title">${inline(qq.label)} <span class="small">(${qq.points || 0} pkt)</span></div>
        ${qq.type === "choice" ? `<ul class="list">${qq.options.map(o => `<li>${o.id === qq.answer ? "✅ <b>" : ""}${inline(o.label)}${o.id === qq.answer ? "</b>" : ""}</li>`).join("")}</ul>`
          : `<p class="small">Pytanie opisowe — zaliczone, gdy odpowiedź zawiera co najmniej ${qq.min_keywords || 1} z fraz: ${(qq.keywords || []).map(k => `<code>${esc(k)}</code>`).join(" ")}</p>`}
        ${((c.hints || {})[qq.id] || []).map((h, i) => `<p class="hint"><b>Podpowiedź ${i + 1}:</b> ${inline(h)}</p>`).join("")}</div>`).join("")}
      </div></article>`,
    __solution: () => renderDoc({ title: "Rozwiązanie", blocks: c.solution || [] }),
  };
  const draw = () => {
    const doc = special[current] ? null : groups.all.find(d => d.id === current);
    app.innerHTML = `
    <div class="room preview">
      <header class="topbar">
        <button class="btn tiny ghost" id="pvBack">← Wróć</button>
        <div class="tb-title"><b>PODGLĄD:</b> ${esc(c.title || "(bez tytułu)")}</div>
        <span class="badge warn">zawiera rozwiązanie</span>
      </header>
      ${errs.length ? `<div class="error-box m"><b>Błędy w pliku (${errs.length}):</b><ul>${errs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : `<div class="ok-box m">Plik jest poprawny — można go wgrać.</div>`}
      <div class="akta ${current ? "has-doc" : ""}">
        <aside class="doclist">
          <button class="docitem ${current === "__intro" ? "active" : ""}" data-doc="__intro">📋 Odprawa</button>
          ${renderDocGroups(groups, current, {})}
          <div class="dl-group">Dla autora</div>
          <button class="docitem ${current === "__unlocks" ? "active" : ""}" data-doc="__unlocks">📝 Wnioski i odpowiedzi</button>
          <button class="docitem ${current === "__questions" ? "active" : ""}" data-doc="__questions">❓ Pytania i podpowiedzi</button>
          <button class="docitem ${current === "__solution" ? "active" : ""}" data-doc="__solution">🔓 Rozwiązanie</button>
        </aside>
        <section class="viewer">
          <button class="btn tiny ghost back-mobile" data-doc="">← Lista dokumentów</button>
          ${special[current] ? special[current]() : doc ? renderDoc(doc, doc._lockedBy ? `<p class="lockinfo">🔒 Odblokowywany wnioskiem: <b>${inline(doc._lockedBy.title || doc._lockedBy.id)}</b></p>` : "") : ""}
        </section>
      </div>
    </div>`;
    $("#pvBack").addEventListener("click", onBack);
    $$("[data-doc]").forEach(b => b.addEventListener("click", () => { current = b.dataset.doc; draw(); window.scrollTo(0, 0); }));
  };
  draw();
}

/* ------------------------------------------------------------------ */
/*  Pokój śledztwa                                                     */
/* ------------------------------------------------------------------ */
async function openRoom(id) {
  leaveChannel();
  app.innerHTML = `<div class="boot">Otwieranie akt…</div>`;
  try {
    const room = await q(sb.from("rooms").select("*").eq("id", id).maybeSingle());
    if (!room) { toast("Nie masz dostępu do tego pokoju albo już nie istnieje.", "error"); location.replace("#/"); return; }
    const cs = await q(sb.from("cases").select("data, visibility, owner").eq("id", room.case_id).single());
    R = newRoomState(room, cs.data);
    R.caseMeta = { visibility: cs.visibility, owner: cs.owner };
    R.tab = sessionStorage.getItem(`tab:${id}`) || "akta";
    R.docId = sessionStorage.getItem(`doc:${id}`) || "__intro";

    const [members, unlockRows, unlocked, hints, events, items, links, notes] = await Promise.all([
      q(sb.from("room_members").select("user_id, joined_at, profiles(name, avatar)").eq("room_id", id)),
      q(sb.from("room_unlocks").select("unlock_id").eq("room_id", id)),
      q(sb.rpc("get_unlocked", { p_room: id })),
      q(sb.from("room_hints").select("*").eq("room_id", id).order("used_at")),
      q(sb.from("room_events").select("*").eq("room_id", id).order("id", { ascending: false }).limit(150)),
      q(sb.from("board_items").select("*").eq("room_id", id)),
      q(sb.from("board_links").select("*").eq("room_id", id)),
      q(sb.from("room_notes").select("*").eq("room_id", id).maybeSingle()),
    ]);
    members.forEach(m => { R.members.set(m.user_id, m.profiles || { name: "?" }); R.profiles.set(m.user_id, m.profiles || { name: "?" }); });
    R.unlockIds = new Set(unlockRows.map(u => u.unlock_id));
    R.unlocked = unlocked || [];
    R.hints = hints; R.events = events;
    items.forEach(i => R.items.set(i.id, i));
    links.forEach(l => R.links.set(l.id, l));
    if (notes) R.notes = notes;
    await ensureProfiles(events.map(e => e.user_id));
    if (room.status === "solved") await loadSolution();
    subscribeRoom(id);
    renderRoom();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="boot error">Błąd: ${esc(errMsg(e))}<br><a href="#/">← Wróć do lobby</a></div>`;
  }
}

async function ensureProfiles(ids) {
  const missing = [...new Set(ids.filter(x => x && !R.profiles.has(x)))];
  if (!missing.length) return;
  try {
    const rows = await q(sb.from("profiles").select("id, name, avatar").in("id", missing));
    rows.forEach(p => R.profiles.set(p.id, p));
  } catch { /* ignore */ }
}
function prof(id) { return R?.profiles.get(id) || R?.members.get(id) || { name: "Ktoś" }; }

async function loadSolution() {
  try { R.solution = await q(sb.rpc("get_solution", { p_room: R.room.id })); }
  catch (e) { R.solution = null; }
}

function leaveChannel() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

function subscribeRoom(id) {
  channel = sb.channel(`room:${id}`, { config: { presence: { key: me.id } } });
  const f = `room_id=eq.${id}`;
  const on = (table, event, filter, fn) => channel.on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, fn);

  on("rooms", "UPDATE", `id=eq.${id}`, async p => {
    const was = R.room.status;
    R.room = { ...R.room, ...p.new };
    if (was !== "solved" && R.room.status === "solved") {
      await loadSolution();
      toast("🔓 Drużyna wysłała odpowiedź! Zobacz wynik w zakładce <b>Rozwiązanie</b>.", "ok", 6000);
      renderRoom();
    }
  });
  on("room_members", "INSERT", f, async p => {
    const pr = await q(sb.from("profiles").select("id, name, avatar").eq("id", p.new.user_id).maybeSingle()).catch(() => null);
    if (pr) { R.members.set(pr.id, pr); R.profiles.set(pr.id, pr); }
    renderPresence(); if (R.tab === "notatki") renderTab();
  });
  on("room_members", "DELETE", null, p => {
    if (p.old?.room_id && p.old.room_id !== id) return;
    if (p.old?.user_id) R.members.delete(p.old.user_id);
    if (R.tab === "notatki") renderTab();
  });
  on("room_unlocks", "INSERT", f, async () => {
    try {
      R.unlocked = await q(sb.rpc("get_unlocked", { p_room: id }));
      R.unlockIds = new Set(R.unlocked.map(u => u.id));
    } catch { /* ignore */ }
    if (R.tab === "akta") renderTab();
  });
  on("room_hints", "INSERT", f, p => {
    if (!R.hints.some(h => h.question_id === p.new.question_id && h.idx === p.new.idx)) R.hints.push(p.new);
    if (R.tab === "rozwiazanie") renderTab();
  });
  on("room_events", "INSERT", f, async p => {
    R.events.unshift(p.new);
    await ensureProfiles([p.new.user_id]);
    if (p.new.kind === "case_updated") await reloadCase(p.new.user_id !== me.id);
    if (p.new.user_id !== me.id) eventToast(p.new);
    if (R.tab === "notatki") renderEventLog();
  });
  on("board_items", "INSERT", f, p => { R.items.set(p.new.id, p.new); if (R.tab === "tablica") upsertCard(p.new); });
  on("board_items", "UPDATE", f, p => {
    if (R.dragging === p.new.id) return;
    R.items.set(p.new.id, p.new); if (R.tab === "tablica") upsertCard(p.new);
  });
  on("board_items", "DELETE", null, p => {
    if (!p.old?.id || !R.items.has(p.old.id)) return;
    R.items.delete(p.old.id);
    [...R.links.values()].forEach(l => { if (l.a === p.old.id || l.b === p.old.id) R.links.delete(l.id); });
    if (R.tab === "tablica") { $(`.card[data-id="${p.old.id}"]`)?.remove(); drawLinks(); }
  });
  on("board_links", "INSERT", f, p => { R.links.set(p.new.id, p.new); if (R.tab === "tablica") drawLinks(); });
  on("board_links", "DELETE", null, p => {
    if (!p.old?.id || !R.links.has(p.old.id)) return;
    R.links.delete(p.old.id); if (R.tab === "tablica") drawLinks();
  });
  on("room_notes", "UPDATE", f, p => {
    R.notes = p.new;
    const ta = $("#notesArea");
    if (ta && p.new.updated_by !== me.id && Date.now() - R.notesLocalEdit > 2500) {
      const focused = document.activeElement === ta;
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = p.new.text;
      if (focused) { ta.selectionStart = Math.min(s, ta.value.length); ta.selectionEnd = Math.min(e, ta.value.length); }
    }
    renderNotesStatus();
  });
  channel.on("presence", { event: "sync" }, () => {
    const st = channel.presenceState();
    R.presence = {};
    Object.entries(st).forEach(([k, arr]) => { if (arr && arr[0]) R.presence[k] = arr[0]; });
    renderPresence();
    if (R.tab === "akta") updateViewers();
  });
  channel.subscribe(async status => {
    if (status === "SUBSCRIBED") trackPresence();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") toast("Problem z połączeniem na żywo — odśwież stronę, jeśli zmiany innych się nie pojawiają.", "error", 6000);
  });
}
function trackPresence() {
  if (!channel) return;
  channel.track({ name: me.name, avatar: me.avatar, viewing: R?.tab === "akta" ? R.docId : R?.tab, at: Date.now() }).catch(() => {});
}

function eventText(ev) {
  const who = `<b>${esc(prof(ev.user_id).name)}</b>`;
  const pl = ev.payload || {};
  const ql = (id) => R.caseData.questions?.find(x => x.id === id)?.label || id;
  switch (ev.kind) {
    case "created": return `${who} założył(a) pokój`;
    case "joined": return `${who} dołączył(a) do śledztwa`;
    case "unlock_ok": return `${who} złożył(a) trafny wniosek: <b>${esc(pl.title || "")}</b> 🔓`;
    case "unlock_fail": return `${who} — wniosek odrzucony (${esc(pl.title || "")}): „${esc(pl.answer || "")}”`;
    case "hint": return `${who} wziął/wzięła podpowiedź ${pl.n || ""} do pytania: ${esc(plain(ql(pl.question)))}`;
    case "case_updated": return `${who} wgrał(a) poprawioną wersję pliku sprawy`;
    case "solved": return `${who} wysłał(a) odpowiedź drużyny — wynik <b>${pl.total}/${pl.max}</b>`;
    default: return `${who}: ${esc(ev.kind)}`;
  }
}
async function reloadCase(announce) {
  try {
    const cs = await q(sb.from("cases").select("data, visibility, owner").eq("id", R.room.case_id).single());
    R.caseData = cs.data; R.caseMeta = { visibility: cs.visibility, owner: cs.owner };
    R.unlocked = await q(sb.rpc("get_unlocked", { p_room: R.room.id }));
    R.unlockIds = new Set(R.unlocked.map(u => u.id));
    if (R.docId && !["__intro", "__unlocks"].includes(R.docId) && !allDocs().some(d => d.id === R.docId)) R.docId = "__intro";
    if (announce) toast("📂 Założyciel wgrał poprawioną wersję sprawy — akta odświeżone.", "info", 5000);
    renderRoom();
  } catch (e) { toast(errMsg(e), "error"); }
}

function eventToast(ev) {
  if (["unlock_ok", "hint", "joined"].includes(ev.kind)) toast(eventText(ev), ev.kind === "unlock_ok" ? "ok" : "info");
}

/* ------------------------------------------------------------------ */
/*  Szkielet pokoju                                                    */
/* ------------------------------------------------------------------ */
const TABS = [["akta", "📁 Akta"], ["tablica", "🧵 Tablica"], ["notatki", "🗒 Notatki"], ["rozwiazanie", "⚖️ Rozwiązanie"]];

function renderRoom() {
  const r = R.room, c = R.caseData;
  app.innerHTML = `
  <div class="room">
    <header class="topbar">
      <a class="btn tiny ghost" href="#/" title="Lobby">←</a>
      <div class="tb-title"><span class="tb-case">${esc(c.title)}</span><span class="tb-room">${esc(r.name)}</span></div>
      <button class="code-chip" id="inviteBtn" title="Kopiuj link-zaproszenie">Kod: <b>${esc(r.code)}</b> 🔗</button>
      <div class="presence" id="presence"></div>
      ${r.status === "solved" ? `<span class="badge ok">rozwiązana</span>` : ""}
      ${R.caseMeta?.visibility === "private" ? `<span class="badge" title="Sprawa wgrana z pliku — widoczna tylko w tym pokoju">własna sprawa</span>` : ""}
      <a class="btn tiny ghost" href="#/instrukcja" target="_blank" rel="noopener" title="Instrukcja (nowa karta)">📖</a>
      ${topbarUser()}
    </header>
    <nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${R.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav>
    <main id="tabview"></main>
  </div>`;
  bindLogout();
  $("#inviteBtn").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#/join/${r.code}`;
    try { await navigator.clipboard.writeText(url); toast(`Skopiowano link-zaproszenie. Kod pokoju: <b>${esc(r.code)}</b>`, "ok"); }
    catch { prompt("Skopiuj link-zaproszenie:", url); }
  });
  $$(".tabs button").forEach(b => b.addEventListener("click", () => {
    R.tab = b.dataset.tab; sessionStorage.setItem(`tab:${r.id}`, R.tab);
    $$(".tabs button").forEach(x => x.classList.toggle("active", x === b));
    renderTab(); trackPresence();
  }));
  renderPresence();
  renderTab();
}

function renderPresence() {
  const el = $("#presence");
  if (!el || !R) return;
  const online = Object.entries(R.presence);
  el.innerHTML = online.map(([id, p]) => `<span class="pres" title="${esc(p.name)} — ${esc(viewingLabel(p.viewing))}">${avatarHtml(p, 26, false)}<i class="dot"></i></span>`).join("")
    + `<span class="small pres-count">${online.length} online</span>`;
}
function viewingLabel(v) {
  if (!v) return "w pokoju";
  if (v === "tablica") return "przy tablicy";
  if (v === "notatki") return "w notatkach";
  if (v === "rozwiazanie") return "przy rozwiązaniu";
  if (v === "__intro") return "czyta odprawę";
  if (v === "__unlocks") return "przy wnioskach";
  const d = allDocs().find(x => x.id === v);
  return d ? `czyta: ${plain(d.title)}` : "w aktach";
}

function renderTab() {
  const v = $("#tabview");
  if (!v) return;
  if (R.tab === "akta") renderAkta(v);
  else if (R.tab === "tablica") renderBoard(v);
  else if (R.tab === "notatki") renderNotes(v);
  else renderAnswer(v);
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Akta                                                     */
/* ------------------------------------------------------------------ */
function allDocs() {
  if (!R) return [];
  return [...(R.caseData.documents || []), ...R.unlocked.flatMap(u => (u.documents || []).map(d => ({ ...d, _unlocked: true })))];
}
function groupDocs(docs) {
  const order = [], map = {};
  docs.forEach(d => {
    const cat = d.category || "Dokumenty";
    if (!map[cat]) { map[cat] = []; order.push(cat); }
    map[cat].push(d);
  });
  return { order, map, all: docs };
}
function renderDocGroups(groups, current, viewers) {
  return groups.order.map(cat => `<div class="dl-group">${esc(cat)}</div>` + groups.map[cat].map(d => `
    <button class="docitem ${current === d.id ? "active" : ""} ${d._unlocked ? "unlocked" : ""} ${d._lockedBy ? "locked" : ""}" data-doc="${esc(d.id)}">
      <span class="di-no">${esc(d.no || "")}</span><span class="di-title">${inline(d.title)}</span>
      ${d._unlocked ? `<span class="di-tag">🔓 nowy</span>` : ""}${d._lockedBy ? `<span class="di-tag">🔒</span>` : ""}
      <span class="di-viewers" data-viewers="${esc(d.id)}">${(viewers[d.id] || []).map(p => avatarHtml(p, 18)).join("")}</span>
    </button>`).join("")).join("");
}
function viewersMap() {
  const m = {};
  Object.entries(R.presence).forEach(([id, p]) => { if (id !== me.id && p.viewing) (m[p.viewing] = m[p.viewing] || []).push(p); });
  return m;
}
function updateViewers() {
  const m = viewersMap();
  $$("[data-viewers]").forEach(el => { el.innerHTML = (m[el.dataset.viewers] || []).map(p => avatarHtml(p, 18)).join(""); });
}

function renderAkta(v) {
  const groups = groupDocs(allDocs());
  const unl = R.caseData.unlocks || [];
  const openCount = unl.filter(u => !R.unlockIds.has(u.id)).length;
  const vm = viewersMap();
  let content;
  if (R.docId === "__intro") {
    content = renderDoc({ title: R.caseData.title, subtitle: R.caseData.subtitle, blocks: R.caseData.intro || [] },
      R.caseData.meta ? `<p class="doc-meta">${R.caseData.meta.players ? `👥 ${esc(R.caseData.meta.players)} graczy` : ""} ${R.caseData.meta.time ? `· ⏱ ${esc(R.caseData.meta.time)}` : ""} ${R.caseData.meta.difficulty ? `· 🎯 ${esc(R.caseData.meta.difficulty)}` : ""}</p>` : "");
  } else if (R.docId === "__unlocks") {
    content = renderUnlocks();
  } else {
    const d = groups.all.find(x => x.id === R.docId);
    content = d ? renderDoc(d) + `<div class="doc-actions"><button class="btn" id="pinBtn">📌 Przypnij na tablicę</button></div>`
                : `<p class="empty">Wybierz dokument z listy.</p>`;
  }
  v.innerHTML = `
  <div class="akta ${R.docId ? "has-doc" : ""}">
    <aside class="doclist">
      <button class="docitem ${R.docId === "__intro" ? "active" : ""}" data-doc="__intro">📋 Odprawa
        <span class="di-viewers" data-viewers="__intro">${(vm.__intro || []).map(p => avatarHtml(p, 18)).join("")}</span></button>
      ${unl.length ? `<button class="docitem wnioski ${R.docId === "__unlocks" ? "active" : ""}" data-doc="__unlocks">📝 Wnioski
        ${openCount ? `<span class="di-tag hot">${openCount} do złożenia</span>` : `<span class="di-tag">✓ wszystkie</span>`}
        <span class="di-viewers" data-viewers="__unlocks">${(vm.__unlocks || []).map(p => avatarHtml(p, 18)).join("")}</span></button>` : ""}
      ${renderDocGroups(groups, R.docId, vm)}
    </aside>
    <section class="viewer">
      <button class="btn tiny ghost back-mobile" data-doc="">← Lista dokumentów</button>
      ${content}
    </section>
  </div>`;
  $$("[data-doc]", v).forEach(b => b.addEventListener("click", () => {
    R.docId = b.dataset.doc; sessionStorage.setItem(`doc:${R.room.id}`, R.docId);
    renderAkta(v); trackPresence();
    $(".viewer", v)?.scrollTo?.(0, 0); if (window.innerWidth < 860) window.scrollTo(0, 0);
  }));
  $("#pinBtn", v)?.addEventListener("click", () => pinDoc(R.docId));
  $$(".unlock-form", v).forEach(f => f.addEventListener("submit", async e => {
    e.preventDefault();
    const ans = f.answer.value.trim();
    if (!ans) return;
    const btn = $("button", f); btn.disabled = true;
    try {
      const ok = await q(sb.rpc("try_unlock", { p_room: R.room.id, p_unlock: f.dataset.unlock, p_answer: ans }));
      if (ok) {
        R.unlocked = await q(sb.rpc("get_unlocked", { p_room: R.room.id }));
        R.unlockIds = new Set(R.unlocked.map(u => u.id));
        const msg = R.unlocked.find(u => u.id === f.dataset.unlock)?.message;
        toast(`🔓 Wniosek przyjęty! ${msg ? inline(msg) : "Nowe dokumenty trafiły do akt."}`, "ok", 6000);
        renderAkta(v);
      } else {
        toast("Wniosek odrzucony — to nie to. Spróbujcie jeszcze raz.", "error");
        f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
        btn.disabled = false;
      }
    } catch (err) { toast(errMsg(err), "error"); btn.disabled = false; }
  }));
}

function renderUnlocks() {
  const unl = R.caseData.unlocks || [];
  const fails = R.events.filter(e => e.kind === "unlock_fail");
  return `<article class="paper"><header class="doc-head"><span class="doc-no">WNIOSKI</span><h2>Wnioski do prokuratury i techników</h2></header>
    <p class="doc-sub">Złóż trafny wniosek, a do akt trafią nowe materiały. Wielkość liter i polskie znaki nie mają znaczenia.</p>
    <div class="doc-body">
    ${unl.map(u => {
      const done = R.unlockIds.has(u.id);
      const res = R.unlocked.find(x => x.id === u.id);
      const tries = fails.filter(f => f.payload?.unlock === u.id).slice(0, 5);
      return `<div class="unlock ${done ? "done" : ""}">
        <div class="unlock-title">${done ? "✅" : "🔒"} ${inline(u.title)}</div>
        <p>${inline(u.prompt)}</p>
        ${done ? `<p class="ok-line">${inline(res?.message || "Wniosek przyjęty.")}</p>
                  <div class="row wrap">${(res?.documents || []).map(d => `<button class="btn tiny" data-doc="${esc(d.id)}">Otwórz dok. ${esc(d.no || "")}: ${inline(d.title)}</button>`).join("")}</div>`
               : `<form class="unlock-form row" data-unlock="${esc(u.id)}">
                    <input name="answer" maxlength="80" placeholder="${esc(u.placeholder || "Twoja odpowiedź")}" autocomplete="off" required>
                    <button class="btn primary">Złóż wniosek</button></form>
                  ${tries.length ? `<p class="small">Odrzucone: ${tries.map(t => `„${esc(t.payload?.answer)}”`).join(", ")}</p>` : ""}`}
      </div>`;
    }).join("")}
    </div></article>`;
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Tablica dowodów                                          */
/* ------------------------------------------------------------------ */
const BOARD_W = 2600, BOARD_H = 1700;
const COLORS = ["yellow", "pink", "blue", "green"];

function boardCenter() {
  const wrap = $(".board-wrap");
  if (!wrap) return { x: 120 + Math.random() * 200, y: 120 + Math.random() * 120 };
  return {
    x: Math.max(20, Math.min(BOARD_W - 240, wrap.scrollLeft + wrap.clientWidth / 2 - 100 + (Math.random() * 80 - 40))),
    y: Math.max(20, Math.min(BOARD_H - 160, wrap.scrollTop + wrap.clientHeight / 2 - 60 + (Math.random() * 80 - 40))),
  };
}

async function pinDoc(docId) {
  if ([...R.items.values()].some(i => i.kind === "doc" && i.ref === docId)) { toast("Ten dokument już wisi na tablicy.", "info"); return; }
  const pos = R.tab === "tablica" ? boardCenter() : { x: 80 + (R.items.size % 8) * 230, y: 80 + Math.floor(R.items.size / 8) * 170 };
  try {
    const row = await q(sb.from("board_items").insert({ room_id: R.room.id, kind: "doc", ref: docId, x: pos.x, y: pos.y }).select().single());
    R.items.set(row.id, row);
    toast("📌 Przypięto na tablicy.", "ok");
  } catch (e) { toast(errMsg(e), "error"); }
}

function renderBoard(v) {
  v.innerHTML = `
  <div class="boardbar">
    <button class="btn" id="addNote">＋ Karteczka</button>
    <button class="btn ${R.linkMode ? "primary" : ""}" id="linkMode">🧵 ${R.linkMode ? "Łączenie: kliknij 2 elementy" : "Połącz nitką"}</button>
    <span class="small">Przypinaj dokumenty z Akt przyciskiem 📌. Przeciągaj elementy; kliknij nitkę, by ją usunąć.</span>
  </div>
  <div class="board-wrap"><div class="board" id="board" style="width:${BOARD_W}px;height:${BOARD_H}px">
    <svg class="links" id="links" width="${BOARD_W}" height="${BOARD_H}"></svg>
  </div></div>`;
  const board = $("#board");
  R.items.forEach(it => board.appendChild(cardEl(it)));
  requestAnimationFrame(drawLinks);
  $("#addNote").addEventListener("click", async () => {
    const pos = boardCenter();
    try {
      const row = await q(sb.from("board_items").insert({ room_id: R.room.id, kind: "note", text: "", color: COLORS[R.items.size % COLORS.length], x: pos.x, y: pos.y }).select().single());
      R.items.set(row.id, row); upsertCard(row);
      setTimeout(() => $(`.card[data-id="${row.id}"] textarea`)?.focus(), 50);
    } catch (e) { toast(errMsg(e), "error"); }
  });
  $("#linkMode").addEventListener("click", () => { R.linkMode = !R.linkMode; R.linkFrom = null; renderBoard(v); });
  $("#links").addEventListener("click", async e => {
    const line = e.target.closest("[data-link]");
    if (!line) return;
    if (!await confirmBox("Usunąć tę nitkę?", "Usuń")) return;
    try { await q(sb.from("board_links").delete().eq("id", line.dataset.link)); R.links.delete(line.dataset.link); drawLinks(); }
    catch (err) { toast(errMsg(err), "error"); }
  });
}

function cardInner(it) {
  const by = prof(it.created_by).name;
  if (it.kind === "doc") {
    const d = allDocs().find(x => x.id === it.ref);
    return `<i class="pin"></i><div class="card-no">${d ? `DOK. ${esc(d.no || "")}` : "DOKUMENT"}</div>
      <div class="card-title">${d ? inline(d.title) : "(dokument niedostępny)"}</div>
      <div class="card-actions"><button class="btn tiny ghost" data-act="open">Otwórz</button><button class="btn tiny ghost" data-act="del" title="Zdejmij">✕</button></div>
      <div class="card-by">${esc(by)}</div>`;
  }
  return `<i class="pin"></i><textarea maxlength="400" placeholder="Wpisz trop…">${esc(it.text || "")}</textarea>
    <div class="card-actions"><button class="btn tiny ghost" data-act="color" title="Kolor">🎨</button><button class="btn tiny ghost" data-act="del" title="Usuń">✕</button></div>
    <div class="card-by">${esc(by)}</div>`;
}

function cardEl(it) {
  const el = document.createElement("div");
  el.className = `card ${it.kind} c-${it.color || "yellow"}`;
  el.dataset.id = it.id;
  el.style.left = it.x + "px"; el.style.top = it.y + "px";
  el.innerHTML = cardInner(it);
  bindCard(el);
  return el;
}

function upsertCard(it) {
  const board = $("#board");
  if (!board) return;
  const old = $(`.card[data-id="${it.id}"]`, board);
  if (!old) { board.appendChild(cardEl(it)); drawLinks(); return; }
  old.style.left = it.x + "px"; old.style.top = it.y + "px";
  old.className = `card ${it.kind} c-${it.color || "yellow"}${R.linkFrom === it.id ? " selected" : ""}`;
  const ta = $("textarea", old);
  if (ta && document.activeElement !== ta && ta.value !== (it.text || "")) { ta.value = it.text || ""; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + "px"; }
  drawLinks();
}

function bindCard(el) {
  const id = el.dataset.id;
  let start = null, moved = false;
  el.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    if (R.linkMode) { e.preventDefault(); linkClick(id); return; }
    if (e.target.closest("textarea")) return;
    e.preventDefault();
    const it = R.items.get(id);
    start = { x: e.clientX, y: e.clientY, ox: it.x, oy: it.y }; moved = false;
    R.dragging = id; el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", e => {
    if (!start) return;
    const it = R.items.get(id);
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    it.x = Math.max(0, Math.min(BOARD_W - el.offsetWidth, start.ox + dx));
    it.y = Math.max(0, Math.min(BOARD_H - el.offsetHeight, start.oy + dy));
    el.style.left = it.x + "px"; el.style.top = it.y + "px";
    drawLinks();
  });
  const end = async () => {
    if (!start) return;
    start = null; el.classList.remove("dragging");
    const it = R.items.get(id);
    if (moved) {
      try { await q(sb.from("board_items").update({ x: it.x, y: it.y, updated_at: new Date().toISOString() }).eq("id", id)); }
      catch (e) { toast(errMsg(e), "error"); }
    }
    setTimeout(() => { if (R.dragging === id) R.dragging = null; }, 300);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("click", async e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const it = R.items.get(id);
    if (b.dataset.act === "open") {
      R.tab = "akta"; R.docId = it.ref; sessionStorage.setItem(`tab:${R.room.id}`, "akta");
      $$(".tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab === "akta"));
      renderTab(); trackPresence();
    } else if (b.dataset.act === "del") {
      if (!await confirmBox(it.kind === "doc" ? "Zdjąć dokument z tablicy?" : "Usunąć karteczkę?", "Usuń")) return;
      try {
        await q(sb.from("board_items").delete().eq("id", id));
        R.items.delete(id);
        [...R.links.values()].forEach(l => { if (l.a === id || l.b === id) R.links.delete(l.id); });
        el.remove(); drawLinks();
      } catch (err) { toast(errMsg(err), "error"); }
    } else if (b.dataset.act === "color") {
      const nc = COLORS[(COLORS.indexOf(it.color) + 1) % COLORS.length];
      it.color = nc; upsertCard(it);
      try { await q(sb.from("board_items").update({ color: nc }).eq("id", id)); } catch (err) { toast(errMsg(err), "error"); }
    }
  });
  const ta = $("textarea", el);
  if (ta) {
    const save = debounce(async () => {
      try { await q(sb.from("board_items").update({ text: ta.value, updated_at: new Date().toISOString() }).eq("id", id)); }
      catch (err) { toast(errMsg(err), "error"); }
    }, 600);
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + "px"; drawLinks(); };
    requestAnimationFrame(grow);
    ta.addEventListener("input", () => { const it = R.items.get(id); if (it) it.text = ta.value; grow(); save(); });
  }
}

async function linkClick(id) {
  if (!R.linkFrom) {
    R.linkFrom = id;
    $(`.card[data-id="${id}"]`)?.classList.add("selected");
    return;
  }
  const a = R.linkFrom, b = id;
  R.linkFrom = null;
  $$(".card.selected").forEach(x => x.classList.remove("selected"));
  if (a === b) return;
  if ([...R.links.values()].some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) { toast("Te elementy są już połączone.", "info"); return; }
  try {
    const row = await q(sb.from("board_links").insert({ room_id: R.room.id, a, b }).select().single());
    R.links.set(row.id, row); drawLinks();
  } catch (e) { toast(errMsg(e), "error"); }
}

function drawLinks() {
  const svg = $("#links");
  if (!svg) return;
  const center = id => {
    const el = $(`.card[data-id="${id}"]`);
    const it = R.items.get(id);
    if (!el || !it) return null;
    return { x: it.x + el.offsetWidth / 2, y: it.y + 10 };
  };
  svg.innerHTML = [...R.links.values()].map(l => {
    const p1 = center(l.a), p2 = center(l.b);
    if (!p1 || !p2) return "";
    const mx = (p1.x + p2.x) / 2, my = Math.max(p1.y, p2.y) + 40;
    const d = `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
    return `<g class="link" data-link="${esc(l.id)}"><path class="hit" d="${d}"/><path class="thread" d="${d}"/></g>`;
  }).join("");
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Notatki + dziennik                                       */
/* ------------------------------------------------------------------ */
function renderNotes(v) {
  v.innerHTML = `
  <div class="notes-layout">
    <section class="panel notes-panel">
      <div class="row between"><h2>Wspólny notatnik</h2><span class="small" id="notesStatus"></span></div>
      <p class="small">Wszyscy w pokoju widzą i edytują te same notatki. Dobre miejsce na oś czasu i listę alibi.</p>
      <textarea id="notesArea" placeholder="Np.&#10;20:51 — ofiara wraca do sklepu (alarm)&#10;…">${esc(R.notes.text || "")}</textarea>
    </section>
    <aside class="side-col">
      <section class="panel">
        <h2>Drużyna</h2>
        <div class="members">${[...R.members.entries()].map(([id, p]) => `
          <div class="member">${avatarHtml(p, 30)}<span class="m-name">${esc(p.name)}${id === R.room.owner ? ` <span class="small">(założyciel)</span>` : ""}</span>
          ${R.presence[id] ? `<span class="badge ok">online</span>` : ""}</div>`).join("")}</div>
        <button class="btn tiny ghost" id="leaveRoom">Opuść pokój</button>
      </section>
      ${R.caseMeta?.visibility === "private" ? `
      <section class="panel">
        <h2>Plik sprawy</h2>
        <p class="small">To <b>własna sprawa</b> — widać ją tylko w tym pokoju${R.caseMeta.owner === me.id ? "" : " (wgrał ją założyciel)"}.</p>
        ${R.caseMeta.owner === me.id && R.room.owner === me.id && R.room.status !== "solved" ? `
          <p class="small">Znalazłeś błąd w sprawie? Wgraj poprawiony plik — postęp drużyny (wnioski, tablica, notatki, podpowiedzi) zostaje.</p>
          <label class="btn tiny file-btn">⬆ Wgraj poprawioną wersję<input type="file" id="replaceCase" accept=".json,application/json" hidden></label>` : ""}
      </section>` : ""}
      <section class="panel">
        <h2>Dziennik śledztwa</h2>
        <div id="eventLog" class="eventlog"></div>
      </section>
    </aside>
  </div>`;
  const ta = $("#notesArea");
  const save = debounce(async () => {
    try {
      const row = await q(sb.from("room_notes").update({ text: ta.value, updated_by: me.id, updated_at: new Date().toISOString() })
        .eq("room_id", R.room.id).select().single());
      R.notes = row; renderNotesStatus();
    } catch (e) { toast("Nie zapisano notatek: " + errMsg(e), "error"); }
  }, 700);
  ta.addEventListener("input", () => { R.notesLocalEdit = Date.now(); $("#notesStatus").textContent = "zapisywanie…"; save(); });
  $("#replaceCase")?.addEventListener("change", async e => {
    const c = await readCaseFile(e.target.files[0]);
    e.target.value = "";
    if (!c) return;
    const errs = validateCase(c);
    if (errs.length) { toast(`Plik ma błędy (${errs.length}): ${esc(errs.slice(0, 3).join(" · "))}${errs.length > 3 ? " …" : ""}`, "error", 9000); return; }
    if (!await confirmBox(`Podmienić sprawę na <b>${esc(c.title)}</b>? Wszyscy w pokoju zobaczą nową wersję akt.`, "Podmień")) return;
    const { pub, sec } = splitCase(c);
    try { await q(sb.rpc("replace_room_case", { p_room: R.room.id, p_pub: pub, p_sec: sec })); toast("Sprawa zaktualizowana.", "ok"); await reloadCase(false); }
    catch (err) { toast(errMsg(err), "error", 6000); }
  });
  $("#leaveRoom").addEventListener("click", async () => {
    if (!await confirmBox("Opuścić ten pokój? Wrócisz tylko przez nowe zaproszenie. Jeśli jesteś ostatni, pokój zostanie usunięty.", "Opuść")) return;
    try { await q(sb.rpc("leave_room", { p_room: R.room.id })); location.hash = "#/"; } catch (e) { toast(errMsg(e), "error"); }
  });
  renderNotesStatus(); renderEventLog();
}
function renderNotesStatus() {
  const el = $("#notesStatus");
  if (!el) return;
  el.textContent = R.notes.updated_at && R.notes.updated_by ? `ostatnio: ${prof(R.notes.updated_by).name}, ${timeAgo(R.notes.updated_at)}` : "";
}
function renderEventLog() {
  const el = $("#eventLog");
  if (!el) return;
  el.innerHTML = R.events.length ? R.events.map(e => `<div class="ev ev-${esc(e.kind)}"><span class="ev-time">${timeAgo(e.created_at)}</span>${eventText(e)}</div>`).join("")
    : `<p class="small">Pusto.</p>`;
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Rozwiązanie                                              */
/* ------------------------------------------------------------------ */
function draftKey() { return `draft:${R.room.id}`; }
function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || "{}"); } catch { return {}; } }

function renderAnswer(v) {
  const c = R.caseData;
  if (R.room.status === "solved") return renderResult(v);
  const draft = loadDraft();
  const hintsFor = id => R.hints.filter(h => h.question_id === id).sort((a, b) => a.idx - b.idx);
  const pen = c.hint_penalty ?? 1;
  const maxPts = (c.questions || []).reduce((s, x) => s + (x.points || 0), 0);
  v.innerHTML = `
  <div class="answer">
    <section class="panel">
      <h2>Wniosek końcowy drużyny</h2>
      <p>Uzgodnijcie odpowiedzi razem. <b>Odpowiedź wysyła jedna osoba i tylko raz</b> — potem wszyscy zobaczą wynik i rozwiązanie.
      Maksymalnie <b>${maxPts} pkt</b>. Każda podpowiedź: <b>−${pen} pkt</b> (wykorzystano: ${R.hints.length}).</p>
    </section>
    <form id="answerForm">
    ${(c.questions || []).map(qq => {
      const hs = hintsFor(qq.id), total = c.hint_counts?.[qq.id] || 0;
      return `<section class="panel question">
        <div class="row between"><h3>${inline(qq.label)}</h3><span class="badge">${qq.points || 0} pkt</span></div>
        ${qq.type === "choice"
          ? `<div class="options">${qq.options.map(o => `<label class="option"><input type="radio" name="${esc(qq.id)}" value="${esc(o.id)}" ${draft[qq.id] === o.id ? "checked" : ""}><span>${inline(o.label)}</span></label>`).join("")}</div>`
          : `<textarea name="${esc(qq.id)}" rows="5" placeholder="${esc(qq.placeholder || "Twoja odpowiedź…")}">${esc(draft[qq.id] || "")}</textarea>`}
        ${hs.map(h => `<p class="hint"><b>Podpowiedź ${h.idx + 1}</b> <span class="small">(${esc(prof(h.used_by).name)})</span>: ${inline(h.text)}</p>`).join("")}
        ${total ? `<button type="button" class="btn tiny ghost" data-hint="${esc(qq.id)}" ${hs.length >= total ? "disabled" : ""}>💡 ${hs.length >= total ? "Brak kolejnych podpowiedzi" : `Weź podpowiedź ${hs.length + 1}/${total} (−${pen} pkt)`}</button>` : ""}
      </section>`;
    }).join("")}
    <div class="submit-row"><button class="btn primary big">⚖️ Wyślij odpowiedź drużyny</button></div>
    </form>
  </div>`;
  const form = $("#answerForm");
  const collect = () => {
    const out = {};
    (c.questions || []).forEach(qq => {
      if (qq.type === "choice") { const ch = $(`input[name="${CSS.escape(qq.id)}"]:checked`, form); if (ch) out[qq.id] = ch.value; }
      else out[qq.id] = form.elements[qq.id]?.value || "";
    });
    return out;
  };
  form.addEventListener("input", () => localStorage.setItem(draftKey(), JSON.stringify(collect())));
  $$("[data-hint]", v).forEach(b => b.addEventListener("click", async () => {
    if (!await confirmBox(`Wziąć podpowiedź? Cała drużyna straci <b>${pen} pkt</b>, a podpowiedź zobaczą wszyscy.`, "Biorę")) return;
    b.disabled = true;
    try { await q(sb.rpc("use_hint", { p_room: R.room.id, p_question: b.dataset.hint })); R.hints = await q(sb.from("room_hints").select("*").eq("room_id", R.room.id).order("used_at")); renderAnswer(v); }
    catch (e) { toast(errMsg(e), "error"); b.disabled = false; }
  }));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const ans = collect();
    const missing = (c.questions || []).filter(qq => !ans[qq.id] || !String(ans[qq.id]).trim());
    if (missing.length && !await confirmBox(`Nie odpowiedzieliście na ${missing.length} pyt. Wysłać mimo to?`, "Wyślij")) return;
    if (!await confirmBox("Na pewno wysłać <b>ostateczną</b> odpowiedź drużyny? Nie da się jej zmienić.", "Wysyłam")) return;
    const btn = $(".submit-row button", form); btn.disabled = true;
    try {
      const res = await q(sb.rpc("submit_answers", { p_room: R.room.id, p_answers: ans }));
      R.room.status = "solved"; R.room.score = res;
      await loadSolution();
      renderRoom();
    } catch (err) { toast(errMsg(err), "error"); btn.disabled = false; }
  });
}

function renderResult(v) {
  const c = R.caseData, s = R.room.score || {};
  const qmap = Object.fromEntries((c.questions || []).map(x => [x.id, x]));
  const label = (qq, val) => qq?.type === "choice" ? (qq.options.find(o => o.id === val)?.label || val || "—") : (val || "—");
  v.innerHTML = `
  <div class="answer">
    <section class="panel result">
      <div class="score"><span class="score-num">${s.total ?? "?"}</span><span class="score-max">/ ${s.max ?? "?"} pkt</span></div>
      <div class="rank">${inline(rankFor(c.ranks, s.total ?? 0))}</div>
      <p class="small">Odpowiedź wysłał(a): ${esc(prof(s.submitted_by).name)} · podpowiedzi: ${s.hints_used ?? 0} (−${s.penalty ?? 0} pkt)</p>
      <div class="res-list">${(s.questions || []).map(r => {
        const qq = qmap[r.id];
        return `<div class="res ${r.correct ? "ok" : "bad"}"><div class="res-q">${r.correct ? "✅" : "❌"} ${inline(qq?.label || r.id)} <span class="badge">${r.points}/${r.max}</span></div>
          <div class="res-a"><span class="small">Wasza odpowiedź:</span> ${inline(label(qq, r.answer)).replace(/\n/g, "<br>")}</div>
          ${!r.correct && qq?.type === "choice" ? `<div class="res-a"><span class="small">Poprawna:</span> <b>${inline(label(qq, r.correct_answer))}</b></div>` : ""}
          ${qq?.type === "text" ? `<div class="res-a small">Trafione kluczowe elementy: ${r.keyword_hits ?? 0}. Porównajcie swój opis z rozwiązaniem poniżej.</div>` : ""}</div>`;
      }).join("")}</div>
    </section>
    ${R.solution ? renderDoc({ title: "Rozwiązanie sprawy", blocks: R.solution }) : `<p class="small">Wczytywanie rozwiązania…</p>`}
  </div>`;
  if (!R.solution) loadSolution().then(() => { if (R.tab === "rozwiazanie") renderResult(v); });
}


/* ------------------------------------------------------------------ */
/*  Instrukcja + generator promptu do AI                               */
/* ------------------------------------------------------------------ */
let promptCache = null;
async function loadPrompt() {
  if (promptCache) return promptCache;
  const res = await fetch("PROMPT_AI.md", { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  promptCache = await res.text();
  return promptCache;
}
const PARAMS = [
  ["topic", "Temat / rodzaj zbrodni", "np. otrucie na weselu, zniknięcie streamera, kradzież w muzeum", "Temat / rodzaj zbrodni"],
  ["place", "Miejsce i epoka", "np. Wrocław 2026, dwór w latach 30., stacja badawcza", "Miejsce i epoka"],
  ["difficulty", "Poziom trudności", "", "Poziom trudności"],
  ["suspects", "Liczba podejrzanych", "", "Liczba podejrzanych"],
  ["length", "Długość", "", "Długość"],
  ["unlocks", "Liczba wniosków", "", "Liczba wniosków odblokowujących dokumenty"],
  ["id", "Id sprawy", "np. zatrute-wesele", "Id sprawy"],
  ["extra", "Dodatkowe życzenia", "np. ofiara to streamer, motyw z przeszłości, humor", "Dodatkowe życzenia"],
];
function buildPrompt(base, vals) {
  let out = base;
  PARAMS.forEach(([k, , , line]) => {
    const v = (vals[k] || "").trim();
    if (!v) return;
    const re = new RegExp(`^(- ${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:).*$`, "m");
    out = out.replace(re, `$1 ${v.replace(/\$/g, "$$$$")}`);
  });
  return out;
}

function renderHelp() {
  const back = me ? `<a class="btn tiny ghost" href="#/">← Lobby</a>` : `<a class="btn tiny ghost" href="#/">← Logowanie</a>`;
  app.innerHTML = `
  <div class="lobby help">
    <header class="lobby-top"><div class="brand">🔎 ${esc(SITE)}</div>${back}${me ? topbarUser() : ""}</header>
    <main class="help-main">
      <nav class="help-nav">
        <a href="#h-start">Start</a><a href="#h-gra">Jak grać</a><a href="#h-punkty">Punkty</a><a href="#h-ai">Nowe sprawy z AI</a><a href="#h-prompt">Prompt</a>
      </nav>

      <section class="panel" id="h-start">
        <h2>1. Start w 3 krokach</h2>
        <ol class="steps">
          <li><b>Zaloguj się przez Discord.</b> Twój nick i avatar pojawią się w grze.</li>
          <li><b>Nowe śledztwo</b> → wybierz sprawę, nadaj nazwę drużyny i kliknij <b>Rozpocznij</b>.</li>
          <li>Kliknij <b>Kod: XXXXXX 🔗</b> u góry pokoju — link-zaproszenie trafi do schowka. Wyślij go znajomym na Discordzie.
              Można też wpisać sam kod w lobby w polu <b>Dołącz do drużyny</b>.</li>
        </ol>
        <p class="small">Najlepiej grać razem na kanale głosowym — strona synchronizuje akta, tablicę i notatki, a rozmowa idzie przez Discorda.</p>
      </section>

      <section class="panel" id="h-gra">
        <h2>2. Jak grać</h2>
        <div class="help-grid">
          <div><h3>📁 Akta</h3><p>Wszystkie dokumenty sprawy: raporty, przesłuchania, billingi, paragony, notatki, mapy. Obok tytułów widać avatary osób, które właśnie czytają dany dokument. Zacznij od <b>Odprawy</b>.</p></div>
          <div><h3>📝 Wnioski</h3><p>Część materiałów policja zdobędzie dopiero na Wasz wniosek. Wpiszcie trafną odpowiedź (jest gdzieś w aktach), a nowe dokumenty trafią do akt całej drużyny. Nietrafione próby nic nie kosztują.</p></div>
          <div><h3>🧵 Tablica</h3><p>Przypinajcie dokumenty przyciskiem 📌, dodawajcie karteczki z tropami i łączcie je czerwoną nitką (<b>Połącz nitką</b> → kliknij dwa elementy). Elementy można przeciągać, kliknięcie nitki ją usuwa.</p></div>
          <div><h3>🗒 Notatki</h3><p>Wspólny notatnik całej drużyny — idealny na oś czasu i listę alibi. Obok lista graczy i dziennik śledztwa (kto co odblokował, kto wziął podpowiedź).</p></div>
          <div><h3>⚖️ Rozwiązanie</h3><p>Ustalcie razem: <b>kto</b>, <b>czym</b>, <b>dlaczego</b> i <b>jak</b> sprawca zatarł ślady. Odpowiedź wysyła <b>jedna osoba, tylko raz</b> — potem wszyscy widzą wynik i pełne rozwiązanie.</p></div>
          <div><h3>💡 Porady</h3><p>Rozpiszcie oś czasu minuta po minucie. Sprawdzajcie alibi każdego podejrzanego na <i>prawdziwy</i> czas zbrodni. Nie ufajcie niczemu, co mogło zostać ustawione — zegarom, zeznaniom bliskich. Szukajcie sprzeczności między dokumentami.</p></div>
        </div>
      </section>

      <section class="panel" id="h-punkty">
        <h2>3. Punktacja</h2>
        <p>Typowa sprawa daje <b>10 pkt</b>: sprawca 4, narzędzie 2, motyw 2, opis zacierania śladów 2 (zaliczany, gdy zawiera kluczowe elementy). Każda podpowiedź odejmuje drużynie punkty (zwykle 1). Podpowiedzi widzą wszyscy w pokoju.</p>
      </section>

      <section class="panel" id="h-ai">
        <h2>4. Własne sprawy z AI</h2>
        <p><b>Każdy gracz</b> może zagrać we własną sprawę — wystarczy plik <code>.json</code>. Sprawa z pliku trafia <b>tylko do pokoju, który z nią założysz</b>: nie pojawia się na liście dla innych, a odpowiedzi są ukryte przed graczami tak samo jak w zwykłych sprawach.</p>
        <ol class="steps">
          <li>Poniżej uzupełnij parametry (albo zostaw puste — AI wymyśli sama) i kliknij <b>Kopiuj prompt</b>.</li>
          <li>Wklej prompt do AI (najlepiej Claude albo inny mocny model) w <b>nowej rozmowie</b>.</li>
          <li>Zapisz odpowiedź jako plik <code>nazwa.json</code> (sam kod JSON, bez trzech apostrofów <code>\`\`\`</code> na początku i końcu). Jeśli AI potrafi tworzyć pliki — pobierz gotowy plik.</li>
          <li>W lobby → <b>Nowe śledztwo</b> → <b>📂 Własna sprawa z pliku</b> → wybierz plik. Strona od razu sprawdzi, czy nie ma błędów.</li>
          <li>Jeśli są błędy — skopiuj ich listę i napisz do AI: <i>„Popraw plik sprawy, strona pokazuje błędy: …”</i>.</li>
          <li>Kliknij <b>Utwórz pokój</b> i zaproś znajomych kodem. Gotowe!</li>
        </ol>
        <p class="small">Jeśli to Ty wygenerowałeś sprawę, znasz już rozwiązanie — najfajniej, gdy plik przygotuje jedna osoba, a grają pozostali. Założyciel pokoju może w zakładce <b>Notatki → Plik sprawy</b> wgrać poprawioną wersję. Gdy ostatni gracz opuści pokój, własna sprawa jest usuwana.
        <b>Admin</b> może dodatkowo wgrać sprawę publicznie (Panel admina) — wtedy jest na liście dla wszystkich.</p>
        <div class="tips">
          <p><b>Sprawa ucięta w połowie?</b> Długie sprawy mogą nie zmieścić się w jednej odpowiedzi. Prompt każe AI zatrzymać się po pełnym dokumencie — napisz wtedy <b>dalej</b> i sklej części w jeden plik. Prościej: poproś o krótszą sprawę (np. 14–16 dokumentów).</p>
          <p><b>Zbyt łatwa / dziura w logice?</b> Napisz do AI: <i>„Sprawdź, czy da się wskazać sprawcę bez odblokowania wniosku i czy każdy niewinny ma niezależne alibi. Popraw.”</i></p>
          <p><b>Poprawki literówek:</b> w pokoju z własną sprawą — <b>Notatki → Plik sprawy → Wgraj poprawioną wersję</b>. W sprawach publicznych admin wgrywa plik z tym samym <code>id</code>.</p>
        </div>
      </section>

      <section class="panel" id="h-prompt">
        <div class="row between wrap"><h2>5. Prompt do wklejenia do AI</h2>
          <div class="row"><button class="btn primary" id="copyPrompt">📋 Kopiuj prompt</button><button class="btn ghost" id="dlPrompt">⬇ Pobierz .md</button></div></div>
        <div class="param-grid">
          ${PARAMS.map(([k, label, ph]) => k === "difficulty"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: średni)</option><option>łatwy</option><option>średni</option><option>trudny</option></select></label>`
            : k === "suspects"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: 4)</option><option>3</option><option>4</option><option>5</option><option>6</option></select></label>`
            : k === "length"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: 16–22 dokumenty)</option><option>12–15 dokumentów (krótka)</option><option>16–22 dokumenty</option><option>23–30 dokumentów (długa)</option></select></label>`
            : k === "unlocks"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: 2)</option><option>1</option><option>2</option><option>3</option></select></label>`
            : `<label class="${k === "extra" || k === "topic" ? "wide" : ""}">${label}<input data-p="${k}" placeholder="${esc(ph)}" maxlength="200"></label>`).join("")}
        </div>
        <textarea id="promptText" readonly spellcheck="false">Wczytywanie promptu…</textarea>
        <p class="small">Prompt zawiera pełny opis formatu <code>detektyw-case/1</code>, zasady projektowania uczciwej zagadki i listę kontrolną. Możesz go dowolnie edytować przed wysłaniem.</p>
      </section>
    </main>
  </div>`;
  if (me) bindLogout();
  $$(".help-nav a").forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  const ta = $("#promptText");
  const vals = () => Object.fromEntries($$("[data-p]").map(el => [el.dataset.p, el.value]));
  let base = null;
  const refresh = () => { if (base) ta.value = buildPrompt(base, vals()); };
  $$("[data-p]").forEach(el => el.addEventListener("input", refresh));
  loadPrompt().then(t => { base = t; refresh(); })
    .catch(() => { ta.value = "Nie udało się wczytać pliku PROMPT_AI.md. Upewnij się, że leży w tym samym folderze co index.html (przy otwieraniu strony z dysku przeglądarka blokuje wczytywanie — wrzuć stronę na serwer albo otwórz PROMPT_AI.md bezpośrednio)."; });
  $("#copyPrompt").addEventListener("click", async () => {
    if (!base) return toast("Prompt jeszcze się wczytuje.", "error");
    try { await navigator.clipboard.writeText(ta.value); toast("📋 Skopiowano prompt — wklej go do AI.", "ok"); }
    catch { ta.select(); document.execCommand("copy"); toast("Skopiowano (zaznaczony tekst).", "ok"); }
  });
  $("#dlPrompt").addEventListener("click", () => {
    if (!base) return;
    const blob = new Blob([ta.value], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "prompt-nowa-sprawa.md"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
window.addEventListener("error", e => console.error(e.error || e.message));
window.__detektyw = { renderBlocks, validateCase, splitCase, mergeCase, renderPreview, buildPrompt };
init();
})();
