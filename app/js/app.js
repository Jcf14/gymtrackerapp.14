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
    equip: "gluteo_equip",         // { "<nombre normalizado>": "barbell" | "dumbbell" | … | "other" } elegido en la tarjeta
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
    equip: {},          // equipo elegido por ejercicio (KEYS.equip)
    tab: "rutina",
    week: 0,
    day: null,
    exIdx: null,        // ejercicio abierto en la hoja de detalle (S.sheet === "ex")
    exTab: "reg",       // pestaña de esa hoja: reg · how · hist
    drafts: {},         // borradores por slotKey (sobreviven al re-render)
    histQuery: "",
    histFilter: "all",
    histEx: null,       // clave del ejercicio abierto en el historial
    mergeOpen: false,   // selector "Unir con otro ejercicio" abierto
    mergeQuery: "",
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
  const dataOf = (c) => {
    if (Number(c) === S.cycle) return S.data;
    const d = store.get(G.dataKey(c), {});
    if (G.migrateData(c, d)) store.set(G.dataKey(c), d);
    return d;
  };

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

  // Última semana vista de cada ciclo: { "<N>": semana }. (Antes se guardaba una sola: { cycle, week }.)
  function lastWeeks() {
    const v = store.get(KEYS.lastWeek, null);
    if (!v || typeof v !== "object") return {};
    if ("cycle" in v && "week" in v) return { [v.cycle]: v.week };
    return v;
  }

  // Semana al abrir un ciclo sin semana recordada: la que toca por fecha; si el ciclo ya terminó
  // (o no tiene fecha), la última semana con datos, para no caer en una semana vacía.
  function defaultWeek(r) {
    const start = G.parseDate(G.cycleStart(r, S.data));
    const today = new Date();
    const days = start ? Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - start) / 86400000) : null;
    if (days !== null && days >= 0 && days < 28) return Math.floor(days / 7);
    let last = -1;
    for (const k of Object.keys(S.data)) { const p = G.parseSlotKey(k); if (p && p.week > last) last = p.week; }
    return last >= 0 ? last : 0;
  }

  function loadCycle(cycle) {
    S.cycle = Number(cycle);
    S.data = store.get(G.dataKey(S.cycle), {});
    if (G.migrateData(S.cycle, S.data)) saveData();
    S.drafts = {};
    if (S.sheet === "ex") S.sheet = false;
    S.histEx = null;
    const r = routine();
    const remembered = lastWeeks()[S.cycle];
    S.week = Number.isInteger(remembered) ? remembered : defaultWeek(r);
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
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    merge: '<path d="M7 4v5a6 6 0 0 0 6 6h5"/><path d="m15 12 3 3-3 3"/><path d="M7 20v-4"/>',
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
    { id: "saltos", term: "Saltos de peso", text: "Subir un escalón chico (menos de 20%, como 35 → 40 kg) se sugiere cuando llegás al techo del rango. Si el siguiente peso que existe es un salto de 20% o más (polea de 5 a 10 kg, mancuerna de 10 a 15 lb, aductor de 20 a 24 kg), primero sumá reps por encima del rango en todas las series: más reps cuanto más grande el salto (2 a 6; una más en hombros, brazos y aperturas). Con tus datos del ciclo 3, casi todos los saltos de 20% o más no salieron dentro del rango." },
    { id: "cu", term: "c/u (mancuernas)", text: "Con mancuernas anotás el peso de UNA (\"c/u\" = cada una) y si fueron 1 o 2. La app muestra el total (2 × 40 = 80 lb), pero las sugerencias y los récords comparan por mancuerna, que es como subís de verdad (35 → 40 → 50)." },
    { id: "rpe-real", term: "RPE real (¿cómo se sintió?)", text: "Opcional, al registrar: cuánto te costó de verdad (6 = te sobraban 4 reps, 10 = no salía ni una más). Si lo marcás, la sugerencia de la semana siguiente usa eso en lugar del RPE del plan: si costó más de lo pedido no te hace subir, y si te sobró mucho te sube antes." },
    { id: "sugerido", term: "Peso sugerido y %", text: "Lo calcula la app con tu última semana registrada de ese ejercicio. Te dice qué se espera (más peso, más reps, ambos o igual) y el % de cambio contra esa vez. Si en accesorios no llegaste al techo del rango en todas las series, toca más reps con el mismo peso. Manda siempre la primera serie: si se siente más pesada de lo pedido, bajá." },
    { id: "maximo", term: "Máximo (récord)", text: "Tu mejor marca del ejercicio: el peso más alto y, a igual peso, más reps. Cuando lo superás, el anterior queda guardado en el historial de récords." },
    { id: "pulsos", term: "Pulsos", text: "Movimientos cortos arriba, al final de la serie (después de la última rep, sin bajar del todo), no en cada rep. 10 en S1–S2, 15 en S3, ninguno en la descarga." },
    { id: "rematado", term: "Serie de rematado (+ 1x15-20)", text: "Una serie extra de 15–20 reps con ~40–50% menos peso que las series pesadas. Solo en el hip thrust del Día A en S3." },
    { id: "dropset", term: "Dropset (+ dropset)", text: "Solo en la última serie, en S2–S3: al terminarla (cerca del fallo) bajás el peso ~25% (una placa, o la mancuerna anterior) y seguís sin descanso hasta casi el fallo. Es volumen extra sin cargar más las articulaciones. Anotá las reps de la serie normal; las del dropset, en la nota. Nunca en la descarga." },
    { id: "lado", term: "c/pierna · c/lado", text: "Las reps se cuentan para cada pierna o lado por separado." },
    { id: "barra", term: "Por lado / total", text: "Por lado = los discos de un solo lado, sin la barra. Total = 2 × lado + barra. Barra de mujer: 35 lb (15 kg)." },
    { id: "protocolo", term: "Protocolo", text: "Detalle de cómo se hace el ejercicio en este ciclo (pausa arriba, agarre neutro, pies adelante…). Es solo descriptivo: el mismo nombre es el mismo ejercicio para el historial, el récord y las sugerencias. Si una variante cambia mucho la carga (como el hip thrust con pulsos, más liviano), lleva otro nombre." },
    { id: "piramide", term: "Pirámide de Bret (hip thrust)", text: "4 series al principio de la sesión: ~15 reps, ~10 con más peso, ~5 con el peso más alto y ~20 con banda en las rodillas y menos peso. Los pesos NO cambian en las 4 semanas: se progresa sumando reps (meta de reps totales ~50 → 60 → 65 → 70). Lockout completo, sin reps sucias. Bret lo recomienda 2–3 veces al año." },
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
  const exDef = (day, idx) => { const d = routine() && routine().days.find((x) => x.key === day); return d ? d.exercises[idx] : null; };
  // Nombre que se hace en un casillero (el original, el renombrado o la alternativa de esa semana).
  const slotNameOf = (day, idx, w) => { const ex = exDef(day, idx); return ex ? G.slotName(S.data, day, idx, ex, w) : ""; };
  const isOriginal = (ex, name) => !!ex && G.normName(name) === G.normName(ex.name);

  // ---------- Equipo por ejercicio (barra, discos, mancuernas, polea, máquina) ----------
  // Lo elegido en la tarjeta (por nombre, vale para todos los ciclos) › "equip" de la rutina › deducido del nombre.
  function equipOf(ex, name) {
    const own = S.equip[G.normName(name)];
    if (own === "other") return null;
    if (own && G.EQUIP[own]) return own;
    if (isOriginal(ex, name) && ex.equip && G.EQUIP[ex.equip]) return ex.equip;
    return G.inferEquip(name);
  }
  // Escala de carga de una tarjeta: el paso fijo de la rutina (ejercicio original, en su unidad) o el del equipo.
  const scaleOf = (ex, name, u) => G.loadScale(equipOf(ex, name), u, isOriginal(ex, name) && ex.step && u === ex.unit ? ex.step : undefined);

  // Unidad por defecto: la elegida en la tarjeta › la de la rutina (ejercicio original; poleas en kg)
  // › la del último registro de ese ejercicio (como lo cargo de verdad) › la del equipo › la preferida.
  function exUnit(day, idx, w) {
    if (S.data[unitKey(day, idx)]) return S.data[unitKey(day, idx)];
    const ex = exDef(day, idx), name = slotNameOf(day, idx, w || 0);
    if (ex && ex.unit && isOriginal(ex, name)) return ex.unit;
    const last = G.lastRecord(recordsOf(name));
    if (last && last.unit) return last.unit;
    const e = G.EQUIP[equipOf(ex, name)];
    return (e && e.unit) || S.unit;
  }
  // Unidad con la que se muestra una tarjeta: la del borrador, la del registro guardado o la por defecto.
  function cardUnit(day, idx, k, rec) {
    if (S.drafts[k]) return S.drafts[k].unit;
    const p = G.parseSlotKey(k);
    return rec && G.parseNum(rec.weight) > 0 ? G.recUnit(rec, routine()) : exUnit(day, idx, p ? p.week : 0);
  }
  // Un registro (o marca) expresado en otra unidad, redondeado a 0,5.
  const inUnit = (r, u) => (r ? { ...r, weight: G.roundHalf(G.convert(r.weight, r.unit || "lb", u)), unit: u } : r);
  const convTxt = (w, u) => `≈ ${fmt(Math.round(G.convert(w, u, G.otherUnit(u))))} ${G.otherUnit(u)}`;
  // Discos por lado (solo en lb, con barra de mujer): "Por lado 95 → 45 + 25 + 25"
  // bar: "women" | "men" | "custom" (custom = peso escrito; 0 en máquinas que se cargan con discos sin barra)
  function plateTxt(total, u, bar, custom) {
    const t = G.parseNum(total);
    const b = bar === "men" ? G.BARS.men.lb : bar === "none" ? 0 : bar === "custom" ? G.parseNum(custom) : G.BARS.women.lb;
    if (!(b >= 0)) return "";
    if (u !== "lb" || !(t > b)) return "";
    const pf = G.platesFor(t, b);
    if (!pf) return "";
    return `Por lado ${fmt(pf.side)} → ${pf.plates.length ? pf.plates.map(fmt).join(" + ") : "sin discos"}${pf.rest > 0 ? ` · faltan ${fmt(pf.rest)} (no se arma con estos discos)` : ""}`;
  }
  // Mancuernas: se anota el peso de una; cuántas (1 o 2) sale del último registro de ese ejercicio o del nombre.
  const isDumbbell = (ex, name) => equipOf(ex, name) === "dumbbell";
  function lastDbCount(name) {
    const withCount = recordsOf(name).filter((r) => r.dbCount);
    const last = G.lastRecord(withCount);
    return (last && last.dbCount) || G.defaultDbCount(name);
  }
  const dbTotalTxt = (d) => { const w = G.parseNum(d.weight); return w > 0 && d.dbCount > 1 ? `Total ${fmt(w * d.dbCount)} ${d.unit} (${d.dbCount} × ${fmt(w)})` : ""; };
  function refreshDbTotal(k) {
    const el = document.querySelector(`[data-dbtotal="${k}"]`), d = S.drafts[k];
    if (el && d) el.textContent = dbTotalTxt(d);
  }
  // Con barra o máquina con discos, debajo del peso van los discos por lado.
  const usesPlates = (ex, name) => { const e = G.EQUIP[equipOf(ex, name)]; return !!(e && e.plates); };
  const exPlatesTxt = (d) => plateTxt(d.weight, d.unit, d.calcBar);
  function refreshExPlates(k) {
    const el = document.querySelector(`[data-plates="${k}-w"]`), d = S.drafts[k];
    if (el && d) el.textContent = exPlatesTxt(d);
  }
  const EX_SKIP_REASONS = ["Sin tiempo", "Máquina ocupada", "Cansancio", "Molestia", "Otro"];

  // Recomendación de una tarjeta de la rutina (o null), en la unidad u.
  function recFor(day, ex, idx, w, name, u) {
    if (ex.noWeight) return null;
    if (ex.perSetWeight) {
      const max = inUnit(G.findMax(recordsOf(name)), u);
      for (let pw = w - 1; pw >= 0; pw--) {
        const pr = S.data[G.slotKey(day.key, idx, pw)];
        if (!pr || !Array.isArray(pr.setWeights) || !pr.setWeights.some((x) => G.parseNum(x) > 0)) continue;
        const ws = pr.setWeights.map((x) => G.roundHalf(G.convert(G.parseNum(x) || 0, G.recUnit(pr, routine()), u)));
        const top = Math.max(...ws);
        const wkName = splitWeek(routine().weekShort[pw])[0];
        return { max, rec: { value: top, base: top, pct: 0, mode: "reps", goal: "Mismo peso, más reps", setWeights: ws,
          text: `Mismos pesos que en ${wkName} (${ws.map(fmt).join(" · ")} ${u}); sumá reps en cada serie` } };
      }
      return { max, rec: null };
    }
    const r = routine();
    const k = G.slotKey(day.key, idx, w);
    const records = recordsOf(name);
    const others = records.filter((x) => !(x.cycle === S.cycle && x.key === k));
    const prev = inUnit(G.prevWeight(S.data, day.key, idx, w, ex, r.unitDefault), u);
    const lastS1 = inUnit(G.lastCycleS1(others, S.cycle), u);
    // la misma semana en el último ciclo anterior en que se hizo (S3 contra S3)
    const sameWeek = others.filter((x) => x.week === w && x.cycle < S.cycle && x.weight > 0).sort((a, b) => b.cycle - a.cycle)[0];
    const lastSame = sameWeek ? inUnit(sameWeek, u) : null;
    let lastS1Target = null;
    if (lastS1) {
      const p = G.parseSlotKey(lastS1.key) || {}, lr = S.routines[lastS1.cycle];
      const ld = lr && lr.days.find((d) => d.key === p.day);
      lastS1Target = lastS1.target || (ld && ld.exercises[p.idx] ? ld.exercises[p.idx].targets[0] : null);
    }
    return {
      max: inUnit(G.findMax(records), u),
      rec: G.recommend({
        target: ex.targets[w], prevTarget: prev ? ex.targets[prev.week] : null, week: w, prev, fixedLoad: !!ex.fixedLoad,
        prevRec: prev ? S.data[G.slotKey(day.key, idx, prev.week)] : null,
        lastS1, lastS1Target, lastSame, max: inUnit(G.findMax(others), u), unit: u, weekShort: r.weekShort,
        scale: scaleOf(ex, name, u), slow: G.isSlowLift(name),
      }),
    };
  }

  // ---------- Render principal ----------

  let FX = {};   // efectos del render en curso: { view, opened, done, pr } (se consumen en cada render)
  let FXS = {};  // efectos de la hoja en curso: { tabFrom, pane } (se consumen en cada renderSheet)

  function render() {
    FX = S.fx; S.fx = {};
    const ringBefore = readRing();
    const chip = $("#cycleChip");
    const r = routine();
    chip.hidden = !r;
    chip.textContent = r ? `Ciclo ${r.cycle}` : "";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
    const root = $("#root");
    root.innerHTML = S.tab === "rutina" ? renderRutina() : renderHistorial();
    // las notas largas se ven completas al reabrir la tarjeta (crecen hasta ~10 líneas y después hay scroll)
    root.querySelectorAll(".note-input").forEach((ta) => { if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight + 2, 240)}px`; });
    root.classList.toggle("fx-view", !!FX.view);
    if (FX.view) [...root.children].forEach((el, i) => el.style.setProperty("--i", i));
    renderSheet();
    afterRender(ringBefore);
  }

  // ---------- Movimiento ----------
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Cambio de pantalla con View Transitions (Safari 18 / Chrome): la pastilla de la semana y el día se deslizan,
  // el contenido entra desde el costado y, al abrir una tarjeta, las de abajo se acomodan. Sin soporte o con
  // "reducir movimiento": cambio directo (con la entrada suave de siempre si fallbackFx).
  function navigate(kind, update, fallbackFx) {
    if (!document.startViewTransition || reducedMotion()) { if (fallbackFx) S.fx.view = true; update(); return; }
    const html = document.documentElement;
    html.dataset.vt = kind;
    const t = document.startViewTransition(update);
    t.finished.finally(() => { if (html.dataset.vt === kind) delete html.dataset.vt; });
  }

  // Anillo del día: id del día que muestra, cuánto marca y cuántos listos.
  function readRing() {
    const ring = document.querySelector(".hero .ring");
    if (!ring) return null;
    const bar = ring.querySelector(".bar");
    return { id: ring.dataset.id, off: parseFloat(bar.style.strokeDashoffset), done: Number(ring.dataset.done), n: Number(ring.dataset.n) };
  }

  function afterRender(before) {
    if (reducedMotion()) return;
    const now = readRing();
    if (before && now && before.id === now.id && before.off !== now.off) {
      // el anillo avanza (o retrocede) desde donde estaba, y el número hace un salto
      const bar = document.querySelector(".hero .ring .bar");
      bar.style.transition = "none"; bar.style.strokeDashoffset = before.off;
      bar.getBoundingClientRect();
      bar.style.transition = ""; bar.style.strokeDashoffset = now.off;
      document.querySelector(".hero .ring-txt").classList.add("fx-bump");
      // día completo: confeti sobre la tarjeta del día
      if (now.n > 0 && now.done === now.n && before.done < now.n) {
        burst(document.querySelector(".hero"), ["#FFFFFF", "#9CCDEB", "#5FA8D3", "#E0BD4A", "#7FD1A8"], 34);
        // después del aviso de la acción ("Completado ✓"), que se muestra apenas termina el render
        setTimeout(() => toast("¡Día completo! 🎉"), 0);
      }
    }
    // récord nuevo: confeti dorado desde el check de esa tarjeta
    if (FX.pr) {
      const card = document.querySelector(`[data-card="${FX.pr}"] .done-btn`) || document.querySelector(`[data-card="${FX.pr}"]`);
      if (card) burst(card, ["#E0BD4A", "#F2D06B", "#B8901C", "#FFF3C4"], 26);
    }
  }

  // Confeti liviano (sin librerías): partículas con trayectoria al azar que caen y se desvanecen.
  function burst(el, colors, count) {
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "confetti";
    layer.style.left = `${r.left + r.width / 2}px`;
    layer.style.top = `${r.top + Math.min(r.height / 2, 60)}px`;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("i");
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
      p.style.setProperty("--x", `${Math.cos(a) * d}px`);
      p.style.setProperty("--y", `${Math.sin(a) * d * 0.7 - 40}px`);
      p.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.setProperty("--d", `${Math.round(Math.random() * 120)}ms`);
      p.style.background = colors[i % colors.length];
      if (i % 3 === 0) p.classList.add("round");
      layer.append(p);
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 1600);
  }

  function renderEmpty() {
    return `<div class="empty">
      <div class="empty-ic">${icon("layers")}</div>
      <h2>${S.hist && S.hist.cycles.length ? "Ciclo cerrado" : "Sin rutina"}</h2>
      <p>${S.hist && S.hist.cycles.length ? "Tu historial está guardado. " : ""}No hay ninguna rutina cargada. Se carga sola desde <code>${ROUTINE_URL}</code> cuando hay conexión, o podés importarla desde Ajustes.</p>
      <button class="secondary-btn open-settings-btn" data-action="open-settings">${icon("gear")}Abrir ajustes</button>
    </div>`;
  }

  // En el celular, Safari y la app anclada al inicio guardan datos por separado: avisar si no es la app anclada.
  function isStandalone() {
    return navigator.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  }
  function browserNag() {
    const mobile = navigator.maxTouchPoints > 0 || /iPhone|iPad|Android/i.test(navigator.userAgent);
    if (!mobile || isStandalone()) return "";
    return `<div class="banner inline warn">${icon("info")}<span><b>Estás en el navegador.</b> Lo que cargues acá no aparece en la app anclada al inicio (y al revés). Usá siempre la app del ícono.</span></div>`;
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
    const doneOf = (d) => d.exercises.filter((_, i) => { const r = S.data[G.slotKey(d.key, i, S.week)]; return r && (r.completed || r.skipped); }).length;
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
    return `${browserNag()}${backupNag()}
      <div class="seg weeks" role="tablist" aria-label="Semana">${weeks}</div>
      <div class="days" role="tablist" aria-label="Día">${days}</div>
      <section class="hero ${day.type}${st ? " skipped" : ""}">
        <div class="hero-top">
          <div class="hero-text">
            <div class="eyebrow">${esc(day.dayName)} · ${esc(r.weeks[S.week])}</div>
            <h1 class="hero-title">${esc(main)}</h1>
            ${sub ? `<div class="hero-sub">${esc(sub)}</div>` : ""}
          </div>
          <div class="ring" role="img" aria-label="${done} de ${n} completados" data-id="${S.cycle}|${S.week}|${S.day}" data-done="${done}" data-n="${n}">
            <svg viewBox="0 0 72 72"><circle class="track" cx="36" cy="36" r="30"/>
              <circle class="bar" cx="36" cy="36" r="30" style="--c:${C.toFixed(1)};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/></svg>
            <div class="ring-txt"><div><b>${done}/${n}</b><span>listos</span></div></div>
          </div>
        </div>
        <div class="hero-actions">${dateChip}${!st && !S.skipOpen ? `<button class="hero-chip skip-btn" data-action="open-skip">${icon("ban")}No pude hacerlo</button>` : ""}</div>
        ${skipUI}
        ${day.warmup ? `<details class="warmup"><summary>${icon("flame")}Activación${chev}</summary><p>${esc(day.warmup)}</p></details>` : ""}
      </section>
      <div class="section-head"><h2>Ejercicios</h2><span>${day.type === "lower" ? "Tren inferior" : "Tren superior"} · ${n}</span></div>
      <ol class="ex-list">${day.exercises.map((ex, i) => renderCard(day, ex, i)).join("")}</ol>`;
  }

  function weightLine(rec) {
    const w = rec ? G.parseNum(rec.weight) : NaN;
    if (!(w > 0)) return "";
    const u = G.recUnit(rec, routine());
    if (Array.isArray(rec.setWeights) && rec.setWeights.length)
      return `<span class="ex-weight"><span class="ex-val"><b>${fmt(w)}</b> ${u}</span><span class="side sets">series: ${rec.setWeights.map((x) => fmt(G.parseNum(x) || 0)).join(" · ")}</span></span>`;
    const side = rec.weightMode === "perSide" && rec.perSideDisplay != null ? `${fmt(rec.perSideDisplay)}/lado · ` : "";
    if (G.dbCountOf(rec) === 2)
      return `<span class="ex-weight"><span class="ex-val"><b>${fmt(w)}</b> ${u} c/u</span><span class="side"> · total ${fmt(w * 2)} ${u}</span></span>`;
    return `<span class="ex-weight"><span class="ex-val"><b>${fmt(w)}</b> ${u}</span><span class="side"> · ${side}${convTxt(w, u)}</span></span>`;
  }

  function recBadge(rec, u) {
    if (!rec) return "";
    const cls = rec.mode === "deload" ? "down" : rec.mode === "reps" ? "reps" : rec.mode === "calibrate" ? "cal" : rec.value > rec.base ? "up" : "flat";
    const pct = rec.mode !== "calibrate" && rec.pct ? pctTxt(rec.pct) : "";
    return `<span class="ex-sug ${cls}"><span class="ex-val"><b>${fmt(rec.value)}</b> ${u}</span>${rec.setWeights ? `<span class="side sets">series: ${rec.setWeights.map(fmt).join(" · ")}</span>` : ""} ${pct ? `<em>${icon(dirIcon(rec))}${pct}</em><span class="sep"> · </span>` : ""}<span class="goal-s">${esc(SHORT_GOAL[rec.goal] || rec.goal)}</span></span>`;
  }

  function draftFor(k, rec, sets) {
    if (!S.drafts[k]) {
      const p = G.parseSlotKey(k);
      const unit = cardUnit(p.day, p.idx, k, rec);
      const eq = G.EQUIP[equipOf(exDef(p.day, p.idx), slotNameOf(p.day, p.idx, p.week))];
      rec = rec || {};
      S.drafts[k] = {
        unit,
        weight: rec.weight || "",
        weightMode: rec.weightMode || "total",
        perSideDisplay: rec.perSideDisplay ?? null,
        note: rec.note || "",
        reps: Array.from({ length: sets }, (_, i) => (rec.reps && rec.reps[i]) || ""),
        repsSame: (rec.reps || []).some((x) => String(x).trim() !== "") ? !!rec.repsSame : true,
        repsSameValue: rec.repsSameValue || "",
        setWeights: Array.from({ length: sets }, (_, i) => (rec.setWeights && rec.setWeights[i]) || ""),
        calcOpen: false,
        calcBar: (eq && eq.bar) || "women",
        calcCustom: "",
        calcMode: "perSide",
        rpe: rec.rpe != null ? String(rec.rpe) : "",
        dbCount: G.dbCountOf(rec) || lastDbCount(slotNameOf(p.day, p.idx, p.week)),
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
    const altUsed = !!(rec && rec.altUsed && G.alts(ex).length);
    const done = !!(rec && rec.completed);
    const u = cardUnit(day.key, idx, k, rec);
    const info = recFor(day, ex, idx, w, name, u);
    const tagTxt = altUsed ? "alternativa" : name !== ex.name ? "editado" : "";
    const repsTxt = G.repsText(rec);
    const saved = weightLine(rec);
    // Fila compacta (pedido 23/11/2026): de un vistazo, qué toca hoy, el peso sugerido (o lo registrado) y el máximo.
    // Todo lo demás (registro, cómo se hace, historial) está en la hoja de detalle que se abre al tocar la fila.
    const side = rec && rec.skipped
      ? `<span class="cs cs-skip"><span class="cs-lbl">No hecho</span><span class="cs-val">${esc(rec.skipReason || "Sin motivo")}</span></span>`
      : saved || (rec && (rec.completed || repsTxt))
      ? `<span class="cs cs-reg"><span class="cs-lbl sr-only">Registrado</span>${saved || `<span class="cs-val">${repsTxt ? esc(repsTxt) : "Hecho"}</span>`}${saved && repsTxt ? `<span class="cs-sub"><span class="sr-only">reps </span>${esc(repsTxt)}</span>` : ""}</span>`
      : info && info.rec
        ? `<span class="cs cs-sug"><span class="cs-lbl sr-only">Sugerido</span>${recBadge(info.rec, u)}</span>`
        : `<span class="cs"><span class="cs-val none">${ex.noWeight ? "Sin peso" : "Calibrá"}</span></span>`;
    const best = info && info.max;
    const maxTxt = best ? `<span class="row-max"><span class="sr-only">Récord </span><span class="ex-max">${icon("trophy")}${fmt(best.weight)}${best.topReps ? `<small>×${best.topReps}</small>` : ""}</span></span>`
      : ex.noWeight ? "" : `<span class="row-max none">Sin récord</span>`;
    const cls = `card row ${day.type}${done ? " done" : ""}${rec && rec.skipped ? " skipped" : ""}${FX.done === k ? " fx-done" : ""}${FX.pr === k ? " fx-pr" : ""}${FX.saved === k ? " fx-saved" : ""}`;
    return `<li class="${cls}" style="--i:${idx}" data-card="${k}">
        <button class="done-btn${FX.done === k ? " fx-pop" : ""}" data-action="toggle-done" data-k="${k}" aria-pressed="${done}" aria-label="${done ? "Completado" : "Marcar como completado"}">${icon("check")}</button>
        <button class="card-head row-head" data-action="open-ex" data-idx="${idx}" aria-label="Abrir ${esc(name)}">
          <span class="row-main">
            <span class="ex-name">${esc(name)}${tagTxt ? ` <span class="edited">· ${tagTxt}</span>` : ""}</span>
            <span class="row-meta"><span class="ex-target">${esc(prettyTarget(ex.targets[w]))}</span><span class="ex-rest">${icon("clock")}${esc(ex.rest)}</span></span>
          </span>
          <span class="row-side">${side}${maxTxt}</span>
          ${icon("chevron").replace('class="ic"', 'class="ic row-chev"')}
        </button>
      </li>`;
  }

  // ---------- Hoja de detalle del ejercicio: Registrar · Cómo se hace · Historial ----------
  const EX_TABS = [["reg", "Registrar"], ["how", "Cómo se hace"], ["hist", "Historial"]];

  function renderExSheet() {
    const r = routine(), day = currentDay();
    const idx = S.exIdx, ex = r && day && day.exercises[idx];
    if (!ex) { S.sheet = false; return ""; }
    const w = S.week, k = G.slotKey(day.key, idx, w);
    const rec = S.data[k] || null;
    const name = G.slotName(S.data, day.key, idx, ex, w);
    const u = cardUnit(day.key, idx, k, rec);
    const info = recFor(day, ex, idx, w, name, u);
    const proto = G.slotProtocol(rec, ex);
    const ti = Math.max(0, EX_TABS.findIndex(([id]) => id === S.exTab));
    const from = FXS.tabFrom != null ? FXS.tabFrom : ti;
    const pane = S.exTab === "how" ? renderExHow(ex, name, proto)
      : S.exTab === "hist" ? renderExHist(ex, name, k, info)
      : renderCardBody(day, ex, idx, k, rec, name, info);
    return `<div class="ex-sheet ${day.type}" data-ex="${k}">
      <div class="sheet-drag">
        <div class="sheet-grabber"></div>
        <div class="ex-sheet-head">
          <div class="ex-sheet-title">
            <div class="eyebrow">${esc(ex.pattern || (day.type === "upper" ? "Tren superior" : "Pierna"))}</div>
            <h2>${esc(name)}</h2>
            <div class="ex-sheet-meta"><span class="ex-chip today">${esc(prettyTarget(ex.targets[w]))}</span><span class="ex-chip">${icon("clock")}${esc(ex.rest)}</span>${rec && rec.completed ? `<span class="ex-chip ok">${icon("check")}Listo</span>` : ""}</div>
          </div>
          <button class="icon-btn close-settings-btn" data-action="close-settings" aria-label="Cerrar">${icon("x")}</button>
        </div>
      </div>
      <div class="ex-tabs" role="tablist" aria-label="Detalle del ejercicio" style="--t:${from}" data-to="${ti}">
        <span class="ex-tab-ind" aria-hidden="true"></span>
        ${EX_TABS.map(([id, label]) => `<button class="ex-tab${S.exTab === id ? " active" : ""}" role="tab" aria-selected="${S.exTab === id}" data-action="ex-tab" data-tab="${id}">${label}</button>`).join("")}
      </div>
      <div class="ex-pane ${S.exTab}${FXS.pane ? ` fx-pane ${FXS.pane}` : ""}">${pane}</div>
    </div>`;
  }

  // "Cómo se hace": protocolo del ciclo + pasos (campos opcionales `how` y `avoid` de la rutina) + alternativas.
  function renderExHow(ex, name, proto) {
    const steps = Array.isArray(ex.how) ? ex.how.filter((x) => String(x).trim()) : [];
    const alts = G.alts(ex);
    return `${proto ? `<div class="how-card proto">${icon("pause")}<div><span class="how-lbl">En este ciclo</span><p>${esc(proto)}</p></div></div>` : ""}
      ${steps.length ? `<div class="how-card"><span class="how-lbl">Paso a paso</span>
          <ol class="how-steps">${steps.map((s, i) => `<li style="--i:${i}"><span class="how-n">${i + 1}</span><span>${esc(s)}</span></li>`).join("")}</ol></div>`
        : `<div class="how-card muted-card">${icon("info")}<p>Todavía no hay pasos cargados para este ejercicio.</p></div>`}
      ${ex.avoid ? `<div class="how-card avoid">${icon("ban")}<div><span class="how-lbl">Evitá</span><p>${esc(ex.avoid)}</p></div></div>` : ""}
      ${alts.length ? `<div class="how-card"><span class="how-lbl">Si está ocupado</span>${alts.map((a) => `<p class="how-alt">${icon("swap")}${esc(a)}</p>`).join("")}
          <p class="how-hint">Para usarla, en Registrar → Alternativa.</p></div>` : ""}`;
  }

  // "Historial": máximo, gráfico y últimas sesiones; el detalle completo sigue en la pestaña Historial.
  function renderExHist(ex, name, k, info) {
    const e = histIndex().find((x) => x.key === G.normName(name));
    if (!e || !e.records.some((r) => r.weight > 0)) {
      return `<div class="how-card muted-card">${icon("chart")}<p>Todavía no hay registros de <b>${esc(name)}</b>. Cuando guardes la primera sesión, acá vas a ver tu progresión.</p></div>`;
    }
    const m = e.max;
    const last = [...e.records].filter((r) => r.weight > 0).sort(G.chrono).reverse().slice(0, 4);
    return `<div class="how-card hist-max">
        <span class="how-lbl">${icon("trophy")}Máximo</span>
        <span class="hist-max-val num">${fmt(m.weight)} <small>${m.unit}${m.dbCount === 2 ? " c/u" : ""}</small>${m.topReps ? ` <span>× ${m.topReps}</span>` : ""}</span>
        <span class="hist-max-sub">${fmtDate(m.date, { day: "numeric", month: "short", year: "numeric" })} · Ciclo ${m.cycle} · ${esc(splitWeek(m.weekShort || `S${m.week + 1}`)[0])}</span>
      </div>
      ${renderProgress(e)}
      <div class="how-card"><span class="how-lbl">Últimas sesiones</span>
        <ul class="mini-sess">${last.map((r) => `<li><span>${fmtDate(r.date, { day: "numeric", month: "short" })} <small>· C${r.cycle} ${esc(splitWeek(r.weekShort || `S${r.week + 1}`)[0])}</small></span><b class="num">${fmt(r.weight)} ${r.unit}${r.dbCount === 2 ? " c/u" : ""}</b><span class="mini-reps">${esc(r.reps) || "—"}</span></li>`).join("")}</ul>
      </div>
      <button class="link-row ex-hist-btn" data-action="ex-history" data-k="${k}">${icon("chart")}<span>Ver historial completo</span>${icon("chevron")}</button>`;
  }

  function renderCardBody(day, ex, idx, k, rec, name, info) {
    const w = S.week;
    const sets = ex.sets[w];
    const d = draftFor(k, rec, sets);
    const u = d.unit;
    const baseName = G.effectiveName(S.data, day.key, idx, ex);
    const altUsed = !!(rec && rec.altUsed && G.alts(ex).length);
    const altList = G.alts(ex).map((name, i) => ({ name, i })).filter((a) => G.normName(a.name) !== G.normName(baseName));
    const showAlt = altList.length > 0;
    const overridden = baseName !== ex.name;
    const sug = info && info.rec;

    const insight = ex.noWeight ? "" : sug
      ? `<div class="insight ${sug.mode}">
          <p class="why">${icon("info")}<span><b>${esc(sug.goal)}.</b> ${esc(sug.text)}</span></p>
          ${sug.record ? `<p class="rec-note">${icon("trophy")}<span>${esc(sug.record)}</span></p>` : ""}
          <button class="use-sug-btn" data-action="use-suggestion" data-k="${k}" data-value="${sug.value}"${sug.setWeights ? ` data-setweights="${sug.setWeights.join(",")}"` : ""}>Usar ${sug.setWeights ? sug.setWeights.map(fmt).join(" · ") : fmt(sug.value)} ${u}</button>
        </div>`
      : `<div class="insight none"><p class="why">${icon("info")}<span>Sin registros de este ejercicio: elegí un peso que te deje en el RPE pedido y ajustá con la 1ª serie.</span></p></div>`;
    const altBox = !(d.altOpen && showAlt) ? "" : altUsed
      ? `<div class="alt-box"><b>Esta semana hacés la alternativa</b>${esc(name)}
          <div class="row-btns"><button class="chip-btn undo-alt-btn" data-action="undo-alt" data-k="${k}">Volver a ${esc(baseName)}</button></div></div>`
      : `<div class="alt-box"><b>${altList.length > 1 ? "Alternativas" : "Alternativa"}</b>${altList.map((a) => `<div class="alt-opt">
          <div class="alt-name">${esc(a.name)}</div>
          <div class="row-btns">
            <button class="chip-btn solid use-alt-btn" data-action="use-alt" data-i="${a.i}" data-k="${k}">Usar esta semana</button>
            <button class="chip-btn use-alt-cycle-btn" data-action="use-alt-cycle" data-i="${a.i}" data-k="${k}">Usar en todo el ciclo</button>
          </div></div>`).join("")}</div>`;

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
      <div class="tools">
        ${showAlt ? `<button class="tool-btn alt-btn${d.altOpen || altUsed ? " on" : ""}" data-action="toggle-alt" data-k="${k}">${icon("swap")}${altUsed ? "Usando alt." : "Alternativa"}</button>` : ""}
        <button class="tool-btn edit-btn${d.editOpen ? " on" : ""}" data-action="toggle-edit" data-k="${k}">${icon("pencil")}Renombrar</button>
        ${rec && rec.skipped ? "" : `<button class="tool-btn skip-ex-btn${d.skipOpen ? " on" : ""}" data-action="toggle-skip-ex" data-k="${k}">${icon("ban")}No lo hice</button>`}
      </div>
      ${altBox}
      ${editBox}
      ${rec && rec.skipped ? `<div class="alt-box skip-ex-state">${icon("ban")}<span><b>No hecho</b>${esc(rec.skipReason || "Sin motivo")}</span>
          <button class="chip-btn undo-skip-ex-btn" data-action="undo-skip-ex" data-k="${k}">Deshacer</button></div>`
        : d.skipOpen ? `<div class="alt-box skip-ex-box"><b>¿Por qué no lo hiciste?</b>
          <div class="skip-chips">${EX_SKIP_REASONS.map((x) => `<button class="chip-btn skip-ex-chip${d.skipReason === x ? " on" : ""}" data-action="skip-ex-reason" data-reason="${x}" data-k="${k}">${x}</button>`).join("")}</div>
          <input class="text-input skip-ex-input" data-skipex="reason" data-k="${k}" value="${esc(d.skipReason || "")}" placeholder="Motivo (opcional)" aria-label="Motivo">
          <div class="row-btns"><button class="chip-btn solid save-skip-ex-btn" data-action="save-skip-ex" data-k="${k}">Marcar como no hecho</button>
            <button class="chip-btn" data-action="toggle-skip-ex" data-k="${k}">Cancelar</button></div></div>` : ""}
      ${ex.perSetWeight ? renderSetRows(ex, k, d, sets, u, unitSeg) : `<div class="reg">
        <div class="reg-title">Registro de hoy</div>
        ${ex.noWeight ? "" : renderEquipRow(ex, name, k)}
        <div class="reg-row weight-row">
          <span class="reg-label">Peso${ex.noWeight ? "<small>opcional</small>" : isDumbbell(ex, name) ? "<small>de una mancuerna</small>" : ""}</span>
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
            ${ex.noWeight ? "" : `<button class="calc-toggle-btn${d.calcOpen ? " on" : ""}" data-action="toggle-calc" data-k="${k}" aria-label="${d.calcOpen ? "Cerrar calculadora de barra" : "Calculadora de barra"}" title="Calculadora de barra">${icon("calc")}</button>`}
          </div>
        </div>
        <div class="reg-sub">${hints}</div>
        ${!ex.noWeight && isDumbbell(ex, name) ? `<div class="reg-row sets-ctrls db-row"><span class="ctrl-lbl">Mancuernas</span><div class="seg mini db-seg" role="group" aria-label="Cantidad de mancuernas">${[1, 2].map((n) =>
          `<button class="seg-btn db-count-btn${d.dbCount === n ? " active" : ""}" data-action="set-dbcount" data-n="${n}" data-k="${k}">${n}</button>`).join("")}</div>
          <span class="db-total" data-dbtotal="${k}">${esc(dbTotalTxt(d))}</span></div>` : ""}
        ${!ex.noWeight && u === "lb" && usesPlates(ex, name) ? `<div class="reg-row sets-ctrls ex-plates-row"><span class="ctrl-lbl">Barra</span><div class="seg mini bar-toggle" role="group" aria-label="Barra">${(equipOf(ex, name) === "plates" ? [["none", "Sin barra"], ["women", "35"], ["men", "45"]] : [["women", "35 lb"], ["men", "45 lb"]]).map(([v, l]) =>
          `<button class="seg-btn calc-bar-btn${d.calcBar === v ? " active" : ""}" data-action="calc-bar" data-bar="${v}" data-k="${k}">${l}</button>`).join("")}</div></div>
        <div class="plate-hint ex-plate-hint" data-plates="${k}-w">${esc(exPlatesTxt(d))}</div>` : ""}
        ${d.calcOpen && !ex.noWeight ? renderCalc(k, d) : ""}
        <div class="reg-row reps-row">
          <span class="reg-label">Reps
            <label class="switch mini">Iguales<input type="checkbox" class="reps-same-check" data-field="repsSame" data-k="${k}"${d.repsSame ? " checked" : ""}></label></span>
          <div class="reg-ctrl reps-ctrl">${repsInputs}</div>
        </div>
        ${ex.noWeight ? "" : renderRpeRow(k, d)}
        <div class="reg-row note-row">
          <textarea class="text-input note-input" rows="1" data-field="note" data-k="${k}" placeholder="Nota (opcional)" aria-label="Nota: cómo se sintió, molestias, ajustes">${esc(d.note)}</textarea>
        </div>
      </div>`}
      <div class="save-row">
        <button class="secondary-btn save-entry-btn" data-action="save-entry" data-k="${k}">Solo guardar</button>
        <button class="primary-btn save-done-btn" data-action="save-entry" data-complete="1" data-k="${k}">${icon("check")}${rec && rec.completed ? "Guardar" : "Guardar y marcar listo"}</button>
      </div>
    </div>`;
  }

  // Equipo con el que se hace (cambia saltos, unidad y discos); útil sobre todo al usar una alternativa.
  function renderEquipRow(ex, name, k) {
    const cur = equipOf(ex, name) || "other";
    const opts = [...Object.entries(G.EQUIP).map(([v, e]) => [v, e.label]), ["other", "Otro"]];
    return `<div class="reg-row equip-row"><span class="ctrl-lbl">Equipo</span>
      <select class="equip-select" data-change="equip" data-k="${k}" aria-label="Equipo de este ejercicio">${opts.map(([v, l]) =>
        `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
  }
  // RPE real (opcional): cuánto costó de verdad. Afina la sugerencia de la semana siguiente.
  const RPES = ["6", "7", "8", "9", "10"];
  function renderRpeRow(k, d) {
    return `<div class="reg-row rpe-row"><span class="reg-label">¿Cómo se sintió?<small>RPE · opcional</small></span>
      <div class="seg mini rpe-seg" role="group" aria-label="RPE real">${RPES.map((v) =>
        `<button class="seg-btn rpe-btn${d.rpe === v ? " active" : ""}" data-action="set-rpe" data-v="${v}" data-k="${k}">${v}</button>`).join("")}</div></div>`;
  }

  // Peso por serie (pirámide): una fila por serie con su etiqueta, peso y reps.
  function renderSetRows(ex, k, d, sets, u, unitSeg) {
    const rows = Array.from({ length: sets }, (_, i) => `<div class="reg-row set-row">
        <span class="reg-label">${esc((ex.setLabels && ex.setLabels[i]) || `Serie ${i + 1}`)}<small>Serie ${i + 1} de ${sets}</small></span>
        <div class="reg-ctrl">
          <div class="weight-box"><input class="num-input set-weight-input" inputmode="decimal" data-field="setWeight" data-i="${i}" data-k="${k}" value="${esc(d.setWeights[i])}" placeholder="0" aria-label="Peso serie ${i + 1}"><span class="unit">${u}</span></div>
          <span class="reg-x">×</span>
          <input class="num-input rep-input" inputmode="numeric" data-field="rep" data-i="${i}" data-k="${k}" value="${esc(d.reps[i])}" placeholder="reps" aria-label="Reps serie ${i + 1}">
        </div></div>
        <div class="plate-hint" data-plates="${k}-${i}">${esc(plateTxt(d.setWeights[i], u, d.calcBar))}</div>`).join("");
    const barSeg = u === "lb" ? `<div class="seg mini bar-toggle" role="group" aria-label="Barra">${[["women", "35 lb"], ["men", "45 lb"]].map(([v, l]) =>
      `<button class="seg-btn calc-bar-btn${d.calcBar === v ? " active" : ""}" data-action="calc-bar" data-bar="${v}" data-k="${k}">${l}</button>`).join("")}</div>` : "";
    return `<div class="reg reg-sets">
        <div class="reg-title">Peso total por serie (con la barra)</div>
        <div class="reg-row sets-ctrls">${barSeg ? `<span class="ctrl-lbl">Barra</span>${barSeg}` : ""}<span class="ctrl-lbl">Unidad</span>${unitSeg}</div>
        ${rows}
        <div class="reg-row note-row">
          <textarea class="text-input note-input" rows="1" data-field="note" data-k="${k}" placeholder="Nota (opcional)" aria-label="Nota: cómo se sintió, molestias, ajustes">${esc(d.note)}</textarea>
        </div>
      </div>`;
  }

  // Calculadora suelta (botón del encabezado): mismo formulario, sin ejercicio ni "Usar este peso".
  const draftOf = (k) => (k === "tool" ? S.calcTool : S.drafts[k]);
  const rerender = (k) => (k === "tool" ? renderSheet() : render());

  function renderCalcTool() {
    const d = S.calcTool;
    return `${sheetHead("Calculadora de discos")}
      <p class="note">Poné los discos de un lado y te da el total, o poné el total y te dice qué discos van de cada lado.</p>
      <div class="seg small calc-unit-seg">${[["lb", "lb"], ["kg", "kg"]].map(([v, l]) =>
        `<button class="seg-btn calc-unit-btn${d.unit === v ? " active" : ""}" data-action="calc-unit" data-unit="${v}">${l}</button>`).join("")}</div>
      ${renderCalc("tool", d, false)}`;
  }

  function renderCalc(k, d, withUse = true) {
    const u = d.unit;
    const bars = [["women", `Mujer ${G.BARS.women[u]}`], ["men", `Hombre ${G.BARS.men[u]}`], ["custom", "Otra"]];
    const modes = [["perSide", "Por lado"], ["total", "Total"]];
    return `<div class="calc">
      <div class="seg small">${bars.map(([v, l]) =>
        `<button class="seg-btn calc-bar-btn${d.calcBar === v ? " active" : ""}" data-action="calc-bar" data-bar="${v}" data-k="${k}">${l}</button>`).join("")}</div>
      ${d.calcBar === "custom" ? `<input class="num-input calc-custom-input" inputmode="decimal" data-field="calcCustom" data-k="${k}" value="${esc(d.calcCustom)}" placeholder="Peso de la barra (${u}) · 0 si es máquina">` : ""}
      <div class="seg small">${modes.map(([v, l]) =>
        `<button class="seg-btn calc-mode-btn${d.calcMode === v ? " active" : ""}" data-action="calc-mode" data-mode="${v}" data-k="${k}">${l}</button>`).join("")}</div>
      <input class="num-input calc-value-input" inputmode="decimal" data-field="calcValue" data-k="${k}" value="${esc(d.calcValue)}" placeholder="${d.calcMode === "perSide" ? "Discos por lado" : "Peso total"} (${u})">
      <div class="calc-result" data-calc-result="${k}">${esc(calcResultText(d))}</div>
      ${withUse ? `<button class="secondary-btn use-calc-btn" data-action="use-calc" data-k="${k}">Usar este peso</button>` : ""}
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
    const plates = plateTxt(res.total, d.unit, d.calcBar, d.calcCustom);
    if (d.calcMode === "perSide") return `Total: ${fmt(res.total)} ${d.unit}${plates ? ` · ${plates.replace(/^Por lado [\d,.]+ → /, "discos: ")}` : ""}`;
    return res.perSide < 0 ? "El total es menor que la barra" : `Por lado: ${fmt(res.perSide)} ${d.unit}${plates ? ` · ${plates.replace(/^Por lado [\d,.]+ → /, "discos: ")}` : ""}`;
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
    // Como los contactos: orden alfabético agrupado por letra; cada letra queda fija arriba mientras se recorre su grupo.
    const letterOf = (e) => { const c = G.normName(e.name).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
    const groups = new Map();
    for (const e of [...list].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))) {
      const k = letterOf(e);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return [...groups.keys()].map((k) => `<section class="hist-group"><div class="hist-sec">${esc(k)}</div>
      <ul class="hist-ul">${groups.get(k).map((e) => {
      const m = e.max;
      // sin día: en el historial un ejercicio puede haberse hecho en distintos días según el ciclo
      const sub = e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna");
      const right = e.noWeight && !m
        ? `<span class="hl-none">${e.last ? fmtDate(e.last.date) : "Sin peso"}</span>`
        : m ? `<span class="hl-max"><b>${fmt(m.weight)}</b> ${m.unit}${m.dbCount === 2 ? " c/u" : ""}${m.topReps ? ` × ${m.topReps}` : ""}</span><span class="hl-date">${fmtDate(m.date)}</span>`
          : `<span class="hl-none">Sin registros</span>`;
      return `<li><button class="hist-item ${e.group}" data-action="hist-open" data-ex="${esc(e.key)}">
        <span class="hist-dot"></span>
        <span class="hl-info"><span class="ex-name">${esc(e.name)}</span><span class="hl-sub">${esc(sub)}</span></span>
        <span class="hl-right">${right}</span>${icon("chevron")}</button></li>`;
    }).join("")}</ul></section>`).join("");
  }

  function renderMergeList(e) {
    const q = G.normName(S.mergeQuery);
    const list = histIndex().filter((x) => x.key !== e.key && (!q || G.normName(x.name).includes(q)));
    if (!list.length) return `<li class="muted small merge-empty">No hay ejercicios que coincidan.</li>`;
    return list.map((x) => `<li><button class="list-row merge-target-btn" data-action="merge-into" data-name="${esc(x.name)}">
        <span class="grow">${esc(x.name)}<span class="sub">${x.max ? `Récord ${fmt(x.max.weight)} ${x.max.unit}${x.max.topReps ? ` × ${x.max.topReps}` : ""}` : "Sin registros"}</span></span></button></li>`).join("");
  }

  // Une dos ejercicios: lo que se llamaba "from" pasa a llamarse "to" en ciclos abiertos (override de nombre,
  // reversible con Renombrar → Restablecer) y en el historial de ciclos cerrados (guarda el nombre original).
  function mergeExercises(fromName, toName) {
    const from = G.normName(fromName);
    const now = new Date().toISOString();
    let slots = 0, sessions = 0;
    for (const c of Object.keys(S.routines)) {
      const r = S.routines[c], data = dataOf(c);
      let touched = false;
      r.days.forEach((d) => d.exercises.forEach((ex, idx) => {
        if (G.normName(G.effectiveName(data, d.key, idx, ex)) !== from) return;
        data[G.ovrKey(d.key, idx)] = { name: G.normName(toName) === G.normName(ex.name) ? null : toName, savedAt: now, mergedFrom: fromName };
        touched = true; slots++;
      }));
      if (touched) { if (Number(c) === S.cycle) saveData(); else store.set(G.dataKey(c), data); }
    }
    if (S.hist) {
      for (const x of S.hist.sessions) {
        if (G.normName(x.exercise) !== from) continue;
        x.originalExercise = x.originalExercise || x.exercise;
        x.exercise = toName; sessions++;
      }
      if (sessions) store.set(KEYS.history, S.hist);
    }
    S.drafts = {};
    return { slots, sessions };
  }

  // Progresión: el peso de cada sesión en el tiempo (una sola serie, sin leyenda; el título la nombra).
  // Récord = punto lleno grande · descarga (S4) = punto hueco, para que no parezca un retroceso.
  // Tocar un punto muestra su detalle debajo; las sesiones de abajo son la tabla completa.
  function renderProgress(e) {
    const pts = [...e.records].filter((r) => r.weight > 0).sort(G.chrono);
    if (pts.length < 2) return "";
    const unit = (e.max && e.max.unit) || pts[pts.length - 1].unit || "lb";
    const prs = new Set(G.prHistory(e.records).map((r) => `${r.cycle}|${r.key}`));
    const vals = pts.map((r) => G.round1(G.convert(r.weight, r.unit || "lb", unit)));
    const W = 340, H = 156, L = 34, R = 12, T = 14, B = 24;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || Math.max(hi * 0.2, 1);
    lo = Math.max(0, lo - span * 0.2); hi += span * 0.2;
    const x = (i) => L + (W - L - R) * (i / (pts.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
    const grid = ticks.map((v) => `<line class="pg-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="pg-tick" x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join("");
    // separador y etiqueta de cada ciclo, en su primera sesión
    const cycles = pts.map((r, i) => (i === 0 || r.cycle !== pts[i - 1].cycle ? i : -1)).filter((i) => i >= 0).map((i) =>
      `${i > 0 ? `<line class="pg-sep" x1="${(x(i) - (x(i) - x(i - 1)) / 2).toFixed(1)}" x2="${(x(i) - (x(i) - x(i - 1)) / 2).toFixed(1)}" y1="${T}" y2="${H - B}"/>` : ""}
      <text class="pg-cyc" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "middle"}">Ciclo ${pts[i].cycle}</text>`).join("");
    const line = pts.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(" ");
    const cap = (r, i) => `${fmt(vals[i])} ${unit}${r.dbCount === 2 ? " c/u" : ""}${r.topReps ? ` × ${r.topReps}` : ""} · Ciclo ${r.cycle} · ${splitWeek(r.weekShort || `S${r.week + 1}`)[0]}${r.date ? ` · ${fmtDate(r.date)}` : ""}${prs.has(`${r.cycle}|${r.key}`) ? " · récord" : r.week === 3 ? " · descarga" : ""}`;
    // al abrir, el detalle del último récord (o de la última sesión)
    const lastPr = pts.map((r, i) => i).filter((i) => prs.has(`${pts[i].cycle}|${pts[i].key}`)).pop();
    const first = lastPr != null ? lastPr : pts.length - 1;
    const dots = pts.map((r, i) => {
      const kind = prs.has(`${r.cycle}|${r.key}`) ? "is-pr" : r.week === 3 ? "is-deload" : "is-reg";
      return `<circle class="pg-dot ${kind}${i === first ? " sel" : ""}" style="--d:${Math.round((i / Math.max(1, pts.length - 1)) * 700)}ms" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="${kind === "is-pr" ? 5.5 : 4}"/>`;
    }).join("");
    const hits = pts.map((r, i) => `<circle class="pg-hit" data-action="pg-pt" data-i="${i}" data-cap="${esc(cap(r, i))}" cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="14"/>`).join("");
    return `<h2 class="section-title">Progresión <span class="muted">${unit}${pts.some((r) => r.dbCount === 2) ? " por mancuerna" : ""}</span></h2>
      <div class="progress ${e.type === "upper" ? "upper" : "lower"}">
        <svg class="pg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progresión de ${esc(e.name)}: peso de cada sesión">
          ${grid}${cycles}<path class="pg-line" pathLength="1" d="${line}"/>${dots}${hits}
        </svg>
        <div class="pg-legend"><span><i class="pg-k is-pr"></i>récord</span><span><i class="pg-k is-reg"></i>sesión</span><span><i class="pg-k is-deload"></i>descarga</span><span class="pg-hint">Tocá un punto</span></div>
        <div class="pg-cap">${esc(cap(pts[first], first))}</div>
      </div>`;
  }

  function renderHistDetail(e) {
    const prs = G.prHistory(e.records).reverse();
    const sessions = [...e.records].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : b.cycle - a.cycle || b.week - a.week));
    const m = e.max;
    const where = (r) => `Ciclo ${r.cycle} · ${esc(splitWeek(r.weekShort)[0])} · Día ${esc(r.day)}${r.protocol ? ` · ${esc(r.protocol)}` : ""}`;
    const prRows = prs.map((r, i) => {
      const before = prs[i + 1];
      const gain = before ? G.round1(r.weight - G.convert(before.weight, before.unit, r.unit)) : 0;
      const delta = before ? (G.cmpW(r) > G.cmpW(before) ? `+${fmt(gain)} ${r.unit}` : `+${r.topReps - before.topReps} reps`) : "Primera";
      return `<li class="pr-row${i === 0 ? " current" : ""}"><span class="pr-badge">${icon("trophy")}</span>
        <span class="pr-w num"><b>${fmt(r.weight)}</b> ${r.unit}${r.dbCount === 2 ? " c/u" : ""}${r.topReps ? ` × ${r.topReps}` : ""}</span>
        <span class="pr-delta">${i === 0 ? "Actual" : delta}</span>
        <span class="pr-meta">${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })} · ${where(r)}</span></li>`;
    }).join("");
    const sessRows = sessions.map((r) => `<li class="sess-row">
        <div class="sess-top">
          <span class="sess-when"><span class="sess-date">${fmtDate(r.date, { day: "numeric", month: "short" })}</span><span class="sess-where">${where(r)}${r.altUsed ? " · alternativa" : ""}</span></span>
          <span class="sess-w num"><b>${r.setWeights ? r.setWeights.map((x) => fmt(G.parseNum(x) || 0)).join("·") : fmt(r.weight)}</b> ${r.unit}${r.dbCount === 2 ? `<small class="db-sub"> c/u · total ${fmt(r.weight * 2)}</small>` : ""}</span><span class="sess-r num">${esc(r.reps) || "—"}</span>
          <span class="ok">${r.completed ? icon("check") : ""}</span></div>
        ${r.note ? `<div class="sess-note">${icon("note")}${esc(r.note)}</div>` : ""}</li>`).join("");
    return `<button class="back-btn hist-back-btn" data-action="hist-back">${icon("back")}${S.histReturn ? "Rutina" : "Historial"}</button>
      <div class="page-head"><div class="eyebrow">${esc(e.pattern || (e.type === "upper" ? "Tren superior" : "Pierna"))}</div>
        <h1 class="page-title detail">${esc(e.name)}</h1></div>
      ${S.mergeOpen ? `<div class="merge-box">
          <div class="merge-title">¿Con qué ejercicio es el mismo?</div>
          <p class="merge-hint">Todas las marcas de "${esc(e.name)}" pasan al que elijas y queda <b>ese</b> nombre.</p>
          <label class="search">${icon("search")}<input type="search" class="search-input merge-search" data-search="merge" value="${esc(S.mergeQuery)}" placeholder="Buscar ejercicio" aria-label="Buscar ejercicio" autocomplete="off"></label>
          <ul class="merge-list">${renderMergeList(e)}</ul>
          <button class="chip-btn merge-cancel-btn" data-action="merge-cancel">Cancelar</button>
        </div>`
        : `<button class="chip-btn merge-btn" data-action="merge-open">${icon("merge")}Unir con otro ejercicio</button>`}
      <div class="pr-hero">
        <span class="label">${icon("trophy")}Máximo actual</span>
        ${m ? `<span class="pr-hero-val num">${fmt(m.weight)} <small>${m.unit}</small>${m.topReps ? ` <span>× ${m.topReps}</span>` : ""}</span>
          <span class="sub">${m.dbCount === 2 ? `por mancuerna · total ${fmt(m.weight * 2)} ${m.unit}` : convTxt(m.weight, m.unit)} · ${fmtDate(m.date, { day: "numeric", month: "long", year: "numeric" })} · ${where(m)}</span>`
          : `<span class="pr-hero-val num none">—</span><span class="sub">Todavía no hay pesos registrados.</span>`}
      </div>
      ${renderProgress(e)}
      ${prs.length > 1 ? `<h2 class="section-title">Récords <span class="muted">del último hacia atrás</span></h2><ul class="pr-list">${prRows}</ul>` : ""}
      <h2 class="section-title">Sesiones <span class="muted">${sessions.length}</span></h2>
      ${sessions.length ? `<ul class="sess-list">${sessRows}</ul>` : `<p class="muted small">Sin sesiones con peso.</p>`}`;
  }

  // ---------- Hojas: Ajustes y Glosario ----------

  function renderSheet() {
    const sheet = $("#sheet");
    if (!S.sheet) { sheet.hidden = true; sheet.innerHTML = ""; return; }
    FXS = S.fxs || {}; S.fxs = {};
    const isEx = S.sheet === "ex";
    const body = isEx ? renderExSheet() : S.sheet === "glossary" ? renderGlossary() : S.sheet === "calc" ? renderCalcTool() : renderSettings();
    if (!S.sheet) { sheet.hidden = true; sheet.innerHTML = ""; return; }
    sheet.hidden = false;
    const fx = S.sheetFx ? " fx-sheet" : "";
    S.sheetFx = false;
    const label = isEx ? "Detalle del ejercicio" : S.sheet === "glossary" ? "Glosario" : S.sheet === "calc" ? "Calculadora de discos" : "Ajustes";
    // la hoja del ejercicio conserva el scroll al re-renderizar (por ejemplo, al tocar − / +)
    const prevPanel = sheet.querySelector(".sheet-panel.ex");
    const keepScroll = isEx && prevPanel && !fx && !FXS.pane ? prevPanel.scrollTop : 0;
    sheet.innerHTML = `<div class="sheet-backdrop${fx}" data-action="close-settings"></div>
      <div class="sheet-panel${isEx ? " ex" : ""}${fx}" role="dialog" aria-label="${label}">
        ${isEx ? "" : '<div class="sheet-grabber sheet-drag"></div>'}${body}</div>`;
    if (keepScroll) sheet.querySelector(".sheet-panel").scrollTop = keepScroll;
    if (isEx) {
      // la píldora de la pestaña se desliza desde la anterior
      const tabs = sheet.querySelector(".ex-tabs");
      if (tabs && tabs.style.getPropertyValue("--t") !== tabs.dataset.to) {
        tabs.getBoundingClientRect();
        requestAnimationFrame(() => tabs.style.setProperty("--t", tabs.dataset.to));
      }
      sheet.querySelectorAll(".note-input").forEach((ta) => { if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight + 2, 240)}px`; });
    }
  }

  // Cierra la hoja: se desliza hacia abajo (View Transitions; sin soporte, se cierra directo).
  function closeSheet(after) {
    navigate("sheet-close", () => { S.sheet = false; renderSheet(); if (after) after(); });
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

  // Fecha local (no UTC): exportar a las 21:00 en Costa Rica ya es el día siguiente en UTC.
  const today = () => G.isoDate(new Date());

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
    if (b.prefs && b.prefs.equip && typeof b.prefs.equip === "object") { S.equip = b.prefs.equip; store.set(KEYS.equip, S.equip); }
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

  // ¿Hay reps anotadas? (en un registro o en un borrador; "todas iguales" usa un solo campo)
  function hasReps(x) {
    if (!x) return false;
    if (x.repsSame && String(x.repsSameValue || "").trim()) return true;
    return (x.reps || []).some((r) => String(r).trim() !== "");
  }

  // Abre la hoja de detalle de un ejercicio del día en la pestaña pedida.
  function openEx(idx, tab) {
    const was = S.sheet === "ex";
    S.sheet = "ex"; S.exIdx = idx; S.exTab = tab || "reg";
    if (!was) S.sheetFx = true;
    renderSheet();
  }

  function saveEntry(k, complete) {
    const { ex, week } = exFromKey(k);
    const sets = ex.sets[week];
    const d = S.drafts[k];
    const prev = S.data[k] || {};
    if (complete === true && !ex.noWeight && !hasReps(d)) { toast("Anotá las reps antes de marcarlo listo", "error"); return false; }
    if (ex.perSetWeight) return savePerSet(k, ex, sets, d, prev, complete);
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
      ...(d.rpe ? { rpe: Number(d.rpe) } : {}),
      ...(isDumbbell(ex, G.slotName(S.data, exFromKey(k).dayObj.key, exFromKey(k).idx, ex, week)) && d.dbCount ? { dbCount: d.dbCount } : {}),
      altUsed: !!prev.altUsed,
      ...(prev.altUsed ? { altIdx: prev.altIdx || 0 } : {}),
      unit: d.unit,
      savedAt: new Date().toISOString(),
    };
    if (!saveData()) return false;
    delete S.drafts[k];
    return true;
  }

  function savePerSet(k, ex, sets, d, prev, complete) {
    const ws = d.setWeights.slice(0, sets).map((x) => G.parseNum(x));
    if (!ex.noWeight && ws.some((x) => !(x > 0))) { toast("Cargá el peso de cada serie", "error"); return false; }
    const top = Math.max(...ws.filter((x) => x > 0), 0);
    S.data[k] = {
      weight: top > 0 ? String(top) : "",
      setWeights: ws.map((x) => (x > 0 ? String(x) : "")),
      weightMode: "total",
      perSideDisplay: null,
      note: d.note.trim(),
      completed: complete === undefined ? !!prev.completed : complete,
      reps: d.reps.slice(0, sets).map((x) => String(x).trim()),
      repsSame: false,
      repsSameValue: "",
      altUsed: !!prev.altUsed,
      ...(prev.altUsed ? { altIdx: prev.altIdx || 0 } : {}),
      unit: d.unit,
      savedAt: new Date().toISOString(),
    };
    if (!saveData()) return false;
    delete S.drafts[k];
    return true;
  }

  const actions = {
    tab(el) {
      if (S.tab === el.dataset.tab && !S.histEx) return;
      navigate("fade", () => { S.tab = el.dataset.tab; S.histEx = null; S.histReturn = null; render(); window.scrollTo(0, 0); }, true);
    },
    week(el) {
      const to = Number(el.dataset.week);
      if (to === S.week) return;
      navigate(to > S.week ? "slide-next" : "slide-prev", () => {
        S.week = to; if (S.sheet === "ex") S.sheet = false; S.skipOpen = false;
        store.set(KEYS.lastWeek, { ...lastWeeks(), [S.cycle]: S.week }); render();
      }, true);
    },
    day(el) {
      const keys = routine().days.map((d) => d.key), to = el.dataset.day;
      if (to === S.day) return;
      navigate(keys.indexOf(to) > keys.indexOf(S.day) ? "slide-next" : "slide-prev", () => {
        S.day = to; if (S.sheet === "ex") S.sheet = false; S.skipOpen = false; store.set(KEYS.lastDay, S.day); render();
      }, true);
    },
    "open-ex"(el) { openEx(Number(el.dataset.idx), "reg"); },
    "ex-tab"(el) {
      const to = el.dataset.tab;
      if (to === S.exTab) return;
      const order = EX_TABS.map(([id]) => id);
      S.fxs = { tabFrom: order.indexOf(S.exTab), pane: order.indexOf(to) > order.indexOf(S.exTab) ? "from-right" : "from-left" };
      S.exTab = to;
      renderSheet();
      const panel = document.querySelector(".sheet-panel.ex");
      if (panel) panel.scrollTop = 0;
    },
    // El círculo completa solo si ya hay peso Y reps (o si el ejercicio no lleva peso); si falta algo,
    // abre el detalle en "Registrar" para anotarlo (pedido 23/11/2026: peso sin reps no tiene sentido).
    "toggle-done"(el) {
      const k = el.dataset.k;
      const { ex, week, idx } = exFromKey(k);
      const rec = S.data[k];
      if (rec && rec.completed) {
        rec.completed = false; rec.savedAt = new Date().toISOString();
        saveData(); render(); toast("Marcado como pendiente"); return;
      }
      const recReady = rec && !rec.skipped && (ex.perSetWeight
        ? Array.isArray(rec.setWeights) && rec.setWeights.some((x) => G.parseNum(x) > 0)
        : G.parseNum(rec.weight) > 0) && hasReps(rec);
      if (ex.noWeight || recReady) {
        S.data[k] = { ...emptyRecord(ex.sets[week]), ...rec, completed: true, savedAt: new Date().toISOString() };
        S.fx.done = k;
        saveData(); render(); toast("Completado ✓"); return;
      }
      const d = S.drafts[k];
      const ready = d && (ex.perSetWeight ? d.setWeights.slice(0, ex.sets[week]).every((x) => G.parseNum(x) > 0) : G.parseNum(d.weight) > 0) && hasReps(d);
      if (ready) {
        if (saveEntry(k, true)) { S.sheet = false; S.fx.done = k; render(); toast("Guardado y completado ✓"); }
        return;
      }
      openEx(idx, "reg");
      toast("Anotá el peso y las reps para completarlo");
    },
    "toggle-skip-ex"(el) { const d = S.drafts[el.dataset.k]; d.skipOpen = !d.skipOpen; render(); },
    "skip-ex-reason"(el) {
      const d = S.drafts[el.dataset.k];
      d.skipReason = el.dataset.reason;
      el.closest(".skip-ex-box").querySelectorAll(".skip-ex-chip").forEach((c) => c.classList.toggle("on", c === el));
      const input = el.closest(".skip-ex-box").querySelector(".skip-ex-input");
      if (input) input.value = d.skipReason;
    },
    "save-skip-ex"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const { ex, week, idx } = exFromKey(k);
      S.data[k] = { ...emptyRecord(ex.sets[week]), ...(S.data[k] || {}), completed: false, skipped: true, skipReason: (d.skipReason || "").trim(), savedAt: new Date().toISOString() };
      if (!saveData()) return;
      delete S.drafts[k];
      closeSheet(() => { S.fx.saved = k; render(); });
      toast("Marcado como no hecho");
      return idx;
    },
    "undo-skip-ex"(el) {
      const k = el.dataset.k;
      if (S.data[k]) { delete S.data[k].skipped; delete S.data[k].skipReason; }
      if (!saveData()) return;
      render(); toast("Quitado: no hecho");
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
    "calc-bar"(el) { draftOf(el.dataset.k).calcBar = el.dataset.bar; rerender(el.dataset.k); },
    "calc-unit"(el) { const d = S.calcTool; if (d.unit !== el.dataset.unit) { d.unit = el.dataset.unit; d.calcValue = ""; d.calcCustom = ""; } renderSheet(); },
    "calc-mode"(el) {
      const d = draftOf(el.dataset.k);
      if (d.calcMode === el.dataset.mode) return;
      const res = calcResult(d);
      d.calcMode = el.dataset.mode;
      if (res) d.calcValue = String(d.calcMode === "perSide" ? Math.max(0, res.perSide) : res.total);
      rerender(el.dataset.k);
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
      if (el.dataset.setweights) el.dataset.setweights.split(",").forEach((x, i) => { d.setWeights[i] = x; });
      else { d.weight = el.dataset.value; d.weightMode = "total"; d.perSideDisplay = null; }
      render();
    },
    "save-entry"(el) {
      const k = el.dataset.k;
      const { dayObj, idx, ex, week } = exFromKey(k);
      const name = G.slotName(S.data, dayObj.key, idx, ex, week);
      const before = G.findMax(recordsOf(name).filter((r) => !(r.cycle === S.cycle && r.key === k)));
      const complete = el.dataset.complete ? true : undefined;
      if (!saveEntry(k, complete)) return;
      const now = G.collectRecords(S.routines, allData(), name).find((r) => r.cycle === S.cycle && r.key === k);
      const isPR = before && now && (G.cmpW(now) > G.cmpW(before) || (G.cmpW(now) === G.cmpW(before) && now.topReps > before.topReps));
      // la hoja baja y la fila guardada queda a la vista (y brilla) para no perderla
      closeSheet(() => {
        S.fx.saved = k;
        if (complete) S.fx.done = k;
        if (isPR) S.fx.pr = k;
        render();
        const row = document.querySelector(`.card[data-card="${k}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      if (isPR) toast(`🏆 ¡Nuevo récord! ${fmt(now.weight)} ${now.unit}${now.topReps ? ` × ${now.topReps}` : ""}`, "pr");
      else toast(complete ? "Guardado y listo ✓" : "Guardado ✓");
      return idx;
    },
    "set-dbcount"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      d.dbCount = Number(el.dataset.n);
      el.closest(".db-seg").querySelectorAll(".db-count-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.n) === d.dbCount));
      refreshDbTotal(k);
    },
    "set-rpe"(el) {
      const d = S.drafts[el.dataset.k];
      d.rpe = d.rpe === el.dataset.v ? "" : el.dataset.v;
      el.closest(".rpe-seg").querySelectorAll(".rpe-btn").forEach((b) => b.classList.toggle("active", b.dataset.v === d.rpe));
    },
    "step-weight"(el) {
      const k = el.dataset.k, d = S.drafts[k];
      const p = G.parseSlotKey(k), ex = p && exDef(p.day, p.idx);
      // la escala del equipo: polea 5 kg, aductor 4 kg, mancuernas 5 lb hasta 40 y después 10…
      const scale = scaleOf(ex, slotNameOf(p.day, p.idx, p.week), d.unit), dir = Number(el.dataset.dir);
      let cur = G.parseNum(d.weight);
      if (!(cur >= 0)) {
        const sug = el.closest(".card-body").querySelector(".use-sug-btn");
        cur = sug ? Number(sug.dataset.value) : dir > 0 ? scale.next(0) : 0;
      } else cur = dir > 0 ? scale.next(cur) : scale.prev(cur);
      d.weight = String(Math.max(0, cur)); d.weightMode = "total"; d.perSideDisplay = null;
      const box = el.closest(".reg");
      box.querySelector(".weight-input").value = d.weight;
      const hint = box.querySelector(".perside-hint");
      if (hint) hint.remove();
      box.querySelector(".conv-hint").textContent = cur > 0 ? convTxt(Math.max(0, cur), d.unit) : "";
      refreshExPlates(el.dataset.k);
      refreshDbTotal(el.dataset.k);
    },
    "set-ex-unit"(el) {
      const k = el.dataset.k, d = S.drafts[k], to = el.dataset.unit;
      if (d.unit === to) return;
      const { dayObj, idx } = exFromKey(k);
      const w = G.parseNum(d.weight);
      if (w > 0) d.weight = String(Math.round(G.convert(w, d.unit, to)));
      d.setWeights = d.setWeights.map((x) => (G.parseNum(x) > 0 ? String(Math.round(G.convert(G.parseNum(x), d.unit, to))) : x));
      d.weightMode = "total"; d.perSideDisplay = null; d.calcValue = "";
      d.unit = to;
      S.data[unitKey(dayObj.key, idx)] = to;
      if (!saveData()) return;
      render();
      toast(w > 0 ? `Convertido: ${fmt(G.parseNum(d.weight))} ${to}` : `Este ejercicio en ${to}`);
    },
    "hist-open"(el) { S.mergeOpen = false; S.histEx = el.dataset.ex; S.fx.view = true; render(); window.scrollTo(0, 0); },
    "hist-back"() {
      S.mergeOpen = false; S.histEx = null; S.fx.view = true;
      const back = S.histReturn;
      S.histReturn = null;
      if (back) {
        // vuelve a la rutina con el detalle del ejercicio abierto en su historial
        S.tab = "rutina"; render();
        const card = document.querySelector(`[data-card="${back.k}"]`);
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
        openEx(back.idx, "hist");
        return;
      }
      render();
    },
    "ex-history"(el) {
      const k = el.dataset.k, { dayObj, idx, ex, week } = exFromKey(k);
      const key = G.normName(G.slotName(S.data, dayObj.key, idx, ex, week));
      if (!histIndex().some((x) => x.key === key)) { toast("Todavía no hay registros de este ejercicio"); return; }
      S.histReturn = { k, idx };
      if (S.sheet === "ex") S.sheet = false;
      S.tab = "historial"; S.histEx = key; S.mergeOpen = false; S.fx.view = true;
      render(); window.scrollTo(0, 0);
    },
    "pg-pt"(el) {
      const box = el.closest(".progress");
      box.querySelector(".pg-cap").textContent = el.dataset.cap;
      box.querySelectorAll(".pg-dot").forEach((d) => d.classList.toggle("sel", d.dataset.i === el.dataset.i));
    },
    "merge-open"() { S.mergeOpen = true; S.mergeQuery = ""; render(); },
    "merge-cancel"() { S.mergeOpen = false; render(); },
    "merge-into"(el) {
      const e = histIndex().find((x) => x.key === S.histEx);
      const to = el.dataset.name;
      if (!e || !to) return;
      if (!confirm(`¿"${e.name}" y "${to}" son el mismo ejercicio?\n\nTodas las marcas pasan a "${to}" (historial, récords y sugerencias).`)) return;
      const res = mergeExercises(e.name, to);
      S.mergeOpen = false;
      S.histEx = G.normName(to);
      S.fx.view = true;
      render();
      toast(`Unidos ✓ · ahora es "${to}"`);
      return res;
    },
    "hist-filter"(el) { S.histFilter = el.dataset.filter; render(); },
    "use-alt"(el) {
      const k = el.dataset.k, { ex, week } = exFromKey(k);
      S.data[k] = { ...(S.data[k] || { ...emptyRecord(ex.sets[week]), savedAt: null }), altUsed: true, altIdx: Number(el.dataset.i) || 0 };
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Esta semana: alternativa");
    },
    "undo-alt"(el) {
      const k = el.dataset.k;
      if (S.data[k]) { S.data[k].altUsed = false; delete S.data[k].altIdx; }
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Volviste al ejercicio original");
    },
    "use-alt-cycle"(el) {
      const k = el.dataset.k, { dayObj, idx, ex } = exFromKey(k);
      S.data[G.ovrKey(dayObj.key, idx)] = { name: G.alts(ex)[Number(el.dataset.i) || 0], savedAt: new Date().toISOString() };
      for (let w = 0; w < 4; w++) { const r = S.data[G.slotKey(dayObj.key, idx, w)]; if (r) r.altUsed = false; }
      if (!saveData()) return;
      S.drafts[k].altOpen = false; render(); toast("Alternativa en todo el ciclo · se deshace con Editar nombre → Restablecer");
    },
    "open-calc"() {
      if (!S.calcTool) S.calcTool = { unit: S.unit, calcBar: "women", calcCustom: "", calcMode: "total", calcValue: "" };
      S.sheet = "calc"; S.sheetFx = true; renderSheet();
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
    "close-settings"() { closeSheet(); },
    "set-theme"(el) { S.theme = el.dataset.theme; store.set(KEYS.theme, S.theme); applyTheme(); renderSheet(); },
    "set-unit"(el) { S.unit = el.dataset.unit; store.set(KEYS.unit, S.unit); S.drafts = {}; render(); },
    "set-cycle"(el) { loadCycle(el.dataset.cycle); S.sheet = false; S.tab = "rutina"; S.fx.view = true; render(); toast(`Ciclo ${S.cycle} activo`); },
    async "export-cycle"() {
      const r = routine();
      const ok = await deliverFile(`gluteo-ciclo-${r.cycle}-${today()}.json`, G.buildCycleExport(r, S.data, S.unit));
      if (ok) toast("Export listo ✓");
    },
    async backup() {
      const data = {};
      for (const c of Object.keys(S.routines)) data[c] = dataOf(c);
      const b = G.buildBackup({ routines: S.routines, data, unit: S.unit, theme: S.theme, history: S.hist, equip: S.equip });
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
    if (el.dataset.skipex === "reason") { const dd = S.drafts[el.dataset.k]; if (dd) dd.skipReason = el.value; return; }
    if (el.dataset.search === "merge") {
      S.mergeQuery = el.value;
      const e = histIndex().find((x) => x.key === S.histEx);
      const list = document.querySelector(".merge-list");
      if (e && list) list.innerHTML = renderMergeList(e);
      return;
    }
    if (el.dataset.search === "hist") {
      S.histQuery = el.value;
      const list = document.querySelector(".hist-list");
      if (list) list.innerHTML = renderHistList();
      return;
    }
    if (!f || !k || el.type === "checkbox") return;
    const d = draftOf(k);
    if (!d) return;
    if (f === "rep") d.reps[Number(el.dataset.i)] = el.value;
    else if (f === "setWeight") {
      d.setWeights[Number(el.dataset.i)] = el.value;
      const hint = document.querySelector(`[data-plates="${k}-${el.dataset.i}"]`);
      if (hint) hint.textContent = plateTxt(el.value, d.unit, d.calcBar);
    }
    else d[f] = el.value;
    if (f === "note") { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 2, 240)}px`; }
    if (f === "weight") {
      d.weightMode = "total"; d.perSideDisplay = null;
      const card = el.closest(".card-body") || el.closest(".card");
      const hint = card.querySelector(".perside-hint");
      if (hint) hint.remove();
      const wv = G.parseNum(el.value), conv = card.querySelector(".conv-hint");
      if (conv) conv.textContent = wv > 0 ? convTxt(wv, d.unit) : "";
      refreshExPlates(k);
      refreshDbTotal(k);
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
    if (el.dataset.change === "equip") {
      const k = el.dataset.k, d = S.drafts[k], p = G.parseSlotKey(k);
      const ex = exDef(p.day, p.idx), name = slotNameOf(p.day, p.idx, p.week);
      const auto = (isOriginal(ex, name) && ex.equip) || G.inferEquip(name) || "other";
      if (el.value === auto) delete S.equip[G.normName(name)]; else S.equip[G.normName(name)] = el.value;
      store.set(KEYS.equip, S.equip);
      // pasa a la unidad del equipo (polea y máquina en kg; barra, discos y mancuernas en lb) y a su barra
      const e = G.EQUIP[equipOf(ex, name)];
      if (d && e && e.unit !== d.unit) {
        const w = G.parseNum(d.weight);
        if (w > 0) d.weight = String(Math.round(G.convert(w, d.unit, e.unit)));
        d.weightMode = "total"; d.perSideDisplay = null; d.calcValue = "";
        d.unit = e.unit;
      }
      if (d) d.calcBar = (e && e.bar) || "women";
      render();
      toast(`${name}: ${e ? e.label : "otro equipo"}`);
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
    // Solo se abre solo un ciclo vigente NUEVO; si elegí a propósito un ciclo anterior, se respeta.
    if (S.cycle === null || (!prev && r.cycle > S.cycle)) {
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
      let updated = false;
      for (const c of S.remote) {
        if (!S.routines[c.cycle] || G.isClosed(S.hist, c.cycle)) continue;
        try {
          const rr = await fetch(`rutinas/ciclo-${c.cycle}.json`, { cache: "no-store" });
          if (!rr.ok) continue;
          const r = await rr.json();
          if (G.validateRoutine(r).length || r.cycle !== c.cycle) continue;
          if (JSON.stringify(r) !== JSON.stringify(S.routines[c.cycle])) { S.routines[c.cycle] = r; updated = true; }
        } catch { /* sin conexión */ }
      }
      if (updated) { store.set(KEYS.routines, S.routines); S.drafts = {}; render(); }
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

  // Hojas: arrastrar hacia abajo desde el encabezado (o la barrita) para cerrar, como en iOS.
  function setupSheetDrag() {
    let drag = null;
    document.addEventListener("touchstart", (e) => {
      const h = e.target.closest(".sheet-drag");
      if (!h || e.target.closest("button, input, select, textarea")) return;
      const panel = h.closest(".sheet-panel");
      if (!panel) return;
      drag = { panel, y0: e.touches[0].clientY, dy: 0, t0: Date.now() };
      panel.style.transition = "none";
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!drag) return;
      drag.dy = Math.max(0, e.touches[0].clientY - drag.y0);
      drag.panel.style.transform = `translateY(${drag.dy}px)`;
      const bg = drag.panel.previousElementSibling;
      if (bg) bg.style.opacity = String(Math.max(0.2, 1 - drag.dy / 500));
    }, { passive: true });
    document.addEventListener("touchend", () => {
      if (!drag) return;
      const { panel, dy, t0 } = drag;
      drag = null;
      const fast = dy > 40 && Date.now() - t0 < 250;
      panel.style.transition = "transform .28s var(--ease)";
      const bg = panel.previousElementSibling;
      if (dy > 120 || fast) {
        panel.style.transform = "translateY(105%)";
        if (bg) { bg.style.transition = "opacity .28s"; bg.style.opacity = "0"; }
        setTimeout(() => { S.sheet = false; renderSheet(); }, 260);
      } else {
        panel.style.transform = "";
        if (bg) bg.style.opacity = "";
      }
    });
  }

  async function boot() {
    S.theme = store.get(KEYS.theme, "light");
    S.equip = store.get(KEYS.equip, {}) || {};
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
    setupSheetDrag();

    if (S.cycle !== null) render();
    if (await refreshRoutine() || S.cycle === null) {
      if (!store.get(KEYS.unit, null) && routine()) S.unit = routine().unitDefault;
      render();
    }
    registerSW();
    loadRemoteIndex();
  }

  window.GluteoApp = { ready: boot().catch((err) => { console.error(err); throw err; }) };
})();
