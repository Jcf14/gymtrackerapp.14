/* core.js — lógica pura de Gym Tracker (sin DOM).
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
    return /\(liviano[^)]*\)|@\s*RPE\s*5\s*-\s*6|@\s*RPE\s*6(?![\d.-])/i.test(String(target));
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
            errs.push(`${w}: la S4 necesita "(liviano…)", "@RPE5-6" o "@RPE6" para la sugerencia de descarga`);
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

  // Nombre del ejercicio hecho en una semana concreta: la alternativa si se usó esa semana.
  function slotName(data, day, idx, ex, week) {
    const rec = data && data[slotKey(day, idx, week)];
    return rec && rec.altUsed && ex.alt ? ex.alt : effectiveName(data, day, idx, ex);
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
        for (let w = 0; w < 4; w++) {
          if (normName(slotName(data, d.key, idx, ex, w)) !== target) continue;
          const k = slotKey(d.key, idx, w), rec = data[k];
          const weight = rec ? parseNum(rec.weight) : NaN;
          if (!(weight > 0)) continue;
          const repsArr = repsNums(rec);
          out.push({
            cycle: Number(c), week: w, key: k, day: d.key, weight, reps: repsText(rec), repsArr,
            topReps: repsArr.length ? Math.max(...repsArr) : 0, date: rec.savedAt || null,
            note: rec.note || "", completed: !!rec.completed, altUsed: !!rec.altUsed, weekShort: r.weekShort[w],
          });
        }
      }));
    }
    return out;
  }

  // Orden cronológico: por fecha de guardado; sin fecha, por ciclo y semana.
  function chrono(a, b) {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.cycle - b.cycle || a.week - b.week;
  }

  // ¿r supera a best? Más peso, o el mismo peso con más reps.
  const beats = (r, best) => !best || r.weight > best.weight || (r.weight === best.weight && r.topReps > best.topReps);

  function findMax(records) {
    let best = null;
    for (const r of [...records].sort(chrono)) if (beats(r, best) || (best && r.weight === best.weight && r.topReps === best.topReps)) best = r;
    return best;
  }

  // Línea de récords: cada vez que se superó el máximo (el anterior queda en la lista).
  function prHistory(records) {
    const out = [];
    let best = null;
    for (const r of [...records].sort(chrono)) if (beats(r, best)) { out.push(r); best = r; }
    return out;
  }

  function lastRecord(records) {
    return records.length ? [...records].sort(chrono)[records.length - 1] : null;
  }

  // Última semana anterior (del mismo ciclo y ejercicio) con peso guardado.
  // Con ex, solo cuenta semanas en las que se hizo el mismo ejercicio (original o alternativa).
  function prevWeight(data, day, idx, week, ex) {
    const name = ex ? normName(slotName(data, day, idx, ex, week)) : null;
    for (let w = week - 1; w >= 0; w--) {
      if (name && normName(slotName(data, day, idx, ex, w)) !== name) continue;
      const rec = data[slotKey(day, idx, w)];
      const weight = rec ? parseNum(rec.weight) : NaN;
      if (weight > 0) return { weight, week: w };
    }
    return null;
  }

  // ---------- Recomendación de peso (CLAUDE.md §3.4) ----------

  // "3x8-12 c/pierna" → { lo: 8, hi: 12 } · "4x8" → { lo: 8, hi: 8 }
  function repRange(target) {
    const m = /\d+\s*[x×]\s*(\d+)(?:\s*-\s*(\d+))?/i.exec(String(target));
    return m ? { lo: Number(m[1]), hi: Number(m[2] || m[1]) } : null;
  }

  function repsNums(rec) {
    return rec ? (rec.reps || []).map(parseNum).filter((n) => n > 0) : [];
  }

  const pctDiff = (v, base) => (base > 0 ? Math.round(((v - base) / base) * 100) : null);

  // Último S1 de un ciclo anterior (para comparar S1 contra S1 entre ciclos).
  function lastCycleS1(records, cycle) {
    const prev = records.filter((r) => r.week === 0 && r.cycle < cycle);
    return prev.length ? prev.sort((a, b) => b.cycle - a.cycle)[0] : null;
  }

  // Qué se espera esta semana respecto de la anterior, dicho en simple.
  function goalLabel(wDir, rDir) {
    if (wDir === "down") return "Menos peso";
    const reps = { up: "más reps", same: "mismas reps", down: "menos reps" }[rDir] || "";
    if (wDir === "up") return rDir === "up" ? "Más peso y más reps" : `Más peso, ${reps}`;
    if (rDir === "up") return "Mismo peso, más reps";
    if (rDir === "down") return "Mismo peso, menos reps";
    return "Mismo peso y reps";
  }

  // Compara el rango de reps de esta semana con el de la referencia.
  function repsDir(cur, was) {
    if (!cur || !was) return "same";
    return cur.hi > was.hi ? "up" : cur.hi < was.hi ? "down" : "same";
  }

  // Devuelve { value, base, pct, mode, goal, text } o null.
  // mode: "up" · "reps" · "same" · "deload" · "calibrate" (sin referencia directa: usar la 1ª serie)
  function recommend({ target, prevTarget, week, prev, prevRec, lastS1, lastS1Target, max, unit, weekShort }) {
    const step = STEP[unit] || 5;
    const wk = (i) => (weekShort && weekShort[i] ? String(weekShort[i]).replace(/\s*\(.*\)\s*$/, "") : `S${i + 1}`);
    const out = (value, base, mode, rDir, text) => {
      const wDir = value > base ? "up" : value < base ? "down" : "same";
      return { value, base, pct: pctDiff(value, base), mode, goal: goalLabel(wDir, rDir), text };
    };
    const up = (base) => Math.max(base + step, roundStep(base * 1.05, unit));
    const cur = repRange(target);
    if (prev) {
      const pw = prev.weight;
      const was = repRange(prevTarget);
      if (isDeloadTarget(target)) return out(roundStep(pw * 0.55, unit), pw, "deload", repsDir(cur, was), `Descarga: ~55% del peso de ${wk(prev.week)}, terminando con 4+ reps en reserva`);
      if (hasPlusWeight(target)) return out(pw + step, pw, "up", repsDir(cur, was), `El plan pide subir: ${wk(prev.week)} + ${fmtNum(step)} ${unit}`);
      if (cur && was && cur.hi < was.hi && cur.hi <= was.lo)
        return out(up(pw), pw, "up", "down", `Rango más bajo que en ${wk(prev.week)} (${cur.lo}-${cur.hi}): más carga`);
      if (cur) {
        const reps = repsNums(prevRec);
        if (reps.length && reps.every((r) => r >= cur.hi))
          return out(pw + step, pw, "up", "down", `Llegaste a ${cur.hi} en todas: subí ${fmtNum(step)} ${unit} y volvé a ${cur.lo} reps`);
        return out(pw, pw, "reps", "up", reps.length
          ? `Hiciste ${reps.join("·")}: buscá ${cur.hi} en todas antes de subir peso`
          : `Buscá ${cur.hi} reps en todas las series antes de subir peso`);
      }
      return out(pw, pw, "same", "same", `Igual que ${wk(prev.week)}`);
    }
    if (week === 0 && lastS1) {
      if (cur && lastS1.repsArr.length && !lastS1.repsArr.every((r) => r >= cur.hi))
        return out(lastS1.weight, lastS1.weight, "reps", "up", `En S1 del ciclo ${lastS1.cycle} hiciste ${lastS1.repsArr.join("·")}: buscá ${cur.hi} en todas`);
      return out(up(lastS1.weight), lastS1.weight, "up", repsDir(cur, repRange(lastS1Target)), `S1 del ciclo ${lastS1.cycle} (${fmtNum(lastS1.weight)} ${unit}) + 5%`);
    }
    if (max) {
      const r = out(roundStep(max.weight * 0.9, unit), max.weight, "calibrate", "same", "~90% de tu máximo: ajustalo con la 1ª serie según el RPE");
      r.goal = "Calibrá el peso";
      return r;
    }
    return null;
  }

  // ---------- Índice de ejercicios (para el historial) ----------

  // Un ejercicio por nombre (sin tildes ni mayúsculas), en todos los ciclos guardados.
  function exerciseIndex(routines, allData, activeCycle) {
    const map = new Map();
    for (const c of Object.keys(routines).map(Number).sort((a, b) => b - a)) {
      const r = routines[c], data = allData[c] || {};
      r.days.forEach((d, di) => d.exercises.forEach((ex, idx) => {
        const names = new Set([effectiveName(data, d.key, idx, ex), ...[0, 1, 2, 3].map((w) => slotName(data, d.key, idx, ex, w))]);
        for (const name of names) {
          const key = normName(name);
          if (!map.has(key)) map.set(key, { key, name, pattern: ex.pattern, type: d.type, noWeight: !!ex.noWeight, days: new Set(), cycles: new Set(), order: Infinity });
          const e = map.get(key);
          e.cycles.add(c);
          if (c === activeCycle) { e.days.add(d.key); e.order = Math.min(e.order, di * 100 + idx); }
        }
      }));
    }
    const list = [...map.values()];
    for (const e of list) {
      e.records = collectRecords(routines, allData, e.name);
      e.max = findMax(e.records);
      e.last = lastRecord(e.records);
      e.group = e.pattern && /^core/i.test(e.pattern) ? "core" : e.type;
    }
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
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
              exercise: slotName(data, d.key, idx, ex, w),
              altUsed: !!rec.altUsed,
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
    if (!b || b.type !== "gluteo-backup" || b.version !== 1) return ["No es un respaldo de Gym Tracker"];
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
    dataKey, slotKey, ovrKey, parseSlotKey, effectiveName, slotName, normName,
    parseNum, roundStep, fmtNum, barWeight, calcBar, repsText,
    collectRecords, findMax, prHistory, lastRecord, prevWeight, repRange, repsNums, lastCycleS1, recommend, goalLabel, exerciseIndex,
    weekFromStart, autoDayKey,
    buildCycleExport, buildBackup, checkBackup,
  };
})(typeof window !== "undefined" ? window : globalThis);
