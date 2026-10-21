/* app.js — interfaz de Gym Tracker.
   Todo se guarda al instante en localStorage; la red solo se usa para traer la rutina vigente.
   Los clics se resuelven por data-action (un único manejador): nada de selectores compartidos. */
(function () {
  "use strict";

  const G = window.Gluteo;
  const KEYS = {
    routines: "gluteo_rutinas",
    active: "gluteo_ciclo_activo",
    unit: "gluteo_unit",
    theme: "gluteo_theme",
    lastDay: "gluteo_last_day",
    lastWeek: "gluteo_last_week",
    lastBackup: "gluteo_last_backup",
  };
  const ROUTINE_URL = "rutinas/ciclo-actual.json";
  const BACKUP_EVERY_DAYS = 7;

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = G.fmtNum;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { toast("No se pudo guardar en el dispositivo", "error"); return false; }
    },
  };

  const S = {
    routines: {},       // { [cycle]: rutina }
    cycle: null,        // ciclo activo
    data: {},           // registros del ciclo activo
    unit: "lb",
    theme: "light",
    tab: "rutina",
    week: 0,
    day: null,
    open: new Set(),    // índices de tarjetas abiertas
    drafts: {},         // borradores por slotKey (sobreviven al re-render)
    histQuery: "",
    histFilter: "all",
    histEx: null,       // clave del ejercicio abierto en el historial
    sheet: false,       // false | "settings" | "glossary"
    glossaryTerms: null,
  };

  // ---------- Estado ----------

  const routine = () => S.routines[S.cycle] || null;
  const cycleList = () => Object.keys(S.routines).map(Number).sort((a, b) => b - a);
  const dataOf = (c) => (Number(c) === S.cycle ? S.data : store.get(G.dataKey(c), {}));

  function currentDay() {
    const r = routine();
    return r ? r.days.find((d) => d.key === S.day) || r.days[0] : null;
  }

  function allData() {
    const out = {};
    for (const c of Object.keys(S.routines)) out[c] = dataOf(c);
    return out;
  }

  function saveData() { return store.set(G.dataKey(S.cycle), S.data); }

  function loadCycle(cycle) {
    S.cycle = Number(cycle);
    S.data = store.get(G.dataKey(S.cycle), {});
    S.drafts = {};
    S.open = new Set();
    S.histEx = null;
    const r = routine();
    const lw = store.get(KEYS.lastWeek, null);
    S.week = lw && lw.cycle === S.cycle ? lw.week : G.weekFromStart(r.startDate, new Date()) ?? 0;
    S.day = G.autoDayKey(r, new Date(), store.get(KEYS.lastDay, null));
    store.set(KEYS.active, S.cycle);
  }

  function hasAnyData() {
    return Object.keys(S.routines).some((c) => Object.keys(dataOf(c)).length > 0);
  }

  // ---------- Avisos ----------

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast show${kind === "error" ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, kind === "error" ? 3400 : 2400);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", S.theme);
  }

  // ---------- Íconos (trazos estilo Lucide) ----------

  const ICONS = {
    gear: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.8l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.8v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r=".6"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    flame: '<path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z"/>',
    note: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM10 12h4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    up: '<path d="M7 17 17 7M9 7h8v8"/>',
    down: '<path d="M7 7l10 10M17 9v8H9"/>',
    flat: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

  // ---------- Glosario (CLAUDE.md §3) ----------

  const GLOSSARY = [
    { id: "rpe", term: "RPE", text: "Qué tan duro fue, del 1 al 10. Se mide por cuántas reps te quedaron en reserva al terminar la serie: RPE 6 = 4 o más · RPE 7 = 3 · RPE 8 = 2 · RPE 9 = 1 · RPE 10 = ninguna (fallo)." },
    { id: "reserva", term: "Reps en reserva", text: "Las repeticiones que todavía podrías hacer con buena técnica cuando cortás la serie. Es la forma práctica de llegar al RPE pedido." },
    { id: "rango", term: "Series × reps (3x8-12)", text: "3 series de entre 8 y 12 repeticiones. El peso se ajusta para caer dentro del rango con el RPE pedido; las reps no se negocian." },
    { id: "fases", term: "Semanas del ciclo", text: "S1 adaptación (RPE 7) · S2 intensificación (RPE 8) · S3 pico (RPE 9, menos reps y más peso en los básicos) · S4 descarga." },
    { id: "descarga", term: "Descarga (deload)", text: "Semana liviana para recuperarte y llegar fresca al ciclo siguiente: mismos ejercicios, 2 series (3 si querés), ~50–60% del peso de S3 y RPE 5–6. Sin pulsos ni serie de rematado." },
    { id: "peso", term: "(+peso)", text: "El plan pide subir el peso respecto de la semana anterior, normalmente 5 lb." },
    { id: "sugerido", term: "Peso sugerido y %", text: "Lo calcula la app con tu última semana registrada de ese ejercicio. Te dice qué se espera (más peso, más reps, ambos o igual) y el % de cambio contra esa vez. Si en accesorios no llegaste al techo del rango en todas las series, toca más reps con el mismo peso. Manda siempre la primera serie: si se siente más pesada de lo pedido, bajá." },
    { id: "maximo", term: "Máximo (récord)", text: "Tu mejor marca del ejercicio: el peso más alto y, a igual peso, más reps. Cuando lo superás, el anterior queda guardado en el historial de récords." },
    { id: "pulsos", term: "Pulsos", text: "Movimientos cortos arriba, al final de la serie (después de la última rep, sin bajar del todo), no en cada rep. 10 en S1–S2, 15 en S3, ninguno en la descarga." },
    { id: "rematado", term: "Serie de rematado (+ 1x15-20)", text: "Una serie extra de 15–20 reps con ~40–50% menos peso que las series pesadas. Solo en el hip thrust del Día A en S3." },
    { id: "lado", term: "c/pierna · c/lado", text: "Las reps se cuentan para cada pierna o lado por separado." },
    { id: "barra", term: "Por lado / total", text: "Por lado = los discos de un solo lado, sin la barra. Total = 2 × lado + barra. Barra de mujer: 35 lb (15 kg)." },
    { id: "alternativa", term: "Alternativa", text: "Ejercicio de reemplazo si la máquina o la barra están ocupadas. \"Usar esta semana\" lo marca solo en esa semana; \"Usar en todo el ciclo\" cambia el nombre en las 4 semanas." },
  ];

  function glossaryFor(ex, week) {
    const t = ex.targets[week];
    const ids = ["rango", "sugerido", "maximo"];
    if (/RPE/i.test(t)) ids.unshift("rpe", "reserva");
    if (G.hasPlusWeight(t)) ids.push("peso");
    if (week === 3) ids.push("descarga");
    if (/puls/i.test(t)) ids.push("pulsos");
    if (/\+\s*1\s*x/i.test(t)) ids.push("rematado");
    if (/c\/(pierna|lado)/i.test(t)) ids.push("lado");
    return ids;
  }

  // ---------- Ayudas de render ----------

  function splitTitle(t) { const i = t.indexOf("—"); return i < 0 ? [t, ""] : [t.slice(0, i).trim(), t.slice(i + 1).trim()]; }
  function splitWeek(w) { const m = /^(.*?)\s*\((.+)\)\s*$/.exec(w); return m ? [m[1], m[2]] : [w, ""]; }
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (iso, opts) => (iso ? new Date(iso).toLocaleDateString("es", opts || { day: "2-digit", month: "2-digit" }) : "—");
  const pctTxt = (p) => (p === null || p === undefined ? "" : p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : "0%");
  const dirIcon = (r) => (r.mode === "deload" ? "down" : r.value > r.base ? "up" : "flat");

  // Recomendación de una tarjeta de la rutina (o null).
  function recFor(day, ex, idx, w, name) {
    if (ex.noWeight) return null;
    const r = routine();
    const records = G.collectRecords(S.routines, allData(), name);
    const k = G.slotKey(day.key, idx, w);
    const others = records.filter((x) => !(x.cycle === S.cycle && x.key === k));
    const prev = G.prevWeight(S.data, day.key, idx, w, ex);
    const lastS1 = G.lastCycleS1(others, S.cycle);
    let lastS1Target = null;
    if (lastS1) {
      const p = G.parseSlotKey(lastS1.key), lr = S.routines[lastS1.cycle];
      const ld = lr && lr.days.find((d) => d.key === p.day);
      lastS1Target = ld && ld.exercises[p.idx] ? ld.exercises[p.idx].targets[0] : null;
    }
    return {
      max: G.findMax(records),
      rec: G.recommend({
        target: ex.targets[w], prevTarget: prev ? ex.targets[prev.week] : null, week: w, prev,
        prevRec: prev ? S.data[G.slotKey(day.key, idx, prev.week)] : null,
        lastS1, lastS1Target, max: G.findMax(others), unit: S.unit, weekShort: r.weekShort,
      }),
    };
  }

  // ---------- Render principal ----------

  function render() {
    const chip = $("#cycleChip");
    const r = routine();
    chip.hidden = !r;
    chip.textContent = r ? `Ciclo ${r.cycle}` : "";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
    $("#root").innerHTML = S.tab === "rutina" ? renderRutina() : renderHistorial();
    renderSheet();
  }

  function renderEmpty() {
    return `<div class="empty">
      <div class="empty-ic">${icon("layers")}</div>
      <h2>Sin rutina</h2>
      <p>No hay ninguna rutina cargada. Se carga sola desde <code>${ROUTINE_URL}</code> cuando hay conexión, o podés importarla desde Ajustes.</p>
      <button class="secondary-btn open-settings-btn" data-action="open-settings">${icon("gear")}Abrir ajustes</button>
    </div>`;
  }

  function backupNag() {
    if (!hasAnyData()) return "";
    const last = store.get(KEYS.lastBackup, null);
    const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
    if (days !== null && days < BACKUP_EVERY_DAYS) return "";
    const txt = days === null ? "Todavía no hiciste ningún respaldo." : `Hace ${days} días que no hacés un respaldo.`;
    return `<div class="banner inline">${icon("archive")}<span>${txt}</span><button class="link-btn backup-nag-btn" data-action="backup">Respaldar</button></div>`;
  }

  function renderRutina() {
    const r = routine();
    if (!r) return renderEmpty();
    const day = currentDay();
    const weeks = r.weekShort.map((w, i) => {
      const [main, sub] = splitWeek(w);
      return `<button class="seg-btn week-btn${i === S.week ? " active" : ""}" data-action="week" data-week="${i}">
        <span class="wk-num">${esc(main)}</span>${sub ? `<span class="wk-sub">${esc(sub)}</span>` : ""}</button>`;
    }).join("");
    const days = r.days.map((d) => {
      const n = d.exercises.length;
      const done = d.exercises.filter((_, i) => S.data[G.slotKey(d.key, i, S.week)]?.completed).length;
      const abbr = d.label.split("·")[0].trim();
      return `<button class="day-btn ${d.type}${d.key === day.key ? " active" : ""}" data-action="day" data-day="${d.key}" aria-label="${esc(d.dayName)}, día ${d.key}">
        <i class="type-dot"></i><span class="day-name">${esc(abbr)}</span><span class="day-key">${esc(d.key)}</span>
        <small>${done}/${n}</small><i class="day-bar"><b style="width:${Math.round((done / n) * 100)}%"></b></i></button>`;
    }).join("");
    const n = day.exercises.length;
    const done = day.exercises.filter((_, i) => S.data[G.slotKey(day.key, i, S.week)]?.completed).length;
    const [main, sub] = splitTitle(day.title);
    return `${backupNag()}
      <div class="seg weeks" role="tablist" aria-label="Semana">${weeks}</div>
      <div class="days" role="tablist" aria-label="Día">${days}</div>
      <section class="hero">
        <div class="eyebrow">${esc(day.dayName)} · ${esc(r.weeks[S.week])}</div>
        <h1 class="hero-title">${esc(main)}</h1>
        ${sub ? `<div class="hero-sub">${esc(sub)}</div>` : ""}
        <div class="hero-meta">
          <span class="tag ${day.type}">${day.type === "lower" ? "Tren inferior" : "Tren superior"}</span>
          <div class="progress"><b style="width:${Math.round((done / n) * 100)}%"></b></div>
          <span class="hero-count">${done}/${n}</span>
        </div>
        ${day.warmup ? `<div class="warmup">${icon("flame")}<div><b>Activación</b>${esc(day.warmup)}</div></div>` : ""}
      </section>
      <ol class="ex-list">${day.exercises.map((ex, i) => renderCard(day, ex, i)).join("")}</ol>`;
  }

  function weightSummary(rec) {
    const w = rec ? G.parseNum(rec.weight) : NaN;
    if (!(w > 0)) return "";
    const side = rec.weightMode === "perSide" && rec.perSideDisplay != null ? ` · ${fmt(rec.perSideDisplay)}/lado` : "";
    const reps = G.repsText(rec);
    return `<span class="ex-weight"><b>${fmt(w)}</b> ${S.unit}${side}${reps ? ` · ${esc(reps)}` : ""}</span>`;
  }

  function recBadge(rec) {
    if (!rec) return "";
    const cls = rec.mode === "deload" ? "down" : rec.mode === "calibrate" ? "cal" : rec.value > rec.base ? "up" : "flat";
    return `<span class="ex-sug ${cls}">${icon(dirIcon(rec))}<b>${fmt(rec.value)}</b> ${S.unit}${rec.mode !== "calibrate" && rec.pct ? ` <em>${pctTxt(rec.pct)}</em>` : ""} · ${esc(rec.goal)}</span>`;
  }

  function draftFor(k, rec, sets) {
    if (!S.drafts[k]) {
      rec = rec || {};
      S.drafts[k] = {
        weight: rec.weight || "",
        weightMode: rec.weightMode || "total",
        perSideDisplay: rec.perSideDisplay ?? null,
        note: rec.note || "",
        reps: Array.from({ length: sets }, (_, i) => (rec.reps && rec.reps[i]) || ""),
        repsSame: !!rec.repsSame,
        repsSameValue: rec.repsSameValue || "",
        calcOpen: false,
        calcBar: "women",
        calcCustom: "",
        calcMode: "perSide",
        calcValue: rec.weightMode === "perSide" && rec.perSideDisplay != null ? String(rec.perSideDisplay) : "",
        altOpen: false,
        editOpen: false,
        editName: "",
      };
    }
    const d = S.drafts[k];
    while (d.reps.length < sets) d.reps.push("");
    return d;
  }

  function renderCard(day, ex, idx) {
    const w = S.week;
    const k = G.slotKey(day.key, idx, w);
    const rec = S.data[k] || null;
    const name = G.slotName(S.data, day.key, idx, ex, w);
    const altUsed = !!(rec && rec.altUsed && ex.alt);
    const open = S.open.has(idx);
    const done = !!(rec && rec.completed);
    const info = recFor(day, ex, idx, w, name);
    const line = weightSummary(rec) || (info && info.rec ? recBadge(info.rec) : "");
    const tagTxt = altUsed ? "alternativa" : name !== ex.name ? "editado" : "";
    const maxTxt = info && info.max ? `<span class="ex-max">${icon("trophy")}${fmt(info.max.weight)}${info.max.topReps ? `×${info.max.topReps}` : ""}</span>` : "";
    const head = `<div class="card-head" data-action="toggle-card" data-idx="${idx}">
        <span class="ex-idx">${done ? icon("check") : pad2(idx + 1)}</span>
        <div class="card-info">
          ${ex.pattern ? `<div class="pattern">${esc(ex.pattern)}</div>` : ""}
          <div class="ex-name">${esc(name)}${tagTxt ? ` <span class="edited">· ${tagTxt}</span>` : ""}</div>
          <div class="ex-meta"><span class="ex-target">${esc(ex.targets[w])}</span>${maxTxt}</div>
          ${line ? `<div class="ex-line">${line}</div>` : ""}
        </div>
        <button class="done-btn" data-action="toggle-done" data-k="${k}" aria-pressed="${done}" aria-label="${done ? "Completado" : "Marcar como completado"}">${icon("check")}</button>
      </div>`;
    const cls = `card ${day.type}${done ? " done" : ""}${open ? " open" : ""}`;
    if (!open) return `<li class="${cls}">${head}</li>`;
    return `<li class="${cls}" data-card="${k}">${head}${renderCardBody(day, ex, idx, k, rec, name, info)}</li>`;
  }

  function renderCardBody(day, ex, idx, k, rec, name, info) {
    const w = S.week, u = S.unit;
    const sets = ex.sets[w];
    const d = draftFor(k, rec, sets);
    const baseName = G.effectiveName(S.data, day.key, idx, ex);
    const altUsed = !!(rec && rec.altUsed && ex.alt);
    const showAlt = ex.alt && G.normName(baseName) !== G.normName(ex.alt);
    const overridden = baseName !== ex.name;
    const sug = info && info.rec;
    const max = info && info.max;

    const statRest = `<div class="stat"><span class="stat-label">${icon("clock")}Descanso</span>
      <span class="stat-val">${esc(ex.rest)}</span><span class="stat-sub">${sets} series</span></div>`;
    const statSug = sug
      ? `<div class="stat sug ${sug.mode}"><span class="stat-label">${icon("target")}Sugerido</span>
          <span class="stat-val">${fmt(sug.value)} <small>${u}</small>${sug.mode !== "calibrate" && sug.pct ? ` <em>${pctTxt(sug.pct)}</em>` : ""}</span>
          <span class="stat-goal">${esc(sug.goal)}</span>
          <button class="use-sug-btn" data-action="use-suggestion" data-k="${k}" data-value="${sug.value}">Usar</button></div>`
      : `<div class="stat sug"><span class="stat-label">${icon("target")}Sugerido</span>
          <span class="stat-val empty">—</span><span class="stat-goal">Calibrá con la 1ª serie</span></div>`;
    const statMax = max
      ? `<div class="stat"><span class="stat-label">${icon("trophy")}Máximo</span>
          <span class="stat-val">${fmt(max.weight)} <small>${u}</small></span>
          <span class="stat-sub">${max.topReps ? `${max.topReps} reps · ` : ""}${fmtDate(max.date)}</span></div>`
      : `<div class="stat"><span class="stat-label">${icon("trophy")}Máximo</span>
          <span class="stat-val empty">—</span><span class="stat-sub">Sin registros</span></div>`;
    const stats = ex.noWeight
      ? `<div class="stats two">${statRest}<div class="stat"><span class="stat-label">${icon("target")}Objetivo</span>
          <span class="stat-val">${sets} <small>series</small></span><span class="stat-sub">Sin peso obligatorio</span></div></div>`
      : `<div class="stats">${statRest}${statSug}${statMax}</div>`;
    const why = sug ? `<p class="why">${icon("info")}<span>${esc(sug.text)}</span></p>` : "";

    const altBox = !(d.altOpen && showAlt) ? "" : altUsed
      ? `<div class="alt-box"><b>Esta semana hacés la alternativa</b>${esc(ex.alt)}
          <div class="row-btns"><button class="chip-btn undo-alt-btn" data-action="undo-alt" data-k="${k}">Volver a ${esc(baseName)}</button></div></div>`
      : `<div class="alt-box"><b>Alternativa</b>${esc(ex.alt)}
          <div class="row-btns">
            <button class="chip-btn solid use-alt-btn" data-action="use-alt" data-k="${k}">Usar esta semana</button>
            <button class="chip-btn use-alt-cycle-btn" data-action="use-alt-cycle" data-k="${k}">Usar en todo el ciclo</button>
          </div></div>`;

    const editBox = d.editOpen ? `<div class="edit-box">
        <input class="text-input" data-field="editName" data-k="${k}" value="${esc(d.editName)}" placeholder="Nombre del ejercicio" aria-label="Nuevo nombre">
        <div class="hint">Cambia el nombre en las 4 semanas. Original: ${esc(ex.name)}</div>
        <div class="row-btns">
          <button class="chip-btn solid save-name-btn" data-action="save-name" data-k="${k}">Guardar nombre</button>
          ${overridden ? `<button class="chip-btn reset-name-btn" data-action="reset-name" data-k="${k}">Restablecer</button>` : ""}
          <button class="chip-btn cancel-name-btn" data-action="toggle-edit" data-k="${k}">Cancelar</button>
        </div></div>` : "";

    const repsInputs = d.repsSame
      ? `<input class="num-input reps-same-input" inputmode="numeric" data-field="repsSameValue" data-k="${k}" value="${esc(d.repsSameValue)}" placeholder="Reps de cada serie">`
      : `<div class="reps-grid">${Array.from({ length: sets }, (_, i) =>
          `<label class="rep-cell"><span>SERIE ${i + 1}</span><input class="num-input rep-input" inputmode="numeric" data-field="rep" data-i="${i}" data-k="${k}" value="${esc(d.reps[i])}" aria-label="Reps serie ${i + 1}"></label>`).join("")}</div>`;

    const sideHint = d.weightMode === "perSide" && d.perSideDisplay != null
      ? `<div class="perside-hint">= ${fmt(d.perSideDisplay)} ${u} por lado + barra</div>` : "";

    return `<div class="card-body">
      ${stats}
      ${why}
      <div class="tools">
        ${showAlt ? `<button class="tool-btn alt-btn${d.altOpen || altUsed ? " on" : ""}" data-action="toggle-alt" data-k="${k}">${icon("swap")}${altUsed ? "Usando alternativa" : "Alternativa"}</button>` : ""}
        <button class="tool-btn edit-btn${d.editOpen ? " on" : ""}" data-action="toggle-edit" data-k="${k}">${icon("pencil")}Renombrar</button>
        <button class="tool-btn glossary-btn" data-action="open-glossary" data-terms="${glossaryFor(ex, w).join(",")}">${icon("info")}¿Qué es?</button>
      </div>
      ${altBox}
      ${editBox}
      <div class="field">
        <div class="field-head"><span class="field-label">Reps por serie</span>
          <label class="check"><input type="checkbox" class="reps-same-check" data-field="repsSame" data-k="${k}"${d.repsSame ? " checked" : ""}> Todas iguales</label></div>
        ${repsInputs}
      </div>
      <div class="field">
        <div class="field-head"><span class="field-label">Peso${ex.noWeight ? " · opcional" : ""}</span></div>
        <div class="weight-row">
          <div class="weight-box">
            <input class="num-input weight-input" inputmode="decimal" data-field="weight" data-k="${k}" value="${esc(d.weight)}" placeholder="0" aria-label="Peso total">
            <span class="unit">${u}</span>
          </div>
          ${ex.noWeight ? "" : `<button class="tool-btn calc-toggle-btn${d.calcOpen ? " on" : ""}" data-action="toggle-calc" data-k="${k}">${icon("calc")}Barra</button>`}
        </div>
        ${sideHint}
        ${d.calcOpen && !ex.noWeight ? renderCalc(k, d) : ""}
      </div>
      <div class="field">
        <div class="field-head"><span class="field-label">Nota</span></div>
        <textarea class="text-input note-input" rows="2" data-field="note" data-k="${k}" placeholder="Cómo se sintió, molestias, ajustes…">${esc(d.note)}</textarea>
      </div>
      <button class="primary-btn save-entry-btn" data-action="save-entry" data-k="${k}">${icon("check")}Guardar</button>
    </div>`;
  }

  function renderCalc(k, d) {
    const u = S.unit;
    const bars = [["women", `Mujer ${G.BARS.women[u]}`], ["men", `Hombre ${G.BARS.men[u]}`], ["custom", "Otra"]];
    const modes = [["perSide", "Por lado"], ["total", "Total"]];
    return `<div class="calc">
      <div class="seg small">${bars.map(([v, l]) =>
        `<button class="seg-btn calc-bar-btn${d.calcBar === v ? " active" : ""}" data-action="calc-bar" data-bar="${v}" data-k="${k}">${l}</button>`).join("")}</div>
      ${d.calcBar === "custom" ? `<input class="num-input calc-custom-input" inputmode="decimal" data-field="calcCustom" data-k="${k}" value="${esc(d.calcCustom)}" placeholder="Peso de la barra (${u})">` : ""}
      <div class="seg small">${modes.map(([v, l]) =>
        `<button class="seg-btn calc-mode-btn${d.calcMode === v ? " active" : ""}" data-action="calc-mode" data-mode="${v}" data-k="${k}">${l}</button>`).join("")}</div>
      <input class="num-input calc-value-input" inputmode="decimal" data-field="calcValue" data-k="${k}" value="${esc(d.calcValue)}" placeholder="${d.calcMode === "perSide" ? "Discos por lado" : "Peso total"} (${u})">
      <div class="calc-result" data-calc-result="${k}">${esc(calcResultText(d))}</div>
      <button class="secondary-btn use-calc-btn" data-action="use-calc" data-k="${k}">Usar este peso</button>
    </div>`;
  }

  function calcResult(d) {
    const bar = G.barWeight(d.calcBar, S.unit, d.calcCustom);
    const v = G.parseNum(d.calcValue);
    if (!(bar >= 0) || !(v >= 0)) return null;
    return G.calcBar(d.calcMode, v, bar);
  }

  function calcResultText(d) {
    const res = calcResult(d);
    if (!res) return d.calcBar === "custom" && !(G.parseNum(d.calcCustom) >= 0) ? "Ingresá el peso de la barra" : "Ingresá el peso";
    if (d.calcMode === "perSide") return `Total: ${fmt(res.total)} ${S.unit}`;
    return res.perSide < 0 ? "El total es menor que la barra" : `Por lado: ${fmt(res.perSide)} ${S.unit}`;
  }

  // ---------- Historial (por ejercicio, en todos los ciclos) ----------

  const HIST_FILTERS = [["all", "Todos"], ["lower", "Pierna"], ["upper", "Superior"], ["core", "Core"]];

  function histIndex() { return G.exerciseIndex(S.routines, allData(), S.cycle); }

  function renderHistorial() {
    if (!cycleList().length) return renderEmpty();
    if (S.histEx) {
      const e = histIndex().find((x) => x.key === S.histEx);
      if (e) return renderHistDetail(e);
      S.histEx = null;
    }
    const chips = HIST_FILTERS.map(([v, l]) =>
      `<button class="seg-btn hist-filter-btn${S.histFilter === v ? " active" : ""}" data-action="hist-filter" data-filter="${v}">${l}</button>`).join("");
    return `<div class="page-head"><div class="eyebrow">Tus marcas</div><h1 class="page-title">Historial</h1></div>
      <label class="search">${icon("search")}<input type="search" class="search-input" data-search="hist" value="${esc(S.histQuery)}" placeholder="Buscar ejercicio" aria-label="Buscar ejercicio" autocomplete="off"></label>
      <div class="seg small hist-filters">${chips}</div>
      <div class="hist-list">${renderHistList()}</div>`;
  }

  function renderHistList() {
    const q = G.normName(S.histQuery);
    const list = histIndex().filter((e) =>
      (S.histFilter === "all" || e.group === S.histFilter) && (!q || G.normName(e.name).includes(q)));
    if (!list.length) return `<p class="empty small">No hay ejercicios que coincidan.</p>`;
    return `<ul class="hist-ul">${list.map((e) => {
      const m = e.max;
      const days = [...e.days].join(" · ");
      const right = e.noWeight && !m
        ? `<span class="hl-none">${e.last ? fmtDate(e.last.date) : "Sin peso"}</span>`
        : m ? `<span class="hl-max"><b>${fmt(m.weight)}</b> ${S.unit}${m.topReps ? ` × ${m.topReps}` : ""}</span><span class="hl-date">${fmtDate(m.date)}</span>`
          : `<span class="hl-none">Sin registros</span>`;
      return `<li><button class="hist-item ${e.group}" data-action="hist-open" data-ex="${esc(e.key)}">
        <span class="hl-info"><span class="pattern">${esc(e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna"))}${days ? ` · ${esc(days)}` : ""}</span>
          <span class="ex-name">${esc(e.name)}</span></span>
        <span class="hl-right">${right}</span>${icon("chevron")}</button></li>`;
    }).join("")}</ul>`;
  }

  function renderHistDetail(e) {
    const u = S.unit;
    const prs = G.prHistory(e.records).reverse();
    const sessions = [...e.records].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : b.cycle - a.cycle || b.week - a.week));
    const m = e.max;
    const where = (r) => `C${r.cycle} · ${esc(splitWeek(r.weekShort)[0])} · ${esc(r.day)}`;
    const prRows = prs.map((r, i) => {
      const before = prs[i + 1];
      const delta = before ? (r.weight > before.weight ? `+${fmt(r.weight - before.weight)} ${u}` : `+${r.topReps - before.topReps} reps`) : "Primera marca";
      return `<li class="pr-row${i === 0 ? " current" : ""}"><span class="pr-w num"><b>${fmt(r.weight)}</b> ${u}${r.topReps ? ` × ${r.topReps}` : ""}</span>
        <span class="pr-meta">${fmtDate(r.date, { day: "2-digit", month: "short", year: "2-digit" })} · ${where(r)}</span><span class="pr-delta">${i === 0 ? "Actual" : delta}</span></li>`;
    }).join("");
    const sessRows = sessions.map((r) => `<li class="sess-row">
        <div class="sess-top"><span class="sess-date">${fmtDate(r.date)}</span><span class="sess-where">${where(r)}</span>
          <span class="sess-w num"><b>${fmt(r.weight)}</b> ${u}</span><span class="sess-r num">${esc(r.reps) || "—"}</span>
          <span class="ok">${r.completed ? icon("check") : ""}</span></div>
        ${r.note ? `<div class="sess-note">${icon("note")}${esc(r.note)}</div>` : ""}</li>`).join("");
    return `<button class="back-btn hist-back-btn" data-action="hist-back">${icon("back")}Historial</button>
      <div class="page-head"><div class="eyebrow">${esc(e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna"))}</div>
        <h1 class="page-title detail">${esc(e.name)}</h1></div>
      <div class="pr-hero">
        <span class="stat-label">${icon("trophy")}Máximo actual</span>
        ${m ? `<span class="pr-hero-val num">${fmt(m.weight)} <small>${u}</small>${m.topReps ? ` <span>× ${m.topReps}</span>` : ""}</span>
          <span class="stat-sub">${fmtDate(m.date, { day: "numeric", month: "long", year: "numeric" })} · ${where(m)}</span>`
          : `<span class="pr-hero-val num empty">—</span><span class="stat-sub">Todavía no hay pesos registrados.</span>`}
      </div>
      ${prs.length > 1 ? `<h2 class="section-title">Récords anteriores</h2><ul class="pr-list">${prRows}</ul>` : ""}
      <h2 class="section-title">Sesiones <span class="muted">(${sessions.length})</span></h2>
      ${sessions.length ? `<ul class="sess-list">${sessRows}</ul>` : `<p class="muted small">Sin sesiones con peso.</p>`}`;
  }

  // ---------- Hojas: Ajustes y Glosario ----------

  function renderSheet() {
    const sheet = $("#sheet");
    if (!S.sheet) { sheet.hidden = true; sheet.innerHTML = ""; return; }
    sheet.hidden = false;
    const body = S.sheet === "glossary" ? renderGlossary() : renderSettings();
    sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-settings"></div>
      <div class="sheet-panel" role="dialog" aria-label="${S.sheet === "glossary" ? "Glosario" : "Ajustes"}">
        <div class="sheet-grabber"></div>${body}</div>`;
  }

  function sheetHead(title) {
    return `<div class="sheet-head"><h2>${title}</h2>
      <button class="icon-btn close-settings-btn" data-action="close-settings" aria-label="Cerrar">${icon("x")}</button></div>`;
  }

  function renderGlossary() {
    const focus = S.glossaryTerms;
    const items = focus ? GLOSSARY.filter((g) => focus.includes(g.id)) : GLOSSARY;
    return `${sheetHead("Glosario")}
      ${focus ? `<p class="note">Términos de este ejercicio. <button class="link-btn glossary-all-btn" data-action="open-glossary">Ver todos</button></p>` : ""}
      <dl class="glossary">${items.map((g) => `<div class="gl-item"><dt>${esc(g.term)}</dt><dd>${esc(g.text)}</dd></div>`).join("")}</dl>`;
  }

  function renderSettings() {
    const themes = [["light", "Claro"], ["dark", "Oscuro"], ["auto", "Automático"]];
    const units = [["lb", "lb"], ["kg", "kg"]];
    const last = store.get(KEYS.lastBackup, null);
    const cycles = cycleList().map((c) => {
      const r = S.routines[c], active = c === S.cycle;
      return `<button class="list-row cycle-btn${active ? " active" : ""}" data-action="set-cycle" data-cycle="${c}">
        ${icon(active ? "check" : "layers")}<span class="grow">Ciclo ${c}<span class="sub">${esc(r.name)}</span></span>
        ${active ? '<span class="badge">Activo</span>' : ""}</button>`;
    }).join("");
    return `${sheetHead("Ajustes")}
      <div class="group"><span class="eyebrow">Apariencia</span><div class="seg">${themes.map(([v, l]) =>
        `<button class="seg-btn theme-btn${S.theme === v ? " active" : ""}" data-action="set-theme" data-theme="${v}">${l}</button>`).join("")}</div></div>
      <div class="group"><span class="eyebrow">Unidad</span><div class="seg">${units.map(([v, l]) =>
        `<button class="seg-btn unit-btn${S.unit === v ? " active" : ""}" data-action="set-unit" data-unit="${v}">${l}</button>`).join("")}</div>
        <p class="note">Solo cambia las etiquetas: no convierte los valores guardados.</p></div>
      <div class="group"><span class="eyebrow">Ciclos</span><div class="group-card">${cycles}
        <label class="list-row file-btn">${icon("upload")}<span class="grow">Importar rutina (JSON)</span>
          <input type="file" class="visually-hidden import-routine-input" accept=".json,application/json" data-change="import-routine"></label></div></div>
      <div class="group"><span class="eyebrow">Datos</span><div class="group-card">
        ${S.cycle !== null ? `<button class="list-row export-cycle-btn" data-action="export-cycle">${icon("download")}<span class="grow">Exportar datos del ciclo ${S.cycle}<span class="sub">Para cerrar el ciclo (HISTORIAL y Excel)</span></span></button>` : ""}
        <button class="list-row backup-btn" data-action="backup">${icon("archive")}<span class="grow">Respaldo completo<span class="sub">Último: ${last ? fmtDate(last, { day: "numeric", month: "short", year: "numeric" }) : "nunca"}</span></span></button>
        <label class="list-row file-btn">${icon("refresh")}<span class="grow">Restaurar respaldo</span>
          <input type="file" class="visually-hidden restore-input" accept=".json,application/json" data-change="restore-backup"></label>
      </div>
      <p class="note">Todo vive en este celular: si se borran los datos de Safari, se pierden. Guardá el respaldo en Archivos o iCloud.</p></div>`;
  }

  // ---------- Archivos ----------

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
  }

  // iOS: la hoja de compartir permite "Guardar en Archivos". Si no hay, descarga estándar.
  async function deliverFile(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    try {
      if (typeof File === "function" && navigator.canShare) {
        const file = new File([blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return true; }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  async function importRoutine(file) {
    let r;
    try { r = JSON.parse(await readFileText(file)); }
    catch { toast("El archivo no es un JSON válido", "error"); return; }
    const errs = G.validateRoutine(r);
    if (errs.length) { console.warn("Rutina inválida:", errs); toast(`Rutina inválida: ${errs[0]}`, "error"); return; }
    const hasData = Object.keys(store.get(G.dataKey(r.cycle), {})).length > 0;
    if (S.routines[r.cycle] && hasData &&
        !confirm(`Ya hay registros del ciclo ${r.cycle}. ¿Reemplazar su rutina? Los registros se conservan y se asocian por posición del ejercicio.`)) return;
    S.routines[r.cycle] = r;
    store.set(KEYS.routines, S.routines);
    loadCycle(r.cycle);
    render();
    toast(`Ciclo ${r.cycle} importado ✓`);
  }

  async function restoreBackup(file) {
    let b;
    try { b = JSON.parse(await readFileText(file)); }
    catch { toast("El archivo no es un JSON válido", "error"); return; }
    const errs = G.checkBackup(b);
    if (errs.length) { console.warn("Respaldo inválido:", errs); toast(errs[0], "error"); return; }
    const cycles = Object.keys(b.routines);
    if (!confirm(`Restaurar el respaldo del ${new Date(b.exportedAt).toLocaleDateString("es")}? Reemplaza los datos de: ciclo ${cycles.join(", ")}.`)) return;
    for (const c of cycles) {
      S.routines[c] = b.routines[c];
      store.set(G.dataKey(c), b.data[c] || {});
    }
    store.set(KEYS.routines, S.routines);
    if (b.prefs && b.prefs.unit) { S.unit = b.prefs.unit; store.set(KEYS.unit, S.unit); }
    loadCycle(S.routines[S.cycle] ? S.cycle : cycleList()[0]);
    render();
    toast("Respaldo restaurado ✓");
  }

  // ---------- Acciones ----------

  function exFromKey(k) {
    const p = G.parseSlotKey(k);
    const day = routine().days.find((d) => d.key === p.day);
    return { ...p, dayObj: day, ex: day.exercises[p.idx] };
  }

  function emptyRecord(sets) {
    return { weight: "", weightMode: "total", perSideDisplay: null, note: "", completed: false,
      reps: Array(sets).fill(""), repsSame: false, repsSameValue: "", savedAt: new Date().toISOString() };
  }

  function saveEntry(k, complete) {
    const { ex, week } = exFromKey(k);
    const sets = ex.sets[week];
    const d = S.drafts[k];
    const prev = S.data[k] || {};
    const w = G.parseNum(d.weight);
    if (!ex.noWeight && !(w > 0)) { toast("Cargá el peso antes de guardar", "error"); return false; }
    if (String(d.weight).trim() !== "" && !(w > 0)) { toast("El peso no es un número válido", "error"); return false; }
    const same = d.repsSameValue.trim();
    S.data[k] = {
      weight: w > 0 ? String(w) : "",
      weightMode: w > 0 ? d.weightMode : "total",
      perSideDisplay: w > 0 && d.weightMode === "perSide" ? d.perSideDisplay : null,
      note: d.note.trim(),
      completed: complete === undefined ? !!prev.completed : complete,
      reps: d.repsSame ? Array(sets).fill(same) : d.reps.slice(0, sets).map((x) => String(x).trim()),
      repsSame: d.repsSame,
      repsSameValue: d.repsSame ? same : "",
      altUsed: !!prev.altUsed,
      savedAt: new Date().toISOString(),
    };
    if (!saveData()) return false;
    delete S.drafts[k];
    return true;
  }

  const actions = {
    tab(el) { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
    week(el) {
      S.week = Number(el.dataset.week); S.open = new Set();
      store.set(KEYS.lastWeek, { cycle: S.cycle, week: S.week }); render();
    },
    day(el) { S.day = el.dataset.day; S.open = new Set(); store.set(KEYS.lastDay, S.day); render(); },
    "toggle-card"(el) {
      const i = Number(el.dataset.idx);
      if (S.open.has(i)) S.open.delete(i); else S.open.add(i);
      render();
    },
    "toggle-done"(el) {
      const k = el.dataset.k;
      const { ex, week } = exFromKey(k);
      const rec = S.data[k];
      if (rec && rec.completed) {
        rec.completed = false; rec.savedAt = new Date().toISOString();
        saveData(); render(); toast("Marcado como pendiente"); return;
      }
      if (ex.noWeight || (rec && G.parseNum(rec.weight) > 0)) {
        S.data[k] = { ...emptyRecord(ex.sets[week]), ...rec, completed: true, savedAt: new Date().toISOString() };
        saveData(); render(); toast("Completado ✓"); return;
      }
      const d = S.drafts[k];
      if (d && G.parseNum(d.weight) > 0) {
        if (saveEntry(k, true)) { S.open.delete(exFromKey(k).idx); render(); toast("Guardado y completado ✓"); }
        return;
      }
      toast("Cargá y guardá el peso antes de completar", "error");
    },
    "toggle-alt"(el) { const d = S.drafts[el.dataset.k]; d.altOpen = !d.altOpen; render(); },
    "toggle-edit"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const { dayObj, idx, ex } = exFromKey(k);
      d.editOpen = !d.editOpen;
      if (d.editOpen) d.editName = G.effectiveName(S.data, dayObj.key, idx, ex);
      render();
    },
    "save-name"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const { dayObj, idx, ex } = exFromKey(k);
      const name = d.editName.trim();
      if (!name) { toast("El nombre no puede quedar vacío", "error"); return; }
      S.data[G.ovrKey(dayObj.key, idx)] = { name: name === ex.name ? null : name, savedAt: new Date().toISOString() };
      if (!saveData()) return;
      d.editOpen = false; render(); toast("Nombre guardado ✓");
    },
    "reset-name"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const { dayObj, idx } = exFromKey(k);
      S.data[G.ovrKey(dayObj.key, idx)] = { name: null, savedAt: new Date().toISOString() };
      if (!saveData()) return;
      d.editOpen = false; render(); toast("Nombre original restablecido");
    },
    "toggle-calc"(el) { const d = S.drafts[el.dataset.k]; d.calcOpen = !d.calcOpen; render(); },
    "calc-bar"(el) { S.drafts[el.dataset.k].calcBar = el.dataset.bar; render(); },
    "calc-mode"(el) {
      const d = S.drafts[el.dataset.k];
      if (d.calcMode === el.dataset.mode) return;
      const res = calcResult(d);
      d.calcMode = el.dataset.mode;
      if (res) d.calcValue = String(d.calcMode === "perSide" ? Math.max(0, res.perSide) : res.total);
      render();
    },
    "use-calc"(el) {
      const d = S.drafts[el.dataset.k];
      const res = calcResult(d);
      if (!res || res.perSide < 0 || !(res.total > 0)) { toast("Revisá los datos de la calculadora", "error"); return; }
      d.weight = String(res.total);
      d.weightMode = "perSide";
      d.perSideDisplay = res.perSide;
      d.calcOpen = false;
      render();
      toast(`Peso: ${fmt(res.total)} ${S.unit}`);
    },
    "use-suggestion"(el) {
      const d = S.drafts[el.dataset.k];
      d.weight = el.dataset.value; d.weightMode = "total"; d.perSideDisplay = null;
      render();
    },
    "save-entry"(el) {
      const k = el.dataset.k;
      if (!saveEntry(k)) return;
      S.open.delete(exFromKey(k).idx);
      render();
      toast("Guardado ✓");
    },
    "hist-open"(el) { S.histEx = el.dataset.ex; render(); window.scrollTo(0, 0); },
    "hist-back"() { S.histEx = null; render(); },
    "hist-filter"(el) { S.histFilter = el.dataset.filter; render(); },
    "use-alt"(el) {
      const k = el.dataset.k, { ex, week } = exFromKey(k);
      S.data[k] = { ...(S.data[k] || { ...emptyRecord(ex.sets[week]), savedAt: null }), altUsed: true };
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Esta semana: alternativa");
    },
    "undo-alt"(el) {
      const k = el.dataset.k;
      if (S.data[k]) S.data[k].altUsed = false;
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Volviste al ejercicio original");
    },
    "use-alt-cycle"(el) {
      const k = el.dataset.k, { dayObj, idx, ex } = exFromKey(k);
      S.data[G.ovrKey(dayObj.key, idx)] = { name: ex.alt, savedAt: new Date().toISOString() };
      for (let w = 0; w < 4; w++) { const r = S.data[G.slotKey(dayObj.key, idx, w)]; if (r) r.altUsed = false; }
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Alternativa en todo el ciclo · se deshace con Editar nombre → Restablecer");
    },
    "open-glossary"(el) { S.glossaryTerms = el.dataset.terms ? el.dataset.terms.split(",") : null; S.sheet = "glossary"; renderSheet(); },
    "open-settings"() { S.sheet = "settings"; renderSheet(); },
    "close-settings"() { S.sheet = false; renderSheet(); },
    "set-theme"(el) { S.theme = el.dataset.theme; store.set(KEYS.theme, S.theme); applyTheme(); renderSheet(); },
    "set-unit"(el) { S.unit = el.dataset.unit; store.set(KEYS.unit, S.unit); S.drafts = {}; render(); },
    "set-cycle"(el) { loadCycle(el.dataset.cycle); render(); toast(`Ciclo ${S.cycle} activo`); },
    async "export-cycle"() {
      const r = routine();
      const ok = await deliverFile(`gluteo-ciclo-${r.cycle}-${today()}.json`, G.buildCycleExport(r, S.data, S.unit));
      if (ok) toast("Export listo ✓");
    },
    async backup() {
      const data = {};
      for (const c of Object.keys(S.routines)) data[c] = dataOf(c);
      const b = G.buildBackup({ routines: S.routines, data, unit: S.unit, theme: S.theme });
      const ok = await deliverFile(`gluteo-respaldo-${today()}.json`, b);
      if (ok) { store.set(KEYS.lastBackup, b.exportedAt); render(); toast("Respaldo listo ✓"); }
    },
    "reload-app"() { location.reload(); },
  };

  // ---------- Eventos ----------

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) { console.error("Acción desconocida:", el.dataset.action); return; }
    if (el.tagName === "BUTTON") e.preventDefault();
    fn(el, e);
  }

  function onInput(e) {
    const el = e.target, f = el.dataset.field, k = el.dataset.k;
    if (el.dataset.search === "hist") {
      S.histQuery = el.value;
      const list = document.querySelector(".hist-list");
      if (list) list.innerHTML = renderHistList();
      return;
    }
    if (!f || !k || el.type === "checkbox") return;
    const d = S.drafts[k];
    if (!d) return;
    if (f === "rep") d.reps[Number(el.dataset.i)] = el.value;
    else d[f] = el.value;
    if (f === "weight") {
      d.weightMode = "total"; d.perSideDisplay = null;
      const hint = el.closest(".card").querySelector(".perside-hint");
      if (hint) hint.remove();
    }
    if (f === "calcValue" || f === "calcCustom") {
      const out = document.querySelector(`[data-calc-result="${k}"]`);
      if (out) out.textContent = calcResultText(d);
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.type === "checkbox" && el.dataset.field === "repsSame") {
      const d = S.drafts[el.dataset.k];
      d.repsSame = el.checked;
      if (d.repsSame && !d.repsSameValue) d.repsSameValue = d.reps.find((x) => String(x).trim() !== "") || "";
      render();
      return;
    }
    const file = el.files && el.files[0];
    if (!file) return;
    if (el.dataset.change === "import-routine") importRoutine(file);
    else if (el.dataset.change === "restore-backup") restoreBackup(file);
    el.value = "";
  }

  // ---------- Arranque ----------

  // Trae rutinas/ciclo-actual.json (red primero; el service worker cae al caché sin señal).
  async function refreshRoutine() {
    if (typeof fetch !== "function") return false;
    let r;
    try {
      const res = await fetch(ROUTINE_URL, { cache: "no-store" });
      if (!res.ok) return false;
      r = await res.json();
    } catch { return false; }
    const errs = G.validateRoutine(r);
    if (errs.length) { console.warn(`${ROUTINE_URL} inválido:`, errs); return false; }
    const prev = S.routines[r.cycle];
    let changed = false;
    if (!prev || JSON.stringify(prev) !== JSON.stringify(r)) {
      S.routines[r.cycle] = r;
      store.set(KEYS.routines, S.routines);
      changed = true;
    }
    if (S.cycle === null || r.cycle > S.cycle) {
      const wasEmpty = S.cycle === null;
      loadCycle(r.cycle);
      if (!wasEmpty) toast(`Ciclo ${r.cycle} cargado`);
      return true;
    }
    if (changed && r.cycle === S.cycle) S.drafts = {};
    return changed;
  }

  function registerSW() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) $("#updateBanner").hidden = false;
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  async function boot() {
    S.theme = store.get(KEYS.theme, "light");
    applyTheme();
    S.routines = store.get(KEYS.routines, {});
    const active = store.get(KEYS.active, null);
    const start = S.routines[active] ? active : cycleList()[0];
    S.unit = store.get(KEYS.unit, null) || (S.routines[start] && S.routines[start].unitDefault) || "lb";
    if (start !== undefined) loadCycle(start);

    document.querySelectorAll("[data-icon]").forEach((el) => el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)));
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);

    if (S.cycle !== null) render();
    if (await refreshRoutine() || S.cycle === null) {
      if (!store.get(KEYS.unit, null) && routine()) S.unit = routine().unitDefault;
      render();
    }
    registerSW();
  }

  window.GluteoApp = { ready: boot().catch((err) => { console.error(err); throw err; }) };
})();
