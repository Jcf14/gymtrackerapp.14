/* core.js — lógica pura de Gym Tracker (sin DOM).
   La usan app.js, los tests y scripts/validar-rutina.mjs. */
(function (root) {
  "use strict";

  const DAY_KEYS = ["A", "B", "C", "D", "E"];
  const BARS = { women: { lb: 35, kg: 15 }, men: { lb: 45, kg: 20 }, none: { lb: 0, kg: 0 } };
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
    return /\([^)]*liviano[^)]*\)|@\s*RPE\s*5\s*-\s*6|@\s*RPE\s*6(?![\d.-])/i.test(String(target));
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
        if (!(ex.alt === null || isStr(ex.alt) || (Array.isArray(ex.alt) && ex.alt.length >= 1 && ex.alt.length <= 2 && ex.alt.every(isStr))))
          errs.push(`${w}: alt debe ser texto, null o una lista de 1 o 2 textos`);
        if (!isStr(ex.rest)) errs.push(`${w}: falta rest`);
        if (ex.protocol !== undefined && !isStr(ex.protocol)) errs.push(`${w}: protocol debe ser un texto (u omitirse)`);
        if (ex.noWeight !== undefined && ex.noWeight !== true) errs.push(`${w}: noWeight solo puede ser true (u omitirse)`);
        if (ex.fixedLoad !== undefined && ex.fixedLoad !== true) errs.push(`${w}: fixedLoad solo puede ser true (u omitirse)`);
        if (ex.unit !== undefined && ex.unit !== "lb" && ex.unit !== "kg") errs.push(`${w}: unit debe ser "lb" o "kg" (u omitirse)`);
        if (ex.step !== undefined && !(typeof ex.step === "number" && ex.step > 0)) errs.push(`${w}: step debe ser un número mayor que 0 (u omitirse)`);
        if (ex.step !== undefined && ex.unit === undefined) errs.push(`${w}: step necesita unit (el paso es en esa unidad)`);
        if (ex.perSetWeight !== undefined && ex.perSetWeight !== true) errs.push(`${w}: perSetWeight solo puede ser true (u omitirse)`);
        if (ex.setLabels !== undefined && !(Array.isArray(ex.setLabels) && ex.setLabels.every(isStr) && Array.isArray(ex.sets) && ex.setLabels.length >= Math.max(...ex.sets)))
          errs.push(`${w}: setLabels debe tener un texto por serie`);
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
          if (!ex.noWeight && !ex.fixedLoad && !isDeloadTarget(ex.targets[3]))
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
    const a = alts(ex);
    return rec && rec.altUsed && a.length ? a[rec.altIdx || 0] || a[0] : effectiveName(data, day, idx, ex);
  }

  // Alternativas de un ejercicio como lista (0, 1 o 2): otro ejercicio o el mismo con otro accesorio.
  const alts = (ex) => (Array.isArray(ex.alt) ? ex.alt : ex.alt ? [ex.alt] : []);

  // Protocolo de la semana (pausa, pulsos…): el del ejercicio, salvo que se haya hecho la alternativa.
  const slotProtocol = (rec, ex) => (rec && rec.altUsed && alts(ex).length ? "" : ex.protocol || "");

  function normName(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // ---------- Números y pesos ----------

  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(",", ".");
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // s: paso propio del ejercicio (pila de polea o máquina de 5 en 5 kg); si no, el de la unidad.
  function roundStep(v, unit, s = STEP[unit] || 5) {
    return Math.max(s, Math.round(v / s) * s);
  }

  function fmtNum(n) {
    const r = Math.round(n * 100) / 100;
    return String(r).replace(".", ",");
  }

  // ---------- Unidades: cada registro guarda la suya; se compara en lb ----------

  const LB_PER_KG = 2.20462;
  const otherUnit = (u) => (u === "kg" ? "lb" : "kg");
  function convert(w, from, to) {
    if (from === to) return w;
    return to === "kg" ? w / LB_PER_KG : w * LB_PER_KG;
  }
  const toLb = (w, unit) => convert(w, unit || "lb", "lb");
  const round1 = (n) => Math.round(n * 10) / 10;
  const roundHalf = (n) => Math.round(n * 2) / 2;
  // ---------- Fechas del ciclo ----------
  // data.meta = { startDate, dayDates: { "E_w0": "YYYY-MM-DD" }, dayStatus: { "E_w0": { status: "skipped", reason, savedAt } } }

  const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  const dayId = (day, week) => `${day}_w${week}`;
  const cycleStart = (routine, data) => (data && data.meta && data.meta.startDate) || routine.startDate || null;

  // Fecha planificada del día: inicio del ciclo + semana + distancia al día de la semana.
  function plannedDate(routine, data, dayKey, week) {
    const start = parseDate(cycleStart(routine, data));
    const d = routine.days.find((x) => x.key === dayKey);
    if (!start || !d) return null;
    const offset = (d.weekday - start.getDay() + 7) % 7;
    return isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + offset));
  }

  // Fecha real: la editada a mano, o la planificada.
  function dayDate(routine, data, dayKey, week) {
    const o = data && data.meta && data.meta.dayDates && data.meta.dayDates[dayId(dayKey, week)];
    return o || plannedDate(routine, data, dayKey, week);
  }

  function dayStatus(data, dayKey, week) {
    const st = data && data.meta && data.meta.dayStatus && data.meta.dayStatus[dayId(dayKey, week)];
    return st && st.status ? st : null;
  }

  // Unidad de un registro: la guardada, o la de la rutina (registros anteriores a esta función).
  const recUnit = (rec, routine) => (rec && rec.unit) || (routine && routine.unitDefault) || "lb";

  // Discos por lado para armar un peso total con la barra (discos del gym: 45, 35, 25, 10, 5 y 2,5 lb).
  // Busca la combinación con menos discos (con el de 35, "el más grande que entre" no alcanza:
  // 105 = 45+35+25, no 45+45+10+5). A igual cantidad, prefiere los discos más grandes.
  const PLATES_LB = [45, 35, 25, 10, 5, 2.5];
  function platesFor(total, bar) {
    const side = (total - bar) / 2;
    if (!(side > 0)) return null;
    const units = Math.floor(side / 2.5 + 1e-9); // todo en pasos de 2,5 lb
    const better = (a, b) => {
      if (a.length !== b.length) return a.length < b.length;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
      return false;
    };
    const best = [[]]; // best[u] = discos (de mayor a menor) que suman u × 2,5
    for (let u = 1; u <= units; u++) {
      best[u] = null;
      for (const p of PLATES_LB) {
        const prev = best[u - Math.round(p / 2.5)];
        if (!prev) continue;
        const cand = [...prev, p].sort((x, y) => y - x);
        if (!best[u] || better(cand, best[u])) best[u] = cand;
      }
    }
    const plates = best[units];
    const rest = side - units * 2.5;
    return { side, plates, rest: Math.round(rest * 100) / 100 };
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
          const unit = recUnit(rec, r);
          out.push({
            cycle: Number(c), week: w, key: k, day: d.key, weight, unit, weightLb: toLb(weight, unit), reps: repsText(rec), repsArr,
            setWeights: Array.isArray(rec.setWeights) ? rec.setWeights : null,
            topReps: topRepsOf(rec, repsArr), date: dayDate(r, data, d.key, w) || rec.savedAt || null, savedAt: rec.savedAt || null,
            note: rec.note || "", completed: !!rec.completed, altUsed: !!rec.altUsed, weekShort: r.weekShort[w],
            protocol: slotProtocol(rec, ex), target: ex.targets[w], rpe: loggedRpe(rec),
          });
        }
      }));
    }
    return out;
  }

  // Orden cronológico: ciclo y semana mandan; dentro de la misma semana, la fecha.
  function chrono(a, b) {
    if (a.cycle !== b.cycle || a.week !== b.week) return a.cycle - b.cycle || a.week - b.week;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return 0;
  }

  // ¿r supera a best? Más peso, o el mismo peso con más reps.
  // Peso comparable (en lb, redondeado para que 100 kg y 220,5 lb no difieran por decimales).
  const cmpW = (r) => round1(r.weightLb !== undefined ? r.weightLb : r.weight);
  const beats = (r, best) => !best || cmpW(r) > cmpW(best) || (cmpW(r) === cmpW(best) && r.topReps > best.topReps);

  // Reps del récord: con peso por serie, las de la serie más pesada; si no, la mejor serie.
  function topRepsOf(rec, repsArr) {
    if (Array.isArray(rec.setWeights) && rec.setWeights.length) {
      const ws = rec.setWeights.map(parseNum);
      const i = ws.indexOf(Math.max(...ws.filter((x) => x > 0)));
      return parseNum((rec.reps || [])[i]) || 0;
    }
    return repsArr.length ? Math.max(...repsArr) : 0;
  }

  function findMax(records) {
    let best = null;
    for (const r of [...records].sort(chrono)) if (beats(r, best) || (best && cmpW(r) === cmpW(best) && r.topReps === best.topReps)) best = r;
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
  function prevWeight(data, day, idx, week, ex, defaultUnit) {
    const name = ex ? normName(slotName(data, day, idx, ex, week)) : null;
    for (let w = week - 1; w >= 0; w--) {
      if (name && normName(slotName(data, day, idx, ex, w)) !== name) continue;
      const rec = data[slotKey(day, idx, w)];
      const weight = rec ? parseNum(rec.weight) : NaN;
      if (weight > 0) return { weight, week: w, unit: (rec && rec.unit) || defaultUnit || "lb" };
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

  // ---------- Equipo y saltos de carga (CLAUDE.md §2) ----------
  // Cada equipo sube de a lo que permite: discos de 2,5 lb por lado (5 lb en total), poleas de 5 en 5 kg,
  // aductor/abductor/pec deck de 4 en 4 kg, mancuernas de 5 en 5 lb hasta 40 y después de 10 en 10.
  const DUMBBELLS_LB = [5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100];
  const EQUIP = {
    barbell: { label: "Barra", unit: "lb", step: 5, plates: true, bar: "women" },
    plates: { label: "Máquina con discos", unit: "lb", step: 5, plates: true, bar: "none" },
    dumbbell: { label: "Mancuernas", unit: "lb", ladder: DUMBBELLS_LB },
    cable: { label: "Polea (5 kg)", unit: "kg", step: 5 },
    machine5: { label: "Máquina (5 kg)", unit: "kg", step: 5 },
    machine4: { label: "Máquina (4 kg)", unit: "kg", step: 4 },
  };
  // Equipo a partir del nombre (se puede cambiar en la tarjeta). null = no se sabe: pasos genéricos de la unidad.
  function inferEquip(name) {
    const n = normName(name || "");
    if (/smith|prensa|remo t\b|arrodillad|talones/.test(n)) return "plates";
    if (/mancuerna|goblet/.test(n)) return "dumbbell";
    if (/polea|cuerda|cable|jalon|face pull|pallof/.test(n)) return "cable";
    if (/\bbarra\b|piramide/.test(n)) return "barbell";
    if (/extension de cuadriceps|curl femoral sentado/.test(n)) return "machine5";
    if (/maquina|aduccion|abduccion|pec deck/.test(n)) return "machine4";
    return null;
  }

  // Subida máxima por semana de la sugerencia (10%): progresar de a poco.
  const MAX_JUMP = 0.1;
  // Ejercicios chicos que progresan lento (hombro, brazos, aperturas): piden más reps antes de un salto grande.
  function isSlowLift(name) {
    const n = normName(name || "");
    if (/femoral/.test(n)) return false;
    return /elevacion lateral|elevacion posterior|pec deck|face pull|curl|triceps|press frances|aperturas|apertura/.test(n);
  }

  // Escala de carga: los pesos que existen de verdad. round/floor caen en un valor posible;
  // next/prev = el siguiente/anterior (lo que hace el + / − y "subí un escalón").
  function uniformScale(s) {
    const e = 1e-9;
    return {
      step: s,
      round: (v) => Math.max(s, Math.round(v / s) * s),
      floor: (v) => Math.max(s, Math.floor(v / s + e) * s),
      next: (v) => (Math.floor(v / s + e) + 1) * s,
      prev: (v) => Math.max(0, (Math.ceil(v / s - e) - 1) * s),
    };
  }
  function ladderScale(list) {
    const gap = list[list.length - 1] - list[list.length - 2];
    const upTo = (v) => { const a = [...list]; while (a[a.length - 1] <= v) a.push(a[a.length - 1] + gap); return a; };
    return {
      step: list[1] - list[0],
      round: (v) => upTo(v).reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) - 1e-9 ? x : b)),
      floor: (v) => upTo(v).reduce((b, x) => (x <= v + 1e-9 ? x : b), list[0]),
      next: (v) => upTo(v).find((x) => x > v + 1e-9),
      prev: (v) => upTo(v).reduce((b, x) => (x < v - 1e-9 ? x : b), 0),
    };
  }
  // step: paso fijo de la rutina (manda); si no, el del equipo cuando se usa en su unidad; si no, el de la unidad.
  function loadScale(equip, unit, step) {
    if (step > 0) return uniformScale(step);
    const e = EQUIP[equip];
    if (e && e.unit === unit) return e.ladder ? ladderScale(e.ladder) : uniformScale(e.step);
    return uniformScale(STEP[unit] || 5);
  }

  // RPE pedido en un target ("@RPE8-9" → 8,5). Sin RPE escrito, el de la fase (§3.1): S1 7 · S2 8 · S3 9 · S4 5,5.
  const PHASE_RPE = [7, 8, 9, 5.5];
  function rpeOf(target, week) {
    const m = /@\s*RPE\s*(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+(?:[.,]\d+)?))?/i.exec(String(target || ""));
    if (!m) return PHASE_RPE[week] != null ? PHASE_RPE[week] : null;
    const a = parseNum(m[1]), b = m[2] ? parseNum(m[2]) : a;
    return (a + b) / 2;
  }
  // RPE que marqué al registrar (6–10), si lo marqué.
  const loggedRpe = (rec) => { const n = rec ? parseNum(rec.rpe) : NaN; return n >= 5 && n <= 10 ? n : null; };

  // Fuerza estimada (1RM, fórmula de Epley) con las reps hechas + las que quedaron en reserva (10 − RPE),
  // y el peso que da esa misma fuerza con otras reps y otro RPE. Así un cambio de rango (8-10 @RPE7 → 4-6 @RPE9)
  // se traduce en el salto de peso que corresponde, no en un +5% fijo que se queda corto.
  // Si marqué el RPE real, se usa ese (no el del plan): es lo que más afina la estimación.
  const e1rm = (w, reps, rpe) => w * (1 + (reps + (10 - rpe)) / 30);
  const fromE1rm = (e, reps, rpe) => e / (1 + (reps + (10 - rpe)) / 30);
  // Peso (sin redondear) para el techo del rango de `target` al RPE pedido, desde una marca.
  function projectWeight(weight, repsDone, fromTarget, fromWeek, target, week, fromRpe) {
    const was = repRange(fromTarget), cur = repRange(target);
    if (!cur) return null;
    const done = repsDone.length ? repsDone.reduce((a, b) => a + b, 0) / repsDone.length : was ? was.hi : null;
    const rf = fromRpe != null ? fromRpe : rpeOf(fromTarget, fromWeek), rt = rpeOf(target, week);
    if (!(done > 0) || rf == null || rt == null) return null;
    return fromE1rm(e1rm(weight, done, rf), cur.hi, rt);
  }

  // Qué hace falta para superar el récord (más peso, o mismo peso con más reps), dicho en simple.
  // peak = semana pico (S3 o RPE 9): ahí se busca el récord; en S1–S2 se deja margen.
  function recordNote(value, max, cur, peak, unit, scale) {
    if (!max || !(max.weight > 0)) return "";
    const mw = max.weight, mr = max.topReps || 0;
    const rec = `${fmtNum(mw)} ${unit}${mr ? ` × ${mr}` : ""}`;
    if (value > mw) return `Con este peso ya superás tu récord (${rec}).`;
    if (value === mw) return `Con ${fmtNum(mw)} ${unit} × ${mr + 1} superás tu récord (${rec}).`;
    if (peak) return `Esta es la semana para el récord (${rec}): hacé ${fmtNum(mw)} ${unit} × ${mr + 1} o subí a ${fmtNum(scale.next(mw))} ${unit}.`;
    return `Tu récord es ${rec}: se busca en la semana pico (S3); hoy toca dejar reps en reserva.`;
  }

  // Devuelve { value, base, pct, mode, goal, text, record } o null.
  // mode: "up" · "reps" · "same" · "deload" · "calibrate" (sin referencia directa: usar la 1ª serie)
  // scale: escala de carga del ejercicio (loadScale); sin ella, `step` o el paso de la unidad.
  // lastSame: la misma semana de un ciclo anterior (S3 contra S3): la sugerencia apunta a superarla.
  function recommend(args) {
    const scale = args.scale || loadScale(null, args.unit, args.step);
    let r = recommendBase({ ...args, scale });
    if (!r || r.mode === "deload" || args.fixedLoad) return r;
    const cur = repRange(args.target), unit = args.unit, ls = args.lastSame;
    // Misma semana del ciclo anterior (S2 contra S2, S3 contra S3): apuntar a superarla, sin saltar más de ~10%.
    if (ls && args.week > 0 && cur && ls.weight > 0) {
      const p = projectWeight(ls.weight, ls.repsArr || [], ls.target, args.week, args.target, args.week, loggedRpe(ls));
      const aim = p == null ? ls.weight : Math.max(scale.floor(p), ls.weight);
      const cap = r.mode === "calibrate" ? aim : Math.max(r.value, scale.floor(r.value * 1.1));
      const v = Math.min(aim, Math.max(cap, r.value));
      if (v > r.value) {
        const wkN = args.weekShort && args.weekShort[args.week] ? String(args.weekShort[args.week]).replace(/\s*\(.*\)\s*$/, "") : `S${args.week + 1}`;
        const lr = ls.repsArr && ls.repsArr.length ? ` × ${ls.repsArr.join("·")}` : "";
        const base = r.mode === "calibrate" ? ls.weight : r.base;
        const wDir = v > base ? "up" : v < base ? "down" : "same";
        r = { ...r, value: v, base, pct: pctDiff(v, base), mode: v > base ? "up" : "reps",
          goal: goalLabel(wDir, v === ls.weight ? "up" : "same"),
          text: `En ${wkN} del ciclo ${ls.cycle} hiciste ${fmtNum(ls.weight)} ${unit}${lr}: para progresar, ${v === ls.weight ? `mismo peso y más reps` : `~${fmtNum(v)} ${unit}`}. (${r.text})` };
      }
    }
    // Saltos chicos: no más de ~10% por semana. Si el siguiente peso que existe es un salto más grande
    // (polea de 5 a 10 kg, mancuerna de 10 a 15 lb), primero se suman reps por encima del rango.
    if (args.prev && r.mode !== "calibrate" && r.base > 0 && r.value > r.base) {
      const weeks = Math.max(1, args.week - args.prev.week);
      const limit = r.base * (1 + MAX_JUMP * weeks);
      if (r.value > limit + 1e-9) {
        const extra = args.slow ? 5 : 3;
        const reps = repsNums(args.prevRec);
        const earned = cur && reps.length && reps.every((x) => x >= cur.hi + extra);
        const within = scale.floor(limit);
        const jump = pctDiff(r.value, r.base);
        if (within > r.base) {
          r = { ...r, value: within, pct: pctDiff(within, r.base),
            text: `${r.text} · sin saltar más de ${Math.round(MAX_JUMP * weeks * 100)}%: ${fmtNum(within)} ${unit}` };
        } else if (earned) {
          r = { ...r, text: `${r.text} · ya hiciste ${cur.hi + extra}+ reps en todas: toca el salto (+${jump}%)` };
        } else {
          r = { ...r, value: r.base, pct: 0, mode: "reps", goal: goalLabel("same", "up"),
            text: `Subir a ${fmtNum(r.value)} ${unit} es un salto grande (+${jump}%)${args.slow ? " y este ejercicio progresa lento" : ""}: `
              + `quedate en ${fmtNum(r.base)} ${unit} y sumá reps${cur ? ` hasta ${cur.hi + extra} en todas` : ""} antes de subir.` };
        }
      }
    }
    const peak = args.week === 2 || rpeOf(args.target, args.week) >= 9;
    r.record = recordNote(r.value, args.max, cur, peak, unit, scale);
    return r;
  }

  function recommendBase({ target, prevTarget, week, prev, prevRec, lastS1, lastS1Target, max, unit, weekShort, fixedLoad, scale: L }) {
    const wk = (i) => (weekShort && weekShort[i] ? String(weekShort[i]).replace(/\s*\(.*\)\s*$/, "") : `S${i + 1}`);
    const out = (value, base, mode, rDir, text) => {
      const wDir = value > base ? "up" : value < base ? "down" : "same";
      return { value, base, pct: pctDiff(value, base), mode, goal: goalLabel(wDir, rDir), text };
    };
    const up = (base) => Math.max(L.next(base), L.round(base * 1.05));
    const cur = repRange(target);
    // Peso fijo (pirámide de Bret): el peso no cambia en todo el ciclo; se progresa sumando reps.
    if (fixedLoad && prev) {
      const reps = repsNums(prevRec);
      return out(prev.weight, prev.weight, "reps", "up", `Peso fijo todo el ciclo: mismo peso que en ${wk(prev.week)}${reps.length ? ` (hiciste ${reps.join("·")})` : ""}; buscá ${cur ? cur.hi : "más"} reps`);
    }
    if (prev) {
      const pw = prev.weight;
      const was = repRange(prevTarget);
      if (isDeloadTarget(target)) return out(L.round(pw * 0.55), pw, "deload", repsDir(cur, was), `Descarga: ~55% del peso de ${wk(prev.week)}, terminando con 4+ reps en reserva`);
      const done = repsNums(prevRec);
      const felt = loggedRpe(prevRec);
      const feltTxt = felt != null ? ` (lo marcaste RPE ${fmtNum(felt)})` : "";
      // Cambia el rango de reps (o el RPE): el peso sale de la fuerza estimada con lo que hiciste.
      // Si el rango sube en un accesorio sin RPE escrito (15-20 → 20-25) sigue "mismo peso, más reps".
      const hasRpe = (t) => /@\s*RPE/i.test(String(t || ""));
      // Si marqué que costó más de lo pedido, también se recalcula con la fuerza estimada (y no se sube a ciegas).
      const harder = felt != null && felt >= rpeOf(prevTarget, prev.week) + 1;
      const raw = cur && was && (harder || cur.hi < was.hi || (cur.hi !== was.hi && hasRpe(target) && hasRpe(prevTarget)))
        ? projectWeight(pw, done, prevTarget, prev.week, target, week, felt) : null;
      const proj = raw != null ? L.floor(raw) : null;
      const gap = week - prev.week > 1 ? ` (estimado desde ${wk(prev.week)}: ${wk(week - 1)} todavía sin registrar)` : "";
      const did = `${done.length ? `En ${wk(prev.week)} hiciste ${fmtNum(pw)} × ${done.join("·")}` : `En ${wk(prev.week)} usaste ${fmtNum(pw)} ${unit}`}${feltTxt}`;
      if (hasPlusWeight(target) && felt != null && felt >= rpeOf(prevTarget, prev.week) + 2)
        return out(pw, pw, "reps", "up", `${did}: costó bastante más de lo pedido, así que todavía no subas: quedate en ${fmtNum(pw)} ${unit} hasta que se sienta más liviano`);
      if (hasPlusWeight(target)) {
        const v = Math.max(L.next(pw), proj || 0);
        return out(v, pw, "up", repsDir(cur, was), v > L.next(pw)
          ? `El plan pide subir. ${did}: para ${cur.lo}-${cur.hi} reps te corresponde ~${fmtNum(v)} ${unit}${gap}`
          : `El plan pide subir: de ${fmtNum(pw)} a ${fmtNum(v)} ${unit}${gap}`);
      }
      if (proj != null) {
        const v = harder ? Math.max(proj, pw) : cur.hi < was.hi ? Math.max(proj, L.next(pw)) : proj;
        if (harder && v === pw)
          return out(pw, pw, "reps", repsDir(cur, was), `${did}: costó más de lo pedido, quedate en ${fmtNum(pw)} ${unit} y buscá las reps del rango${gap}`);
        return out(v, pw, v > pw ? "up" : "same", repsDir(cur, was),
          `${did}: para ${cur.lo}-${cur.hi} reps @RPE${fmtNum(rpeOf(target, week))} te corresponde ~${fmtNum(v)} ${unit}${gap}`);
      }
      if (cur && was && cur.hi < was.hi && cur.hi <= was.lo)
        return out(up(pw), pw, "up", "down", `Rango más bajo que en ${wk(prev.week)} (${cur.lo}-${cur.hi}): más carga`);
      if (cur) {
        const reps = done;
        if (reps.length && reps.every((r) => r >= cur.hi))
          return out(L.next(pw), pw, "up", "down", `Llegaste a ${cur.hi} en todas: subí a ${fmtNum(L.next(pw))} ${unit} y volvé a ${cur.lo} reps`);
        // Marqué que me sobró mucho (2+ RPE por debajo de lo pedido): subir aunque no haya llegado al techo.
        if (felt != null && felt <= rpeOf(target, week) - 2)
          return out(L.next(pw), pw, "up", "same", `Lo marcaste RPE ${fmtNum(felt)}: te sobraron reps, subí a ${fmtNum(L.next(pw))} ${unit}`);
        return out(pw, pw, "reps", "up", reps.length
          ? `Hiciste ${reps.join("·")}${feltTxt}: buscá ${cur.hi} en todas antes de subir peso`
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
      const r = out(L.round(max.weight * 0.9), max.weight, "calibrate", "same", "~90% de tu máximo: ajustalo con la 1ª serie según el RPE");
      r.goal = "Calibrá el peso";
      return r;
    }
    return null;
  }

  // ---------- Historial de ciclos cerrados ----------
  // hist = { version: 1, cycles: [{ cycle, name, startDate, closedAt, sessions }], sessions: [...], skipped: [...] }
  // Al cerrar un ciclo sus registros pasan acá y el ciclo se borra del celular.

  const emptyHistory = () => ({ version: 1, cycles: [], sessions: [], skipped: [] });
  const isClosed = (hist, cycle) => !!(hist && hist.cycles.some((c) => c.cycle === Number(cycle)));

  // Sesiones del ciclo (todo registro con peso, reps, nota o completado) y días no completados.
  function cycleSessions(routine, data) {
    const sessions = [], skipped = [];
    routine.days.forEach((d) => {
      for (let w = 0; w < 4; w++) {
        const st = dayStatus(data, d.key, w);
        if (st) skipped.push({ cycle: routine.cycle, week: w, weekShort: routine.weekShort[w], day: d.key, date: dayDate(routine, data, d.key, w), reason: st.reason || "" });
      }
      d.exercises.forEach((ex, idx) => {
        for (let w = 0; w < 4; w++) {
          const rec = data[slotKey(d.key, idx, w)];
          if (!rec) continue;
          const weight = parseNum(rec.weight);
          const hasReps = (rec.reps || []).some((x) => String(x).trim() !== "");
          if (!(weight > 0) && !hasReps && !rec.completed && !rec.note && !rec.skipped) continue;
          sessions.push({
            cycle: routine.cycle, week: w, weekShort: routine.weekShort[w], day: d.key,
            exercise: slotName(data, d.key, idx, ex, w), protocol: slotProtocol(rec, ex), pattern: ex.pattern, type: d.type, noWeight: !!ex.noWeight, target: ex.targets[w],
            date: dayDate(routine, data, d.key, w) || rec.savedAt || null,
            weight: weight > 0 ? weight : null, unit: weight > 0 ? recUnit(rec, routine) : null,
            reps: rec.reps || [], repsSame: !!rec.repsSame, repsSameValue: rec.repsSameValue || "",
            ...(Array.isArray(rec.setWeights) ? { setWeights: rec.setWeights } : {}),
            ...(rec.skipped ? { skipped: true, skipReason: rec.skipReason || "" } : {}),
            note: rec.note || "", completed: !!rec.completed, altUsed: !!rec.altUsed,
            ...(loggedRpe(rec) != null ? { rpe: loggedRpe(rec) } : {}),
          });
        }
      });
    });
    return { sessions, skipped };
  }

  // Marcas con peso del historial, con la misma forma que collectRecords.
  function historyRecords(hist, name) {
    if (!hist) return [];
    const target = normName(name);
    return hist.sessions.filter((x) => x.weight > 0 && normName(x.exercise) === target).map((x) => {
      const repsArr = repsNums(x);
      const unit = x.unit || "lb";
      return {
        cycle: x.cycle, week: x.week, key: `hist:${x.cycle}:${x.day}:${x.week}`, day: x.day, weight: x.weight, unit, weightLb: toLb(x.weight, unit),
        setWeights: Array.isArray(x.setWeights) ? x.setWeights : null,
        reps: repsText(x), repsArr, topReps: topRepsOf(x, repsArr), date: x.date || null, savedAt: null,
        note: x.note || "", completed: !!x.completed, altUsed: !!x.altUsed, weekShort: x.weekShort, target: x.target, archived: true,
        protocol: x.protocol || "", rpe: loggedRpe(x),
      };
    });
  }

  // Cierra un ciclo: arma el historial nuevo y verifica que el máximo de cada ejercicio quedó igual.
  // No modifica nada: devuelve { hist, sessions, exercises, missing } o { error }.
  function closeCycle(hist, routine, data, now) {
    const h = hist ? JSON.parse(JSON.stringify(hist)) : emptyHistory();
    if (isClosed(h, routine.cycle)) return { error: `El ciclo ${routine.cycle} ya estaba cerrado` };
    const { sessions, skipped } = cycleSessions(routine, data);
    h.sessions.push(...sessions);
    h.skipped.push(...skipped);
    h.cycles.push({ cycle: routine.cycle, name: routine.name, startDate: cycleStart(routine, data), closedAt: (now || new Date()).toISOString(), sessions: sessions.length });
    const names = new Set(sessions.map((x) => x.exercise));
    const missing = [];
    for (const n of names) {
      const mine = findMax(collectRecords({ [routine.cycle]: routine }, { [routine.cycle]: data }, n));
      if (!mine) continue;
      const kept = findMax(historyRecords(h, n).filter((r) => r.cycle === routine.cycle));
      if (!kept || cmpW(kept) !== cmpW(mine) || kept.topReps !== mine.topReps) missing.push(n);
    }
    return { hist: h, sessions: sessions.length, exercises: names.size, missing };
  }

  // ---------- Índice de ejercicios (para el historial) ----------

  // Un ejercicio por nombre (sin tildes ni mayúsculas), en todos los ciclos guardados.
  function exerciseIndex(routines, allData, activeCycle, hist) {
    const map = new Map();
    for (const c of Object.keys(routines).map(Number).sort((a, b) => b - a)) {
      const r = routines[c], data = allData[c] || {};
      r.days.forEach((d, di) => d.exercises.forEach((ex, idx) => {
        const names = new Set([effectiveName(data, d.key, idx, ex), ...[0, 1, 2, 3].map((w) => slotName(data, d.key, idx, ex, w))]);
        for (const name of names) {
          const key = normName(name);
          // lastDay: día donde se hizo más recientemente (los ciclos se recorren del más nuevo al más viejo)
          if (!map.has(key)) map.set(key, { key, name, pattern: ex.pattern, type: d.type, noWeight: !!ex.noWeight, days: new Set(), cycles: new Set(), order: Infinity, lastDay: d.key, lastDayCycle: c });
          const e = map.get(key);
          e.cycles.add(c);
          if (c === activeCycle) { e.days.add(d.key); e.order = Math.min(e.order, di * 100 + idx); }
        }
      }));
    }
    // Ejercicios que solo existen en ciclos cerrados.
    for (const x of (hist && hist.sessions) || []) {
      const key = normName(x.exercise);
      if (!map.has(key)) map.set(key, { key, name: x.exercise, pattern: x.pattern, type: x.type, noWeight: !!x.noWeight, days: new Set(), cycles: new Set(), order: Infinity, lastDay: x.day, lastDayCycle: x.cycle });
      const e = map.get(key);
      e.cycles.add(x.cycle);
      if (x.day && x.cycle > e.lastDayCycle) { e.lastDay = x.day; e.lastDayCycle = x.cycle; }
    }
    const list = [...map.values()];
    for (const e of list) {
      e.records = collectRecords(routines, allData, e.name).concat(historyRecords(hist, e.name));
      e.max = findMax(e.records);
      e.last = lastRecord(e.records);
      e.group = e.pattern && /^core/i.test(e.pattern) ? "core" : e.type;
    }
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
  }

  // ---------- Fechas y selección automática ----------

  function weekFromStart(startDate, today) {
    if (startDate && typeof startDate === "object") startDate = isoDate(startDate);
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
      startDate: cycleStart(routine, data),
      unit,
      days: routine.days.map((d) => ({
        day: d.key,
        title: d.title,
        sessions: [0, 1, 2, 3].map((w) => {
          const st = dayStatus(data, d.key, w);
          return { week: routine.weekShort[w], date: dayDate(routine, data, d.key, w), status: st ? st.status : null, reason: st ? st.reason || "" : "" };
        }),
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
              unit: rec.weight ? recUnit(rec, routine) : null,
              weightMode: rec.weightMode || null,
              perSide: rec.perSideDisplay ?? null,
              reps: rec.reps || [],
              setWeights: Array.isArray(rec.setWeights) ? rec.setWeights : null,
              skipped: !!rec.skipped,
              skipReason: rec.skipReason || "",
              repsText: repsText(rec),
              rpe: loggedRpe(rec),
              note: rec.note || "",
              completed: !!rec.completed,
              date: rec.savedAt || null,
            };
          }),
        })),
      })),
    };
  }

  function buildBackup({ routines, data, unit, theme, history, equip }, now) {
    return { type: "gluteo-backup", version: 1, exportedAt: (now || new Date()).toISOString(), prefs: { unit, theme, equip: equip || {} }, routines, data, history: history || null };
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
    dataKey, slotKey, ovrKey, parseSlotKey, effectiveName, slotName, slotProtocol, alts, normName,
    parseNum, roundStep, fmtNum, barWeight, calcBar, repsText, PLATES_LB, platesFor, rpeOf, projectWeight, loggedRpe, EQUIP, inferEquip, loadScale, isSlowLift, MAX_JUMP,
    LB_PER_KG, otherUnit, convert, toLb, round1, roundHalf, recUnit, cmpW,
    collectRecords, findMax, prHistory, lastRecord, prevWeight, repRange, repsNums, lastCycleS1, recommend, goalLabel, exerciseIndex,
    weekFromStart, autoDayKey,
    isoDate, parseDate, dayId, cycleStart, plannedDate, dayDate, dayStatus,
    buildCycleExport, buildBackup, checkBackup,
    emptyHistory, isClosed, cycleSessions, historyRecords, closeCycle,
  };
})(typeof window !== "undefined" ? window : globalThis);
