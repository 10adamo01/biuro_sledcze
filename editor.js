/* =====================================================================
   BIURO ŚLEDCZE — edytor spraw (formularze zamiast JSON-a)
   Ładowany przed app.js; korzysta z window.BS (udostępnianego przez app.js).
   ===================================================================== */
(() => {
"use strict";

const KEY = "edytor";
let ED = null;            // { c: sprawa, source: {kind, id?, roomId?, title?}, sel: "info" }
let saveTimer = null;
const B = () => window.BS;

/* ---------------- szablony ---------------- */
const TEMPLATE = () => ({
  format: "detektyw-case/1", id: "nowa-sprawa", title: "Nowa sprawa", subtitle: "Sprawa nr …",
  meta: { players: "1–4", time: "60–90 min", difficulty: "średnia", author: "" },
  time_limit: 90,
  intro: [{ type: "p", text: "Krótko: co się stało i dlaczego sprawa budzi wątpliwości." },
          { type: "small", text: "Wszystkie osoby, firmy i miejsca są fikcyjne." }],
  documents: [{ id: "d1", no: "1", category: "Raporty", title: "Notatka z oględzin", subtitle: "", blocks: [{ type: "p", text: "Treść dokumentu…" }] }],
  unlocks: [], story: [], confrontations: [],
  questions: [
    { id: "who", label: "KTO jest sprawcą?", type: "choice", points: 4, answer: "a", options: [{ id: "a", label: "Podejrzany A" }, { id: "b", label: "Podejrzany B" }] },
    { id: "weapon", label: "CZYM?", type: "choice", points: 2, answer: "a", options: [{ id: "a", label: "Narzędzie A" }, { id: "b", label: "Narzędzie B" }] },
    { id: "motive", label: "DLACZEGO?", type: "choice", points: 2, answer: "a", options: [{ id: "a", label: "Motyw A" }, { id: "b", label: "Motyw B" }] },
    { id: "how", label: "JAK sprawca zatarł ślady? (opisz)", type: "text", points: 2, placeholder: "", keywords: ["słowo1", "słowo2"], min_keywords: 2 },
  ],
  hints: { who: [], weapon: [], motive: [], how: [] }, hint_penalty: 1,
  ranks: [{ min: 9, label: "Mistrzowska robota!" }, { min: 6, label: "Solidna robota." }, { min: 3, label: "Obrona ma pole do popisu." }, { min: 0, label: "Sprawa umorzona…" }],
  solution: [{ type: "p", text: "Rozwiązanie: kto, czym, dlaczego — z numerami dokumentów." }],
});

const BLOCK_TYPES = [
  ["p", "Akapit"], ["h", "Śródtytuł"], ["small", "Przypis (mały tekst)"], ["note", "Uwaga / notatka (niebieska)"],
  ["list", "Lista punktowana"], ["kv", "Tabela klucz–wartość"], ["table", "Tabela"], ["qa", "Przesłuchanie (P/O)"],
  ["receipts", "Paragony"], ["handwriting", "Notes odręczny"], ["email", "E-mail"], ["signature", "Podpis"],
  ["stamp", "Pieczątka"], ["divider", "Linia"], ["box", "Ramka z blokami"], ["svg", "Rysunek SVG (zaawansowane)"], ["image", "Obrazek z adresu"],
];
const BT = Object.fromEntries(BLOCK_TYPES);
function blockTemplate(t) {
  switch (t) {
    case "list": return { type: t, items: [""] };
    case "kv": return { type: t, rows: [["", ""]] };
    case "table": return { type: t, head: ["Kolumna 1", "Kolumna 2"], rows: [["", ""]] };
    case "qa": return { type: t, items: [["", ""]] };
    case "receipts": return { type: t, items: [{ lines: ["## NAZWA SKLEPU", "adres", "---", "Pozycja            10,00", "---", "SUMA PLN           10,00", "16.10.2026 20:48"] }] };
    case "handwriting": return { type: t, entries: [{ date: "pon.", lines: [""] }] };
    case "email": return { type: t, headers: [["Od", ""], ["Do", ""], ["Temat", ""], ["Data", ""]], body: [""] };
    case "svg": return { type: t, svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'><rect x='10' y='10' width='380' height='180' fill='none' stroke='black'/></svg>", caption: "" };
    case "image": return { type: t, src: "https://", caption: "" };
    case "box": return { type: t, title: "", blocks: [{ type: "p", text: "" }] };
    case "divider": return { type: t };
    default: return { type: t, text: "" };
  }
}
const ADD = {
  pair: () => ["", ""],
  receipt: () => ({ lines: ["## NAZWA", "---", ""] }),
  entry: () => ({ date: "", lines: [""] }),
  option: arr => ({ id: nextId(arr.map(o => o.id), "o"), label: "" }),
  rank: () => ({ min: 0, label: "" }),
  hint: () => "",
  doc: () => newDoc(),
  unlock: arr => ({ id: nextId(arr.map(u => u.id), "wniosek"), title: "Wniosek o …", prompt: "Pytanie, na które odpowiedź jest w aktach", placeholder: "", answers: [""], match: "exact", message: "Wniosek przyjęty. Nowy dokument w aktach.", documents: [] }),
  story: arr => ({ id: nextId(arr.map(u => u.id), "wiadomosc"), trigger: { type: "minutes", minutes: 30 }, from: "Komendant", title: "Nowa wiadomość", blocks: [{ type: "p", text: "" }], documents: [] }),
  conf: arr => ({ id: nextId(arr.map(u => u.id), "sprzecznosc"), title: "", a: [], b: [], points: 1, message: "" }),
  question: arr => ({ id: nextId(arr.map(u => u.id), "q"), label: "Nowe pytanie", type: "choice", points: 1, answer: "a", options: [{ id: "a", label: "" }, { id: "b", label: "" }] }),
};
function nextId(existing, prefix) { let i = existing.length + 1; while (existing.includes(`${prefix}${i}`)) i++; return `${prefix}${i}`; }
function allDocsOf(c) {
  return [...(c.documents || []), ...(c.unlocks || []).flatMap(u => u.documents || []), ...(c.story || []).flatMap(m => m.documents || [])];
}
function newDoc() {
  const docs = allDocsOf(ED.c);
  const ids = docs.map(d => d.id);
  const nums = docs.map(d => parseInt(d.no, 10)).filter(n => !isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  let id = `d${n}`; while (ids.includes(id)) id += "x";
  return { id, no: String(n), category: "Dowody", title: "Nowy dokument", subtitle: "", blocks: [{ type: "p", text: "" }] };
}

/* ---------------- ścieżki ---------------- */
const parts = p => p.split(".").map(k => (/^\d+$/.test(k) ? +k : k));
function getP(o, p) { return parts(p).reduce((x, k) => (x == null ? undefined : x[k]), o); }
function setP(o, p, v) {
  const ks = parts(p); let x = o;
  for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null) x[ks[i]] = typeof ks[i + 1] === "number" ? [] : {}; x = x[ks[i]]; }
  x[ks[ks.length - 1]] = v;
}

/* ---------------- stan ---------------- */
function load() {
  try { ED = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { ED = null; }
  if (!ED || !ED.c) ED = { c: TEMPLATE(), source: { kind: "new" }, sel: "info" };
  normalize(ED.c);
}
function normalize(c) {
  ["intro", "documents", "unlocks", "story", "confrontations", "questions", "ranks", "solution"].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
  if (!c.meta || typeof c.meta !== "object") c.meta = {};
  if (!c.hints || typeof c.hints !== "object") c.hints = {};
  c.questions.forEach(q => { if (!Array.isArray(c.hints[q.id])) c.hints[q.id] = []; });
  if (!c.format) c.format = "detektyw-case/1";
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ED)); setStatus("zapisano w przeglądarce"); }
    catch { setStatus("⚠ brak miejsca na autozapis — pobierz plik"); }
  }, 400);
}
function setStatus(t) { const el = document.getElementById("edStatus"); if (el) el.textContent = t; }

// Plik gotowy do zapisu: bez pustych pól pomocniczych
function cleaned() {
  const c = JSON.parse(JSON.stringify(ED.c));
  if (!c.series || !c.series.id) delete c.series;
  else c.series.episode = Number(c.series.episode) || 1;
  if (!c.unlocks.length) delete c.unlocks;
  if (!c.story.length) delete c.story;
  if (!c.confrontations.length) delete c.confrontations;
  Object.keys(c.hints).forEach(k => { if (!c.questions.some(q => q.id === k)) delete c.hints[k]; else c.hints[k] = c.hints[k].filter(h => String(h).trim()); });
  (c.questions || []).forEach(q => {
    if (q.type === "choice") { delete q.keywords; delete q.min_keywords; }
    else { delete q.options; delete q.answer; }
  });
  (c.unlocks || []).forEach(u => { u.answers = (u.answers || []).filter(a => String(a).trim()); });
  return c;
}

/* ---------------- pola formularzy ---------------- */
const esc = s => B().esc(s);
const inp = (p, v, ph = "", t = "", extra = "") => `<input data-p="${p}" ${t ? `data-t="${t}"` : ""} value="${esc(v ?? "")}" placeholder="${esc(ph)}" ${extra}>`;
const area = (p, v, rows = 3, ph = "", t = "", extra = "") => `<textarea data-p="${p}" ${t ? `data-t="${t}"` : ""} rows="${rows}" placeholder="${esc(ph)}" ${extra}>${esc(v ?? "")}</textarea>`;
const sel = (p, v, opts, t = "", extra = "") => `<select data-p="${p}" ${t ? `data-t="${t}"` : ""} ${extra}>${opts.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const field = (label, html, cls = "") => `<label class="ef ${cls}"><span>${label}</span>${html}</label>`;
const btn = (a, p, label, extra = "", cls = "tiny ghost") => `<button type="button" class="btn ${cls}" data-a="${a}" data-p="${p}" ${extra}>${label}</button>`;
const moveBtns = (arrPath, i, delLabel = "✕") => `<span class="ed-move">${btn("up", arrPath, "↑", `data-i="${i}" title="W górę"`)}${btn("down", arrPath, "↓", `data-i="${i}" title="W dół"`)}${btn("del", arrPath, delLabel, `data-i="${i}" title="Usuń"`)}</span>`;
const docLabel = d => `Dok. ${d.no || "?"}: ${String(d.title || "").replace(/<[^>]+>/g, "")}`;

/* ---------------- bloki ---------------- */
function blocksEd(path, blocks) {
  blocks = blocks || [];
  return `<div class="ed-blocks">${blocks.map((b, i) => blockEd(`${path}.${i}`, b, path, i)).join("")}
    <div class="ed-addblock"><select data-blocktype>${BLOCK_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>${btn("addblock", path, "＋ Dodaj blok", "", "tiny")}</div></div>`;
}
function blockEd(p, b, arrPath, i) {
  const t = b.type;
  let body = "";
  if (["p", "h", "small", "note", "signature", "stamp"].includes(t)) body = area(`${p}.text`, b.text, t === "p" || t === "note" ? 3 : 1);
  else if (t === "list") body = area(`${p}.items`, (b.items || []).join("\n"), 4, "jeden punkt w linii", "lines");
  else if (t === "kv") body = `${(b.rows || []).map((r, j) => `<div class="ed-pair">${inp(`${p}.rows.${j}.0`, r[0], "Klucz")}${area(`${p}.rows.${j}.1`, r[1], 1, "Wartość")}${btn("del", `${p}.rows`, "✕", `data-i="${j}"`)}</div>`).join("")}${btn("add", `${p}.rows`, "＋ wiersz", `data-v="pair"`)}`;
  else if (t === "table") {
    const cols = Math.max((b.head || []).length, ...(b.rows || []).map(r => r.length), 1);
    body = `<div class="ed-table-wrap"><table class="ed-table"><thead><tr>${Array.from({ length: cols }, (_, k) => `<th>${inp(`${p}.head.${k}`, (b.head || [])[k], `Kol. ${k + 1}`)}${btn("tdelcol", p, "✕", `data-i="${k}" title="Usuń kolumnę"`)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${(b.rows || []).map((r, j) => `<tr>${Array.from({ length: cols }, (_, k) => `<td>${area(`${p}.rows.${j}.${k}`, r[k], 1)}</td>`).join("")}<td>${btn("del", `${p}.rows`, "✕", `data-i="${j}"`)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row wrap">${btn("taddrow", p, "＋ wiersz")}${btn("taddcol", p, "＋ kolumna")}<label class="sw"><input type="checkbox" data-p="${p}.mono" data-t="bool" ${b.mono ? "checked" : ""}> czcionka maszynowa</label></div>`;
  } else if (t === "qa") body = `${(b.items || []).map((r, j) => `<div class="ed-qa"><div class="ed-qa-row"><b>P:</b>${area(`${p}.items.${j}.0`, r[0], 1, "Pytanie")}</div><div class="ed-qa-row"><b>O:</b>${area(`${p}.items.${j}.1`, r[1], 3, "Odpowiedź")}</div>${btn("del", `${p}.items`, "✕ usuń parę", `data-i="${j}"`)}</div>`).join("")}${btn("add", `${p}.items`, "＋ pytanie i odpowiedź", `data-v="pair"`)}`;
  else if (t === "receipts") body = `<p class="small">„## Tekst” = nagłówek, „---” = linia przerywana. Spacje są zachowane.</p><div class="ed-receipts">${(b.items || []).map((r, j) => `<div>${area(`${p}.items.${j}.lines`, (r.lines || []).join("\n"), 9, "", "rawlines", `class="mono"`)}${btn("del", `${p}.items`, "✕ usuń paragon", `data-i="${j}"`)}</div>`).join("")}</div>${btn("add", `${p}.items`, "＋ paragon", `data-v="receipt"`)}`;
  else if (t === "handwriting") body = `${(b.entries || []).map((e, j) => `<div class="ed-entry">${inp(`${p}.entries.${j}.date`, e.date, "data, np. pon. 13.10")}${area(`${p}.entries.${j}.lines`, (e.lines || []).join("\n"), 3, "jeden wpis w linii", "lines")}${btn("del", `${p}.entries`, "✕", `data-i="${j}"`)}</div>`).join("")}${btn("add", `${p}.entries`, "＋ dzień", `data-v="entry"`)}`;
  else if (t === "email") body = `${(b.headers || []).map((r, j) => `<div class="ed-pair">${inp(`${p}.headers.${j}.0`, r[0], "Pole")}${inp(`${p}.headers.${j}.1`, r[1], "Wartość")}${btn("del", `${p}.headers`, "✕", `data-i="${j}"`)}</div>`).join("")}${btn("add", `${p}.headers`, "＋ nagłówek", `data-v="pair"`)}
      ${field("Treść (akapity oddziel pustą linią)", area(`${p}.body`, (b.body || []).join("\n\n"), 6, "", "paras"))}`;
  else if (t === "svg") body = `${area(`${p}.svg`, b.svg, 6, "<svg …>", "", `class="mono"`)}${field("Podpis", inp(`${p}.caption`, b.caption))}`;
  else if (t === "image") body = `${field("Adres obrazka (https://…)", inp(`${p}.src`, b.src))}${field("Podpis", inp(`${p}.caption`, b.caption))}`;
  else if (t === "box") body = `${field("Tytuł ramki", inp(`${p}.title`, b.title))}${blocksEd(`${p}.blocks`, b.blocks)}`;
  else if (t === "divider") body = `<hr>`;
  else body = `<p class="small">Nieznany typ bloku „${esc(t)}” — zostanie zachowany bez zmian.</p>`;
  return `<div class="ed-block"><div class="ed-bhead"><span class="ed-btype">${esc(BT[t] || t)}</span>${moveBtns(arrPath, i)}</div>${body}</div>`;
}

/* ---------------- sekcje ---------------- */
function docEd(p, d, ctx) {
  const cats = [...new Set(allDocsOf(ED.c).map(x => x.category).filter(Boolean).concat(["Raporty", "Osoby", "Przesłuchania", "Dowody"]))];
  return `<div class="ed-head-row"><h2>${ctx}</h2></div>
    <div class="ed-grid">
      ${field("Id (unikalne)", inp(`${p}.id`, d.id, "d12", "", "data-side"))}
      ${field("Numer (wyświetlany)", inp(`${p}.no`, d.no, "12", "", "data-side"))}
      ${field("Kategoria", inp(`${p}.category`, d.category, "Dowody", "", `list="edCats" data-side`))}
    </div>
    <datalist id="edCats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    ${field("Tytuł", inp(`${p}.title`, d.title, "", "", "data-side"), "wide")}
    ${field("Podtytuł (kto, kiedy)", inp(`${p}.subtitle`, d.subtitle), "wide")}
    <h3>Treść</h3>${blocksEd(`${p}.blocks`, d.blocks)}`;
}

function infoEd(c) {
  return `<h2>Informacje o sprawie</h2>
    <div class="ed-grid">
      ${field("Id sprawy (małe litery, cyfry, myślniki)", inp("id", c.id, "zatrute-wesele"))}
      ${field("Tytuł", inp("title", c.title, "", "", "data-side"))}
      ${field("Podtytuł", inp("subtitle", c.subtitle))}
      ${field("Liczba graczy", inp("meta.players", c.meta.players, "1–4"))}
      ${field("Czas gry", inp("meta.time", c.meta.time, "60–90 min"))}
      ${field("Trudność (opis)", inp("meta.difficulty", c.meta.difficulty, "średnia"))}
      ${field("Autor", inp("meta.author", c.meta.author))}
      ${field("Limit czasu na poziomie trudnym (min)", inp("time_limit", c.time_limit ?? 90, "90", "num", `type="number" min="10" max="600"`))}
      ${field("Kara za podpowiedź (pkt)", inp("hint_penalty", c.hint_penalty ?? 1, "1", "num", `type="number" min="0" max="5"`))}
    </div>
    <h3>📚 Seria (opcjonalnie)</h3>
    <p class="small">Sprawy z tym samym id serii tworzą kampanię — odcinek N odblokowuje się po rozwiązaniu odcinka N−1.</p>
    <div class="ed-grid">
      ${field("Id serii", inp("series.id", c.series?.id, "akta-rudnickiej"))}
      ${field("Nazwa serii", inp("series.title", c.series?.title, "Akta komisarz Rudnickiej"))}
      ${field("Numer odcinka", inp("series.episode", c.series?.episode ?? "", "1", "num", `type="number" min="1"`))}
    </div>
    <h3>🏅 Rangi za wynik</h3>
    ${(c.ranks || []).map((r, i) => `<div class="ed-pair">${inp(`ranks.${i}.min`, r.min, "od pkt", "num", `type="number" class="short"`)}${inp(`ranks.${i}.label`, r.label, "Tekst rangi")}${btn("del", "ranks", "✕", `data-i="${i}"`)}</div>`).join("")}
    ${btn("add", "ranks", "＋ ranga", `data-v="rank"`)}`;
}

function unlockEd(i) {
  const u = ED.c.unlocks[i], p = `unlocks.${i}`;
  return `<div class="ed-head-row"><h2>📝 Wniosek</h2>${moveBtns("unlocks", i, "🗑 Usuń wniosek")}</div>
    <div class="ed-grid">${field("Id", inp(`${p}.id`, u.id, "", "", "data-side"))}${field("Tytuł", inp(`${p}.title`, u.title, "", "", "data-side"))}</div>
    ${field("Pytanie dla graczy (odpowiedź musi być w aktach)", area(`${p}.prompt`, u.prompt, 2), "wide")}
    <div class="ed-grid">
      ${field("Podpowiedź w polu", inp(`${p}.placeholder`, u.placeholder, "np. nazwa przedmiotu"))}
      ${field("Dopasowanie", sel(`${p}.match`, u.match || "exact", [["exact", "dokładne (całe słowo/fraza)"], ["contains", "zawiera (rdzeń słowa)"]]))}
    </div>
    ${field("Akceptowane odpowiedzi (jedna w linii; wielkość liter i polskie znaki bez znaczenia)", area(`${p}.answers`, (u.answers || []).join("\n"), 4, "", "lines"), "wide")}
    ${field("Komunikat po przyjęciu", area(`${p}.message`, u.message, 2), "wide")}
    <h3>Dokumenty dołączane po przyjęciu</h3>
    ${(u.documents || []).map((d, j) => `<div class="ed-sublink">${btn("sel", "", `📄 ${esc(docLabel(d))}`, `data-s="unlock:${i}:doc:${j}"`, "tiny")}</div>`).join("") || `<p class="small">Brak — dodaj dokument, który drużyna dostanie za trafny wniosek.</p>`}
    ${btn("adddoc", `${p}.documents`, "＋ Dokument do wniosku", "", "tiny")}`;
}

function storyEd(i) {
  const m = ED.c.story[i], p = `story.${i}`, tt = m.trigger?.type || "start";
  return `<div class="ed-head-row"><h2>📨 Wiadomość fabularna</h2>${moveBtns("story", i, "🗑 Usuń wiadomość")}</div>
    <div class="ed-grid">
      ${field("Id", inp(`${p}.id`, m.id))}
      ${field("Od kogo", inp(`${p}.from`, m.from, "insp. Jerzy Malec"))}
      ${field("Tytuł", inp(`${p}.title`, m.title, "", "", "data-side"))}
      ${field("Kiedy przychodzi", sel(`${p}.trigger.type`, tt, [["start", "od razu na starcie"], ["unlock", "po odblokowaniu wniosku"], ["minutes", "po X minutach gry"]], "", "data-rerender"))}
      ${tt === "unlock" ? field("Wniosek", sel(`${p}.trigger.unlock`, m.trigger?.unlock, [["", "— wybierz —"], ...ED.c.unlocks.map(u => [u.id, u.title || u.id])])) : ""}
      ${tt === "minutes" ? field("Minuty", inp(`${p}.trigger.minutes`, m.trigger?.minutes ?? 30, "", "num", `type="number" min="0"`)) : ""}
    </div>
    <h3>Treść</h3>${blocksEd(`${p}.blocks`, m.blocks)}
    <h3>Załączone dokumenty</h3>
    ${(m.documents || []).map((d, j) => `<div class="ed-sublink">${btn("sel", "", `📄 ${esc(docLabel(d))}`, `data-s="story:${i}:doc:${j}"`, "tiny")}</div>`).join("") || `<p class="small">Brak.</p>`}
    ${btn("adddoc", `${p}.documents`, "＋ Dokument do wiadomości", "", "tiny")}`;
}

function confEd() {
  const docs = allDocsOf(ED.c);
  const multi = (p, vals) => `<select multiple size="5" data-p="${p}" data-t="multi">${docs.map(d => `<option value="${esc(d.id)}" ${(vals || []).includes(d.id) ? "selected" : ""}>${esc(docLabel(d))}</option>`).join("")}</select>`;
  return `<h2>⚔️ Sprzeczności</h2>
    <p class="small">Gracze zestawiają dwa dokumenty. Trafna para (dowolny z „A” z dowolnym z „B”) daje punkty bonusowe i komunikat. Zaznacz kilka dokumentów z Ctrl/Cmd.</p>
    ${ED.c.confrontations.map((x, i) => `<div class="ed-card">
      <div class="ed-head-row"><b>${esc(x.title || x.id)}</b>${moveBtns("confrontations", i)}</div>
      <div class="ed-grid">${field("Id", inp(`confrontations.${i}.id`, x.id))}${field("Tytuł", inp(`confrontations.${i}.title`, x.title, "Zegar nie chodził"))}${field("Punkty", inp(`confrontations.${i}.points`, x.points ?? 1, "", "num", `type="number" min="0"`))}</div>
      <div class="ed-grid">${field("Dokumenty A", multi(`confrontations.${i}.a`, x.a))}${field("Dokumenty B", multi(`confrontations.${i}.b`, x.b))}</div>
      ${field("Wyjaśnienie po trafieniu", area(`confrontations.${i}.message`, x.message, 2), "wide")}</div>`).join("")}
    ${btn("add", "confrontations", "＋ Sprzeczność", `data-v="conf"`, "tiny")}`;
}

function questionsEd() {
  const c = ED.c;
  return `<h2>❓ Pytania końcowe i podpowiedzi</h2>
    ${c.questions.map((qq, i) => {
      const p = `questions.${i}`;
      return `<div class="ed-card">
        <div class="ed-head-row"><b>${esc(qq.label || qq.id)}</b>${moveBtns("questions", i)}</div>
        <div class="ed-grid">
          ${field("Id", inp(`${p}.id`, qq.id, "who", "", "data-qid"))}
          ${field("Typ", sel(`${p}.type`, qq.type, [["choice", "wybór z listy"], ["text", "opis (słowa-klucze)"]], "", "data-rerender"))}
          ${field("Punkty", inp(`${p}.points`, qq.points, "", "num", `type="number" min="0"`))}
        </div>
        ${field("Treść pytania", inp(`${p}.label`, qq.label), "wide")}
        ${qq.type === "choice" ? `<p class="small">Zaznacz kółkiem poprawną odpowiedź.</p>
          ${(qq.options || []).map((o, j) => `<div class="ed-opt"><input type="radio" name="ans-${i}" data-p="${p}.answer" data-t="radio" value="${esc(o.id)}" ${qq.answer === o.id ? "checked" : ""} title="Poprawna">
            ${inp(`${p}.options.${j}.id`, o.id, "id", "", `class="short" data-optid="${i}"`)}${inp(`${p}.options.${j}.label`, o.label, "Treść odpowiedzi")}${btn("del", `${p}.options`, "✕", `data-i="${j}"`)}</div>`).join("")}
          ${btn("add", `${p}.options`, "＋ odpowiedź", `data-v="option"`)}`
        : `${field("Słowa-klucze (rdzenie, jedno w linii)", area(`${p}.keywords`, (qq.keywords || []).join("\n"), 4, "zegar\nwskaz\nfiliżank", "lines"), "wide")}
           <div class="ed-grid">${field("Ile słów wystarczy", inp(`${p}.min_keywords`, qq.min_keywords ?? 1, "", "num", `type="number" min="1"`))}${field("Podpowiedź w polu", inp(`${p}.placeholder`, qq.placeholder))}</div>`}
        <h4>💡 Podpowiedzi (od najsłabszej)</h4>
        ${(c.hints[qq.id] || []).map((h, j) => `<div class="ed-pair">${area(`hints.${qq.id}.${j}`, h, 2)}${btn("del", `hints.${qq.id}`, "✕", `data-i="${j}"`)}</div>`).join("")}
        ${btn("add", `hints.${qq.id}`, "＋ podpowiedź", `data-v="hint"`)}
      </div>`;
    }).join("")}
    ${btn("add", "questions", "＋ Pytanie", `data-v="question"`, "tiny")}`;
}

/* ---------------- nawigacja ---------------- */
function navItems() {
  const c = ED.c, items = [["info", "ℹ️ Informacje"], ["intro", "📋 Odprawa"], ["#Dokumenty"]];
  c.documents.forEach((d, i) => items.push([`doc:${i}`, `${d.no || "?"} · ${String(d.title || "").replace(/<[^>]+>/g, "")}`, "sub"]));
  items.push(["+doc", "＋ Dokument"], ["#Wnioski"]);
  c.unlocks.forEach((u, i) => {
    items.push([`unlock:${i}`, `📝 ${u.title || u.id}`, "sub"]);
    (u.documents || []).forEach((d, j) => items.push([`unlock:${i}:doc:${j}`, `↳ ${d.no || "?"} · ${String(d.title || "").replace(/<[^>]+>/g, "")}`, "sub2"]));
  });
  items.push(["+unlock", "＋ Wniosek"], ["#Wiadomości"]);
  c.story.forEach((m, i) => {
    items.push([`story:${i}`, `📨 ${m.title || m.id}`, "sub"]);
    (m.documents || []).forEach((d, j) => items.push([`story:${i}:doc:${j}`, `↳ ${d.no || "?"} · ${String(d.title || "").replace(/<[^>]+>/g, "")}`, "sub2"]));
  });
  items.push(["+story", "＋ Wiadomość"], ["#Rozgrywka"], ["conf", `⚔️ Sprzeczności (${c.confrontations.length})`], ["questions", "❓ Pytania i podpowiedzi"], ["solution", "🔓 Rozwiązanie"]);
  return items;
}
function renderSide() {
  const side = document.getElementById("edSide"), mob = document.getElementById("edNavSel");
  if (!side) return;
  const items = navItems();
  side.innerHTML = items.map(([k, l, cls]) => k.startsWith("#") ? `<div class="dl-group">${esc(k.slice(1))}</div>`
    : k.startsWith("+") ? `<button type="button" class="ed-nav add" data-a="navadd" data-k="${k.slice(1)}">${esc(l)}</button>`
    : `<button type="button" class="ed-nav ${cls || ""} ${ED.sel === k ? "active" : ""}" data-a="sel" data-s="${k}">${esc(l)}</button>`).join("");
  if (mob) mob.innerHTML = items.filter(([k]) => !k.startsWith("#") && !k.startsWith("+")).map(([k, l]) => `<option value="${k}" ${ED.sel === k ? "selected" : ""}>${esc(l)}</option>`).join("");
}
function renderForm() {
  const f = document.getElementById("edForm");
  if (!f) return;
  const c = ED.c, s = ED.sel;
  let html = "", m;
  if (s === "info") html = infoEd(c);
  else if (s === "intro") html = `<h2>📋 Odprawa (to gracze widzą na start)</h2>${blocksEd("intro", c.intro)}`;
  else if (s === "solution") html = `<h2>🔓 Rozwiązanie (widoczne po wysłaniu odpowiedzi)</h2>${blocksEd("solution", c.solution)}`;
  else if (s === "conf") html = confEd();
  else if (s === "questions") html = questionsEd();
  else if ((m = s.match(/^doc:(\d+)$/)) && c.documents[+m[1]]) html = `${docEd(`documents.${m[1]}`, c.documents[+m[1]], "📄 Dokument")}<div class="ed-foot">${moveBtns("documents", +m[1], "🗑 Usuń dokument")}</div>`;
  else if ((m = s.match(/^unlock:(\d+)$/)) && c.unlocks[+m[1]]) html = unlockEd(+m[1]);
  else if ((m = s.match(/^unlock:(\d+):doc:(\d+)$/)) && c.unlocks[+m[1]]?.documents?.[+m[2]]) html = `${docEd(`unlocks.${m[1]}.documents.${m[2]}`, c.unlocks[+m[1]].documents[+m[2]], `📄 Dokument z wniosku „${esc(c.unlocks[+m[1]].title)}”`)}<div class="ed-foot">${btn("sel", "", "← Wróć do wniosku", `data-s="unlock:${m[1]}"`, "tiny")}${moveBtns(`unlocks.${m[1]}.documents`, +m[2], "🗑 Usuń dokument")}</div>`;
  else if ((m = s.match(/^story:(\d+)$/)) && c.story[+m[1]]) html = storyEd(+m[1]);
  else if ((m = s.match(/^story:(\d+):doc:(\d+)$/)) && c.story[+m[1]]?.documents?.[+m[2]]) html = `${docEd(`story.${m[1]}.documents.${m[2]}`, c.story[+m[1]].documents[+m[2]], `📄 Dokument z wiadomości`)}<div class="ed-foot">${btn("sel", "", "← Wróć do wiadomości", `data-s="story:${m[1]}"`, "tiny")}${moveBtns(`story.${m[1]}.documents`, +m[2], "🗑 Usuń dokument")}</div>`;
  else { ED.sel = "info"; html = infoEd(c); }
  f.innerHTML = html;
}
function validate() {
  const errs = B().validateCase(cleaned());
  const el = document.getElementById("edErrs");
  if (el) {
    el.className = `badge ${errs.length ? "bad" : "ok"}`;
    el.textContent = errs.length ? `⚠ ${errs.length} ${errs.length === 1 ? "błąd" : "błędów"}` : "✓ plik poprawny";
    el.title = errs.slice(0, 12).join("\n");
  }
  return errs;
}
function renderAll(keepScroll = true) {
  const f = document.getElementById("edForm");
  const y = keepScroll && f ? f.scrollTop : 0, wy = window.scrollY;
  renderSide(); renderForm(); validate();
  if (f) f.scrollTop = y;
  if (keepScroll) window.scrollTo(0, wy);
}

/* ---------------- akcje ---------------- */
function arr(path) { const a = getP(ED.c, path); if (Array.isArray(a)) return a; const n = []; setP(ED.c, path, n); return n; }
function select(k) { ED.sel = k; persist(); renderAll(false); document.getElementById("edForm")?.scrollTo(0, 0); window.scrollTo(0, 0); }

async function onAction(b) {
  const a = b.dataset.a, p = b.dataset.p, i = b.dataset.i !== undefined ? +b.dataset.i : null;
  const c = ED.c;
  if (a === "sel") return select(b.dataset.s);
  if (a === "navadd") {
    const k = b.dataset.k;
    if (k === "doc") { c.documents.push(newDoc()); return select(`doc:${c.documents.length - 1}`); }
    if (k === "unlock") { c.unlocks.push(ADD.unlock(c.unlocks)); return select(`unlock:${c.unlocks.length - 1}`); }
    if (k === "story") { c.story.push(ADD.story(c.story)); return select(`story:${c.story.length - 1}`); }
    return;
  }
  if (a === "add") {
    const list = arr(p), mk = ADD[b.dataset.v];
    list.push(mk ? mk(list) : "");
    if (b.dataset.v === "question") c.hints[list[list.length - 1].id] = [];
  } else if (a === "adddoc") {
    const list = arr(p); list.push(newDoc());
    const mm = p.match(/^(unlocks|story)\.(\d+)\.documents$/);
    if (mm) return select(`${mm[1] === "unlocks" ? "unlock" : "story"}:${mm[2]}:doc:${list.length - 1}`);
  } else if (a === "addblock") {
    const t = b.parentElement.querySelector("[data-blocktype]").value;
    arr(p).push(blockTemplate(t));
  } else if (a === "del") {
    const list = arr(p);
    const big = /^(documents|unlocks|story|questions|confrontations)$|\.documents$/.test(p);
    if (big && !await B().confirmBox("Na pewno usunąć? Tego nie da się cofnąć (chyba że wczytasz plik ponownie).", "Usuń")) return;
    const [removed] = list.splice(i, 1);
    if (p === "questions" && removed) delete c.hints[removed.id];
    if (big) {
      if (p === "documents") ED.sel = c.documents.length ? `doc:${Math.max(0, i - 1)}` : "info";
      else if (p === "unlocks") ED.sel = "info";
      else if (p === "story") ED.sel = "info";
      else { const mm = p.match(/^(unlocks|story)\.(\d+)\.documents$/); if (mm) ED.sel = `${mm[1] === "unlocks" ? "unlock" : "story"}:${mm[2]}`; }
    }
  } else if (a === "up" || a === "down") {
    const list = arr(p), j = a === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    if (p === "documents" && ED.sel === `doc:${i}`) ED.sel = `doc:${j}`;
    if (p === "unlocks" && ED.sel === `unlock:${i}`) ED.sel = `unlock:${j}`;
    if (p === "story" && ED.sel === `story:${i}`) ED.sel = `story:${j}`;
  } else if (a === "taddrow") {
    const t = getP(c, p); const cols = Math.max((t.head || []).length, 1); (t.rows = t.rows || []).push(Array(cols).fill(""));
  } else if (a === "taddcol") {
    const t = getP(c, p); (t.head = t.head || []).push(`Kolumna ${t.head.length + 1}`); (t.rows || []).forEach(r => r.push(""));
  } else if (a === "tdelcol") {
    const t = getP(c, p); (t.head || []).splice(i, 1); (t.rows || []).forEach(r => r.splice(i, 1));
  } else return;
  persist(); renderAll();
}

function applyInput(el) {
  const p = el.dataset.p, t = el.dataset.t;
  let v;
  if (t === "num") v = el.value === "" ? "" : Number(el.value);
  else if (t === "lines") v = el.value.split("\n").map(x => x.trim()).filter(Boolean);
  else if (t === "rawlines") v = el.value.split("\n");
  else if (t === "paras") v = el.value.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  else if (t === "bool") v = el.checked;
  else if (t === "multi") v = [...el.selectedOptions].map(o => o.value);
  else if (t === "radio") { if (!el.checked) return; v = el.value; }
  else v = el.value;
  // zmiana id pytania — przenieś podpowiedzi
  const qm = p.match(/^questions\.(\d+)\.id$/);
  if (qm) {
    const old = ED.c.questions[+qm[1]].id;
    if (old !== v) { ED.c.hints[v] = ED.c.hints[old] || []; delete ED.c.hints[old]; }
  }
  // zmiana id opcji, która była poprawna — przenieś „answer”
  const om = p.match(/^questions\.(\d+)\.options\.(\d+)\.id$/);
  if (om) {
    const qq = ED.c.questions[+om[1]], old = qq.options[+om[2]].id;
    if (qq.answer === old) qq.answer = v;
    const r = el.closest(".ed-opt")?.querySelector('input[type="radio"]'); if (r) r.value = v;
  }
  if (p === "series.id" && !v) { delete ED.c.series; persist(); validate(); return; }
  setP(ED.c, p, v);
  setStatus("zapisywanie…");
  persist();
  if (el.hasAttribute("data-side")) renderSide();
  validate();
}

/* ---------------- zapis / wczytanie ---------------- */
async function loadFile(file) {
  const c = await B().readCaseFile(file);
  if (!c) return;
  if (!await B().confirmBox(`Wczytać <b>${esc(c.title || "plik")}</b>? Obecna zawartość edytora zostanie zastąpiona.`, "Wczytaj")) return;
  normalize(c);
  ED = { c, source: { kind: "file" }, sel: "info" };
  persist(); renderEditor(false);
}
async function saveAction(kind) {
  const bs = B(), c = cleaned(), errs = validate();
  if (kind === "download") { bs.downloadJson(c, `${c.id || "sprawa"}.json`); return; }
  if (errs.length) {
    bs.showModal("⚠ Plik ma błędy", `<ul class="ed-errs">${errs.map(e => `<li>${esc(e)}</li>`).join("")}</ul><div class="row end"><button class="btn primary" data-close>OK</button></div>`);
    return;
  }
  if (!bs.me()) { bs.toast("Zaloguj się przez Discord, żeby zapisać sprawę na stronie.", "error"); return; }
  const { pub, sec } = bs.splitCase(c);
  try {
    if (kind === "room") {
      if (!await bs.confirmBox("Zapisać zmiany w pokoju? Drużyna zobaczy nową wersję akt (postęp zostaje).", "Zapisz")) return;
      await bs.q(bs.sb.rpc("replace_room_case", { p_room: ED.source.roomId, p_pub: pub, p_sec: sec }));
      bs.toast("💾 Zapisano w pokoju.", "ok");
    } else if (kind === "publish") {
      if (await bs.publishCase(c)) { ED.source = { kind: "public", id: c.id }; persist(); bs.toast("🌐 Sprawa opublikowana — jest na liście w lobby.", "ok"); renderEditor(false); }
    } else if (kind === "room-new") {
      const w = bs.showModal("🚪 Nowy pokój z tej sprawy", `<form id="edRoomForm" class="col-form">
          <input name="name" maxlength="40" placeholder="Nazwa drużyny (opcjonalnie)">${bs.diffSelect()}
          <p class="small">Sprawa będzie widoczna tylko w tym pokoju.</p>
          <div class="row end"><button type="button" class="btn ghost" data-close>Anuluj</button><button class="btn primary">Utwórz pokój</button></div></form>`);
      document.getElementById("edRoomForm").addEventListener("submit", async e => {
        e.preventDefault();
        try {
          const id = await bs.q(bs.sb.rpc("create_room_with_case", { p_pub: pub, p_sec: sec, p_name: e.target.name.value, p_difficulty: e.target.difficulty.value }));
          w.remove(); location.hash = `#/room/${id}`;
        } catch (err) { bs.toast(bs.errMsg(err), "error", 6000); }
      });
    }
  } catch (e) { bs.toast(bs.errMsg(e), "error", 6000); }
}

/* ---------------- główny widok ---------------- */
function renderEditor(reload = true) {
  const bs = B();
  if (!bs) return;
  if (reload || !ED) load();
  const me = bs.me(), src = ED.source || {};
  const srcLabel = src.kind === "room" ? `pokój „${esc(src.title || "")}”` : src.kind === "public" ? `sprawa publiczna „${esc(src.id)}”` : src.kind === "file" ? "plik" : "nowa sprawa";
  bs.app.innerHTML = `
  <div class="editor">
    <header class="lobby-top ed-top">
      <a class="btn tiny ghost" href="#/">← ${me ? "Lobby" : "Start"}</a>
      <div class="brand">✏️ Edytor spraw</div>
      <span class="small ed-src">Źródło: ${srcLabel} · <span id="edStatus">autozapis w przeglądarce</span></span>
      <span id="edErrs" class="badge"></span>
      ${me ? bs.topbarUser() : ""}
    </header>
    <div class="ed-toolbar">
      <button class="btn tiny ghost" id="edNew">🆕 Nowa</button>
      <label class="btn tiny ghost file-btn">📂 Wczytaj plik<input type="file" id="edFile" accept=".json,application/json" hidden></label>
      <button class="btn tiny ghost" id="edPreview">👁 Podgląd</button>
      <button class="btn tiny" id="edDl">⬇ Pobierz .json</button>
      ${me ? `<button class="btn tiny" id="edRoomNew">🚪 Utwórz pokój</button>` : ""}
      ${me && src.kind === "room" ? `<button class="btn tiny primary" id="edRoomSave">💾 Zapisz w pokoju</button>` : ""}
      ${me && bs.isAdmin() ? `<button class="btn tiny primary" id="edPublish">🌐 Opublikuj publicznie</button>` : ""}
    </div>
    <div class="ed-warn">⚠ Edytor pokazuje całą sprawę <b>razem z rozwiązaniem</b>. Jeśli chcesz w nią grać — niech edytuje ktoś inny.</div>
    <div class="ed-layout">
      <aside class="ed-side" id="edSide"></aside>
      <select class="ed-navsel" id="edNavSel"></select>
      <main class="ed-form" id="edForm"></main>
    </div>
  </div>`;
  if (me) bs.bindLogout();
  const root = bs.app.querySelector(".editor");
  root.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b) { e.preventDefault(); onAction(b); } });
  root.addEventListener("input", e => {
    const el = e.target.closest("[data-p]");
    if (!el || el.dataset.t === "multi" || el.type === "radio" || el.type === "checkbox" || el.tagName === "SELECT") return;
    applyInput(el);
  });
  root.addEventListener("change", e => {
    const el = e.target.closest("[data-p]");
    if (!el) return;
    if (el.tagName === "SELECT" || el.type === "radio" || el.type === "checkbox" || el.dataset.t === "multi") applyInput(el);
    if (el.hasAttribute("data-rerender")) renderAll();
  });
  document.getElementById("edNavSel").addEventListener("change", e => select(e.target.value));
  document.getElementById("edNew").addEventListener("click", async () => {
    if (!await bs.confirmBox("Zacząć nową, pustą sprawę? Obecna zawartość edytora zniknie (pobierz ją wcześniej, jeśli chcesz zachować).", "Nowa sprawa")) return;
    ED = { c: TEMPLATE(), source: { kind: "new" }, sel: "info" }; persist(); renderEditor(false);
  });
  document.getElementById("edFile").addEventListener("change", e => { loadFile(e.target.files[0]); e.target.value = ""; });
  document.getElementById("edPreview").addEventListener("click", () => {
    try { localStorage.setItem(KEY, JSON.stringify(ED)); } catch { /* ignore */ }
    bs.renderPreview(cleaned(), validate(), () => renderEditor(false));
  });
  document.getElementById("edDl").addEventListener("click", () => saveAction("download"));
  document.getElementById("edRoomNew")?.addEventListener("click", () => saveAction("room-new"));
  document.getElementById("edRoomSave")?.addEventListener("click", () => saveAction("room"));
  document.getElementById("edPublish")?.addEventListener("click", () => saveAction("publish"));
  renderAll(false);
}

window.renderEditor = () => renderEditor(true);
window.__editor = { cleaned: () => cleaned(), state: () => ED };
})();
