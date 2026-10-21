/* app.js — interfaz de Glúteo Tracker.
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
    histCycle: null,
    histNotes: new Set(),
    sheet: false,
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
    S.histCycle = null;
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
      <p><b>No hay ninguna rutina cargada.</b></p>
      <p>Se carga sola desde <code>${ROUTINE_URL}</code> cuando hay conexión, o podés importarla desde ⚙ Ajustes.</p>
      <button class="secondary-btn open-settings-btn" data-action="open-settings">Abrir Ajustes</button>
    </div>`;
  }

  function backupNag() {
    if (!hasAnyData()) return "";
    const last = store.get(KEYS.lastBackup, null);
    const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
    if (days !== null && days < BACKUP_EVERY_DAYS) return "";
    const txt = days === null ? "Todavía no hiciste ningún respaldo." : `Hace ${days} días que no hacés un respaldo.`;
    return `<div class="banner inline"><span>💾 ${txt}</span><button class="link-btn backup-nag-btn" data-action="backup">Respaldar</button></div>`;
  }

  function renderRutina() {
    const r = routine();
    if (!r) return renderEmpty();
    const day = currentDay();
    const weeks = r.weekShort.map((w, i) =>
      `<button class="seg-btn week-btn${i === S.week ? " active" : ""}" data-action="week" data-week="${i}">${esc(w)}</button>`).join("");
    const days = r.days.map((d) => {
      const done = d.exercises.filter((_, i) => S.data[G.slotKey(d.key, i, S.week)]?.completed).length;
      return `<button class="day-btn ${d.type}${d.key === day.key ? " active" : ""}" data-action="day" data-day="${d.key}">
        <span>${esc(d.label)}</span><small>${done}/${d.exercises.length}</small></button>`;
    }).join("");
    const cards = day.exercises.map((ex, i) => renderCard(day, ex, i)).join("");
    return `${backupNag()}
      <div class="seg weeks" role="tablist" aria-label="Semana">${weeks}</div>
      <div class="days" role="tablist" aria-label="Día">${days}</div>
      <div class="day-head">
        <h2>${esc(day.title)}</h2>
        <div class="sub">${esc(day.dayName)} · ${esc(r.weeks[S.week])}</div>
        ${day.warmup ? `<div class="warmup">🔥 <b>Activación:</b> ${esc(day.warmup)}</div>` : ""}
      </div>
      ${cards}`;
  }

  function weightSummary(rec) {
    const w = rec ? G.parseNum(rec.weight) : NaN;
    if (!(w > 0)) return "Sin peso";
    const side = rec.weightMode === "perSide" && rec.perSideDisplay != null ? ` · ${fmt(rec.perSideDisplay)}/lado` : "";
    return `${fmt(w)} ${S.unit}${side}`;
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
    const name = G.effectiveName(S.data, day.key, idx, ex);
    const open = S.open.has(idx);
    const done = !!(rec && rec.completed);
    const repsTxt = G.repsText(rec);
    const head = `<div class="card-head" data-action="toggle-card" data-idx="${idx}">
        <div class="card-info">
          ${ex.pattern ? `<div class="pattern">${esc(ex.pattern)}</div>` : ""}
          <div class="ex-name">${esc(name)}${name !== ex.name ? ' <span class="edited">(editado)</span>' : ""}</div>
          <div class="ex-target">${esc(ex.targets[w])}</div>
          <div class="ex-weight">${esc(weightSummary(rec))}${repsTxt ? ` · reps ${esc(repsTxt)}` : ""}</div>
        </div>
        <button class="done-btn" data-action="toggle-done" data-k="${k}" aria-pressed="${done}" aria-label="${done ? "Completado" : "Marcar como completado"}">✓</button>
      </div>`;
    const cls = `card ${day.type}${done ? " done" : ""}${open ? " open" : ""}`;
    if (!open) return `<div class="${cls}">${head}</div>`;
    return `<div class="${cls}" data-card="${k}">${head}${renderCardBody(day, ex, idx, k, rec, name)}</div>`;
  }

  function renderCardBody(day, ex, idx, k, rec, name) {
    const w = S.week, r = routine(), u = S.unit;
    const sets = ex.sets[w];
    const d = draftFor(k, rec, sets);
    const records = G.collectRecords(S.routines, allData(), name);
    const max = G.findMax(records);
    const others = records.filter((x) => !(x.cycle === S.cycle && x.key === k));
    const sug = ex.noWeight ? null : G.suggest({
      target: ex.targets[w], week: w, prev: G.prevWeight(S.data, day.key, idx, w),
      max: G.findMax(others), unit: u, weekShort: r.weekShort,
    });
    const overridden = name !== ex.name;

    const sugRow = sug
      ? `<div class="info-row">💡 Sugerido: <b>${fmt(sug.value)} ${u}</b> <span class="muted">· ${esc(sug.text)}</span>
           <button class="link-btn use-sug-btn" data-action="use-suggestion" data-k="${k}" data-value="${sug.value}">Usar</button></div>`
      : ex.noWeight ? "" : `<div class="info-row muted">💡 Sin historial: calibrá el peso con la primera serie.</div>`;
    const maxRow = ex.noWeight && !max ? "" : `<div class="info-row">🏆 ${max
      ? `Máximo: <b>${fmt(max.weight)} ${u}</b>${max.reps ? ` × ${esc(max.reps)}` : ""} <span class="muted">· Ciclo ${max.cycle} · ${esc(max.weekShort)}</span>`
      : '<span class="muted">Sin máximo registrado todavía</span>'}</div>`;

    const editBox = d.editOpen ? `<div class="edit-box">
        <input class="text-input" data-field="editName" data-k="${k}" value="${esc(d.editName)}" placeholder="Nombre del ejercicio" aria-label="Nuevo nombre">
        <div class="muted small" style="margin-top:6px">Reemplaza el nombre en las 4 semanas. Original: ${esc(ex.name)}</div>
        <div class="row-btns">
          <button class="chip-btn save-name-btn" data-action="save-name" data-k="${k}">Guardar nombre</button>
          ${overridden ? `<button class="chip-btn reset-name-btn" data-action="reset-name" data-k="${k}">Restablecer</button>` : ""}
          <button class="chip-btn cancel-name-btn" data-action="toggle-edit" data-k="${k}">Cancelar</button>
        </div></div>` : "";

    const repsInputs = d.repsSame
      ? `<input class="num-input reps-same-input" inputmode="numeric" data-field="repsSameValue" data-k="${k}" value="${esc(d.repsSameValue)}" placeholder="Reps de cada serie">`
      : `<div class="reps-grid">${Array.from({ length: sets }, (_, i) =>
          `<label class="rep-cell"><span>Serie ${i + 1}</span><input class="num-input rep-input" inputmode="numeric" data-field="rep" data-i="${i}" data-k="${k}" value="${esc(d.reps[i])}"></label>`).join("")}</div>`;

    const sideHint = d.weightMode === "perSide" && d.perSideDisplay != null
      ? `<div class="muted small perside-hint" style="margin-top:4px">= ${fmt(d.perSideDisplay)} ${u} por lado + barra</div>` : "";

    return `<div class="card-body">
      <div class="info-row">⏱ Descanso: <b>${esc(ex.rest)}</b> <span class="muted">· ${sets} series</span></div>
      ${sugRow}
      ${maxRow}
      <div class="row-btns">
        ${ex.alt ? `<button class="chip-btn alt-btn" data-action="toggle-alt" data-k="${k}">${d.altOpen ? "Ocultar" : "Ver"} alternativa</button>` : ""}
        <button class="chip-btn edit-btn" data-action="toggle-edit" data-k="${k}">✏️ Editar nombre</button>
      </div>
      ${d.altOpen && ex.alt ? `<div class="alt-box">🔁 <b>Alternativa:</b> ${esc(ex.alt)}</div>` : ""}
      ${editBox}
      <div class="field">
        <div class="field-label">Reps por serie</div>
        <label class="check"><input type="checkbox" class="reps-same-check" data-field="repsSame" data-k="${k}"${d.repsSame ? " checked" : ""}> Todas las series fueron iguales</label>
        ${repsInputs}
      </div>
      <div class="field">
        <div class="field-label">Peso${ex.noWeight ? ' <span class="muted">(opcional)</span>' : ""}</div>
        <div class="weight-row">
          <input class="num-input weight-input" inputmode="decimal" data-field="weight" data-k="${k}" value="${esc(d.weight)}" placeholder="0" aria-label="Peso total">
          <span class="unit">${u}</span>
          ${ex.noWeight ? "" : `<button class="chip-btn calc-toggle-btn" data-action="toggle-calc" data-k="${k}">🧮 Barra</button>`}
        </div>
        ${sideHint}
        ${d.calcOpen && !ex.noWeight ? renderCalc(k, d) : ""}
      </div>
      <div class="field">
        <div class="field-label">Nota</div>
        <textarea class="text-input note-input" rows="2" data-field="note" data-k="${k}" placeholder="Cómo se sintió, molestias, ajustes…">${esc(d.note)}</textarea>
      </div>
      <button class="primary-btn save-entry-btn" data-action="save-entry" data-k="${k}">Guardar</button>
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

  // ---------- Historial ----------

  function renderHistorial() {
    const cycles = cycleList();
    if (!cycles.length) return renderEmpty();
    const hc = S.histCycle ?? S.cycle;
    const r = S.routines[hc];
    const data = dataOf(hc);
    const select = cycles.length > 1 ? `<div class="seg small hist-select">${cycles.map((c) =>
      `<button class="seg-btn hist-cycle-btn${c === hc ? " active" : ""}" data-action="hist-cycle" data-cycle="${c}">Ciclo ${c}</button>`).join("")}</div>` : "";

    const days = r.days.map((d) => {
      const exs = d.exercises.map((ex, idx) => {
        const rows = [0, 1, 2, 3].map((w) => {
          const k = G.slotKey(d.key, idx, w), rec = data[k];
          const wt = rec ? G.parseNum(rec.weight) : NaN;
          const date = rec && rec.savedAt ? new Date(rec.savedAt).toLocaleDateString("es", { day: "2-digit", month: "2-digit" }) : "—";
          const noteKey = `${hc}:${k}`;
          const hasNote = !!(rec && rec.note);
          const row = `<div class="hist-row${hasNote ? " has-note" : ""}"${hasNote ? ` data-action="toggle-note" data-note="${noteKey}"` : ""}>
              <span class="wk">${esc(r.weekShort[w])}</span>
              <span class="muted">${date}</span>
              <span>${wt > 0 ? `${fmt(wt)} ${S.unit}` : "—"}${hasNote ? " 📝" : ""}</span>
              <span class="muted">${esc(G.repsText(rec)) || "—"}</span>
              <span class="ok">${rec && rec.completed ? "✓" : ""}</span>
            </div>`;
          return row + (hasNote && S.histNotes.has(noteKey) ? `<div class="hist-note">${esc(rec.note)}</div>` : "");
        }).join("");
        return `<div class="hist-ex"><div class="hist-ex-head">
            ${ex.pattern ? `<div class="pattern">${esc(ex.pattern)}</div>` : ""}
            <div class="ex-name">${esc(G.effectiveName(data, d.key, idx, ex))}</div></div>${rows}</div>`;
      }).join("");
      return `<h3 class="hist-day">${esc(d.key)} · ${esc(d.title)}</h3>${exs}`;
    }).join("");
    return `${select}<div class="muted small">${esc(r.name)}</div>${days}`;
  }

  // ---------- Ajustes ----------

  function renderSheet() {
    const sheet = $("#sheet");
    if (!S.sheet) { sheet.hidden = true; sheet.innerHTML = ""; return; }
    sheet.hidden = false;
    const themes = [["light", "Claro"], ["dark", "Oscuro"], ["auto", "Automático"]];
    const units = [["lb", "lb"], ["kg", "kg"]];
    const last = store.get(KEYS.lastBackup, null);
    const cycles = cycleList().map((c) => {
      const r = S.routines[c];
      return `<button class="cycle-btn${c === S.cycle ? " active" : ""}" data-action="set-cycle" data-cycle="${c}">
        <span><b>Ciclo ${c}</b><br><span class="muted small">${esc(r.name)}</span></span>
        <span class="muted small">${c === S.cycle ? "activo" : ""}</span></button>`;
    }).join("");
    sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-settings"></div>
      <div class="sheet-panel" role="dialog" aria-label="Ajustes">
        <div class="sheet-head"><h2>Ajustes</h2>
          <button class="icon-btn close-settings-btn" data-action="close-settings" aria-label="Cerrar">✕</button></div>
        <section><h3>Apariencia</h3><div class="seg">${themes.map(([v, l]) =>
          `<button class="seg-btn theme-btn${S.theme === v ? " active" : ""}" data-action="set-theme" data-theme="${v}">${l}</button>`).join("")}</div></section>
        <section><h3>Unidad</h3><div class="seg">${units.map(([v, l]) =>
          `<button class="seg-btn unit-btn${S.unit === v ? " active" : ""}" data-action="set-unit" data-unit="${v}">${l}</button>`).join("")}</div>
          <p class="muted small">Solo cambia las etiquetas: no convierte los valores guardados.</p></section>
        <section><h3>Ciclos</h3>${cycles || '<p class="muted small">Ninguno cargado.</p>'}
          <label class="secondary-btn file-btn">Importar rutina (JSON)
            <input type="file" class="visually-hidden import-routine-input" accept=".json,application/json" data-change="import-routine"></label></section>
        <section><h3>Datos</h3>
          ${S.cycle !== null ? `<button class="secondary-btn export-cycle-btn" data-action="export-cycle">Exportar datos del ciclo ${S.cycle}</button>` : ""}
          <button class="secondary-btn backup-btn" data-action="backup">Respaldo completo</button>
          <label class="secondary-btn file-btn">Restaurar respaldo
            <input type="file" class="visually-hidden restore-input" accept=".json,application/json" data-change="restore-backup"></label>
          <p class="muted small">Último respaldo: ${last ? new Date(last).toLocaleDateString("es") : "nunca"}.
            Todo vive en este celular: si se borran los datos de Safari, se pierden. Guardá el respaldo en Archivos o iCloud.</p></section>
      </div>`;
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
    "toggle-note"(el) {
      const n = el.dataset.note;
      if (S.histNotes.has(n)) S.histNotes.delete(n); else S.histNotes.add(n);
      render();
    },
    "hist-cycle"(el) { S.histCycle = Number(el.dataset.cycle); render(); },
    "open-settings"() { S.sheet = true; renderSheet(); },
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
