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

async function boot({ storage = {}, routine = FIXTURE } = {}) {
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
      win.fetch = async (url) => routine
        ? { ok: true, json: async () => structuredClone(routine) }
        : { ok: false, json: async () => ({}) };
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
  assert.match(t.$(".use-sug-btn").closest(".stat").textContent, /220 lb\s*\+2%/);
  assert.match(t.$(".use-sug-btn").closest(".stat").textContent, /Más peso/);
  t.click(".use-sug-btn");
  assert.equal(t.$(".weight-input").value, "220");
  t.click(".save-entry-btn");
  t.goTo(2, "A"); t.openCard(0); t.type(".weight-input", "235"); t.click(".save-entry-btn");
  t.goTo(3, "A"); t.openCard(0);
  assert.match(t.$(".use-sug-btn").closest(".stat").textContent, /130 lb\s*−45%/);
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

test("glosario: botón general y términos del ejercicio", async () => {
  const t = await boot();
  t.click(".glossary-top-btn");
  assert.ok(t.$$(".gl-item").length >= 10);
  assert.match(t.$("#sheet").textContent, /RPE/);
  t.click(".close-settings-btn");
  t.goTo(2, "A"); t.openCard(0); t.click(".glossary-btn");
  const terms = t.$$(".gl-item dt").map((e) => e.textContent);
  assert.ok(terms.includes("RPE") && terms.some((x) => /rematado/.test(x)));
  assert.ok(!terms.includes("Pulsos"));
  t.click(".glossary-all-btn");
  assert.ok(t.$$(".gl-item").length >= 10);
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
