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
  if (c.story !== undefined && !Array.isArray(c.story)) errs.push(`Pole "story" musi być listą wiadomości.`);
  const sids = new Set();
  (Array.isArray(c.story) ? c.story : []).forEach(m => {
    if (!m.id) errs.push(`story: wiadomość bez "id".`);
    if (sids.has(m.id)) errs.push(`story: powtórzone id "${m.id}".`);
    sids.add(m.id);
    if (!m.title) errs.push(`story "${m.id}": brak "title".`);
    if (!Array.isArray(m.blocks)) errs.push(`story "${m.id}": brak listy "blocks".`);
    const t = m.trigger || {};
    if (t.type === "unlock") { if (!uids.has(t.unlock)) errs.push(`story "${m.id}": trigger.unlock "${t.unlock}" nie pasuje do żadnego wniosku.`); }
    else if (t.type === "minutes") { if (!(Number(t.minutes) >= 0)) errs.push(`story "${m.id}": trigger.minutes musi być liczbą minut.`); }
    else if (t.type !== "start") errs.push(`story "${m.id}": trigger.type musi być "start", "unlock" albo "minutes".`);
    (m.documents || []).forEach(d => checkDoc(d, `story "${m.id}"`));
  });
  if (c.confrontations !== undefined && !Array.isArray(c.confrontations)) errs.push(`Pole "confrontations" musi być listą.`);
  const cids = new Set();
  (Array.isArray(c.confrontations) ? c.confrontations : []).forEach(x => {
    if (!x.id) errs.push(`confrontations: sprzeczność bez "id".`);
    if (cids.has(x.id)) errs.push(`confrontations: powtórzone id "${x.id}".`);
    cids.add(x.id);
    if (!x.title) errs.push(`confrontations "${x.id}": brak "title".`);
    ["a", "b"].forEach(k => {
      if (!Array.isArray(x[k]) || !x[k].length) errs.push(`confrontations "${x.id}": "${k}" musi być niepustą listą id dokumentów.`);
      else x[k].forEach(d => { if (!ids.has(d)) errs.push(`confrontations "${x.id}": dokument "${d}" w "${k}" nie istnieje.`); });
    });
    if (Array.isArray(x.a) && Array.isArray(x.b) && x.a.some(d => x.b.includes(d))) errs.push(`confrontations "${x.id}": ten sam dokument nie może być w "a" i "b".`);
    if (x.points !== undefined && !(Number.isInteger(x.points) && x.points >= 0)) errs.push(`confrontations "${x.id}": "points" musi być liczbą całkowitą ≥ 0.`);
  });
  if (c.series !== undefined && c.series !== null) {
    if (typeof c.series !== "object" || !/^[a-z0-9-]{2,60}$/.test(c.series.id || "")) errs.push(`series: "id" — małe litery, cyfry i myślniki (np. "akta-rudnickiej").`);
    if (!(Number.isInteger(c.series?.episode) && c.series.episode >= 1)) errs.push(`series: "episode" musi być liczbą całkowitą od 1.`);
  }
  if (c.time_limit !== undefined && !(Number(c.time_limit) >= 10 && Number(c.time_limit) <= 600)) errs.push(`"time_limit" musi być liczbą minut od 10 do 600.`);
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
    has_story: Array.isArray(c.story) && c.story.length > 0,
    conf_count: Array.isArray(c.confrontations) ? c.confrontations.length : 0,
    time_limit: Number(c.time_limit) || 90,
    ...(c.series && c.series.id ? { series: { id: c.series.id, title: c.series.title || "", episode: Number(c.series.episode) || 1 } } : {}),
  };
  const sec = {
    unlocks: (c.unlocks || []).map(u => ({ id: u.id, title: u.title || "Wniosek", answers: u.answers, match: u.match || "exact",
      message: u.message || "", documents: u.documents || [] })),
    questions: (c.questions || []).map(qq => ({ id: qq.id, type: qq.type, points: qq.points || 0, answer: qq.answer ?? null,
      keywords: qq.keywords || null, min_keywords: qq.min_keywords || null })),
    hints: c.hints || {}, hint_penalty: c.hint_penalty ?? 1, solution: c.solution || [],
    story: Array.isArray(c.story) ? c.story : [],
    confrontations: Array.isArray(c.confrontations) ? c.confrontations : [],
    time_limit: Number(c.time_limit) || 90,
  };
  return { pub, sec };
}
function mergeCase(pub, sec) {
  const out = { ...pub };
  delete out.hint_counts; delete out.has_story; delete out.conf_count;
  const su = Object.fromEntries((sec.unlocks || []).map(u => [u.id, u]));
  out.unlocks = (pub.unlocks || []).map(u => ({ ...u, ...(su[u.id] || {}) }));
  const sq = Object.fromEntries((sec.questions || []).map(x => [x.id, x]));
  out.questions = (pub.questions || []).map(x => {
    const m = { ...x, ...(sq[x.id] || {}) };
    Object.keys(m).forEach(k => (m[k] === null || m[k] === undefined) && delete m[k]);
    return m;
  });
  out.hints = sec.hints || {}; out.hint_penalty = sec.hint_penalty ?? 1; out.solution = sec.solution || [];
  if ((sec.story || []).length) out.story = sec.story;
  if ((sec.confrontations || []).length) out.confrontations = sec.confrontations;
  out.time_limit = sec.time_limit ?? pub.time_limit ?? 90;
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
let streamer = (() => { try { return localStorage.getItem("streamer") === "1"; } catch { return false; } })();
let roomTimer = null, storyTimer = null;

function toggleStreamer() {
  streamer = !streamer;
  try { localStorage.setItem("streamer", streamer ? "1" : "0"); } catch { /* ignore */ }
  toast(streamer ? "🎥 Tryb streamera włączony — kody pokoi są ukryte." : "Tryb streamera wyłączony.", "info");
}
function codeText(code) { return streamer ? "••••••" : esc(code); }

/* ---- poziomy trudności ---- */
const DIFF = {
  easy:   { label: "Łatwy",    icon: "🟢", desc: "3 darmowe podpowiedzi, nietrafione konfrontacje bez kary" },
  normal: { label: "Normalny", icon: "🟡", desc: "standardowe zasady" },
  hard:   { label: "Trudny",   icon: "🔴", desc: "podpowiedzi −2 pkt, limit czasu, −1 pkt za każde rozpoczęte 15 min po limicie" },
};
function diffSelect(name = "difficulty") {
  return `<select name="${name}" class="diff-sel" title="Poziom trudności">${Object.entries(DIFF).map(([k, d]) =>
    `<option value="${k}" ${k === "normal" ? "selected" : ""} title="${esc(d.desc)}">${d.icon} ${d.label}</option>`).join("")}</select>`;
}
function diffOf() { return R?.room?.difficulty || "normal"; }
function timeLimitMin() { return Number(R?.caseData?.time_limit) || 90; }
function nextHintCost() {
  const pen = R.caseData.hint_penalty ?? 1, d = diffOf();
  if (d === "easy") return R.hints.length < 3 ? 0 : pen;
  return d === "hard" ? pen * 2 : pen;
}
function timerText() {
  const sec = elapsedSec();
  if (diffOf() === "hard") return `⏱ ${fmtDur(sec)} / ${fmtDur(timeLimitMin() * 60)}`;
  return `⏱ ${fmtDur(sec)}`;
}
function timerOver() { return diffOf() === "hard" && R.room.status !== "solved" && elapsedSec() > timeLimitMin() * 60; }

/* ---- dźwięki (generowane w przeglądarce, bez plików) ---- */
const SND = (() => {
  let ctx = null, master = null, amb = null;
  const st = (() => { try { return { fx: true, amb: false, vol: 0.6, ...JSON.parse(localStorage.getItem("sound") || "{}") }; } catch { return { fx: true, amb: false, vol: 0.6 }; } })();
  const save = () => { try { localStorage.setItem("sound", JSON.stringify(st)); } catch { /* ignore */ } };
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = st.vol; master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function noise(sec, brown = false) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  function burst(t, { dur = 0.03, freq = 2500, q = 1.2, gain = 0.4, type = "bandpass" } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noise(dur + 0.02);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.03);
  }
  function tone(t, freq, dur, { gain = 0.25, type = "sine", to = null } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  const fx = {
    type() { const t = ctx.currentTime; let x = t; const n = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) { burst(x, { dur: 0.025, freq: 1800 + Math.random() * 1600, gain: 0.35 }); x += 0.06 + Math.random() * 0.07; }
      tone(x + 0.05, 2093, 0.6, { gain: 0.12 }); tone(x + 0.05, 3136, 0.5, { gain: 0.05 }); },
    stamp() { const t = ctx.currentTime; tone(t, 110, 0.25, { gain: 0.7, to: 45 }); burst(t, { dur: 0.12, freq: 380, type: "lowpass", gain: 0.6, q: 0.7 }); },
    ding() { const t = ctx.currentTime; tone(t, 880, 0.5, { gain: 0.18 }); tone(t + 0.12, 1318, 0.7, { gain: 0.15 }); },
    paper() { const t = ctx.currentTime; burst(t, { dur: 0.22, freq: 3000, q: 0.6, gain: 0.08 }); },
    bad() { const t = ctx.currentTime; tone(t, 196, 0.18, { gain: 0.12, type: "square" }); tone(t + 0.16, 147, 0.28, { gain: 0.12, type: "square" }); },
    click() { burst(ctx.currentTime, { dur: 0.02, freq: 1200, gain: 0.3 }); },
    win() { const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.13, f, 0.5, { gain: 0.16, type: "triangle" })); },
  };
  function play(name) { if (!st.fx) return; try { if (ensure()) fx[name]?.(); } catch { /* ignore */ } }
  function startAmb() {
    if (amb || !ensure()) return;
    const rain = ctx.createBufferSource(); rain.buffer = noise(4, true); rain.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100;
    const rg = ctx.createGain(); rg.gain.value = 0.09;
    rain.connect(lp); lp.connect(rg); rg.connect(master); rain.start();
    const drone = [55, 82.4].map(f => { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.018; o.connect(g); g.connect(master); o.start(); return o; });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(rg.gain); lfo.start();
    amb = [rain, lfo, ...drone];
  }
  function stopAmb() { (amb || []).forEach(n => { try { n.stop(); } catch { /* ignore */ } }); amb = null; }
  document.addEventListener("pointerdown", () => { if (st.amb && !amb) startAmb(); });
  return {
    play, state: st,
    setFx(v) { st.fx = v; save(); },
    setAmb(v) { st.amb = v; save(); v ? startAmb() : stopAmb(); },
    setVol(v) { st.vol = v; save(); if (master) master.gain.value = v; },
  };
})();
function soundButton() { return `<button class="btn tiny ghost ${SND.state.fx || SND.state.amb ? "" : "muted"}" id="soundBtn" title="Dźwięk">${SND.state.fx || SND.state.amb ? "🔊" : "🔇"}</button>`; }
function bindSoundButton() {
  $("#soundBtn")?.addEventListener("click", () => {
    const w = showModal("🔊 Dźwięk", `
      <label class="sw"><input type="checkbox" id="sFx" ${SND.state.fx ? "checked" : ""}> Efekty (maszyna do pisania, pieczątka, powiadomienia)</label>
      <label class="sw"><input type="checkbox" id="sAmb" ${SND.state.amb ? "checked" : ""}> Klimat w tle (deszcz i niski szum)</label>
      <label class="sw col">Głośność <input type="range" id="sVol" min="0" max="1" step="0.05" value="${SND.state.vol}"></label>
      <div class="row end"><button class="btn ghost" id="sTest">▶ Test</button><button class="btn primary" data-close>Gotowe</button></div>`);
    $("#sFx", w).addEventListener("change", e => SND.setFx(e.target.checked));
    $("#sAmb", w).addEventListener("change", e => SND.setAmb(e.target.checked));
    $("#sVol", w).addEventListener("input", e => SND.setVol(+e.target.value));
    $("#sTest", w).addEventListener("click", () => { const f = SND.state.fx; SND.state.fx = true; SND.play("type"); SND.state.fx = f; });
    w.addEventListener("click", e => { if (e.target.closest("[data-close]") || e.target === w) { const b = $("#soundBtn"); if (b) b.textContent = SND.state.fx || SND.state.amb ? "🔊" : "🔇"; } });
  });
}

/* ---- teczka na start ---- */
function maybeShowFolder(after) {
  let seen = false;
  try { seen = !!localStorage.getItem(`folder:${R.room.id}`); } catch { /* ignore */ }
  if (seen || R.room.status === "solved") { after?.(); return; }
  const d = DIFF[diffOf()];
  const w = document.createElement("div");
  w.className = "folder-back";
  w.innerHTML = `<div class="folder">
      <div class="folder-tab">AKTA SPRAWY</div>
      <div class="folder-inside"><div class="f-sheet"></div><div class="f-sheet s2"></div></div>
      <div class="folder-front">
        <div class="f-org">${esc(SITE).toUpperCase()} · WYDZIAŁ KRYMINALNY</div>
        <div class="f-no">${inline(R.caseData.subtitle || "")}</div>
        <div class="f-title">${inline(R.caseData.title)}</div>
        <div class="f-meta">Drużyna: <b>${esc(R.room.name)}</b> · Poziom: ${d.icon} ${d.label}</div>
        <div class="f-stamp">ŚCIŚLE TAJNE</div>
        <button class="btn primary big" id="openFolder">📂 Otwórz akta</button>
      </div></div>`;
  document.body.appendChild(w);
  setTimeout(() => SND.play("stamp"), 450);
  $("#openFolder", w).addEventListener("click", () => {
    SND.play("paper");
    w.classList.add("opening");
    try { localStorage.setItem(`folder:${R.room.id}`, "1"); } catch { /* ignore */ }
    setTimeout(() => { w.remove(); after?.(); }, 950);
  });
}
function elapsedSec() {
  if (!R) return 0;
  const start = new Date(R.room.created_at).getTime();
  const end = R.room.status === "solved" && R.room.score?.submitted_at ? new Date(R.room.score.submitted_at).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
}
function startRoomTimers() {
  stopRoomTimers();
  roomTimer = setInterval(() => { const el = $("#timer"); if (el) { el.textContent = timerText(); el.classList.toggle("over", timerOver()); } }, 1000);
  storyTimer = setInterval(() => { loadStory(true); if (R?.room?.rival) loadRival(true); }, 30000);
}
function stopRoomTimers() { clearInterval(roomTimer); clearInterval(storyTimer); roomTimer = storyTimer = null; }
function openEditor(c, source) {
  try { localStorage.setItem("edytor", JSON.stringify({ c, source: source || { kind: "file" }, sel: "info" })); } catch { toast("Za mało miejsca w przeglądarce, żeby otworzyć edytor.", "error"); return; }
  if (location.hash.startsWith("#/edytor")) window.renderEditor?.(); else location.hash = "#/edytor";
}
function showModal(title, bodyHtml) {
  const w = document.createElement("div");
  w.className = "modal-back";
  w.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><div class="row between"><h2>${title}</h2><button class="btn tiny ghost" data-close>✕</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(w);
  w.addEventListener("click", e => { if (e.target === w || e.target.closest("[data-close]")) w.remove(); });
  return w;
}

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
    highlights: new Map(),            // zakreślenia w dokumentach
    timeline: new Map(),              // wspólna oś czasu
    draft: { answers: {}, version: 0, updated_by: null },
    votes: new Map(),                 // user_id -> wersja szkicu, za którą głosował
    draftLocalEdit: 0,
    story: [],                        // wiadomości fabularne, które już przyszły
    popped: new Set(),
    tlPrefill: null, tlEditing: null,
    conf: { found: [], wrong: 0 },    // sprzeczności
    rival: null,                      // postęp rywali
  };
}

/* ------------------------------------------------------------------ */
/*  Start i logowanie                                                  */
/* ------------------------------------------------------------------ */
let notConfigured = false;
async function init() {
  window.addEventListener("hashchange", route);
  setupSelectionBar();
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
      <a class="help-link" href="#/edytor">✏️ Edytor spraw</a>
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
  if (h.startsWith("#/edytor")) { leaveChannel(); R = null; window.renderEditor ? window.renderEditor() : renderLobby(); return; }
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
    <header class="lobby-top"><div class="brand">🔎 ${esc(SITE)}</div><a class="btn tiny ghost" href="#/instrukcja">📖 Instrukcja</a>
      <a class="btn tiny ghost" href="#/edytor">✏️ Edytor</a>
      ${soundButton()}<button class="btn tiny ghost ${streamer ? "on" : ""}" id="streamBtn" title="Tryb streamera — ukrywa kody pokoi">🎥</button>${topbarUser()}</header>
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
          <div class="row wrap"><label class="btn ghost file-btn">Wybierz plik .json<input type="file" id="customCaseFile" accept=".json,application/json" hidden></label>
            <a class="btn ghost" href="#/edytor">✏️ Stwórz w edytorze</a></div>
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
  $("#streamBtn").addEventListener("click", () => { toggleStreamer(); renderLobby(); });
  bindSoundButton();
  loadMyRooms().then(loadCases);
}

let mySolved = new Set();
async function loadMyRooms() {
  const box = $("#myRooms");
  try {
    const rows = await q(sb.from("room_members")
      .select("room_id, rooms(id, case_id, code, name, status, difficulty, created_at, score, cases(title, visibility))")
      .eq("user_id", me.id));
    const rooms = rows.map(r => r.rooms).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
    mySolved = new Set(rooms.filter(r => r.status === "solved").map(r => r.case_id));
    if (!rooms.length) { box.innerHTML = `<p class="empty">Nie masz jeszcze żadnych śledztw. Wybierz sprawę obok i zaproś znajomych!</p>`; return; }
    box.innerHTML = rooms.map(r => `
      <a class="room-card" href="#/room/${r.id}">
        <div class="rc-title">${esc(r.name)}</div>
        <div class="rc-case">${esc(r.cases?.title || "")}${r.cases?.visibility === "private" ? ` <span class="badge">własna</span>` : ""}</div>
        <div class="rc-meta"><span class="code">${codeText(r.code)}</span>
          ${r.status === "solved" ? `<span class="badge ok">rozwiązana · ${r.score?.total ?? "?"}/${r.score?.max ?? "?"}</span>` : `<span class="badge">w toku</span>`}
          <span title="${esc(DIFF[r.difficulty || "normal"]?.label || "")}">${DIFF[r.difficulty || "normal"]?.icon || ""}</span>
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
      const series = {}, single = [];
      cases.forEach(c => {
        const sr = c.data?.series;
        if (sr && sr.id) (series[sr.id] = series[sr.id] || { title: sr.title || sr.id, items: [] }).items.push(c);
        else single.push(c);
      });
      const epOf = c => Number(c.data?.series?.episode) || 1;
      const card = (c, sr) => {
        let locked = false, prevEp = 0;
        if (sr && !isAdmin) {
          prevEp = epOf(c) - 1;
          const prev = prevEp > 0 ? sr.items.find(x => epOf(x) === prevEp) : null;
          locked = !!prev && !mySolved.has(prev.id);
        }
        return `
        <div class="case-card ${locked ? "locked" : ""}">
          ${sr ? `<div class="cc-ep">Odcinek ${epOf(c)}</div>` : ""}
          <div class="cc-title">${esc(c.title)}</div>
          ${c.data?.subtitle ? `<div class="small">${esc(c.data.subtitle)}</div>` : ""}
          <div class="cc-meta">${c.data?.meta?.players ? `👥 ${esc(c.data.meta.players)}` : ""} ${c.data?.meta?.time ? `· ⏱ ${esc(c.data.meta.time)}` : ""} ${c.data?.meta?.difficulty ? `· 🎯 ${esc(c.data.meta.difficulty)}` : ""}${mySolved.has(c.id) ? ` · <b>✅ rozwiązana</b>` : ""}</div>
          ${locked ? `<p class="cc-lock">🔒 Najpierw rozwiąż odcinek ${prevEp}</p>` : `
          <form class="row newroom" data-case="${esc(c.id)}">
            <input name="name" maxlength="40" placeholder="Nazwa drużyny (opcjonalnie)">
            ${diffSelect()}
            <button class="btn primary">Rozpocznij</button>
          </form>`}
          <button class="btn tiny ghost lb-btn" type="button" data-lb="${esc(c.id)}" data-title="${esc(c.title)}">🏆 Ranking</button>
        </div>`;
      };
      box.innerHTML = Object.values(series).map(sr => {
        sr.items.sort((a, b) => epOf(a) - epOf(b));
        return `<div class="series"><div class="series-title">📚 ${esc(sr.title)} <span class="small">· ${sr.items.length} odc.</span></div>${sr.items.map(c => card(c, sr)).join("")}</div>`;
      }).join("") + single.map(c => card(c, null)).join("");
      $$("[data-lb]", box).forEach(b => b.addEventListener("click", () => {
        const w = showModal(`🏆 Ranking — ${esc(b.dataset.title)}`, `<div class="lb-box"><p class="small">Wczytywanie…</p></div>`);
        loadLeaderboard(b.dataset.lb, $(".lb-box", w), null);
      }));
      $$(".newroom", box).forEach(f => f.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = $("button", f); btn.disabled = true;
        try {
          const id = await q(sb.rpc("create_room", { p_case: f.dataset.case, p_name: f.name.value, p_difficulty: f.difficulty.value }));
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
      <td class="nowrap"><button class="btn tiny ghost" data-ed="${esc(c.id)}">✏️ Edytuj</button><button class="btn tiny ghost" data-dl="${esc(c.id)}">Pobierz JSON</button>
      <button class="btn tiny danger" data-del="${esc(c.id)}">Usuń</button></td></tr>`).join("")}</tbody></table>` : "";
  $$("[data-ed]", box).forEach(b => b.addEventListener("click", async () => {
    try {
      const c = await q(sb.from("cases").select("data").eq("id", b.dataset.ed).single());
      const s = await q(sb.from("case_secrets").select("data").eq("case_id", b.dataset.ed).single());
      openEditor(mergeCase(c.data, s.data), { kind: "public", id: b.dataset.ed });
    } catch (e) { toast(errMsg(e), "error"); }
  }));
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
      ${diffSelect()}
      <button class="btn primary">Utwórz pokój</button>
    </form>
    <div class="row wrap"><button class="btn tiny ghost" id="customPreview" type="button">👁 Podgląd (zdradza rozwiązanie!)</button>
    <button class="btn tiny ghost" id="customEdit" type="button">✏️ Otwórz w edytorze</button></div>`;
  $("#customEdit").addEventListener("click", async () => {
    if (await confirmBox("Edytor pokazuje <b>całą sprawę razem z rozwiązaniem</b>. Otworzyć?", "Otwórz")) openEditor(c, { kind: "file" });
  });
  $("#customPreview").addEventListener("click", async () => {
    if (await confirmBox("Podgląd pokazuje <b>całą sprawę razem z rozwiązaniem</b>. Otworzyć?", "Pokaż")) renderPreview(c, [], () => { location.hash = "#/"; renderLobby(); });
  });
  $("#customForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button", e.target); btn.disabled = true;
    try {
      const id = await q(sb.rpc("create_room_with_case", { p_pub: pub, p_sec: sec, p_name: e.target.name.value, p_difficulty: e.target.difficulty.value }));
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
  try {
    const ok = await publishCase(c);
    if (!ok) return;
    const { pub } = splitCase(c);
    info.innerHTML = `<div class="ok-box">Wgrano: <b>${esc(c.title)}</b> — ${pub.documents.length} dokumentów, ${pub.unlocks.length} wniosków, ${pub.questions.length} pytań.</div>`;
    loadCases();
  } catch (e) { info.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
}

// Publiczne wgranie sprawy (admin); zwraca true po zapisie, false gdy anulowano
async function publishCase(c) {
  const exists = await q(sb.from("cases").select("id").eq("id", c.id).maybeSingle()).catch(() => null);
  if (exists && !await confirmBox(`Sprawa o id <b>${esc(c.id)}</b> już istnieje. Nadpisać ją? (Pokoje zostaną, ale zobaczą nową wersję.)`, "Nadpisz")) return false;
  const { pub, sec } = splitCase(c);
  await q(sb.from("cases").upsert({ id: c.id, title: c.title, data: pub, updated_at: new Date().toISOString() }));
  await q(sb.from("case_secrets").upsert({ case_id: c.id, data: sec }));
  return true;
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
    ...(Array.isArray(c.story) ? c.story : []).flatMap(m => (m.documents || []).map(d => ({ ...d, _lockedBy: { title: `wiadomość „${m.title || m.id}”` } }))),
  ]);
  const trigText = t => !t ? "?" : t.type === "start" ? "na starcie" : t.type === "minutes" ? `po ${t.minutes} min` : t.type === "unlock" ? `po wniosku „${t.unlock}”` : "?";
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
    __story: () => `<article class="paper"><header class="doc-head"><h2>Wiadomości fabularne</h2></header><div class="doc-body">
      ${(Array.isArray(c.story) ? c.story : []).map(m => `<div class="msg"><div class="msg-head">📨 <b>${inline(m.from || "Komenda")}</b> <span class="small">· ${esc(trigText(m.trigger))}</span></div>
        <h3>${inline(m.title || "")}</h3>${renderBlocks(m.blocks)}${(m.documents || []).length ? `<p class="small">Załączniki: ${m.documents.map(d => esc(d.no || d.id)).join(", ")}</p>` : ""}</div>`).join("") || "<p>Brak wiadomości.</p>"}
      </div></article>`,
    __conf: () => {
      const dn = id => { const d = groups.all.find(x => x.id === id); return d ? `dok. ${esc(d.no || d.id)}` : `<span class="error">${esc(id)}?</span>`; };
      return `<article class="paper"><header class="doc-head"><h2>Sprzeczności (konfrontacje)</h2></header><div class="doc-body">
      ${(Array.isArray(c.confrontations) ? c.confrontations : []).map(x => `<div class="box"><div class="box-title">⚔️ ${inline(x.title || x.id)} <span class="small">(+${x.points ?? 1} pkt)</span></div>
        <p class="small">${(x.a || []).map(dn).join(" / ")} ✕ ${(x.b || []).map(dn).join(" / ")}</p><p>${inline(x.message || "")}</p></div>`).join("") || "<p>Brak sprzeczności.</p>"}
      </div></article>`;
    },
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
          <button class="docitem ${current === "__story" ? "active" : ""}" data-doc="__story">📨 Wiadomości fabularne</button>
          <button class="docitem ${current === "__conf" ? "active" : ""}" data-doc="__conf">⚔️ Sprzeczności</button>
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
    const [hls, tl, draft, votes] = await Promise.all([
      q(sb.from("room_highlights").select("*").eq("room_id", id)),
      q(sb.from("room_timeline").select("*").eq("room_id", id)),
      q(sb.from("room_drafts").select("*").eq("room_id", id).maybeSingle()),
      q(sb.from("room_votes").select("*").eq("room_id", id)),
    ]);
    hls.forEach(h => R.highlights.set(h.id, h));
    tl.forEach(t => R.timeline.set(t.id, t));
    if (draft) R.draft = draft;
    votes.forEach(x => R.votes.set(x.user_id, x.version));
    if (R.caseData.conf_count) await loadConf();
    if (room.rival) await loadRival(false);
    await ensureProfiles([...events.map(e => e.user_id), ...hls.map(h => h.created_by), ...tl.map(t => t.created_by)]);
    await loadStory(false);
    if (room.status === "solved") await loadSolution();
    subscribeRoom(id);
    renderRoom();
    startRoomTimers();
    maybeShowFolder(() => maybePopupStory());
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
  stopRoomTimers();
  hideSelBar();
  if (channel) { sb.removeChannel(channel); channel = null; }
}

function subscribeRoom(id) {
  channel = sb.channel(`room:${id}`, { config: { presence: { key: me.id } } });
  const f = `room_id=eq.${id}`;
  const on = (table, event, filter, fn) => channel.on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, fn);

  on("rooms", "UPDATE", `id=eq.${id}`, async p => {
    const was = R.room.status, wasRival = R.room.rival;
    if ((p.new.rival || null) !== (wasRival || null)) { R.room.rival = p.new.rival; await loadRival(false); updateRivalUI(); }
    R.room = { ...R.room, ...p.new };
    if (was !== "solved" && R.room.status === "solved") {
      await loadSolution();
      toast("🔓 Drużyna wysłała odpowiedź! Zobacz wynik w zakładce <b>Rozwiązanie</b>.", "ok", 6000);
      SND.play("win");
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
    renderAktaPane();
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
  on("room_unlocks", "INSERT", f, () => loadStory(true));
  on("room_confronts", "INSERT", f, () => { if (R.caseData.conf_count) loadConf(true); });
  on("room_highlights", "INSERT", f, async p => { R.highlights.set(p.new.id, p.new); await ensureProfiles([p.new.created_by]); refreshHighlights(); });
  on("room_highlights", "DELETE", null, p => { if (p.old?.id && R.highlights.delete(p.old.id)) refreshHighlights(); });
  on("room_timeline", "INSERT", f, async p => { R.timeline.set(p.new.id, p.new); await ensureProfiles([p.new.created_by]); if (R.tab === "os") renderTimelineList(); });
  on("room_timeline", "UPDATE", f, p => { R.timeline.set(p.new.id, p.new); if (R.tab === "os") renderTimelineList(); });
  on("room_timeline", "DELETE", null, p => { if (p.old?.id && R.timeline.delete(p.old.id) && R.tab === "os") renderTimelineList(); });
  on("room_drafts", "*", f, p => { if (p.new && p.new.room_id) onRemoteDraft(p.new); });
  on("room_votes", "INSERT", f, p => { R.votes.set(p.new.user_id, p.new.version); renderVotes(); });
  on("room_votes", "UPDATE", f, p => { R.votes.set(p.new.user_id, p.new.version); renderVotes(); });
  on("room_votes", "DELETE", null, p => { if (p.old?.room_id === id && p.old.user_id) { R.votes.delete(p.old.user_id); renderVotes(); } });
  channel.on("presence", { event: "sync" }, () => {
    const st = channel.presenceState();
    R.presence = {};
    Object.entries(st).forEach(([k, arr]) => { if (arr && arr[0]) R.presence[k] = arr[0]; });
    renderPresence();
    if (aktaShown()) updateViewers();
  });
  channel.subscribe(async status => {
    if (status === "SUBSCRIBED") trackPresence();
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") toast("Problem z połączeniem na żywo — odśwież stronę, jeśli zmiany innych się nie pojawiają.", "error", 6000);
  });
}
function trackPresence() {
  if (!channel) return;
  channel.track({ name: me.name, avatar: me.avatar, viewing: aktaShown() ? R.docId : R?.tab, at: Date.now() }).catch(() => {});
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
    case "confront_ok": return `${who} znalazł(a) sprzeczność: <b>${inline(pl.title || "")}</b> ⚔️`;
    case "confront_fail": { const dn = id => allDocs().find(d => d.id === id)?.no || id;
      return `${who} — nietrafiona konfrontacja (dok. ${esc(dn(pl.a))} ✕ dok. ${esc(dn(pl.b))})`; }
    case "rival": return pl.challenged ? `Drużyna <b>${esc(pl.team || "")}</b> rzuciła Wam wyzwanie! ⚔️` : `${who} rzucił(a) wyzwanie drużynie <b>${esc(pl.team || "")}</b> ⚔️`;
    case "rival_end": return `Rywalizacja zakończona`;
    case "vote": return `${who} zagłosował(a) za odpowiedzią drużyny (${pl.votes}/${pl.members})`;
    case "force": return `${who} wysłał(a) odpowiedź bez kompletu głosów (${pl.votes}/${pl.members})`;
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
  if (["unlock_ok", "hint", "joined", "vote", "confront_ok", "confront_fail", "rival", "rival_end"].includes(ev.kind))
    toast(eventText(ev), ["unlock_ok", "confront_ok"].includes(ev.kind) ? "ok" : "info");
  const snd = { unlock_ok: "stamp", confront_ok: "stamp", confront_fail: "bad", hint: "paper", vote: "click", joined: "ding", rival: "ding", solved: "win" }[ev.kind];
  if (snd) SND.play(snd);
}

/* ------------------------------------------------------------------ */
/*  Szkielet pokoju                                                    */
/* ------------------------------------------------------------------ */
const TABS = [["akta", "📁 Akta"], ["tablica", "🧵 Tablica"], ["os", "🕒 Oś czasu"], ["notatki", "🗒 Notatki"], ["rozwiazanie", "⚖️ Rozwiązanie"]];

/* ---- podzielony ekran (komputer): akta po lewej, narzędzia po prawej ---- */
const SPLIT_MIN = 1100;
let splitPref = (() => { try { return localStorage.getItem("split") !== "0"; } catch { return true; } })();
function isSplit() { return splitPref && window.innerWidth >= SPLIT_MIN; }
function aktaShown() { return !!R && (isSplit() || R.tab === "akta"); }
function aktaEl() { return isSplit() ? $("#leftview") : $("#tabview"); }
function renderAktaPane() { if (!aktaShown()) return; const el = aktaEl(); if (el) renderAkta(el); }
function openDoc(id) {
  R.docId = id; sessionStorage.setItem(`doc:${R.room.id}`, id);
  if (isSplit()) { hideSelBar(); renderAktaPane(); trackPresence(); }
  else switchTab("akta");
}
function splitLeft() { try { const v = parseFloat(localStorage.getItem("splitLeft")); return v >= 25 && v <= 75 ? v : 50; } catch { return 50; } }
window.addEventListener("resize", debounce(() => { if (R && $("#tabview") && R.renderedSplit !== isSplit()) renderRoom(); }, 200));

function bindSplitter() {
  const sp = $("#splitter"), main = $("#splitMain");
  if (!sp || !main) return;
  sp.addEventListener("pointerdown", e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId); main.classList.add("dragging");
    const move = ev => {
      const r = main.getBoundingClientRect();
      const pct = Math.min(75, Math.max(25, (ev.clientX - r.left) / r.width * 100));
      main.style.setProperty("--left", pct + "%");
      drawLinks();
    };
    const up = ev => {
      sp.removeEventListener("pointermove", move); sp.removeEventListener("pointerup", up); main.classList.remove("dragging");
      try { localStorage.setItem("splitLeft", parseFloat(main.style.getPropertyValue("--left")) || 50); } catch { /* ignore */ }
    };
    sp.addEventListener("pointermove", move); sp.addEventListener("pointerup", up);
  });
  sp.addEventListener("dblclick", () => { main.style.setProperty("--left", "50%"); try { localStorage.setItem("splitLeft", 50); } catch { /* ignore */ } });
}

function switchTab(k) {
  R.tab = k; sessionStorage.setItem(`tab:${R.room.id}`, k);
  $$(".tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab === k));
  if (!(isSplit() && selState?.kind === "sel")) hideSelBar();
  renderTab(); trackPresence();
  if (!isSplit()) window.scrollTo(0, 0);
}

function renderRoom() {
  const r = R.room, c = R.caseData;
  const split = isSplit();
  R.renderedSplit = split;
  if (split && R.tab === "akta") R.tab = sessionStorage.getItem(`rtab:${r.id}`) || "tablica";
  const tabs = split ? TABS.filter(([k]) => k !== "akta") : TABS;
  const tabsNav = `<nav class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${R.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav>`;
  app.innerHTML = `
  <div class="room ${split ? "is-split" : ""}">
    <header class="topbar">
      <a class="btn tiny ghost" href="#/" title="Lobby">←</a>
      <div class="tb-title"><span class="tb-case">${esc(c.title)}</span><span class="tb-room">${esc(r.name)}</span></div>
      <button class="code-chip" id="inviteBtn" title="Kopiuj link-zaproszenie">Kod: <b>${codeText(r.code)}</b> 🔗</button>
      <span class="timer ${r.status === "solved" ? "done" : ""} ${timerOver() ? "over" : ""}" id="timer" title="${diffOf() === "hard" ? `Czas śledztwa / limit (poziom trudny)` : "Czas śledztwa"}">${timerText()}</span>
      <span class="badge diff" title="Poziom: ${esc(DIFF[diffOf()].desc)}">${DIFF[diffOf()].icon} ${DIFF[diffOf()].label}</span>
      <button class="rival-chip" id="rivalChip" ${r.rival ? "" : "hidden"}>${rivalChipText()}</button>
      <div class="presence" id="presence"></div>
      ${r.status === "solved" ? `<span class="badge ok">rozwiązana</span>` : ""}
      ${R.caseMeta?.visibility === "private" ? `<span class="badge" title="Sprawa wgrana z pliku — widoczna tylko w tym pokoju">własna sprawa</span>` : ""}
      <button class="btn tiny ghost split-toggle ${splitPref ? "on" : ""}" id="splitBtn" title="${splitPref ? "Wyłącz podzielony ekran" : "Podziel ekran: akta po lewej, narzędzia po prawej"}">◫ Podziel</button>
      ${soundButton()}
      <button class="btn tiny ghost ${streamer ? "on" : ""}" id="streamBtn" title="Tryb streamera — ukrywa kod pokoju">🎥</button>
      <a class="btn tiny ghost" href="#/instrukcja" target="_blank" rel="noopener" title="Instrukcja (nowa karta)">📖</a>
      ${topbarUser()}
    </header>
    ${split ? `
    <main class="split" id="splitMain" style="--left:${splitLeft()}%">
      <section class="pane left" id="leftview"></section>
      <div class="splitter" id="splitter" title="Przeciągnij, aby zmienić szerokość (dwuklik — po równo)"></div>
      <section class="pane right">${tabsNav}<div id="tabview"></div></section>
    </main>` : `${tabsNav}<main id="tabview"></main>`}
  </div>`;
  bindLogout();
  $("#inviteBtn").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#/join/${r.code}`;
    try { await navigator.clipboard.writeText(url); toast(streamer ? "Skopiowano link-zaproszenie (kod ukryty — tryb streamera)." : `Skopiowano link-zaproszenie. Kod pokoju: <b>${esc(r.code)}</b>`, "ok"); }
    catch { prompt("Skopiuj link-zaproszenie:", url); }
  });
  $("#streamBtn").addEventListener("click", () => { toggleStreamer(); renderRoom(); });
  bindSoundButton();
  $("#rivalChip").addEventListener("click", () => { if (isSplit()) sessionStorage.setItem(`rtab:${r.id}`, "notatki"); switchTab("notatki"); });
  $("#splitBtn").addEventListener("click", () => {
    splitPref = !splitPref;
    try { localStorage.setItem("split", splitPref ? "1" : "0"); } catch { /* ignore */ }
    if (!splitPref) { R.tab = "akta"; sessionStorage.setItem(`tab:${r.id}`, "akta"); }
    renderRoom(); trackPresence();
  });
  $$(".tabs button").forEach(b => b.addEventListener("click", () => {
    if (split) sessionStorage.setItem(`rtab:${r.id}`, b.dataset.tab);
    switchTab(b.dataset.tab);
  }));
  renderPresence();
  if (split) { renderAktaPane(); bindSplitter(); }
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
  if (v === "os") return "przy osi czasu";
  if (v === "__inbox") return "czyta wiadomości";
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
  else if (R.tab === "os") renderTimeline(v);
  else if (R.tab === "notatki") renderNotes(v);
  else renderAnswer(v);
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Akta                                                     */
/* ------------------------------------------------------------------ */
function allDocs() {
  if (!R) return [];
  return [...(R.caseData.documents || []),
    ...R.unlocked.flatMap(u => (u.documents || []).map(d => ({ ...d, _unlocked: true }))),
    ...R.story.flatMap(m => (m.documents || []).map(d => ({ ...d, _unlocked: true })))];
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
function renderDocGroups(groups, current, viewers, counts = {}) {
  return groups.order.map(cat => `<div class="dl-group">${esc(cat)}</div>` + groups.map[cat].map(d => `
    <button class="docitem ${current === d.id ? "active" : ""} ${d._unlocked ? "unlocked" : ""} ${d._lockedBy ? "locked" : ""}" data-doc="${esc(d.id)}">
      <span class="di-no">${esc(d.no || "")}</span><span class="di-title">${inline(d.title)}</span>
      ${d._unlocked ? `<span class="di-tag">🔓 nowy</span>` : ""}${d._lockedBy ? `<span class="di-tag">🔒</span>` : ""}
      <span class="di-hl" data-hlc="${esc(d.id)}">${counts[d.id] ? `🖍${counts[d.id]}` : ""}</span>
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
  } else if (R.docId === "__inbox") {
    content = renderInbox();
  } else if (R.docId === "__conf") {
    content = renderConfPage();
  } else {
    const d = groups.all.find(x => x.id === R.docId);
    content = d ? renderDoc(d) + `<div class="doc-actions"><span class="small">Zaznacz fragment tekstu, aby go zakreślić 🖍</span><span class="row">${R.caseData.conf_count ? `<button class="btn" id="confBtn" title="Zestaw ten dokument z innym, który mu przeczy">⚔️ Konfrontuj</button>` : ""}<button class="btn" id="pinBtn">📌 Przypnij na tablicę</button></span></div>`
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
      ${R.caseData.conf_count ? `<button class="docitem confr ${R.docId === "__conf" ? "active" : ""}" data-doc="__conf">⚔️ Sprzeczności
        <span class="di-tag ${R.conf.found.length ? "okc" : ""}">${R.conf.found.length}/${R.caseData.conf_count}</span></button>` : ""}
      ${R.story.length ? `<button class="docitem inbox ${R.docId === "__inbox" ? "active" : ""}" data-doc="__inbox">📨 Wiadomości
        ${unreadStory() ? `<span class="di-tag hot">${unreadStory()} nowe</span>` : `<span class="di-tag">${R.story.length}</span>`}</button>` : ""}
      ${renderDocGroups(groups, R.docId, vm, hlCounts())}
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
  $("#confBtn", v)?.addEventListener("click", () => confrontModal(R.docId));
  const cf = $("#confForm", v);
  cf?.addEventListener("submit", e => { e.preventDefault(); doConfront(cf.a.value, cf.b.value); });
  if (groups.all.some(x => x.id === R.docId)) applyHighlights($(".viewer .doc-body", v), R.docId);
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
        SND.play("stamp");
        renderAkta(v);
        loadStory(true);
      } else {
        toast("Wniosek odrzucony — to nie to. Spróbujcie jeszcze raz.", "error");
        SND.play("bad");
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
    R.items.set(row.id, row); upsertCard(row);
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
  if (it.kind === "quote") {
    const d = allDocs().find(x => x.id === it.ref);
    return `<i class="pin"></i><div class="card-no">CYTAT${d ? ` · DOK. ${esc(d.no || "")}` : ""}</div>
      <blockquote class="card-quote">„${esc(it.text || "")}”</blockquote>
      <div class="card-actions">${d ? `<button class="btn tiny ghost" data-act="open">Otwórz</button>` : ""}<button class="btn tiny ghost" data-act="del" title="Usuń">✕</button></div>
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
      openDoc(it.ref);
    } else if (b.dataset.act === "del") {
      if (!await confirmBox(it.kind === "doc" ? "Zdjąć dokument z tablicy?" : it.kind === "quote" ? "Usunąć cytat z tablicy?" : "Usunąć karteczkę?", "Usuń")) return;
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
          <div class="row wrap"><label class="btn tiny file-btn">⬆ Wgraj poprawioną wersję<input type="file" id="replaceCase" accept=".json,application/json" hidden></label>
          <button class="btn tiny" id="editRoomCase">✏️ Edytuj w edytorze</button></div>` : ""}
      </section>` : ""}
      <section class="panel rival-panel" id="rivalPanel"></section>
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
  $("#editRoomCase")?.addEventListener("click", async () => {
    if (!await confirmBox("Edytor pokazuje <b>całą sprawę razem z rozwiązaniem</b>. Otworzyć?", "Otwórz")) return;
    try {
      const sec = await q(sb.from("case_secrets").select("data").eq("case_id", R.room.case_id).single());
      openEditor(mergeCase(R.caseData, sec.data), { kind: "room", roomId: R.room.id, title: R.room.name });
    } catch (e) { toast(errMsg(e), "error"); }
  });
  renderRivalPanel();
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
function renderAnswer(v) {
  const c = R.caseData;
  if (R.room.status === "solved") return renderResult(v);
  const a = R.draft.answers || {};
  const hintsFor = id => R.hints.filter(h => h.question_id === id).sort((x, y) => x.idx - y.idx);
  const pen = c.hint_penalty ?? 1;
  const maxPts = (c.questions || []).reduce((sum, x) => sum + (x.points || 0), 0);
  v.innerHTML = `
  <div class="answer">
    <section class="panel">
      <h2>Wspólna odpowiedź drużyny</h2>
      <p>Wszyscy edytujecie <b>tę samą odpowiedź</b> — zmiany widać na żywo. Gdy <b>każdy</b> z drużyny kliknie <b>✅ Zgadzam się</b>, odpowiedź zostanie wysłana automatycznie. Każda zmiana odpowiedzi zeruje głosy.</p>
      <p class="small">Maksymalnie <b>${maxPts} pkt</b> + bonus za sprzeczności. Poziom: <b>${DIFF[diffOf()].icon} ${DIFF[diffOf()].label}</b> — ${esc(DIFF[diffOf()].desc)}${diffOf() === "hard" ? ` (limit: ${timeLimitMin()} min)` : ""}.
        Podpowiedzi: ${R.hints.length}${diffOf() === "easy" ? ` (pierwsze 3 gratis)` : ""}. Liczy się też czas ⏱ — najlepsze drużyny trafiają do rankingu.</p>
      ${R.caseData.conf_count ? `<p class="small">⚔️ Sprzeczności: znalezione <b>${R.conf.found.length}/${R.caseData.conf_count}</b>, nietrafione ${R.conf.wrong} → bonus <b>+${confBonus()} pkt</b>.</p>` : ""}
    </section>
    <form id="answerForm" onsubmit="return false">
    ${(c.questions || []).map(qq => {
      const hs = hintsFor(qq.id), total = c.hint_counts?.[qq.id] || 0;
      return `<section class="panel question">
        <div class="row between"><h3>${inline(qq.label)}</h3><span class="badge">${qq.points || 0} pkt</span></div>
        ${qq.type === "choice"
          ? `<div class="options">${qq.options.map(o => `<label class="option"><input type="radio" name="${esc(qq.id)}" value="${esc(o.id)}" ${a[qq.id] === o.id ? "checked" : ""}><span>${inline(o.label)}</span></label>`).join("")}</div>`
          : `<textarea name="${esc(qq.id)}" rows="5" maxlength="3000" placeholder="${esc(qq.placeholder || "Wasza odpowiedź…")}">${esc(a[qq.id] || "")}</textarea>`}
        ${hs.map(h => `<p class="hint"><b>Podpowiedź ${h.idx + 1}</b> <span class="small">(${esc(prof(h.used_by).name)})</span>: ${inline(h.text)}</p>`).join("")}
        ${total ? `<button type="button" class="btn tiny ghost" data-hint="${esc(qq.id)}" ${hs.length >= total ? "disabled" : ""}>💡 ${hs.length >= total ? "Brak kolejnych podpowiedzi" : `Weź podpowiedź ${hs.length + 1}/${total} (${nextHintCost() ? `−${nextHintCost()} pkt` : "gratis"})`}</button>` : ""}
      </section>`;
    }).join("")}
    </form>
    <section class="panel votes" id="votesPanel"></section>
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
  let saveTimer = null;
  const saveNow = async () => {
    clearTimeout(saveTimer); saveTimer = null;
    const ans = collect();
    try {
      const ver = await q(sb.rpc("save_draft", { p_room: R.room.id, p_answers: ans }));
      R.draft = { ...R.draft, answers: ans, version: ver, updated_by: me.id };
      [...R.votes.entries()].forEach(([u, vv]) => { if (vv !== ver) R.votes.delete(u); });
      renderVotes();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  R.flushDraft = async () => { if (saveTimer) await saveNow(); };
  form.addEventListener("change", e => { if (e.target.type === "radio") { R.draftLocalEdit = Date.now(); saveNow(); } });
  form.addEventListener("input", e => {
    if (e.target.tagName === "TEXTAREA") { R.draftLocalEdit = Date.now(); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 900); }
  });
  $$("[data-hint]", v).forEach(b => b.addEventListener("click", async () => {
    const cost = nextHintCost();
    if (!await confirmBox(cost ? `Wziąć podpowiedź? Cała drużyna straci <b>${cost} pkt</b>, a podpowiedź zobaczą wszyscy.` : `Wziąć podpowiedź? Na poziomie łatwym ta jest <b>gratis</b>.`, "Biorę")) return;
    b.disabled = true;
    try {
      await R.flushDraft();
      await q(sb.rpc("use_hint", { p_room: R.room.id, p_question: b.dataset.hint }));
      R.hints = await q(sb.from("room_hints").select("*").eq("room_id", R.room.id).order("used_at"));
      renderAnswer(v);
    } catch (e) { toast(errMsg(e), "error"); b.disabled = false; }
  }));
  renderVotes();
}

function renderVotes() {
  const el = $("#votesPanel");
  if (!el || !R) return;
  const ver = R.draft.version || 0;
  const members = [...R.members.entries()];
  const voted = id => ver > 0 && R.votes.get(id) === ver;
  const k = members.filter(([id]) => voted(id)).length, n = members.length;
  const mine = voted(me.id);
  el.innerHTML = `
    <div class="row between wrap"><h2>Głosowanie</h2><span class="badge ${k === n && n ? "ok" : ""}">${k}/${n} za</span></div>
    ${ver === 0 ? `<p class="small">Zaznaczcie odpowiedzi powyżej — potem każdy głosuje.</p>` : ""}
    <div class="vote-list">${members.map(([id, p]) => `<div class="vote ${voted(id) ? "yes" : ""}">${avatarHtml(p, 26)}<span>${esc(p.name)}${id === me.id ? " (Ty)" : ""}</span><b>${voted(id) ? "✅" : "⏳"}</b></div>`).join("")}</div>
    <div class="row wrap vote-actions">
      ${mine ? `<button class="btn ghost" id="unvoteBtn">↩ Cofnij głos</button>`
             : `<button class="btn primary big" id="voteBtn" ${ver === 0 ? "disabled" : ""}>✅ Zgadzam się z tą odpowiedzią</button>`}
      ${R.room.owner === me.id && n > 1 && k * 2 > n && k < n ? `<button class="btn danger" id="forceBtn">Wyślij bez kompletu głosów</button>` : ""}
    </div>
    <p class="small">Ktoś nie gra? Może opuścić pokój (zakładka Notatki) — wtedy nie blokuje głosowania. Założyciel pokoju może wysłać odpowiedź, gdy „za” jest ponad połowa drużyny.</p>`;
  $("#voteBtn", el)?.addEventListener("click", voteNow);
  $("#unvoteBtn", el)?.addEventListener("click", async () => {
    try { await q(sb.rpc("unvote_answers", { p_room: R.room.id })); R.votes.delete(me.id); renderVotes(); }
    catch (e) { toast(errMsg(e), "error"); }
  });
  $("#forceBtn", el)?.addEventListener("click", async () => {
    if (!await confirmBox("Wysłać odpowiedź bez kompletu głosów? Tego nie da się cofnąć.", "Wysyłam")) return;
    try { await afterSubmit(await q(sb.rpc("force_submit", { p_room: R.room.id }))); }
    catch (e) { toast(errMsg(e), "error", 6000); }
  });
}

async function voteNow() {
  await R.flushDraft?.();
  const c = R.caseData, ans = R.draft.answers || {};
  const missing = (c.questions || []).filter(qq => !ans[qq.id] || !String(ans[qq.id]).trim());
  if (missing.length && !await confirmBox(`Odpowiedź nie obejmuje ${missing.length} pyt. Zagłosować mimo to?`, "Głosuję")) return;
  const btn = $("#voteBtn"); if (btn) btn.disabled = true;
  try {
    const res = await q(sb.rpc("vote_answers", { p_room: R.room.id, p_version: R.draft.version }));
    if (res.status === "submitted") await afterSubmit(res.result);
    else { R.votes.set(me.id, R.draft.version); renderVotes(); toast(`✅ Głos zapisany (${res.votes}/${res.members}). Czekamy na resztę drużyny.`, "ok"); }
  } catch (e) { toast(errMsg(e), "error", 6000); if (btn) btn.disabled = false; }
}

async function afterSubmit(result) {
  R.room.status = "solved"; R.room.score = result;
  SND.play("win");
  await loadSolution();
  renderRoom();
}

function onRemoteDraft(d) {
  const changed = d.version !== R.draft.version;
  R.draft = d;
  if (changed) [...R.votes.entries()].forEach(([u, vv]) => { if (vv !== d.version) R.votes.delete(u); });
  if (R.tab !== "rozwiazanie" || R.room.status === "solved") return;
  const form = $("#answerForm");
  if (form && d.updated_by !== me.id && Date.now() - R.draftLocalEdit > 1500) {
    (R.caseData.questions || []).forEach(qq => {
      const val = d.answers?.[qq.id] ?? "";
      if (qq.type === "choice") $$(`input[name="${CSS.escape(qq.id)}"]`, form).forEach(r => { r.checked = r.value === val; });
      else { const ta = form.elements[qq.id]; if (ta && document.activeElement !== ta) ta.value = val; }
    });
    if (changed) toast(`✏️ ${esc(prof(d.updated_by).name)} zmienił(a) odpowiedź — głosy wyzerowane.`, "info");
  }
  renderVotes();
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
      <p class="small">${DIFF[s.difficulty || diffOf()]?.icon || ""} ${DIFF[s.difficulty || diffOf()]?.label || ""} · ⏱ Czas: <b>${fmtDur(elapsedSec())}</b> · podpowiedzi: ${s.hints_used ?? 0} (−${s.penalty ?? 0} pkt)
        ${s.bonus ? ` · ⚔️ bonus +${s.bonus} (sprzeczności ${s.conf_found}, nietrafione ${s.conf_wrong})` : ""}
        ${s.time_penalty ? ` · ⌛ po limicie −${s.time_penalty}` : ""} · wysłał(a): ${esc(prof(s.submitted_by).name)}</p>
      ${R.room.rival ? `<div id="rivalVerdict"></div>` : ""}
      <div class="res-list">${(s.questions || []).map(r => {
        const qq = qmap[r.id];
        return `<div class="res ${r.correct ? "ok" : "bad"}"><div class="res-q">${r.correct ? "✅" : "❌"} ${inline(qq?.label || r.id)} <span class="badge">${r.points}/${r.max}</span></div>
          <div class="res-a"><span class="small">Wasza odpowiedź:</span> ${inline(label(qq, r.answer)).replace(/\n/g, "<br>")}</div>
          ${!r.correct && qq?.type === "choice" ? `<div class="res-a"><span class="small">Poprawna:</span> <b>${inline(label(qq, r.correct_answer))}</b></div>` : ""}
          ${qq?.type === "text" ? `<div class="res-a small">Trafione kluczowe elementy: ${r.keyword_hits ?? 0}. Porównajcie swój opis z rozwiązaniem poniżej.</div>` : ""}</div>`;
      }).join("")}</div>
    </section>
    <section class="panel"><h2>🏆 Ranking sprawy</h2><div id="lbBox"><p class="small">Wczytywanie…</p></div></section>
    ${R.solution ? renderDoc({ title: "Rozwiązanie sprawy", blocks: R.solution }) : `<p class="small">Wczytywanie rozwiązania…</p>`}
  </div>`;
  loadLeaderboard(R.room.case_id, $("#lbBox"), R.room.id);
  if (R.room.rival) loadRival(false).then(updateRivalUI);
  if (!R.solution) loadSolution().then(() => { if (R.tab === "rozwiazanie" && R.solution) renderResult(v); });
}

async function loadLeaderboard(caseId, box, highlightRoom) {
  if (!box) return;
  try {
    const rows = await q(sb.rpc("get_leaderboard", { p_case: caseId }));
    box.innerHTML = rows.length ? `<div class="tablewrap"><table class="lb">
      <thead><tr><th>#</th><th>Drużyna</th><th title="Poziom">🎯</th><th>Pkt</th><th>Czas</th><th title="Podpowiedzi">💡</th><th title="Graczy">👥</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.room_id === highlightRoom ? "me" : ""}"><td>${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td><td>${esc(r.team)}</td>
        <td title="${esc(DIFF[r.difficulty || "normal"]?.label || "")}">${DIFF[r.difficulty || "normal"]?.icon || ""}</td>
        <td><b>${r.total}</b>/${r.max}${r.bonus ? ` <span class="small">(+${r.bonus}⚔)</span>` : ""}</td><td>${fmtDur(r.seconds)}</td><td>${r.hints}</td><td>${r.players}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">Jeszcze nikt nie rozwiązał tej sprawy. Bądźcie pierwsi!</p>`;
  } catch (e) { box.innerHTML = `<p class="error">${esc(errMsg(e))}</p>`; }
}

/* ------------------------------------------------------------------ */
/*  Zakładka: Oś czasu                                                 */
/* ------------------------------------------------------------------ */
function parseTime(t) {
  const m = String(t || "").replace(/\s/g, "").match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
function normTime(t) {
  const v = parseTime(t);
  return v === null ? String(t || "").trim() : `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}
function dayKey(d) {
  const m = String(d || "").match(/(\d{1,2})[./](\d{1,2})/);
  return m ? (+m[2]) * 100 + (+m[1]) : (d ? 5000 : -1);
}
function sortedTimeline() {
  return [...R.timeline.values()].sort((a, b) =>
    dayKey(a.day) - dayKey(b.day) || String(a.day).localeCompare(String(b.day)) ||
    ((parseTime(a.time) ?? 9999) - (parseTime(b.time) ?? 9999)) || (a.created_at < b.created_at ? -1 : 1));
}

function renderTimeline(v) {
  const docs = allDocs();
  const pre = R.tlPrefill; R.tlPrefill = null; R.tlEditing = null;
  const days = [...new Set([...R.timeline.values()].map(t => t.day).filter(Boolean))];
  v.innerHTML = `
  <div class="tl-layout">
    <section class="panel tl-form-panel">
      <h2 id="tlFormTitle">Dodaj wydarzenie</h2>
      <form id="tlForm">
        <div class="tl-row">
          <label>Dzień<input name="day" list="tlDays" maxlength="40" placeholder="np. czw 16.10"></label>
          <label>Godzina<input name="time" maxlength="20" placeholder="21:02" autocomplete="off"></label>
        </div>
        <datalist id="tlDays">${days.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
        <label>Co się wydarzyło?<textarea name="title" rows="2" maxlength="400" required placeholder="np. Wolski dzwoni do córki: »mam gościa«"></textarea></label>
        <label>Notatka (opcjonalnie)<input name="note" maxlength="1000" placeholder="np. kto to potwierdza? sprzeczność z dok. 10"></label>
        <label>Źródło<select name="doc_id"><option value="">— brak —</option>${docs.map(d => `<option value="${esc(d.id)}">Dok. ${esc(d.no || "")}: ${esc(plain(d.title))}</option>`).join("")}</select></label>
        <div class="row wrap"><button class="btn primary" id="tlSubmit">＋ Dodaj do osi</button><button type="button" class="btn ghost" id="tlCancel" hidden>Anuluj edycję</button></div>
      </form>
      <p class="small">Wydarzenia same układają się według dnia i godziny. W aktach zaznacz fragment tekstu → <b>🕒 Na oś czasu</b>, żeby dodać go jednym kliknięciem.</p>
    </section>
    <section class="tl-list-panel"><div id="tlList"></div></section>
  </div>`;
  const f = $("#tlForm", v);
  const resetForm = () => {
    f.reset(); R.tlEditing = null;
    $("#tlFormTitle").textContent = "Dodaj wydarzenie"; $("#tlSubmit").textContent = "＋ Dodaj do osi"; $("#tlCancel").hidden = true;
  };
  if (pre) { f.title.value = pre.title || ""; f.doc_id.value = pre.doc_id || ""; setTimeout(() => f.time.focus(), 50); }
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const row = { day: f.day.value.trim(), time: normTime(f.time.value), title: f.title.value.trim(), note: f.note.value.trim(), doc_id: f.doc_id.value || null };
    if (!row.title) return;
    const btn = $("#tlSubmit"); btn.disabled = true;
    try {
      if (R.tlEditing) {
        const upd = await q(sb.from("room_timeline").update({ ...row, updated_at: new Date().toISOString() }).eq("id", R.tlEditing).select().single());
        R.timeline.set(upd.id, upd);
      } else {
        const ins = await q(sb.from("room_timeline").insert({ room_id: R.room.id, ...row }).select().single());
        R.timeline.set(ins.id, ins);
      }
      const keepDay = row.day;
      resetForm(); f.day.value = keepDay;
      renderTimelineList();
      f.time.focus();
    } catch (err) { toast(errMsg(err), "error"); }
    btn.disabled = false;
  });
  $("#tlCancel").addEventListener("click", resetForm);
  $("#tlList").addEventListener("click", async e => {
    const ed = e.target.closest("[data-tl-edit]"), del = e.target.closest("[data-tl-del]"), doc = e.target.closest("[data-tl-doc]");
    if (ed) {
      const t = R.timeline.get(ed.dataset.tlEdit); if (!t) return;
      R.tlEditing = t.id;
      f.day.value = t.day; f.time.value = t.time; f.title.value = t.title; f.note.value = t.note; f.doc_id.value = t.doc_id || "";
      $("#tlFormTitle").textContent = "Edytuj wydarzenie"; $("#tlSubmit").textContent = "💾 Zapisz zmiany"; $("#tlCancel").hidden = false;
      f.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (del) {
      if (!await confirmBox("Usunąć to wydarzenie z osi czasu?", "Usuń")) return;
      try { await q(sb.from("room_timeline").delete().eq("id", del.dataset.tlDel)); R.timeline.delete(del.dataset.tlDel); renderTimelineList(); }
      catch (err) { toast(errMsg(err), "error"); }
    } else if (doc) {
      openDoc(doc.dataset.tlDoc);
    }
  });
  renderTimelineList();
}

function renderTimelineList() {
  const el = $("#tlList");
  if (!el) return;
  const items = sortedTimeline();
  if (!items.length) {
    el.innerHTML = `<div class="panel"><p class="empty">Oś czasu jest pusta. Dodajcie pierwsze wydarzenie — np. godzinę, o której ofiara ostatni raz dawała znak życia.</p></div>`;
    return;
  }
  const docs = allDocs();
  const showDays = new Set(items.map(t => t.day)).size > 1 || items[0].day;
  let html = "", lastDay = null;
  items.forEach(t => {
    if (showDays && t.day !== lastDay) { html += `<div class="tl-day">${esc(t.day || "Bez dnia")}</div>`; lastDay = t.day; }
    const d = t.doc_id ? docs.find(x => x.id === t.doc_id) : null;
    html += `<div class="tl-item">
      <div class="tl-time ${parseTime(t.time) === null ? "unk" : ""}">${esc(t.time || "??:??")}</div>
      <div class="tl-card">
        <div class="tl-title">${esc(t.title)}</div>
        ${t.note ? `<div class="tl-note">${esc(t.note)}</div>` : ""}
        <div class="tl-meta">${d ? `<button class="chip" data-tl-doc="${esc(d.id)}">📄 Dok. ${esc(d.no || "")}</button>` : ""}
          <span class="small">${esc(prof(t.created_by).name)}</span>
          <span class="tl-actions"><button class="btn tiny ghost" data-tl-edit="${esc(t.id)}" title="Edytuj">✏️</button><button class="btn tiny ghost" data-tl-del="${esc(t.id)}" title="Usuń">🗑</button></span></div>
      </div></div>`;
  });
  el.innerHTML = `<div class="timeline">${html}</div>`;
}

/* ------------------------------------------------------------------ */
/*  Wiadomości fabularne                                               */
/* ------------------------------------------------------------------ */
function storySeenKey() { return `seen:${R.room.id}`; }
function storySeen() { try { return new Set(JSON.parse(localStorage.getItem(storySeenKey()) || "[]")); } catch { return new Set(); } }
function markStorySeen() { try { localStorage.setItem(storySeenKey(), JSON.stringify(R.story.map(m => m.id))); } catch { /* ignore */ } }
function unreadStory() { const seen = storySeen(); return R.story.filter(m => !seen.has(m.id)).length; }

async function loadStory(render = true) {
  if (!R) return;
  let list;
  try { list = await q(sb.rpc("get_story", { p_room: R.room.id })); } catch { return; }
  const before = R.story.map(m => m.id).join(",");
  R.story = Array.isArray(list) ? list : [];
  if (render && R.story.map(m => m.id).join(",") !== before) {
    renderAktaPane();
    maybePopupStory();
  }
}

function maybePopupStory() {
  if (!R) return;
  const seen = storySeen();
  const fresh = R.story.filter(m => !seen.has(m.id) && !R.popped.has(m.id));
  if (!fresh.length) return;
  fresh.forEach(m => R.popped.add(m.id));
  const m = fresh[fresh.length - 1];
  SND.play("type");
  const w = showModal("📨 Nowa wiadomość", `<p class="small">Od: <b>${inline(m.from || "Komenda")}</b></p><h3>${inline(m.title || "")}</h3>
    ${(m.documents || []).length ? `<p class="small">W załączniku: ${m.documents.map(d => `dok. ${esc(d.no || "")}`).join(", ")}</p>` : ""}
    <div class="row end"><button class="btn ghost" data-close>Później</button><button class="btn primary" data-read>📨 Czytaj</button></div>`);
  $("[data-read]", w).addEventListener("click", () => { w.remove(); openDoc("__inbox"); });
}

function renderInbox() {
  const list = [...R.story].reverse();
  markStorySeen();
  return `<article class="paper"><header class="doc-head"><span class="doc-no">WIADOMOŚCI</span><h2>Skrzynka śledczego</h2></header>
    <p class="doc-sub">Nowe wiadomości przychodzą w trakcie śledztwa — po złożeniu wniosków albo po upływie czasu.</p>
    <div class="doc-body">${list.map(m => `<div class="msg">
      <div class="msg-head">📨 <b>${inline(m.from || "Komenda")}</b> <span class="small">· ${timeAgo(m.at)}</span></div>
      <h3>${inline(m.title || "")}</h3>${renderBlocks(m.blocks)}
      ${(m.documents || []).length ? `<div class="row wrap">${m.documents.map(d => `<button class="btn tiny" data-doc="${esc(d.id)}">Otwórz dok. ${esc(d.no || "")}: ${inline(d.title)}</button>`).join("")}</div>` : ""}
    </div>`).join("") || `<p class="empty">Na razie cisza.</p>`}</div></article>`;
}

/* ------------------------------------------------------------------ */
/*  Sprzeczności (konfrontacja dokumentów)                             */
/* ------------------------------------------------------------------ */
async function loadConf(render = false) {
  try {
    const before = R.conf.found.length;
    R.conf = await q(sb.rpc("get_confrontations", { p_room: R.room.id }));
    R.conf.found = R.conf.found || [];
    if (render) {
      renderAktaPane();
      if (R.tab === "rozwiazanie" && R.room.status !== "solved") renderTab();
    }
    return R.conf.found.length - before;
  } catch { return 0; }
}
function confBonus() {
  const raw = R.conf.found.reduce((sum, x) => sum + (Number(x.points) || 0), 0);
  return Math.max(0, raw - (diffOf() === "easy" ? 0 : R.conf.wrong));
}
function docOptions(selected, exclude) {
  return allDocs().filter(d => d.id !== exclude).map(d => `<option value="${esc(d.id)}" ${d.id === selected ? "selected" : ""}>Dok. ${esc(d.no || "")}: ${esc(plain(d.title))}</option>`).join("");
}
function renderConfPage() {
  const penalty = diffOf() === "easy" ? "bez kary (poziom łatwy)" : "−1 pkt z bonusu";
  const dn = id => { const d = allDocs().find(x => x.id === id); return d ? `<button class="chip" data-doc="${esc(d.id)}">📄 Dok. ${esc(d.no || "")}</button>` : ""; };
  return `<article class="paper"><header class="doc-head"><span class="doc-no">KONFRONTACJE</span><h2>Sprzeczności w aktach</h2></header>
    <p class="doc-sub">Znaleźliście dwa dokumenty, które sobie przeczą? Zestawcie je. Trafiona sprzeczność: <b>+ punkty bonusowe</b>. Nietrafiona: ${penalty}.</p>
    <div class="doc-body">
      <form id="confForm" class="conf-form">
        <label>Dokument A<select name="a">${docOptions(null)}</select></label>
        <span class="conf-x">⚔️</span>
        <label>Dokument B<select name="b">${docOptions(allDocs()[1]?.id)}</select></label>
        <button class="btn primary">Konfrontuj</button>
      </form>
      <p class="small">Znalezione: <b>${R.conf.found.length}/${R.caseData.conf_count}</b> · nietrafione: ${R.conf.wrong} · bonus teraz: <b>+${confBonus()} pkt</b></p>
      ${R.conf.found.map(x => `<div class="msg conf-ok">
        <div class="msg-head">⚔️ <b>${inline(x.title || "")}</b> <span class="small">· +${x.points} pkt · ${esc(prof(x.user_id).name)}, ${timeAgo(x.at)}</span></div>
        <p>${inline(x.message || "")}</p><div class="row wrap">${dn(x.doc_a)}${dn(x.doc_b)}</div></div>`).join("") || `<p class="empty">Jeszcze żadnej sprzeczności. Czytajcie uważnie zeznania i porównujcie je z dowodami.</p>`}
    </div></article>`;
}
function confrontModal(docA) {
  const d = allDocs().find(x => x.id === docA);
  const w = showModal("⚔️ Konfrontacja", `
    <p>Z czym kłóci się <b>Dok. ${esc(d?.no || "")}: ${inline(d?.title || "")}</b>?</p>
    <form id="confModalForm" class="col-form"><select name="b">${docOptions(null, docA)}</select>
      <p class="small">${diffOf() === "easy" ? "Nietrafiona konfrontacja jest bez kary (poziom łatwy)." : "Nietrafiona konfrontacja odejmuje 1 pkt z bonusu."}</p>
      <div class="row end"><button type="button" class="btn ghost" data-close>Anuluj</button><button class="btn primary">⚔️ Konfrontuj</button></div></form>`);
  $("#confModalForm", w).addEventListener("submit", async e => { e.preventDefault(); const b = e.target.b.value; w.remove(); doConfront(docA, b); });
}
async function doConfront(a, b) {
  if (!a || !b || a === b) return toast("Wybierz dwa różne dokumenty.", "error");
  try {
    const res = await q(sb.rpc("try_confront", { p_room: R.room.id, p_a: a, p_b: b }));
    if (res.ok && res.already) { toast(`Tę sprzeczność już znaleźliście: <b>${inline(res.title || "")}</b>`, "info"); return; }
    if (res.ok) {
      SND.play("stamp");
      await loadConf(true);
      showModal("⚔️ Sprzeczność!", `<h3>${inline(res.title || "")}</h3><p>${inline(res.message || "")}</p><p class="small">+${res.points} pkt bonusu dla drużyny.</p><div class="row end"><button class="btn primary" data-close>Świetnie</button></div>`);
      return;
    }
    if (res.repeat) { toast("To zestawienie już sprawdzaliście — nic tu nie ma.", "info"); return; }
    SND.play("bad");
    await loadConf(true);
    toast(`Brak sprzeczności między tymi dokumentami${diffOf() === "easy" ? "." : " (−1 pkt z bonusu)."}`, "error");
  } catch (e) { toast(errMsg(e), "error"); }
}

/* ------------------------------------------------------------------ */
/*  Rywalizacja                                                        */
/* ------------------------------------------------------------------ */
async function loadRival(notify) {
  if (!R?.room?.rival) { if (R) R.rival = null; return; }
  try {
    const prev = R.rival;
    R.rival = await q(sb.rpc("get_rival", { p_room: R.room.id }));
    if (notify && prev && R.rival && prev.status !== "solved" && R.rival.status === "solved") {
      toast(`⚔️ Drużyna <b>${esc(R.rival.team)}</b> wysłała odpowiedź!`, "info", 6000); SND.play("ding");
    }
    if (notify && prev && R.rival && R.rival.unlocks > prev.unlocks) toast(`⚔️ Rywale odblokowali kolejny wniosek (${R.rival.unlocks}).`, "info");
    updateRivalUI();
  } catch { /* ignore */ }
}
function rivalChipText() {
  const v = R?.rival;
  if (!R?.room?.rival || !v) return "⚔️ rywale…";
  return `⚔️ vs ${esc(v.team)} · ${v.status === "solved" ? `✅ ${v.total ?? "?"} pkt` : `🔓${v.unlocks} ⚔${v.confronts}`}`;
}
function rivalVerdictHtml() {
  const v = R.rival, me_ = R.room.score;
  if (!v || R.room.status !== "solved") return "";
  if (v.status !== "solved") return `<div class="rival-verdict wait">⚔️ Czekamy, aż <b>${esc(v.team)}</b> wyśle odpowiedź…</div>`;
  const myT = me_?.total ?? 0, thT = v.total ?? 0;
  const mySec = elapsedSec(), thSec = Math.max(0, (new Date(v.submitted_at) - new Date(v.created_at)) / 1000);
  const win = myT > thT || (myT === thT && mySec < thSec), draw = myT === thT && Math.abs(mySec - thSec) < 1;
  return `<div class="rival-verdict ${draw ? "" : win ? "win" : "lose"}">${draw ? "🤝 Remis!" : win ? "🏆 Wygraliście rywalizację!" : `😤 Wygrała drużyna ${esc(v.team)}`}
    <span class="small">Wy: ${myT} pkt, ${fmtDur(mySec)} · ${esc(v.team)}: ${thT} pkt, ${fmtDur(thSec)}</span></div>`;
}
function updateRivalUI() {
  const chip = $("#rivalChip");
  if (chip) { chip.hidden = !R.room.rival; chip.innerHTML = rivalChipText(); }
  if ($("#rivalPanel")) renderRivalPanel();
  const vd = $("#rivalVerdict"); if (vd) vd.innerHTML = rivalVerdictHtml();
}
function renderRivalPanel() {
  const el = $("#rivalPanel");
  if (!el) return;
  const owner = R.room.owner === me.id;
  if (!R.room.rival) {
    el.innerHTML = `<h2>⚔️ Rywalizacja</h2>
      <p class="small">Zmierzcie się z inną drużyną grającą tę samą sprawę. Zobaczycie nawzajem tylko postęp (liczbę wniosków, sprzeczności, podpowiedzi) — bez szczegółów. Wygrywa więcej punktów, przy remisie szybszy czas.</p>
      ${R.room.status === "solved" ? `<p class="small">Sprawa jest już rozwiązana.</p>` : owner ? `<form id="rivalForm" class="row"><input name="code" maxlength="6" placeholder="Kod pokoju rywali" autocomplete="off" required><button class="btn primary">Rzuć wyzwanie</button></form>`
        : `<p class="small">Wyzwanie może rzucić założyciel pokoju.</p>`}`;
    $("#rivalForm", el)?.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await q(sb.rpc("challenge_room", { p_room: R.room.id, p_code: e.target.code.value }));
        const rm = await q(sb.from("rooms").select("rival").eq("id", R.room.id).single());
        R.room.rival = rm.rival; await loadRival(false); SND.play("ding"); toast("⚔️ Wyzwanie rzucone!", "ok");
      } catch (err) { toast(errMsg(err), "error", 6000); }
    });
    return;
  }
  const v = R.rival;
  const row = (label, a, b) => `<tr><td>${label}</td><td><b>${a}</b></td><td><b>${b}</b></td></tr>`;
  el.innerHTML = `<h2>⚔️ Rywalizacja</h2>
    ${v ? `<table class="rival-tbl"><thead><tr><th></th><th>Wy</th><th>${esc(v.team)}</th></tr></thead><tbody>
      ${row("Status", R.room.status === "solved" ? "✅ wysłana" : "🔎 w toku", v.status === "solved" ? "✅ wysłana" : "🔎 w toku")}
      ${row("Poziom", DIFF[diffOf()].icon, DIFF[v.difficulty || "normal"]?.icon || "")}
      ${row("Wnioski", R.unlockIds.size, v.unlocks)}
      ${R.caseData.conf_count ? row("Sprzeczności", R.conf.found.length, v.confronts) : ""}
      ${row("Podpowiedzi", R.hints.length, v.hints)}
      ${row("Wpisy na osi", R.timeline.size, v.timeline)}
      ${row("Graczy", R.members.size, v.players)}
      ${R.room.status === "solved" && v.status === "solved" ? row("Wynik", `${R.room.score?.total ?? "?"}`, `${v.total ?? "?"}`) : ""}
    </tbody></table>${rivalVerdictHtml()}` : `<p class="small">Wczytywanie…</p>`}
    <div class="row wrap"><button class="btn tiny ghost" id="rivalRefresh">↻ Odśwież</button>${owner ? `<button class="btn tiny danger" id="rivalEnd">Zakończ rywalizację</button>` : ""}</div>`;
  $("#rivalRefresh", el).addEventListener("click", () => loadRival(true));
  $("#rivalEnd", el)?.addEventListener("click", async () => {
    if (!await confirmBox("Zakończyć rywalizację dla obu drużyn?", "Zakończ")) return;
    try { await q(sb.rpc("end_rivalry", { p_room: R.room.id })); R.room.rival = null; R.rival = null; updateRivalUI(); } catch (e) { toast(errMsg(e), "error"); }
  });
}

/* ------------------------------------------------------------------ */
/*  Zakreślacz                                                         */
/* ------------------------------------------------------------------ */
let selState = null;
function hlColor(uid) { let h = 0; for (const ch of String(uid || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 4; }
function hlCounts() {
  const m = {};
  R.highlights.forEach(h => { m[h.doc_id] = (m[h.doc_id] || 0) + 1; });
  return m;
}
function applyHighlights(root, docId) {
  if (!root || !R) return;
  [...R.highlights.values()].filter(h => h.doc_id === docId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).forEach(h => wrapQuote(root, h));
}
// Szuka cytatu w tekście dokumentu (ignorując białe znaki) i owija go w <mark>, także przez granice pogrubień
function wrapQuote(root, h) {
  const target = String(h.quote || "").replace(/\s+/g, "");
  if (target.length < 2) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const map = []; let flat = ""; let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue;
    for (let i = 0; i < t.length; i++) if (!/\s/.test(t[i])) { flat += t[i]; map.push([n, i]); }
  }
  const idx = flat.indexOf(target);
  if (idx < 0) return false;
  const segs = new Map();
  for (let k = idx; k < idx + target.length; k++) {
    const [node, off] = map[k];
    const sg = segs.get(node);
    if (!sg) segs.set(node, [off, off + 1]); else sg[1] = off + 1;
  }
  [...segs.entries()].reverse().forEach(([node, [a, b]]) => {
    const r = document.createRange();
    r.setStart(node, a); r.setEnd(node, b);
    const m = document.createElement("mark");
    m.className = `hl hl-c${hlColor(h.created_by)}`; m.dataset.hl = h.id; m.title = `Zakreślił(a): ${prof(h.created_by).name}`;
    try { r.surroundContents(m); } catch { /* ignore */ }
  });
  return true;
}
function refreshHighlights() {
  if (!R) return;
  $$("[data-hlc]").forEach(el => { const c = hlCounts()[el.dataset.hlc]; el.textContent = c ? `🖍${c}` : ""; });
  if (!aktaShown()) return;
  const body = $(".viewer .doc-body");
  const d = allDocs().find(x => x.id === R.docId);
  if (!body || !d) return;
  body.innerHTML = renderBlocks(d.blocks);
  applyHighlights(body, d.id);
}

function setupSelectionBar() {
  if ($("#selbar")) return;
  const bar = document.createElement("div");
  bar.id = "selbar"; bar.className = "selbar"; bar.hidden = true;
  document.body.appendChild(bar);
  bar.addEventListener("pointerdown", e => { if (e.target.closest("button")) e.preventDefault(); });
  bar.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
  bar.addEventListener("click", e => { const b = e.target.closest("button[data-sel]"); if (b) selAction(b.dataset.sel); });
  document.addEventListener("selectionchange", debounce(checkSelection, 250));
  document.addEventListener("click", e => {
    if (e.target.closest("#selbar")) return;
    const m = e.target.closest("mark.hl");
    if (m && R && aktaShown() && (window.getSelection()?.isCollapsed ?? true)) { showMarkBar(m.dataset.hl); return; }
    if (selState?.kind === "mark") hideSelBar();
  });
}
function checkSelection() {
  if (!R || !aktaShown() || !allDocs().some(d => d.id === R.docId)) { if (selState?.kind === "sel") hideSelBar(); return; }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { if (selState?.kind === "sel") hideSelBar(); return; }
  const body = $(".viewer .doc-body");
  const range = sel.getRangeAt(0);
  if (!body || !body.contains(range.commonAncestorContainer)) return;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.replace(/\s/g, "").length < 3) return;
  const tooLong = text.length > 600;
  selState = { kind: "sel", text: text.slice(0, 600), docId: R.docId };
  showSelBar(`<span class="small">${tooLong ? "Za długi fragment (max 600 znaków)" : "Zaznaczony fragment:"}</span>
    ${tooLong ? "" : `<button data-sel="hl">🖍 Zakreśl</button><button data-sel="pin">📌 Na tablicę</button><button data-sel="tl">🕒 Na oś czasu</button>`}
    <button data-sel="x" title="Zamknij">✕</button>`);
}
function showMarkBar(id) {
  const h = R.highlights.get(id);
  if (!h) return;
  selState = { kind: "mark", id, text: h.quote, docId: h.doc_id };
  showSelBar(`<span class="small">🖍 ${esc(prof(h.created_by).name)}</span>
    <button data-sel="pin">📌 Na tablicę</button><button data-sel="tl">🕒 Na oś czasu</button><button data-sel="del">🗑 Usuń</button><button data-sel="x" title="Zamknij">✕</button>`);
}
function showSelBar(html) { const bar = $("#selbar"); if (!bar) return; bar.innerHTML = html; bar.hidden = false; }
function hideSelBar() { const bar = $("#selbar"); if (bar) bar.hidden = true; selState = null; }
async function selAction(a) {
  const st = selState;
  if (!st || !R) return hideSelBar();
  if (a === "x") { window.getSelection()?.removeAllRanges(); return hideSelBar(); }
  try {
    if (a === "hl") {
      const row = await q(sb.from("room_highlights").insert({ room_id: R.room.id, doc_id: st.docId, quote: st.text }).select().single());
      R.highlights.set(row.id, row);
      window.getSelection()?.removeAllRanges();
      refreshHighlights();
      toast("🖍 Zakreślono — widzi to cała drużyna.", "ok");
    } else if (a === "pin") {
      const pos = { x: 80 + (R.items.size % 8) * 230, y: 80 + Math.floor(R.items.size / 8) * 170 };
      const row = await q(sb.from("board_items").insert({ room_id: R.room.id, kind: "quote", ref: st.docId, text: st.text, x: pos.x, y: pos.y }).select().single());
      R.items.set(row.id, row); upsertCard(row);
      toast("📌 Cytat przypięty na tablicy.", "ok");
    } else if (a === "tl") {
      R.tlPrefill = { title: st.text.slice(0, 400), doc_id: st.docId };
      window.getSelection()?.removeAllRanges();
      hideSelBar();
      if (isSplit()) sessionStorage.setItem(`rtab:${R.room.id}`, "os");
      switchTab("os");
      return;
    } else if (a === "del") {
      if (!await confirmBox("Usunąć to zakreślenie?", "Usuń")) return hideSelBar();
      await q(sb.from("room_highlights").delete().eq("id", st.id));
      R.highlights.delete(st.id);
      refreshHighlights();
    }
  } catch (e) { toast(errMsg(e), "error"); }
  hideSelBar();
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
  ["story", "Zwroty akcji", "", "Liczba wiadomości fabularnych (zwrotów akcji)"],
  ["conf", "Sprzeczności", "", "Liczba sprzeczności do znalezienia"],
  ["series", "Seria (opcjonalnie)", "np. Akta komisarz Rudnickiej, odcinek 2 — po sprawie »Pod Zegarem«", "Seria (opcjonalnie)"],
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
          <div><h3>◫ Podzielony ekran</h3><p>Na komputerze (szerokie okno) akta są <b>po lewej</b>, a tablica, oś czasu, notatki i rozwiązanie <b>po prawej</b>. Granicę przeciągniesz myszką (dwuklik — po równo). Przycisk <b>◫ Podziel</b> u góry włącza i wyłącza ten widok. Na telefonie wszystko zostaje w zakładkach.</p></div>
          <div><h3>⚔️ Sprzeczności</h3><p>Przy dokumencie kliknij <b>⚔️ Konfrontuj</b> i wskaż drugi dokument, który mu przeczy (np. zeznanie vs billing). Trafiona sprzeczność daje <b>punkty bonusowe</b> i wyjaśnienie, nietrafiona odbiera punkt z bonusu (poza poziomem łatwym). Lista w aktach: <b>⚔️ Sprzeczności</b>.</p></div>
          <div><h3>🏁 Rywalizacja</h3><p>Założyciel pokoju wpisuje w <b>Notatki → Rywalizacja</b> kod pokoju innej drużyny grającej tę samą sprawę. Widzicie nawzajem tylko postęp (wnioski, sprzeczności, podpowiedzi). Wygrywa więcej punktów, przy remisie — czas.</p></div>
          <div><h3>🎯 Poziomy trudności</h3><p>Wybierasz przy zakładaniu pokoju. 🟢 <b>Łatwy</b>: 3 podpowiedzi gratis, nietrafione konfrontacje bez kary. 🟡 <b>Normalny</b>: standard. 🔴 <b>Trudny</b>: podpowiedzi −2 pkt i limit czasu — za każde rozpoczęte 15 min po limicie −1 pkt.</p></div>
          <div><h3>📚 Serie</h3><p>Sprawy z serii mają odcinki. Kolejny odcinek odblokowuje się, gdy rozwiążesz poprzedni (w dowolnej drużynie).</p></div>
          <div><h3>🔊 Dźwięk</h3><p>Maszyna do pisania przy nowych wiadomościach, pieczątka przy trafieniach, opcjonalny klimat w tle (deszcz). Ustawienia pod przyciskiem 🔊.</p></div>
          <div><h3>🖍 Zakreślacz</h3><p>Zaznacz fragment tekstu w dokumencie (myszką albo przytrzymując palec) — pojawi się pasek: <b>Zakreśl</b>, <b>Na tablicę</b> (jako cytat) albo <b>Na oś czasu</b>. Zakreślenia widzi cała drużyna, każdy gracz ma swój kolor.</p></div>
          <div><h3>🕒 Oś czasu</h3><p>Wspólna lista wydarzeń, która sama układa się według dnia i godziny. Dodawajcie fakty z dokumentów i szukajcie dziur w alibi — to najważniejsze narzędzie śledczego.</p></div>
          <div><h3>📨 Wiadomości</h3><p>W trakcie śledztwa przychodzą wiadomości od przełożonych — po złożeniu wniosku albo po upływie czasu. Często z nowymi dokumentami i zwrotami akcji.</p></div>
          <div><h3>🧵 Tablica</h3><p>Przypinajcie dokumenty przyciskiem 📌, dodawajcie karteczki z tropami i łączcie je czerwoną nitką (<b>Połącz nitką</b> → kliknij dwa elementy). Elementy można przeciągać, kliknięcie nitki ją usuwa.</p></div>
          <div><h3>🗒 Notatki</h3><p>Wspólny notatnik całej drużyny — idealny na oś czasu i listę alibi. Obok lista graczy i dziennik śledztwa (kto co odblokował, kto wziął podpowiedź).</p></div>
          <div><h3>⚖️ Rozwiązanie</h3><p>Wszyscy edytujecie <b>jedną wspólną odpowiedź</b>: kto, czym, dlaczego i jak sprawca zatarł ślady. Gdy każdy kliknie <b>✅ Zgadzam się</b>, odpowiedź idzie automatycznie. Zmiana odpowiedzi zeruje głosy. Potem wszyscy widzą wynik, rozwiązanie i ranking.</p></div>
          <div><h3>💡 Porady</h3><p>Rozpiszcie oś czasu minuta po minucie. Sprawdzajcie alibi każdego podejrzanego na <i>prawdziwy</i> czas zbrodni. Nie ufajcie niczemu, co mogło zostać ustawione — zegarom, zeznaniom bliskich. Szukajcie sprzeczności między dokumentami.</p></div>
        </div>
      </section>

      <section class="panel" id="h-punkty">
        <h2>3. Punktacja</h2>
        <p>Typowa sprawa daje <b>10 pkt</b>: sprawca 4, narzędzie 2, motyw 2, opis zacierania śladów 2 (zaliczany, gdy zawiera kluczowe elementy). Każda podpowiedź odejmuje drużynie punkty (zwykle 1). Podpowiedzi widzą wszyscy w pokoju.</p>
        <p><b>⏱ Czas</b> liczy się od założenia pokoju (licznik u góry). W <b>🏆 rankingu</b> sprawy wygrywa drużyna z największą liczbą punktów, a przy remisie — szybsza. Ranking widać po rozwiązaniu i w lobby przy każdej sprawie.</p>
        <p><b>🎥 Tryb streamera</b> (przycisk u góry) ukrywa kody pokoi, żeby widzowie nie wbili Wam do śledztwa. Link-zaproszenie dalej da się skopiować.</p>
      </section>

      <section class="panel" id="h-ai">
        <h2>4. Własne sprawy — z AI albo w edytorze</h2>
        <p><b>✏️ Edytor spraw</b> (link w lobby) pozwala napisać sprawę od zera albo poprawić gotowy plik w formularzach — bez grzebania w JSON. Z edytora pobierzesz plik, założysz pokój albo (admin) opublikujesz sprawę.</p>
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
            : k === "conf"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: 4)</option><option>3</option><option>4</option><option>5</option><option>6</option></select></label>`
            : k === "series"
            ? `<label class="wide">${label}<input data-p="${k}" placeholder="${esc(ph)}" maxlength="200"></label>`
            : k === "story"
            ? `<label>${label}<select data-p="${k}"><option value="">(domyślnie: 2)</option><option>0</option><option>1</option><option>2</option><option>3</option></select></label>`
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
window.BS = {
  sb, $, $$, esc, inline, plain, toast, confirmBox, showModal, q, errMsg, debounce,
  validateCase, splitCase, mergeCase, renderPreview, renderBlocks, downloadJson, readCaseFile, publishCase, openEditor,
  topbarUser, bindLogout, diffSelect, SND, SITE,
  me: () => me, isAdmin: () => isAdmin, app,
};
init();
})();
