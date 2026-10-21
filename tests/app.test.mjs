// Prueba de humo de la app en jsdom (CLAUDE.md §6.3 #5): carga, tarjetas, guardar, nombre, calculadora, historial.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const APP = new URL("../app/", import.meta.url);
const read = (p) => readFileSync(new URL(p, APP), "utf8");
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/rutina-test.json", import.meta.url), "utf8"));

function inlineHTML() {
  let html = read("index.html");
  for (const src of ["js/core.js", "js/app.js"]) {
    const tag = `<script src="${src}"></script>`;
    assert.ok(html.includes(tag), `index.html debe cargar ${src}`);
    html = html.replace(tag, () => `<script>${read(src)}</script>`);
  }
  return html;
}

async function boot({ storage = {}, routine = FIXTURE, published = [] } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  vc.on("error", (...a) => errors.push(a.join(" ")));
  const downloads = []; downloads.names = [];
  const dom = new JSDOM(inlineHTML(), {
    url: "https://gluteo.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
      // Red simulada: ciclo-actual.json, el índice de ciclos publicados y cada ciclo-N.json.
      const ok = (body) => ({ ok: true, json: async () => structuredClone(body) });
      const fail = { ok: false, json: async () => ({}) };
      win.fetch = async (url) => {
        if (!routine) return fail;
        if (/index\.json$/.test(url)) return ok({ cycles: published.map((r) => ({ cycle: r.cycle, name: r.name })) });
        const m = /ciclo-(\d+)\.json$/.exec(url);
        if (m) { const r = published.find((x) => x.cycle === Number(m[1])); return r ? ok(r) : fail; }
        return ok(routine);
      };
      win.confirm = () => true;
      win.scrollTo = () => {};
      win.URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test"; };
      win.URL.revokeObjectURL = () => {};
      // jsdom no implementa la navegación del <a download>: registramos el nombre del archivo.
      win.HTMLAnchorElement.prototype.click = function () { downloads.names.push(this.download); };
    },
  });
  const w = dom.window;
  await w.GluteoApp.ready;
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];
  const click = (s) => { const el = typeof s === "string" ? $(s) : s; assert.ok(el, `no existe ${s}`); el.click(); };
  const type = (s, value) => {
    const el = $(s); assert.ok(el, `no existe ${s}`);
    el.value = value; el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const data = () => JSON.parse(w.localStorage.getItem(`gluteo_tracker_ciclo-${FIXTURE.cycle}`) || "{}");
  const toast = () => $("#toast").textContent;
  const goTo = (week, day) => { click(`.week-btn[data-week="${week}"]`); click(`.day-btn[data-day="${day}"]`); };
  const openCard = (idx) => click($$(".card-head")[idx]);
  return { w, $, $$, click, type, data, toast, goTo, openCard, errors, downloads };
}

test("arranca sin errores, en modo claro, con la rutina del JSON", async () => {
  const t = await boot();
  assert.deepEqual(t.errors, []);
  assert.equal(t.w.document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(t.$$(".week-btn").length, 4);
  assert.equal(t.$$(".day-btn").length, 2);
  assert.equal(t.$("#cycleChip").textContent, "Ciclo 9");
  t.goTo(0, "A");
  assert.equal(t.$$(".card").length, 3);
  assert.match(t.$(".warmup").textContent, /monster walk/);
  assert.equal(JSON.parse(t.w.localStorage.getItem("gluteo_rutinas"))[9].name, "Rutina de prueba");
});

test("sin rutina disponible muestra el estado vacío", async () => {
  const t = await boot({ routine: null });
  assert.deepEqual(t.errors, []);
  assert.match(t.$("#root").textContent, /No hay ninguna rutina cargada/);
});

test("no guarda ni completa sin peso; guarda con peso y reps", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.click(t.$$(".done-btn")[0]);
  assert.match(t.toast(), /Cargá y guardá el peso/);
  t.openCard(0);
  t.click(".save-entry-btn");
  assert.match(t.toast(), /Cargá el peso/);
  assert.deepEqual(t.data(), {});

  t.type(".weight-input", "215");
  t.$$(".rep-input").forEach((el, i) => { el.value = String(10 - i); el.dispatchEvent(new t.w.Event("input", { bubbles: true })); });
  t.type(".note-input", "  bastante pesadito ");
  t.click(".save-entry-btn");
  const rec = t.data().A_0_w0;
  assert.equal(rec.weight, "215");
  assert.deepEqual(rec.reps, ["10", "9", "8", "7"]);
  assert.equal(rec.note, "bastante pesadito");
  assert.equal(rec.completed, false);
  assert.match(t.toast(), /Guardado ✓/);  // el toast sobrevive al re-render
  assert.match(t.$(".ex-weight").textContent, /215 lb/);

  t.click(t.$$(".done-btn")[0]);
  assert.equal(t.data().A_0_w0.completed, true);
  assert.equal(t.$$(".done-btn")[0].getAttribute("aria-pressed"), "true");
  assert.match(t.$('.day-btn[data-day="A"] small').textContent, /1\/3/);
  assert.deepEqual(t.errors, []);
});

test("reps 'todas iguales' usan un solo campo", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.openCard(1);
  t.$(".reps-same-check").checked = true;
  t.$(".reps-same-check").dispatchEvent(new t.w.Event("change", { bubbles: true }));
  assert.equal(t.$$(".rep-input").length, 0);
  t.type(".reps-same-input", "12");
  t.type(".weight-input", "30");
  t.click(".save-entry-btn");
  const rec = t.data().A_1_w0;
  assert.deepEqual(rec.reps, ["12", "12", "12"]);
  assert.equal(rec.repsSame, true);
});

test("core (noWeight) se completa directo, sin peso", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.click(t.$$(".done-btn")[2]);
  assert.equal(t.data().A_2_w0.completed, true);
  assert.match(t.toast(), /Completado/);
});

test("editar nombre guarda el override y no toca el peso (trampa §6.3 #1)", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.openCard(0);
  t.type(".weight-input", "200");
  t.click(".save-entry-btn");
  t.openCard(0);
  t.click(".edit-btn");
  t.type('[data-field="editName"]', "Hip thrust con banda");
  t.click(".save-name-btn");
  const d = t.data();
  assert.equal(d.ovr_A_0.name, "Hip thrust con banda");
  assert.equal(d.A_0_w0.weight, "200");
  assert.match(t.$(".ex-name").textContent, /Hip thrust con banda/);
  t.goTo(2, "A");
  assert.match(t.$(".ex-name").textContent, /Hip thrust con banda/, "el nombre aplica a todas las semanas");

  t.openCard(0);
  t.click(".edit-btn");
  t.click(".reset-name-btn");
  assert.equal(t.data().ovr_A_0.name, null);
  assert.equal(t.$(".ex-name").textContent.trim(), "Hip thrust con barra libre (pausa 2s arriba)");
  assert.deepEqual(t.errors, []);
});

test("calculadora: 90 por lado + barra de mujer = 215", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.openCard(0);
  t.click(".calc-toggle-btn");
  t.type(".calc-value-input", "90");
  assert.match(t.$(".calc-result").textContent, /Total: 215 lb/);
  t.click('.calc-mode-btn[data-mode="total"]');
  assert.equal(t.$(".calc-value-input").value, "215");
  assert.match(t.$(".calc-result").textContent, /Por lado: 90 lb/);
  t.click('.calc-bar-btn[data-bar="men"]');
  assert.match(t.$(".calc-result").textContent, /Por lado: 85 lb/);
  t.click('.calc-bar-btn[data-bar="women"]');
  t.click(".use-calc-btn");
  assert.equal(t.$(".weight-input").value, "215");
  t.click(".save-entry-btn");
  const rec = t.data().A_0_w0;
  assert.equal(rec.weightMode, "perSide");
  assert.equal(rec.perSideDisplay, 90);
  assert.match(t.$(".ex-weight").textContent, /215 lb · 90\/lado/);
});

test("sugerencias: (+peso) en S2 y 55% en descarga", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(0); t.type(".weight-input", "215"); t.click(".save-entry-btn");
  t.goTo(1, "A"); t.openCard(0);
  assert.match(t.$(".use-sug-btn").closest(".insight").textContent, /220 lb\s*\+2%/);
  assert.match(t.$(".use-sug-btn").closest(".insight").textContent, /Más peso/);
  t.click(".use-sug-btn");
  assert.equal(t.$(".weight-input").value, "220");
  t.click(".save-entry-btn");
  t.goTo(2, "A"); t.openCard(0); t.type(".weight-input", "235"); t.click(".save-entry-btn");
  t.goTo(3, "A"); t.openCard(0);
  assert.match(t.$(".use-sug-btn").closest(".insight").textContent, /130 lb\s*−45%/);
  assert.match(t.$(".why").textContent, /Descarga/);
  assert.match(t.$(".card-body").textContent, /Máximo\s*235 lb/);
  // la tarjeta plegada también muestra máximo y sugerencia
  t.click(t.$$(".card-head")[0]);
  assert.match(t.$(".ex-max").textContent, /235/);
  assert.match(t.$(".ex-sug").textContent, /130 lb −45% · Menos peso/);
});

test("borradores sobreviven al re-render de otra tarjeta", async () => {
  const t = await boot();
  t.goTo(0, "A");
  t.openCard(0);
  t.type(".weight-input", "180");
  t.click(t.$$(".done-btn")[2]);              // completar el core re-renderiza todo
  assert.equal(t.$(".weight-input").value, "180");
});

test("historial: lista con máximo, buscador, filtros y detalle con récords", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(0);
  t.type(".weight-input", "215"); t.type(".note-input", "pausa bien marcada");
  t.click(".save-entry-btn");
  t.goTo(1, "A"); t.openCard(0); t.type(".weight-input", "225"); t.click(".save-entry-btn");
  t.click('.tab[data-tab="historial"]');
  const items = () => t.$$(".hist-item");
  assert.equal(items().length, 4);
  assert.match(items()[0].textContent, /225 lb/);
  const search = t.$(".search-input");
  t.type(".search-input", "bulgara");                       // sin tilde
  assert.equal(items().length, 1);
  assert.match(items()[0].textContent, /Sentadilla búlgara/);
  assert.equal(t.$(".search-input"), search, "buscar no re-renderiza el campo (no se pierde el foco)");
  t.type(".search-input", "");
  t.click('.hist-filter-btn[data-filter="core"]');
  assert.equal(items().length, 1);
  t.click('.hist-filter-btn[data-filter="all"]');
  t.click(items()[0]);
  assert.match(t.$(".pr-hero").textContent, /225 lb/);
  assert.equal(t.$$(".pr-row").length, 2);                  // 215 → 225
  assert.equal(t.$$(".sess-row").length, 2);
  assert.match(t.$(".sess-note").textContent, /pausa bien marcada/);
  t.click(".hist-back-btn");
  assert.ok(t.$(".search-input"));
  assert.deepEqual(t.errors, []);
});

test("alternativa: usar esta semana, volver, y usar en todo el ciclo", async () => {
  const t = await boot();
  t.goTo(1, "A"); t.openCard(0);
  t.click(".alt-btn");
  t.click(".use-alt-btn");
  assert.equal(t.data().A_0_w1.altUsed, true);
  assert.match(t.$(".ex-name").textContent, /Hip thrust con mancuerna en banco · alternativa/);
  t.type(".weight-input", "60"); t.click(".save-entry-btn");
  assert.equal(t.data().A_0_w1.altUsed, true, "guardar conserva la alternativa");
  t.goTo(0, "A");
  assert.match(t.$(".ex-name").textContent, /pausa 2s/, "las otras semanas siguen con el original");
  t.goTo(1, "A"); t.openCard(0); t.click(".alt-btn"); t.click(".undo-alt-btn");
  assert.equal(t.data().A_0_w1.altUsed, false);
  t.click(".alt-btn"); t.click(".use-alt-cycle-btn");
  assert.equal(t.data().ovr_A_0.name, "Hip thrust con mancuerna en banco");
  t.goTo(3, "A");
  assert.match(t.$(".ex-name").textContent, /Hip thrust con mancuerna en banco · editado/);
  assert.deepEqual(t.errors, []);
});

test("glosario: solo desde el botón ⓘ del encabezado", async () => {
  const t = await boot();
  t.click(".glossary-top-btn");
  assert.ok(t.$$(".gl-item").length >= 10);
  assert.match(t.$("#sheet").textContent, /RPE/);
  t.click(".close-settings-btn");
  assert.ok(t.$("#sheet").hidden);
  t.goTo(2, "A"); t.openCard(0);
  assert.equal(t.$(".glossary-btn"), null, "las tarjetas ya no tienen botón de glosario");
  assert.equal(t.$$(".tools .tool-btn").length, 2);
  assert.deepEqual(t.errors, []);
});

test("ajustes: tema, unidad, export y respaldo", async () => {
  const t = await boot();
  t.click(".settings-btn");
  assert.ok(!t.$("#sheet").hidden);
  t.click('.theme-btn[data-theme="dark"]');
  assert.equal(t.w.document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(t.w.localStorage.getItem("gluteo_theme"), '"dark"');
  t.click('.unit-btn[data-unit="kg"]');
  assert.equal(t.w.localStorage.getItem("gluteo_unit"), '"kg"');
  t.click(".export-cycle-btn");
  t.click(".backup-btn");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.downloads.length, 2);
  assert.match(t.downloads.names[0], /^gluteo-ciclo-9-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(t.downloads.names[1], /^gluteo-respaldo-/);
  const text = await new Promise((resolve) => {
    const fr = new t.w.FileReader(); fr.onload = () => resolve(fr.result); fr.readAsText(t.downloads[1]);
  });
  const backup = JSON.parse(text);
  assert.equal(backup.type, "gluteo-backup");
  assert.ok(t.w.localStorage.getItem("gluteo_last_backup"));
  t.click(".close-settings-btn");
  assert.ok(t.$("#sheet").hidden);
  assert.deepEqual(t.errors, []);
});

test("los datos persisten al reabrir la app", async () => {
  const t1 = await boot();
  t1.goTo(0, "A"); t1.openCard(0); t1.type(".weight-input", "215"); t1.click(".save-entry-btn");
  const storage = {};
  for (let i = 0; i < t1.w.localStorage.length; i++) {
    const k = t1.w.localStorage.key(i);
    storage[k] = t1.w.localStorage.getItem(k);
  }
  const t2 = await boot({ storage, routine: null });   // sin red: usa lo guardado
  t2.goTo(0, "A");
  assert.match(t2.$(".ex-weight").textContent, /215 lb/);
});

test("todos los #id que usa app.js existen en index.html (trampa §6.3 #3)", () => {
  const js = read("js/app.js"), html = read("index.html");
  const ids = [...js.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `falta id="${id}"`);
});

test("cada data-action del HTML generado tiene manejador", () => {
  const js = read("js/app.js") + read("index.html");
  const used = new Set([...js.matchAll(/data-action="([\w-]+)"/g)].map((m) => m[1]));
  const actionsBlock = read("js/app.js").split("const actions = {")[1];
  for (const a of used) {
    const re = new RegExp(`(^|\\n)\\s*(async\\s+)?("${a}"|${a.replace(/-/g, "_")})\\s*\\(`);
    assert.match(actionsBlock, re, `falta el manejador de data-action="${a}"`);
  }
});

test("peso con − / + y aviso de nuevo récord", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(1);
  t.click(".step-up-btn");
  assert.equal(t.$(".weight-input").value, "5", "sin sugerencia arranca en 0 + 5");
  t.type(".weight-input", "200");
  t.click(".step-up-btn"); t.click(".step-up-btn"); t.click(".step-down-btn");
  assert.equal(t.$(".weight-input").value, "205");
  t.click(".save-entry-btn");
  assert.equal(t.data().A_1_w0.weight, "205");
  assert.match(t.toast(), /Guardado/, "la primera marca no es récord");
  t.goTo(1, "A"); t.openCard(1);
  t.click(".step-up-btn");
  assert.equal(t.$(".weight-input").value, "205", "con sugerencia, el primer toque usa la sugerencia");
  t.click(".step-up-btn");
  t.click(".save-entry-btn");
  assert.match(t.toast(), /Nuevo récord! 210 lb/);
  assert.ok(t.$("#toast").classList.contains("pr"));
  assert.ok(t.$$(".card")[1].classList.contains("fx-pr"));
  assert.deepEqual(t.errors, []);
});

test("lb/kg por ejercicio: convierte, guarda la unidad y muestra la equivalencia", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(0);
  assert.ok(t.$('.ex-unit-btn[data-unit="lb"]').classList.contains("active"), "lb por defecto");
  t.type(".weight-input", "215");
  assert.match(t.$(".conv-hint").textContent, /≈ 97,5 kg/);
  t.click('.ex-unit-btn[data-unit="kg"]');
  assert.equal(t.$(".weight-input").value, "97.5");
  assert.equal(t.$(".weight-box .unit").textContent, "kg");
  assert.match(t.toast(), /Convertido: 97,5 kg/);
  t.click(".step-up-btn");
  assert.equal(t.$(".weight-input").value, "100", "en kg el paso es 2,5");
  t.click(".save-entry-btn");
  const d = t.data();
  assert.equal(d.A_0_w0.unit, "kg");
  assert.equal(d.A_0_w0.weight, "100");
  assert.equal(d.unit_A_0, "kg");
  assert.match(t.$(".ex-weight").textContent, /100 kg · ≈ 220,5 lb/);
  // la semana siguiente queda en kg y la sugerencia también
  t.goTo(1, "A");
  assert.match(t.$(".ex-sug").textContent, /102,5 kg/);
  // otro ejercicio sigue en lb
  t.openCard(1);
  assert.ok(t.$('.card.open .ex-unit-btn[data-unit="lb"]').classList.contains("active"));
  // la calculadora usa la barra en kg
  t.openCard(0); t.click(".calc-toggle-btn");
  assert.match(t.$(".calc-bar-btn").textContent, /Mujer 15/);
  assert.deepEqual(t.errors, []);
});

test("descanso visible en la tarjeta plegada", async () => {
  const t = await boot();
  t.goTo(0, "A");
  assert.match(t.$$(".card")[0].querySelector(".ex-rest").textContent, /90-120s/);
});

test("fechas: inicio del ciclo, día calculado y fecha editada (día E en viernes)", async () => {
  const t = await boot();
  const change = (sel, value) => { const el = t.$(sel); el.value = value; el.dispatchEvent(new t.w.Event("change", { bubbles: true })); };
  t.goTo(0, "A");
  assert.match(t.$(".date-chip").textContent, /Poner fecha/);
  t.click(".settings-btn");
  change(".cycle-start-input", "2026-09-07");                 // lunes
  assert.equal(t.data().meta.startDate, "2026-09-07");
  t.click(".close-settings-btn");
  t.goTo(1, "B");
  assert.equal(t.$(".day-date-input").value, "2026-09-15", "martes de la semana 2");
  change(".day-date-input", "2026-09-18");                    // lo hizo el viernes
  assert.equal(t.data().meta.dayDates.B_w1, "2026-09-18");
  assert.ok(t.$(".date-chip .edited-dot"));
  t.openCard(0); t.type(".weight-input", "40"); t.click(".save-entry-btn");
  t.click('.tab[data-tab="historial"]');
  t.click(t.$$(".hist-item").find((b) => /Press inclinado/.test(b.textContent)));
  assert.match(t.$(".sess-date").textContent, /18/, "la sesión usa la fecha real del día");
  // volver a la fecha planificada quita el override
  t.click('.tab[data-tab="rutina"]'); t.goTo(1, "B");
  change(".day-date-input", "2026-09-15");
  assert.equal(t.data().meta.dayDates.B_w1, undefined);
  assert.deepEqual(t.errors, []);
});

test("día no completado con motivo, y deshacer", async () => {
  const t = await boot();
  t.goTo(2, "A");
  t.click(".skip-btn");
  t.click('.skip-chip[data-reason="Viaje"]');
  assert.equal(t.$(".skip-input").value, "Viaje");
  t.type(".skip-input", "Viaje de trabajo");
  t.click(".save-skip-btn");
  const st = t.data().meta.dayStatus.A_w2;
  assert.equal(st.status, "skipped"); assert.equal(st.reason, "Viaje de trabajo");
  assert.ok(t.$(".hero").classList.contains("skipped"));
  assert.match(t.$(".skip-state").textContent, /No completado · Viaje de trabajo/);
  assert.ok(t.$('.day-btn[data-day="A"]').classList.contains("skipped"));
  t.goTo(1, "A");
  assert.ok(!t.$(".hero").classList.contains("skipped"), "solo esa semana");
  t.goTo(2, "A"); t.click(".undo-skip-btn");
  assert.equal(t.data().meta.dayStatus.A_w2, undefined);
  assert.deepEqual(t.errors, []);
});

test("ciclos publicados: se cargan desde Ajustes sin cambiar el activo", async () => {
  const old = structuredClone(FIXTURE); old.cycle = 8; old.name = "Ciclo viejo";
  const t = await boot({ published: [old, FIXTURE] });
  t.click(".settings-btn");
  await new Promise((r) => setTimeout(r, 20));
  const btn = t.$('.remote-cycle-btn[data-cycle="8"]');
  assert.ok(btn, "aparece el ciclo 8 para cargar");
  assert.equal(t.$('.remote-cycle-btn[data-cycle="9"]'), null, "el ya cargado no se ofrece");
  t.click(btn);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(JSON.parse(t.w.localStorage.getItem("gluteo_rutinas"))[8].name, "Ciclo viejo");
  assert.equal(t.$("#cycleChip").textContent, "Ciclo 9", "sigue el ciclo activo");
  t.click('.cycle-btn[data-cycle="8"]');
  assert.equal(t.$("#cycleChip").textContent, "Ciclo 8");
  assert.deepEqual(t.errors, []);
});

test("cerrar ciclo: verifica, exporta, guarda el historial y borra el ciclo", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(0); t.type(".weight-input", "215"); t.click(".save-entry-btn");
  t.goTo(2, "A"); t.openCard(0); t.type(".weight-input", "235"); t.click(".save-entry-btn");
  t.click(".settings-btn");
  t.click(".close-cycle-btn");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.downloads.names.length, 1, "descarga el export antes de borrar");
  assert.match(t.downloads.names[0], /gluteo-ciclo-9-/);
  const hist = JSON.parse(t.w.localStorage.getItem("gluteo_historial"));
  assert.equal(hist.cycles[0].cycle, 9);
  assert.equal(hist.sessions.length, 2);
  assert.equal(t.w.localStorage.getItem("gluteo_tracker_ciclo-9"), null, "el ciclo se borró del celular");
  assert.equal(JSON.parse(t.w.localStorage.getItem("gluteo_rutinas"))[9], undefined);
  assert.match(t.$("#root").textContent, /Ciclo cerrado/);
  t.click('.tab[data-tab="historial"]');
  const item = t.$$(".hist-item").find((b) => /Hip thrust/.test(b.textContent));
  assert.match(item.textContent, /235 lb/, "el máximo sigue en el historial");
  t.click(item);
  assert.equal(t.$$(".pr-row").length, 2);
  // al reabrir, aunque el servidor siga publicando ciclo-actual = 9, no vuelve
  const storage = {};
  for (let i = 0; i < t.w.localStorage.length; i++) { const k = t.w.localStorage.key(i); storage[k] = t.w.localStorage.getItem(k); }
  const t2 = await boot({ storage, published: [FIXTURE] });
  assert.equal(JSON.parse(t2.w.localStorage.getItem("gluteo_rutinas"))[9], undefined);
  t2.click(".settings-btn");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t2.$('.remote-cycle-btn[data-cycle="9"]'), null);
  assert.match(t2.$("#sheet").textContent, /Ciclos cerrados \(en el historial\): 9/);
  assert.deepEqual(t.errors, []); assert.deepEqual(t2.errors, []);
});

test("las sugerencias del ciclo nuevo usan el historial del ciclo cerrado (S1 contra S1)", async () => {
  const t = await boot();
  t.goTo(0, "A"); t.openCard(0);
  t.$$(".rep-input").forEach((el) => { el.value = "10"; el.dispatchEvent(new t.w.Event("input", { bubbles: true })); });
  t.type(".weight-input", "200"); t.click(".save-entry-btn");
  t.click(".settings-btn"); t.click(".close-cycle-btn");
  await new Promise((r) => setTimeout(r, 30));
  const storage = {};
  for (let i = 0; i < t.w.localStorage.length; i++) { const k = t.w.localStorage.key(i); storage[k] = t.w.localStorage.getItem(k); }
  const next = structuredClone(FIXTURE); next.cycle = 10; next.name = "Ciclo nuevo";
  const t2 = await boot({ storage, routine: next });
  t2.goTo(0, "A");
  assert.match(t2.$$(".card")[0].querySelector(".ex-sug").textContent, /210 lb/, "S1 anterior 200 + 5%");
  assert.deepEqual(t2.errors, []);
});

test("protocolo: se muestra y las sugerencias no mezclan protocolos distintos", async () => {
  const cur = structuredClone(FIXTURE);
  cur.days[0].exercises[0].name = "Hip thrust con barra libre";
  cur.days[0].exercises[0].protocol = "Pausa 2 s arriba en cada rep";
  const old = structuredClone(FIXTURE); old.cycle = 8; old.name = "Viejo";
  old.days[0].exercises[0].name = "Hip thrust con barra libre";          // sin protocolo
  const storage = {
    gluteo_rutinas: JSON.stringify({ 8: old }),
    "gluteo_tracker_ciclo-8": JSON.stringify({ A_0_w0: { weight: "300", reps: ["8"], unit: "lb" } }),
  };
  const t = await boot({ storage, routine: cur });
  t.goTo(0, "A");
  const card = t.$$(".card")[0];
  assert.match(card.querySelector(".ex-proto").textContent, /Pausa 2 s/);
  assert.equal(card.querySelector(".ex-sug"), null, "no sugiere desde el hip thrust sin pausa");
  assert.equal(card.querySelector(".ex-max"), null);
  // pero el historial los muestra juntos, con el protocolo en cada sesión
  t.openCard(0); t.type(".weight-input", "215"); t.click(".save-entry-btn");
  t.click('.tab[data-tab="historial"]');
  const items = t.$$(".hist-item").filter((b) => /Hip thrust con barra libre/.test(b.textContent));
  assert.equal(items.length, 1, "un solo ejercicio en el historial");
  t.click(items[0]);
  assert.equal(t.$$(".sess-row").length, 2);
  assert.match(t.$("#root").textContent, /Pausa 2 s arriba en cada rep/);
  assert.deepEqual(t.errors, []);
});

test("un ciclo ya cargado se actualiza si su JSON cambió en el servidor", async () => {
  const old = structuredClone(FIXTURE); old.cycle = 8; old.name = "Viejo";
  const fixed = structuredClone(old); fixed.days[0].exercises[1].name = "Sentadilla búlgara corregida";
  const t = await boot({ storage: { gluteo_rutinas: JSON.stringify({ 8: old }) }, published: [fixed, FIXTURE] });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(JSON.parse(t.w.localStorage.getItem("gluteo_rutinas"))[8].days[0].exercises[1].name, "Sentadilla búlgara corregida");
  assert.deepEqual(t.errors, []);
});
