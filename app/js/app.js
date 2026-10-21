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
    history: "gluteo_historial",   // sesiones de ciclos cerrados (ver G.closeCycle)
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
    sheetFx: false,
    skipOpen: false,    // formulario "No pude hacerlo" abierto
    skipReason: "",
    remote: null,       // ciclos publicados en el servidor (rutinas/index.json)
    hist: null,         // historial de ciclos cerrados     // animar la entrada de la hoja en el próximo render
    fx: { view: true }, // efectos para el próximo render
  };

  // ---------- Estado ----------

  const routine = () => S.routines[S.cycle] || null;
  const recordsOf = (name) => G.collectRecords(S.routines, allData(), name).concat(G.historyRecords(S.hist, name));
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
    S.week = lw && lw.cycle === S.cycle ? lw.week : G.weekFromStart(G.cycleStart(r, S.data), new Date()) ?? 0;
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
    el.className = `toast show${kind ? ` ${kind}` : ""}`;
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
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
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


  // ---------- Ayudas de render ----------

  function splitTitle(t) { const i = t.indexOf("—"); return i < 0 ? [t, ""] : [t.slice(0, i).trim(), t.slice(i + 1).trim()]; }
  function splitWeek(w) { const m = /^(.*?)\s*\((.+)\)\s*$/.exec(w); return m ? [m[1], m[2]] : [w, ""]; }
  const pad2 = (n) => String(n).padStart(2, "0");
  const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? G.parseDate(v) : new Date(v));
  const fmtDate = (iso, opts) => (iso ? toDate(iso).toLocaleDateString("es", opts || { day: "2-digit", month: "2-digit" }) : "—");
  const SKIP_REASONS = ["Enfermedad", "Cansancio", "Trabajo", "Viaje", "Molestia o lesión", "Otro"];
  function meta() {
    const m = S.data.meta || (S.data.meta = {});
    m.dayDates = m.dayDates || {};
    m.dayStatus = m.dayStatus || {};
    return m;
  }
  const pctTxt = (p) => (p === null || p === undefined ? "" : p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : "0%");
  const dirIcon = (r) => (r.mode === "deload" ? "down" : r.mode === "reps" ? "plus" : r.value > r.base ? "up" : "flat");
  const prettyTarget = (t) => String(t).replace(/(\d)\s*x\s*(\d)/gi, "$1×$2").replace(/\s*@\s*RPE\s*/gi, " · RPE ");
  const SHORT_GOAL = {
    "Más peso, menos reps": "Más peso", "Más peso, mismas reps": "Más peso", "Más peso y más reps": "Peso y reps",
    "Mismo peso, más reps": "Más reps", "Mismo peso, menos reps": "Menos reps", "Mismo peso y reps": "Igual",
    "Menos peso": "Menos peso", "Calibrá el peso": "Calibrar",
  };

  // ---------- Unidad por ejercicio (lb por defecto) ----------

  const unitKey = (day, idx) => `unit_${day}_${idx}`;
  const exUnit = (day, idx) => S.data[unitKey(day, idx)] || S.unit;
  // Unidad con la que se muestra una tarjeta: la del borrador, la del registro guardado o la preferida.
  function cardUnit(day, idx, k, rec) {
    if (S.drafts[k]) return S.drafts[k].unit;
    return rec && G.parseNum(rec.weight) > 0 ? G.recUnit(rec, routine()) : exUnit(day, idx);
  }
  // Un registro (o marca) expresado en otra unidad, redondeado a 0,5.
  const inUnit = (r, u) => (r ? { ...r, weight: G.roundHalf(G.convert(r.weight, r.unit || "lb", u)), unit: u } : r);
  const convTxt = (w, u) => `≈ ${fmt(G.round1(G.convert(w, u, G.otherUnit(u))))} ${G.otherUnit(u)}`;

  // Recomendación de una tarjeta de la rutina (o null), en la unidad u.
  function recFor(day, ex, idx, w, name, u) {
    if (ex.noWeight) return null;
    const r = routine();
    const records = recordsOf(name);
    const k = G.slotKey(day.key, idx, w);
    const others = records.filter((x) => !(x.cycle === S.cycle && x.key === k));
    const prev = inUnit(G.prevWeight(S.data, day.key, idx, w, ex, r.unitDefault), u);
    const lastS1 = inUnit(G.lastCycleS1(others, S.cycle), u);
    let lastS1Target = null;
    if (lastS1) {
      const p = G.parseSlotKey(lastS1.key) || {}, lr = S.routines[lastS1.cycle];
      const ld = lr && lr.days.find((d) => d.key === p.day);
      lastS1Target = lastS1.target || (ld && ld.exercises[p.idx] ? ld.exercises[p.idx].targets[0] : null);
    }
    return {
      max: inUnit(G.findMax(records), u),
      rec: G.recommend({
        target: ex.targets[w], prevTarget: prev ? ex.targets[prev.week] : null, week: w, prev,
        prevRec: prev ? S.data[G.slotKey(day.key, idx, prev.week)] : null,
        lastS1, lastS1Target, max: inUnit(G.findMax(others), u), unit: u, weekShort: r.weekShort,
      }),
    };
  }

  // ---------- Render principal ----------

  let FX = {};   // efectos del render en curso: { view, opened, done, pr } (se consumen en cada render)

  function render() {
    FX = S.fx; S.fx = {};
    const chip = $("#cycleChip");
    const r = routine();
    chip.hidden = !r;
    chip.textContent = r ? `Ciclo ${r.cycle}` : "";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
    const root = $("#root");
    root.innerHTML = S.tab === "rutina" ? renderRutina() : renderHistorial();
    root.classList.toggle("fx-view", !!FX.view);
    if (FX.view) [...root.children].forEach((el, i) => el.style.setProperty("--i", i));
    renderSheet();
  }

  function renderEmpty() {
    return `<div class="empty">
      <div class="empty-ic">${icon("layers")}</div>
      <h2>${S.hist && S.hist.cycles.length ? "Ciclo cerrado" : "Sin rutina"}</h2>
      <p>${S.hist && S.hist.cycles.length ? "Tu historial está guardado. " : ""}No hay ninguna rutina cargada. Se carga sola desde <code>${ROUTINE_URL}</code> cuando hay conexión, o podés importarla desde Ajustes.</p>
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
    const doneOf = (d) => d.exercises.filter((_, i) => S.data[G.slotKey(d.key, i, S.week)]?.completed).length;
    const weeks = r.weekShort.map((w, i) => {
      const [main, sub] = splitWeek(w);
      return `<button class="seg-btn week-btn${i === S.week ? " active" : ""}" data-action="week" data-week="${i}">
        <span class="wk-num">${esc(main)}</span>${sub ? `<span class="wk-sub">${esc(sub)}</span>` : ""}</button>`;
    }).join("");
    const days = r.days.map((d) => {
      const n = d.exercises.length, done = doneOf(d);
      const abbr = d.label.split("·")[0].trim();
      const skipped = !!G.dayStatus(S.data, d.key, S.week);
      return `<button class="day-btn ${d.type}${d.key === day.key ? " active" : ""}${done === n ? " complete" : ""}${skipped ? " skipped" : ""}" data-action="day" data-day="${d.key}" aria-label="${esc(d.dayName)}, día ${d.key}">
        <span class="day-name">${esc(abbr)}</span><span class="day-key">${esc(d.key)}</span><small>${done}/${n}</small></button>`;
    }).join("");
    const n = day.exercises.length, done = doneOf(day);
    const C = 2 * Math.PI * 30;
    const off = C * (1 - (n ? done / n : 0));
    const [main, sub] = splitTitle(day.title);
    const chev = icon("chevron").replace('class="ic"', 'class="ic chev"');
    const date = G.dayDate(r, S.data, day.key, S.week);
    const dateEdited = !!(S.data.meta && S.data.meta.dayDates && S.data.meta.dayDates[G.dayId(day.key, S.week)]);
    const st = G.dayStatus(S.data, day.key, S.week);
    const dateChip = `<label class="hero-chip date-chip">${icon("calendar")}<span>${date ? fmtDate(date, { weekday: "short", day: "numeric", month: "short" }) : "Poner fecha"}</span>${dateEdited ? '<i class="edited-dot" title="Fecha editada"></i>' : ""}
        <input type="date" class="day-date-input" data-change="day-date" value="${date || ""}" aria-label="Fecha de este día"></label>`;
    const skipUI = st
      ? `<div class="skip-state">${icon("ban")}<span><b>No completado</b>${st.reason ? ` · ${esc(st.reason)}` : ""}</span>
          <button class="hero-link undo-skip-btn" data-action="undo-skip">Deshacer</button></div>`
      : S.skipOpen
        ? `<div class="skip-box"><div class="skip-title">¿Por qué no se pudo?</div>
            <div class="skip-chips">${SKIP_REASONS.map((x) =>
              `<button class="skip-chip${S.skipReason === x ? " on" : ""}" data-action="skip-reason" data-reason="${x}">${x}</button>`).join("")}</div>
            <input class="text-input skip-input" data-skip="reason" value="${esc(S.skipReason)}" placeholder="Motivo (opcional)" aria-label="Motivo">
            <div class="row-btns"><button class="chip-btn solid save-skip-btn" data-action="save-skip">Marcar no completado</button>
              <button class="chip-btn cancel-skip-btn" data-action="cancel-skip">Cancelar</button></div></div>`
        : "";
    return `${backupNag()}
      <div class="seg weeks" role="tablist" aria-label="Semana">${weeks}</div>
      <div class="days" role="tablist" aria-label="Día">${days}</div>
      <section class="hero ${day.type}${st ? " skipped" : ""}">
        <div class="hero-top">
          <div class="hero-text">
            <div class="eyebrow">${esc(day.dayName)} · ${esc(r.weeks[S.week])}</div>
            <h1 class="hero-title">${esc(main)}</h1>
            ${sub ? `<div class="hero-sub">${esc(sub)}</div>` : ""}
          </div>
          <div class="ring" role="img" aria-label="${done} de ${n} completados">
            <svg viewBox="0 0 72 72"><circle class="track" cx="36" cy="36" r="30"/>
              <circle class="bar" cx="36" cy="36" r="30" style="--c:${C.toFixed(1)};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/></svg>
            <div class="ring-txt"><div><b>${done}/${n}</b><span>hechos</span></div></div>
          </div>
        </div>
        <div class="hero-actions">${dateChip}${!st && !S.skipOpen ? `<button class="hero-chip skip-btn" data-action="open-skip">${icon("ban")}No pude hacerlo</button>` : ""}</div>
        ${skipUI}
        ${day.warmup ? `<details class="warmup"><summary>${icon("flame")}Activación${chev}</summary><p>${esc(day.warmup)}</p></details>` : ""}
      </section>
      <div class="section-head"><h2>Ejercicios</h2><span>${day.type === "lower" ? "Tren inferior" : "Tren superior"} · ${n}</span></div>
      <ol class="ex-list">${day.exercises.map((ex, i) => renderCard(day, ex, i)).join("")}</ol>`;
  }

  function weightSummary(rec) {
    const w = rec ? G.parseNum(rec.weight) : NaN;
    if (!(w > 0)) return "";
    const u = G.recUnit(rec, routine());
    const side = rec.weightMode === "perSide" && rec.perSideDisplay != null ? ` · ${fmt(rec.perSideDisplay)}/lado` : "";
    return `<span class="ex-weight"><span class="ex-val"><b>${fmt(w)}</b> ${u}</span><span class="side">${side} · ${convTxt(w, u)}</span></span>`;
  }

  function recBadge(rec, u) {
    if (!rec) return "";
    const cls = rec.mode === "deload" ? "down" : rec.mode === "reps" ? "reps" : rec.mode === "calibrate" ? "cal" : rec.value > rec.base ? "up" : "flat";
    const pct = rec.mode !== "calibrate" && rec.pct ? `${pctTxt(rec.pct)} · ` : "";
    return `<span class="ex-sug ${cls}"><span class="sug-lbl">Sugerido</span><span class="ex-val"><b>${fmt(rec.value)}</b> ${u}</span> <em>${icon(dirIcon(rec))}${pct}${esc(SHORT_GOAL[rec.goal] || rec.goal)}</em></span>`;
  }

  function draftFor(k, rec, sets) {
    if (!S.drafts[k]) {
      const p = G.parseSlotKey(k);
      const unit = cardUnit(p.day, p.idx, k, rec);
      rec = rec || {};
      S.drafts[k] = {
        unit,
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
    const u = cardUnit(day.key, idx, k, rec);
    const info = recFor(day, ex, idx, w, name, u);
    const right = weightSummary(rec) || (info && info.rec ? recBadge(info.rec, u) : "");
    const tagTxt = altUsed ? "alternativa" : name !== ex.name ? "editado" : "";
    const maxTxt = info && info.max ? `<span class="ex-max">${icon("trophy")}${fmt(info.max.weight)}${info.max.topReps ? `×${info.max.topReps}` : ""}</span>` : "";
    const head = `<div class="card-head" data-action="toggle-card" data-idx="${idx}">
        <button class="done-btn${FX.done === k ? " fx-pop" : ""}" data-action="toggle-done" data-k="${k}" aria-pressed="${done}" aria-label="${done ? "Completado" : "Marcar como completado"}">${icon("check")}</button>
        <div class="card-info">
          <div class="ex-name">${esc(name)}${tagTxt ? ` <span class="edited">· ${tagTxt}</span>` : ""}</div>
          <div class="ex-sub"><span class="ex-target">${esc(prettyTarget(ex.targets[w]))}</span><span class="ex-rest">${icon("clock")}${esc(ex.rest)}</span>${maxTxt}</div>
          ${right ? `<div class="ex-line">${right}</div>` : ""}
        </div>
      </div>`;
    const cls = `card ${day.type}${done ? " done" : ""}${open ? " open" : ""}${FX.pr === k ? " fx-pr" : ""}`;
    if (!open) return `<li class="${cls}" style="--i:${idx}">${head}</li>`;
    return `<li class="${cls}" style="--i:${idx}" data-card="${k}">${head}${renderCardBody(day, ex, idx, k, rec, name, info)}</li>`;
  }

  function renderCardBody(day, ex, idx, k, rec, name, info) {
    const w = S.week;
    const sets = ex.sets[w];
    const d = draftFor(k, rec, sets);
    const u = d.unit;
    const baseName = G.effectiveName(S.data, day.key, idx, ex);
    const altUsed = !!(rec && rec.altUsed && ex.alt);
    const showAlt = ex.alt && G.normName(baseName) !== G.normName(ex.alt);
    const overridden = baseName !== ex.name;
    const sug = info && info.rec;
    const max = info && info.max;

    const insight = ex.noWeight ? "" : sug
      ? `<div class="insight ${sug.mode}">
          <div><div class="label">${icon("target")}Sugerido para hoy</div>
            <div class="val">${fmt(sug.value)} <small>${u}</small>${sug.mode !== "calibrate" && sug.pct ? `<span class="delta">${icon(dirIcon(sug))}${pctTxt(sug.pct)}</span>` : ""}</div></div>
          <button class="use-sug-btn" data-action="use-suggestion" data-k="${k}" data-value="${sug.value}">Usar</button>
          <div class="goal">${esc(sug.goal)}</div>
          <p class="why">${esc(sug.text)}</p>
        </div>`
      : `<div class="insight none">
          <div><div class="label">${icon("target")}Sugerido para hoy</div><div class="val">Calibrá con la 1ª serie</div></div>
          <p class="why">Todavía no hay registros de este ejercicio: elegí un peso que te deje en el RPE pedido.</p>
        </div>`;
    const facts = `<div class="facts">
        ${ex.pattern ? `<span>${icon("layers")}${esc(ex.pattern)}</span>` : ""}
        <span>${icon("clock")}<b>${esc(ex.rest)}</b></span>
        <span>${icon("list")}<b>${sets}</b> series</span>
        ${max ? `<span class="fact-max">${icon("trophy")}Máximo <b>${fmt(max.weight)} ${u}</b>${max.topReps ? ` × ${max.topReps}` : ""} · ${fmtDate(max.date)}</span>`
          : ex.noWeight ? "" : `<span class="fact-max">${icon("trophy")}Sin máximo todavía</span>`}
      </div>`;

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
      ? `<input class="num-input reps-same-input" inputmode="numeric" data-field="repsSameValue" data-k="${k}" value="${esc(d.repsSameValue)}" placeholder="reps" aria-label="Reps de cada serie"><span class="reg-x">× ${sets}</span>`
      : Array.from({ length: sets }, (_, i) =>
          `<input class="num-input rep-input" inputmode="numeric" data-field="rep" data-i="${i}" data-k="${k}" value="${esc(d.reps[i])}" placeholder="S${i + 1}" aria-label="Reps serie ${i + 1}">`).join("");

    const wNow = G.parseNum(d.weight);
    const hints = `<span class="weight-hints">${d.weightMode === "perSide" && d.perSideDisplay != null
      ? `<span class="perside-hint">${fmt(d.perSideDisplay)} ${u} por lado + barra · </span>` : ""}<span class="conv-hint">${wNow > 0 ? convTxt(wNow, u) : ""}</span></span>`;
    const unitSeg = `<div class="seg mini unit-toggle" role="group" aria-label="Unidad de este ejercicio">${["lb", "kg"].map((x) =>
      `<button class="seg-btn ex-unit-btn${u === x ? " active" : ""}" data-action="set-ex-unit" data-unit="${x}" data-k="${k}">${x}</button>`).join("")}</div>`;

    return `<div class="card-body${FX.opened === idx ? " fx-open" : ""}">
      ${insight}
      ${facts}
      <div class="tools">
        ${showAlt ? `<button class="tool-btn alt-btn${d.altOpen || altUsed ? " on" : ""}" data-action="toggle-alt" data-k="${k}">${icon("swap")}${altUsed ? "Usando alt." : "Alternativa"}</button>` : ""}
        <button class="tool-btn edit-btn${d.editOpen ? " on" : ""}" data-action="toggle-edit" data-k="${k}">${icon("pencil")}Renombrar</button>
      </div>
      ${altBox}
      ${editBox}
      <div class="reg">
        <div class="reg-title">Registro de hoy</div>
        <div class="reg-row weight-row">
          <span class="reg-label">Peso${ex.noWeight ? "<small>opcional</small>" : ""}</span>
          <div class="reg-ctrl">
            <div class="stepper">
              <button class="step-btn step-down-btn" data-action="step-weight" data-dir="-1" data-k="${k}" aria-label="Bajar peso">−</button>
              <div class="weight-box">
                <input class="num-input weight-input" inputmode="decimal" data-field="weight" data-k="${k}" value="${esc(d.weight)}" placeholder="0" aria-label="Peso total">
                <span class="unit">${u}</span>
              </div>
              <button class="step-btn step-up-btn" data-action="step-weight" data-dir="1" data-k="${k}" aria-label="Subir peso">+</button>
            </div>
            ${unitSeg}
          </div>
        </div>
        <div class="reg-sub">${hints}
          ${ex.noWeight ? "" : `<button class="calc-toggle-btn" data-action="toggle-calc" data-k="${k}">${icon("calc")}${d.calcOpen ? "Cerrar" : "Calcular con barra"}</button>`}</div>
        ${d.calcOpen && !ex.noWeight ? renderCalc(k, d) : ""}
        <div class="reg-row reps-row">
          <span class="reg-label">Reps
            <label class="switch mini">Iguales<input type="checkbox" class="reps-same-check" data-field="repsSame" data-k="${k}"${d.repsSame ? " checked" : ""}></label></span>
          <div class="reg-ctrl reps-ctrl">${repsInputs}</div>
        </div>
        <div class="reg-row note-row">
          <textarea class="text-input note-input" rows="1" data-field="note" data-k="${k}" placeholder="Nota (opcional)" aria-label="Nota: cómo se sintió, molestias, ajustes">${esc(d.note)}</textarea>
        </div>
      </div>
      <button class="primary-btn save-entry-btn" data-action="save-entry" data-k="${k}">${icon("check")}Guardar</button>
    </div>`;
  }

  function renderCalc(k, d) {
    const u = d.unit;
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
    const bar = G.barWeight(d.calcBar, d.unit, d.calcCustom);
    const v = G.parseNum(d.calcValue);
    if (!(bar >= 0) || !(v >= 0)) return null;
    return G.calcBar(d.calcMode, v, bar);
  }

  function calcResultText(d) {
    const res = calcResult(d);
    if (!res) return d.calcBar === "custom" && !(G.parseNum(d.calcCustom) >= 0) ? "Ingresá el peso de la barra" : "Ingresá el peso";
    if (d.calcMode === "perSide") return `Total: ${fmt(res.total)} ${d.unit}`;
    return res.perSide < 0 ? "El total es menor que la barra" : `Por lado: ${fmt(res.perSide)} ${d.unit}`;
  }

  // ---------- Historial (por ejercicio, en todos los ciclos) ----------

  const HIST_FILTERS = [["all", "Todos"], ["lower", "Pierna"], ["upper", "Superior"], ["core", "Core"]];

  function histIndex() { return G.exerciseIndex(S.routines, allData(), S.cycle, S.hist); }

  function renderHistorial() {
    if (!cycleList().length && !(S.hist && S.hist.sessions.length)) return renderEmpty();
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
      const sub = [e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna"), days ? `Día ${days}` : ""].filter(Boolean).join(" · ");
      const right = e.noWeight && !m
        ? `<span class="hl-none">${e.last ? fmtDate(e.last.date) : "Sin peso"}</span>`
        : m ? `<span class="hl-max"><b>${fmt(m.weight)}</b> ${m.unit}${m.topReps ? ` × ${m.topReps}` : ""}</span><span class="hl-date">${fmtDate(m.date)}</span>`
          : `<span class="hl-none">Sin registros</span>`;
      return `<li><button class="hist-item ${e.group}" data-action="hist-open" data-ex="${esc(e.key)}">
        <span class="hist-dot"></span>
        <span class="hl-info"><span class="ex-name">${esc(e.name)}</span><span class="hl-sub">${esc(sub)}</span></span>
        <span class="hl-right">${right}</span>${icon("chevron")}</button></li>`;
    }).join("")}</ul>`;
  }

  function renderHistDetail(e) {
    const prs = G.prHistory(e.records).reverse();
    const sessions = [...e.records].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : b.cycle - a.cycle || b.week - a.week));
    const m = e.max;
    const where = (r) => `Ciclo ${r.cycle} · ${esc(splitWeek(r.weekShort)[0])} · Día ${esc(r.day)}`;
    const prRows = prs.map((r, i) => {
      const before = prs[i + 1];
      const gain = before ? G.round1(r.weight - G.convert(before.weight, before.unit, r.unit)) : 0;
      const delta = before ? (G.cmpW(r) > G.cmpW(before) ? `+${fmt(gain)} ${r.unit}` : `+${r.topReps - before.topReps} reps`) : "Primera";
      return `<li class="pr-row${i === 0 ? " current" : ""}"><span class="pr-badge">${icon("trophy")}</span>
        <span class="pr-w num"><b>${fmt(r.weight)}</b> ${r.unit}${r.topReps ? ` × ${r.topReps}` : ""}</span>
        <span class="pr-delta">${i === 0 ? "Actual" : delta}</span>
        <span class="pr-meta">${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })} · ${where(r)}</span></li>`;
    }).join("");
    const sessRows = sessions.map((r) => `<li class="sess-row">
        <div class="sess-top">
          <span class="sess-when"><span class="sess-date">${fmtDate(r.date, { day: "numeric", month: "short" })}</span><span class="sess-where">${where(r)}${r.altUsed ? " · alternativa" : ""}</span></span>
          <span class="sess-w num"><b>${fmt(r.weight)}</b> ${r.unit}</span><span class="sess-r num">${esc(r.reps) || "—"}</span>
          <span class="ok">${r.completed ? icon("check") : ""}</span></div>
        ${r.note ? `<div class="sess-note">${icon("note")}${esc(r.note)}</div>` : ""}</li>`).join("");
    return `<button class="back-btn hist-back-btn" data-action="hist-back">${icon("back")}Historial</button>
      <div class="page-head"><div class="eyebrow">${esc(e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna"))}</div>
        <h1 class="page-title detail">${esc(e.name)}</h1></div>
      <div class="pr-hero">
        <span class="label">${icon("trophy")}Máximo actual</span>
        ${m ? `<span class="pr-hero-val num">${fmt(m.weight)} <small>${m.unit}</small>${m.topReps ? ` <span>× ${m.topReps}</span>` : ""}</span>
          <span class="sub">${convTxt(m.weight, m.unit)} · ${fmtDate(m.date, { day: "numeric", month: "long", year: "numeric" })} · ${where(m)}</span>`
          : `<span class="pr-hero-val num none">—</span><span class="sub">Todavía no hay pesos registrados.</span>`}
      </div>
      ${prs.length > 1 ? `<h2 class="section-title">Récords</h2><ul class="pr-list">${prRows}</ul>` : ""}
      <h2 class="section-title">Sesiones <span class="muted">${sessions.length}</span></h2>
      ${sessions.length ? `<ul class="sess-list">${sessRows}</ul>` : `<p class="muted small">Sin sesiones con peso.</p>`}`;
  }

  // ---------- Hojas: Ajustes y Glosario ----------

  function renderSheet() {
    const sheet = $("#sheet");
    if (!S.sheet) { sheet.hidden = true; sheet.innerHTML = ""; return; }
    sheet.hidden = false;
    const body = S.sheet === "glossary" ? renderGlossary() : renderSettings();
    const fx = S.sheetFx ? " fx-sheet" : "";
    S.sheetFx = false;
    sheet.innerHTML = `<div class="sheet-backdrop${fx}" data-action="close-settings"></div>
      <div class="sheet-panel${fx}" role="dialog" aria-label="${S.sheet === "glossary" ? "Glosario" : "Ajustes"}">
        <div class="sheet-grabber"></div>${body}</div>`;
  }

  function sheetHead(title) {
    return `<div class="sheet-head"><h2>${title}</h2>
      <button class="icon-btn close-settings-btn" data-action="close-settings" aria-label="Cerrar">${icon("x")}</button></div>`;
  }

  function renderGlossary() {
    return `${sheetHead("Glosario")}
      <dl class="glossary">${GLOSSARY.map((g) => `<div class="gl-item"><dt>${esc(g.term)}</dt><dd>${esc(g.text)}</dd></div>`).join("")}</dl>`;
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
    const start = routine() ? G.cycleStart(routine(), S.data) : null;
    const startRow = routine() ? `<label class="list-row date-row">${icon("calendar")}<span class="grow">Inicio del ciclo ${S.cycle}
        <span class="sub">${start ? fmtDate(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Sin fecha: elegí el día en que empezaste"}</span></span>
        <input type="date" class="cycle-start-input" data-change="cycle-start" value="${start || ""}" aria-label="Inicio del ciclo"></label>` : "";
    const closeRow = routine() ? `<button class="list-row close-cycle-btn" data-action="close-cycle">${icon("archive")}<span class="grow">Cerrar ciclo ${S.cycle}
        <span class="sub">Verifica que tus máximos estén en el historial, descarga el export y lo borra del celular</span></span></button>` : "";
    const closed = S.hist && S.hist.cycles.length
      ? `<p class="note">Ciclos cerrados (en el historial): ${S.hist.cycles.map((c) => `${c.cycle}`).join(", ")} · ${S.hist.sessions.length} sesiones guardadas.</p>` : "";
    const remoteRows = (S.remote || []).filter((c) => !S.routines[c.cycle] && !G.isClosed(S.hist, c.cycle)).map((c) =>
      `<button class="list-row remote-cycle-btn" data-action="load-remote-cycle" data-cycle="${c.cycle}">${icon("download")}<span class="grow">Ciclo ${c.cycle}
        <span class="sub">${esc(c.name)} · tocá para cargarlo</span></span></button>`).join("");
    return `${sheetHead("Ajustes")}
      <div class="group"><span class="eyebrow">Apariencia</span><div class="seg">${themes.map(([v, l]) =>
        `<button class="seg-btn theme-btn${S.theme === v ? " active" : ""}" data-action="set-theme" data-theme="${v}">${l}</button>`).join("")}</div></div>
      <div class="group"><span class="eyebrow">Unidad por defecto</span><div class="seg">${units.map(([v, l]) =>
        `<button class="seg-btn unit-btn${S.unit === v ? " active" : ""}" data-action="set-unit" data-unit="${v}">${l}</button>`).join("")}</div>
        <p class="note">Para ejercicios sin unidad elegida. Cada ejercicio puede cambiarla con el selector lb | kg junto al peso; lo ya guardado no cambia.</p></div>
      <div class="group"><span class="eyebrow">Ciclos</span><div class="group-card">${cycles}${startRow}${remoteRows}
        <label class="list-row file-btn">${icon("upload")}<span class="grow">Importar rutina (JSON)</span>
          <input type="file" class="visually-hidden import-routine-input" accept=".json,application/json" data-change="import-routine"></label>${closeRow}</div>${closed}</div>
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
    if (!confirm(`Restaurar el respaldo del ${new Date(b.exportedAt).toLocaleDateString("es")}? Reemplaza los datos de: ${cycles.length ? `ciclo ${cycles.join(", ")}` : "ningún ciclo abierto"}${b.history ? " y el historial" : ""}.`)) return;
    for (const c of cycles) {
      S.routines[c] = b.routines[c];
      store.set(G.dataKey(c), b.data[c] || {});
    }
    store.set(KEYS.routines, S.routines);
    if (b.prefs && b.prefs.unit) { S.unit = b.prefs.unit; store.set(KEYS.unit, S.unit); }
    if (b.history && Array.isArray(b.history.sessions)) { S.hist = b.history; store.set(KEYS.history, S.hist); }
    if (cycleList().length) loadCycle(S.routines[S.cycle] ? S.cycle : cycleList()[0]);
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
      unit: d.unit,
      savedAt: new Date().toISOString(),
    };
    if (!saveData()) return false;
    delete S.drafts[k];
    return true;
  }

  const actions = {
    tab(el) { if (S.tab === el.dataset.tab && !S.histEx) return; S.tab = el.dataset.tab; S.histEx = null; S.fx.view = true; render(); window.scrollTo(0, 0); },
    week(el) {
      S.week = Number(el.dataset.week); S.open = new Set(); S.fx.view = true; S.skipOpen = false;
      store.set(KEYS.lastWeek, { cycle: S.cycle, week: S.week }); render();
    },
    day(el) { S.day = el.dataset.day; S.open = new Set(); S.fx.view = true; S.skipOpen = false; store.set(KEYS.lastDay, S.day); render(); },
    "toggle-card"(el) {
      const i = Number(el.dataset.idx);
      if (S.open.has(i)) S.open.delete(i); else { S.open.add(i); S.fx.opened = i; }
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
        S.fx.done = k;
        saveData(); render(); toast("Completado ✓"); return;
      }
      const d = S.drafts[k];
      if (d && G.parseNum(d.weight) > 0) {
        if (saveEntry(k, true)) { S.open.delete(exFromKey(k).idx); S.fx.done = k; render(); toast("Guardado y completado ✓"); }
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
      toast(`Peso: ${fmt(res.total)} ${d.unit}`);
    },
    "use-suggestion"(el) {
      const d = S.drafts[el.dataset.k];
      d.weight = el.dataset.value; d.weightMode = "total"; d.perSideDisplay = null;
      render();
    },
    "save-entry"(el) {
      const k = el.dataset.k;
      const { dayObj, idx, ex, week } = exFromKey(k);
      const name = G.slotName(S.data, dayObj.key, idx, ex, week);
      const before = G.findMax(recordsOf(name).filter((r) => !(r.cycle === S.cycle && r.key === k)));
      if (!saveEntry(k)) return;
      S.open.delete(idx);
      const now = G.collectRecords(S.routines, allData(), name).find((r) => r.cycle === S.cycle && r.key === k);
      const isPR = before && now && (G.cmpW(now) > G.cmpW(before) || (G.cmpW(now) === G.cmpW(before) && now.topReps > before.topReps));
      if (isPR) S.fx.pr = k;
      render();
      if (isPR) toast(`🏆 ¡Nuevo récord! ${fmt(now.weight)} ${now.unit}${now.topReps ? ` × ${now.topReps}` : ""}`, "pr");
      else toast("Guardado ✓");
    },
    "step-weight"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const step = G.STEP[d.unit] || 5, dir = Number(el.dataset.dir);
      let cur = G.parseNum(d.weight);
      if (!(cur >= 0)) {
        const sug = el.closest(".card-body").querySelector(".use-sug-btn");
        cur = sug ? Number(sug.dataset.value) : 0;
        if (!sug) cur += dir * step;
      } else cur += dir * step;
      d.weight = String(Math.max(0, cur)); d.weightMode = "total"; d.perSideDisplay = null;
      const box = el.closest(".reg");
      box.querySelector(".weight-input").value = d.weight;
      const hint = box.querySelector(".perside-hint");
      if (hint) hint.remove();
      box.querySelector(".conv-hint").textContent = cur > 0 ? convTxt(Math.max(0, cur), d.unit) : "";
    },
    "set-ex-unit"(el) {
      const k = el.dataset.k, d = S.drafts[k], to = el.dataset.unit;
      if (d.unit === to) return;
      const { dayObj, idx } = exFromKey(k);
      const w = G.parseNum(d.weight);
      if (w > 0) d.weight = String(G.roundHalf(G.convert(w, d.unit, to)));
      d.weightMode = "total"; d.perSideDisplay = null; d.calcValue = "";
      d.unit = to;
      S.data[unitKey(dayObj.key, idx)] = to;
      if (!saveData()) return;
      render();
      toast(w > 0 ? `Convertido: ${fmt(G.parseNum(d.weight))} ${to}` : `Este ejercicio en ${to}`);
    },
    "hist-open"(el) { S.histEx = el.dataset.ex; S.fx.view = true; render(); window.scrollTo(0, 0); },
    "hist-back"() { S.histEx = null; S.fx.view = true; render(); },
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
    "open-glossary"() { S.sheet = "glossary"; S.sheetFx = true; renderSheet(); },
    "open-settings"() { S.sheet = "settings"; S.sheetFx = true; renderSheet(); loadRemoteIndex(); },
    async "close-cycle"() {
      const r = routine();
      if (!r) return;
      const res = G.closeCycle(S.hist, r, S.data, new Date());
      if (res.error) { toast(res.error, "error"); return; }
      if (res.missing.length) { toast(`No se pudo verificar el máximo de: ${res.missing.join(", ")}. No se borró nada.`, "error"); return; }
      if (!confirm(`Cerrar el ciclo ${r.cycle} (${r.name})\n\n✓ ${res.exercises} ejercicios y ${res.sessions} sesiones verificados: los máximos quedan en el historial.\n\nSe descarga el export del ciclo y después el ciclo se borra del celular. No se puede deshacer.`)) return;
      const exported = await deliverFile(`gluteo-ciclo-${r.cycle}-${today()}.json`, G.buildCycleExport(r, S.data, S.unit));
      if (!exported) { toast("Cierre cancelado: no se descargó el export", "error"); return; }
      if (!store.set(KEYS.history, res.hist)) return;
      const back = store.get(KEYS.history, null);
      if (!back || back.sessions.length !== res.hist.sessions.length || !G.isClosed(back, r.cycle)) {
        toast("No se pudo comprobar el historial guardado. No se borró el ciclo.", "error"); return;
      }
      S.hist = back;
      delete S.routines[r.cycle];
      store.set(KEYS.routines, S.routines);
      try { localStorage.removeItem(G.dataKey(r.cycle)); } catch { /* ya no está */ }
      const next = cycleList()[0];
      if (next !== undefined) loadCycle(next);
      else { S.cycle = null; S.data = {}; S.drafts = {}; store.set(KEYS.active, null); }
      S.sheet = false; S.fx.view = true;
      render();
      toast(`Ciclo ${r.cycle} cerrado · ${res.sessions} sesiones en el historial ✓`);
    },
    "open-skip"() { S.skipOpen = true; S.skipReason = ""; render(); },
    "cancel-skip"() { S.skipOpen = false; render(); },
    "skip-reason"(el) {
      S.skipReason = el.dataset.reason;
      document.querySelectorAll(".skip-chip").forEach((c) => c.classList.toggle("on", c === el));
      const input = document.querySelector(".skip-input");
      if (input) input.value = S.skipReason;
    },
    "save-skip"() {
      const day = currentDay();
      meta().dayStatus[G.dayId(day.key, S.week)] = { status: "skipped", reason: S.skipReason.trim(), savedAt: new Date().toISOString() };
      if (!saveData()) return;
      S.skipOpen = false; render(); toast("Día marcado como no completado");
    },
    "undo-skip"() {
      const day = currentDay();
      delete meta().dayStatus[G.dayId(day.key, S.week)];
      if (!saveData()) return;
      render(); toast("Marca de no completado quitada");
    },
    async "load-remote-cycle"(el) {
      const c = Number(el.dataset.cycle);
      try {
        const res = await fetch(`rutinas/ciclo-${c}.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status);
        const r = await res.json();
        const errs = G.validateRoutine(r);
        if (errs.length || r.cycle !== c) { toast(`El ciclo ${c} no es válido`, "error"); return; }
        S.routines[c] = r;
        store.set(KEYS.routines, S.routines);
        renderSheet();
        toast(`Ciclo ${c} cargado · tocalo para abrirlo`);
      } catch { toast("Sin conexión: no se pudo cargar el ciclo", "error"); }
    },
    "close-settings"() { S.sheet = false; renderSheet(); },
    "set-theme"(el) { S.theme = el.dataset.theme; store.set(KEYS.theme, S.theme); applyTheme(); renderSheet(); },
    "set-unit"(el) { S.unit = el.dataset.unit; store.set(KEYS.unit, S.unit); S.drafts = {}; render(); },
    "set-cycle"(el) { loadCycle(el.dataset.cycle); S.fx.view = true; render(); toast(`Ciclo ${S.cycle} activo`); },
    async "export-cycle"() {
      const r = routine();
      const ok = await deliverFile(`gluteo-ciclo-${r.cycle}-${today()}.json`, G.buildCycleExport(r, S.data, S.unit));
      if (ok) toast("Export listo ✓");
    },
    async backup() {
      const data = {};
      for (const c of Object.keys(S.routines)) data[c] = dataOf(c);
      const b = G.buildBackup({ routines: S.routines, data, unit: S.unit, theme: S.theme, history: S.hist });
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
    if (el.dataset.skip === "reason") { S.skipReason = el.value; return; }
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
    if (f === "note") { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
    if (f === "weight") {
      d.weightMode = "total"; d.perSideDisplay = null;
      const card = el.closest(".card");
      const hint = card.querySelector(".perside-hint");
      if (hint) hint.remove();
      const wv = G.parseNum(el.value), conv = card.querySelector(".conv-hint");
      if (conv) conv.textContent = wv > 0 ? convTxt(wv, d.unit) : "";
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
    if (el.dataset.change === "day-date") {
      const day = currentDay(), id = G.dayId(day.key, S.week);
      const planned = G.plannedDate(routine(), S.data, day.key, S.week);
      if (!el.value || el.value === planned) delete meta().dayDates[id];
      else meta().dayDates[id] = el.value;
      if (saveData()) { render(); toast(el.value ? "Fecha del día guardada" : "Fecha quitada"); }
      return;
    }
    if (el.dataset.change === "cycle-start") {
      meta().startDate = el.value || null;
      if (saveData()) { render(); toast(el.value ? "Inicio del ciclo guardado" : "Inicio del ciclo quitado"); }
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
    if (G.isClosed(S.hist, r.cycle)) return false;
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

  // Ciclos publicados junto con la app (rutinas/index.json, lo arma el build).
  async function loadRemoteIndex() {
    if (typeof fetch !== "function") return;
    try {
      const res = await fetch("rutinas/index.json", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (!j || !Array.isArray(j.cycles)) return;
      S.remote = j.cycles.filter((c) => Number.isInteger(c.cycle));
      if (S.sheet === "settings") renderSheet();
    } catch { /* sin conexión: no se muestran */ }
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
    S.hist = store.get(KEYS.history, null);
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
