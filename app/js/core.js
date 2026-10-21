/* core.js — lógica pura de Glúteo Tracker (sin DOM).
   La usan app.js, los tests y scripts/validar-rutina.mjs. */
(function (root) {
  "use strict";

  const DAY_KEYS = ["A", "B", "C", "D", "E"];
  const BARS = { women: { lb: 35, kg: 15 }, men: { lb: 45, kg: 20 } };
  const STEP = { lb: 5, kg: 2.5 };

  // ---------- Convenciones de texto en targets (CLAUDE.md §4) ----------

  // "4x8-10 @RPE7" → 4 · "3x4-6 @RPE9 + 1x15-20" → 4 · "4x8 + 10 pulsos" → 4
  function targetSetCount(target) {
    const re = /(?:^|\+)\s*(\d+)\s*[x×]/gi;
    const text = String(target).trim();
    let total = 0, found = false, m;
    while ((m = re.exec(text))) { total += Number(m[1]); found = true; }
    return found ? total : null;
  }

  function isDeloadTarget(target) {
    return /\(liviano\)|@\s*RPE\s*5\s*-\s*6|@\s*RPE\s*6(?![\d.-])/i.test(String(target));
  }

  function hasPlusWeight(target) {
    return /\(\+\s*peso\)/i.test(String(target));
  }

  // ---------- Validación de una rutina (ciclo-N.json) ----------

  function validateRoutine(r) {
    const errs = [];
    const isStr = (v) => typeof v === "string" && v.trim() !== "";
    if (!r || typeof r !== "object" || Array.isArray(r)) return ["La rutina no es un objeto JSON"];
    if (r.schemaVersion !== 1) errs.push("schemaVersion debe ser 1");
    if (!Number.isInteger(r.cycle) || r.cycle < 1) errs.push("cycle debe ser un entero ≥ 1");
    if (!isStr(r.name)) errs.push("falta name");
    if (r.startDate !== null && !(typeof r.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.startDate)))
      errs.push("startDate debe ser \"YYYY-MM-DD\" o null");
    if (r.unitDefault !== "lb" && r.unitDefault !== "kg") errs.push("unitDefault debe ser \"lb\" o \"kg\"");
    for (const f of ["weeks", "weekShort"]) {
      if (!Array.isArray(r[f]) || r[f].length !== 4 || !r[f].every(isStr)) errs.push(`${f} debe tener exactamente 4 textos`);
    }
    if (!Array.isArray(r.days) || r.days.length === 0) { errs.push("days debe ser una lista no vacía"); return errs; }

    const keys = new Set(), weekdays = new Set();
    r.days.forEach((d, di) => {
      const where = `días[${di}]${d && d.key ? ` (${d.key})` : ""}`;
      if (!d || typeof d !== "object") { errs.push(`${where}: no es un objeto`); return; }
      if (!DAY_KEYS.includes(d.key)) errs.push(`${where}: key debe ser A–E`);
      else if (keys.has(d.key)) errs.push(`${where}: key repetida`);
      keys.add(d.key);
      if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) errs.push(`${where}: weekday debe ser 0–6`);
      else if (weekdays.has(d.weekday)) errs.push(`${where}: weekday repetido`);
      weekdays.add(d.weekday);
      for (const f of ["label", "dayName", "title"]) if (!isStr(d[f])) errs.push(`${where}: falta ${f}`);
      if (d.type !== "lower" && d.type !== "upper") errs.push(`${where}: type debe ser "lower" o "upper"`);
      if (typeof d.warmup !== "string") errs.push(`${where}: falta warmup`);
      if (!Array.isArray(d.exercises) || d.exercises.length === 0) { errs.push(`${where}: exercises vacío`); return; }

      d.exercises.forEach((ex, ei) => {
        const w = `${d.key}.${ei}${ex && ex.name ? ` "${ex.name}"` : ""}`;
        if (!ex || typeof ex !== "object") { errs.push(`${w}: no es un objeto`); return; }
        if (!isStr(ex.name)) errs.push(`${w}: falta name`);
        if (!(ex.pattern === null || isStr(ex.pattern))) errs.push(`${w}: pattern debe ser texto o null`);
        if (!(ex.alt === null || isStr(ex.alt))) errs.push(`${w}: alt debe ser texto o null`);
        if (!isStr(ex.rest)) errs.push(`${w}: falta rest`);
        if (ex.noWeight !== undefined && ex.noWeight !== true) errs.push(`${w}: noWeight solo puede ser true (u omitirse)`);
        const okTargets = Array.isArray(ex.targets) && ex.targets.length === 4 && ex.targets.every(isStr);
        const okSets = Array.isArray(ex.sets) && ex.sets.length === 4 && ex.sets.every((n) => Number.isInteger(n) && n >= 1);
        if (!okTargets) errs.push(`${w}: targets debe tener exactamente 4 textos`);
        if (!okSets) errs.push(`${w}: sets debe tener exactamente 4 enteros ≥ 1`);
        if (okTargets && okSets) {
          ex.targets.forEach((t, i) => {
            const n = targetSetCount(t);
            if (n === null) errs.push(`${w}: S${i + 1} "${t}" no indica series (ej. "3x10")`);
            else if (n !== ex.sets[i]) errs.push(`${w}: S${i + 1} sets=${ex.sets[i]} pero "${t}" indica ${n}`);
          });
          if (!ex.noWeight && !isDeloadTarget(ex.targets[3]))
            errs.push(`${w}: la S4 necesita "(liviano)", "@RPE5-6" o "@RPE6" para la sugerencia de descarga`);
        }
      });
    });
    return errs;
  }

  // ---------- Claves de almacenamiento (CLAUDE.md §6.2) ----------

  const dataKey = (cycle) => `gluteo_tracker_ciclo-${cycle}`;
  const slotKey = (day, idx, week) => `${day}_${idx}_w${week}`;
  const ovrKey = (day, idx) => `ovr_${day}_${idx}`;

  function parseSlotKey(k) {
    const m = /^([A-E])_(\d+)_w([0-3])$/.exec(k);
    return m ? { day: m[1], idx: Number(m[2]), week: Number(m[3]) } : null;
  }

  function effectiveName(data, day, idx, ex) {
    const o = data && data[ovrKey(day, idx)];
    return o && o.name ? o.name : ex.name;
  }

  function normName(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // ---------- Números y pesos ----------

  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(",", ".");
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function roundStep(v, unit) {
    const s = STEP[unit] || 5;
    return Math.max(s, Math.round(v / s) * s);
  }

  function fmtNum(n) {
    const r = Math.round(n * 100) / 100;
    return String(r).replace(".", ",");
  }

  function barWeight(bar, unit, custom) {
    if (bar === "custom") return parseNum(custom);
    return BARS[bar] ? BARS[bar][unit] : NaN;
  }

  // Calculadora de barra: "perSide" = discos por lado; "total" = peso total.
  function calcBar(mode, value, bar) {
    if (!(value >= 0) || !(bar >= 0)) return null;
    if (mode === "perSide") return { total: value * 2 + bar, perSide: value };
    return { total: value, perSide: (value - bar) / 2 };
  }

  function repsText(rec) {
    if (!rec) return "";
    if (rec.repsSame && rec.repsSameValue) return `${(rec.reps && rec.reps.length) || 1}×${rec.repsSameValue}`;
    return (rec.reps || []).filter((x) => String(x).trim() !== "").join("·");
  }

  // ---------- Historial de pesos ----------

  // Todas las marcas con peso de un ejercicio (por nombre efectivo), en todos los ciclos guardados.
  function collectRecords(routines, allData, name) {
    const target = normName(name);
    const out = [];
    for (const c of Object.keys(routines)) {
      const r = routines[c], data = allData[c] || {};
      r.days.forEach((d) => d.exercises.forEach((ex, idx) => {
        if (normName(effectiveName(data, d.key, idx, ex)) !== target) return;
        for (let w = 0; w < 4; w++) {
          const k = slotKey(d.key, idx, w), rec = data[k];
          const weight = rec ? parseNum(rec.weight) : NaN;
          if (weight > 0) out.push({ cycle: Number(c), week: w, key: k, weight, reps: repsText(rec), weekShort: r.weekShort[w] });
        }
      }));
    }
    return out;
  }

  function findMax(records) {
    let best = null;
    for (const r of records) {
      if (!best || r.weight > best.weight || (r.weight === best.weight && (r.cycle > best.cycle || (r.cycle === best.cycle && r.week > best.week)))) best = r;
    }
    return best;
  }

  // Última semana anterior (del mismo ciclo y ejercicio) con peso guardado.
  function prevWeight(data, day, idx, week) {
    for (let w = week - 1; w >= 0; w--) {
      const rec = data[slotKey(day, idx, w)];
      const weight = rec ? parseNum(rec.weight) : NaN;
      if (weight > 0) return { weight, week: w };
    }
    return null;
  }

  // Sugerencia de peso (CLAUDE.md §6.1). Devuelve { value, text } o null.
  function suggest({ target, week, prev, max, unit, weekShort }) {
    const step = STEP[unit] || 5;
    const wk = (i) => (weekShort && weekShort[i]) || `S${i + 1}`;
    if (prev && isDeloadTarget(target))
      return { value: roundStep(prev.weight * 0.55, unit), text: `Descarga: ~55% de ${wk(prev.week)} (${fmtNum(prev.weight)})` };
    if (prev && hasPlusWeight(target))
      return { value: prev.weight + step, text: `(+peso): ${wk(prev.week)} + ${fmtNum(step)}` };
    if (week === 0 && max)
      return { value: roundStep(max.weight * 0.9, unit), text: `~90% de tu máximo (${fmtNum(max.weight)})` };
    if (prev) return { value: prev.weight, text: `Similar a ${wk(prev.week)}` };
    if (max) return { value: roundStep(max.weight * 0.9, unit), text: `~90% de tu máximo (${fmtNum(max.weight)})` };
    return null;
  }

  // ---------- Fechas y selección automática ----------

  function weekFromStart(startDate, today) {
    if (!startDate) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.round((t - start) / 86400000);
    if (days < 0) return null;
    return Math.min(3, Math.floor(days / 7));
  }

  // Lun–jue y sáb: el día que corresponde a la fecha. Viernes/domingo (o sin match): el último visto.
  function autoDayKey(routine, date, lastDay) {
    const match = routine.days.find((d) => d.weekday === date.getDay());
    if (match) return match.key;
    if (lastDay && routine.days.some((d) => d.key === lastDay)) return lastDay;
    return routine.days[0].key;
  }

  // ---------- Export y respaldo ----------

  function buildCycleExport(routine, data, unit, now) {
    return {
      exportedAt: (now || new Date()).toISOString(),
      type: "gluteo-cycle-export",
      cycle: routine.cycle,
      cycleName: routine.name,
      unit,
      days: routine.days.map((d) => ({
        day: d.key,
        title: d.title,
        exercises: d.exercises.map((ex, idx) => ({
          name: effectiveName(data, d.key, idx, ex),
          originalName: ex.name,
          pattern: ex.pattern,
          weeks: [0, 1, 2, 3].map((w) => {
            const rec = data[slotKey(d.key, idx, w)] || {};
            return {
              week: routine.weekShort[w],
              target: ex.targets[w],
              weight: rec.weight || "",
              weightMode: rec.weightMode || null,
              perSide: rec.perSideDisplay ?? null,
              reps: rec.reps || [],
              repsText: repsText(rec),
              note: rec.note || "",
              completed: !!rec.completed,
              date: rec.savedAt || null,
            };
          }),
        })),
      })),
    };
  }

  function buildBackup({ routines, data, unit, theme }, now) {
    return { type: "gluteo-backup", version: 1, exportedAt: (now || new Date()).toISOString(), prefs: { unit, theme }, routines, data };
  }

  function checkBackup(b) {
    if (!b || b.type !== "gluteo-backup" || b.version !== 1) return ["No es un respaldo de Glúteo Tracker"];
    if (!b.routines || typeof b.routines !== "object" || !b.data || typeof b.data !== "object") return ["Respaldo incompleto"];
    const errs = [];
    for (const [c, r] of Object.entries(b.routines)) {
      const e = validateRoutine(r);
      if (e.length) errs.push(`Ciclo ${c}: ${e[0]}`);
      else if (String(r.cycle) !== String(c)) errs.push(`Ciclo ${c}: no coincide con cycle=${r.cycle}`);
    }
    return errs;
  }

  root.Gluteo = {
    DAY_KEYS, BARS, STEP,
    targetSetCount, isDeloadTarget, hasPlusWeight, validateRoutine,
    dataKey, slotKey, ovrKey, parseSlotKey, effectiveName, normName,
    parseNum, roundStep, fmtNum, barWeight, calcBar, repsText,
    collectRecords, findMax, prevWeight, suggest,
    weekFromStart, autoDayKey,
    buildCycleExport, buildBackup, checkBackup,
  };
})(typeof window !== "undefined" ? window : globalThis);
