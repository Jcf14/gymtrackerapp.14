import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../scripts/core-node.mjs";

const G = loadCore();
const plain = (x) => JSON.parse(JSON.stringify(x)); // los objetos de vm vienen de otro "realm"
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/rutina-test.json", import.meta.url), "utf8"));

test("cuenta series del target, incluida la de rematado", () => {
  assert.equal(G.targetSetCount("4x8-10 @RPE7"), 4);
  assert.equal(G.targetSetCount("3x4-6 @RPE9 + 1x15-20"), 4);
  assert.equal(G.targetSetCount("4x8 + 10 pulsos"), 4);
  assert.equal(G.targetSetCount("3×12 c/lado"), 3);
  assert.equal(G.targetSetCount("30 segundos"), null);
});

test("detecta marcas de descarga y (+peso)", () => {
  for (const t of ["2x10 @RPE6", "2x10 @RPE5-6", "2x10 (liviano)", "2x10 (liviano/asistido)"]) assert.ok(G.isDeloadTarget(t), t);
  for (const t of ["3x8 @RPE7", "3x6 @RPE6-7", "4x5 @RPE9"]) assert.ok(!G.isDeloadTarget(t), t);
  assert.ok(G.hasPlusWeight("4x6-8 @RPE8 (+peso)"));
  assert.ok(!G.hasPlusWeight("4x6-8 @RPE8"));
});

test("la rutina de prueba es válida", () => {
  assert.deepEqual(plain(G.validateRoutine(fixture())), []);
});

test("la validación detecta los errores del formato", () => {
  const r = fixture();
  r.days[0].exercises[0].sets[2] = 3;                 // no coincide con "3x4-6 + 1x15-20"
  r.days[0].exercises[1].targets[3] = "2x10 @RPE7";   // S4 sin marca de descarga
  r.days[1].exercises[0].targets.pop();               // 3 targets
  delete r.days[0].exercises[2].alt;                  // falta alt
  r.days[1].key = "A";                                // key repetida
  const errs = G.validateRoutine(r).join("\n");
  assert.match(errs, /S3 sets=3 pero .* indica 4/);
  assert.match(errs, /S4 necesita/);
  assert.match(errs, /targets debe tener exactamente 4/);
  assert.match(errs, /alt debe ser texto o null/);
  assert.match(errs, /key repetida/);
});

test("sugerencias de peso", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  // (+peso): anterior + 5
  assert.equal(G.suggest({ target: "4x6-8 @RPE8 (+peso)", week: 1, prev: { weight: 215, week: 0 }, max: null, unit: "lb", weekShort: ws }).value, 220);
  // descarga: 55% de la semana previa, redondeado a 5 lb
  assert.equal(G.suggest({ target: "2x10 @RPE6", week: 3, prev: { weight: 235, week: 2 }, max: null, unit: "lb", weekShort: ws }).value, 130);
  // S1 con historial: 90% del máximo
  assert.equal(G.suggest({ target: "4x8-10 @RPE7", week: 0, prev: null, max: { weight: 235 }, unit: "lb", weekShort: ws }).value, 210);
  // sin marca: similar a la anterior
  assert.equal(G.suggest({ target: "3x8 @RPE8", week: 1, prev: { weight: 50, week: 0 }, max: null, unit: "lb", weekShort: ws }).value, 50);
  // sin datos: nada
  assert.equal(G.suggest({ target: "3x8 @RPE7", week: 0, prev: null, max: null, unit: "lb", weekShort: ws }), null);
  // kg: salto de 2,5
  assert.equal(G.suggest({ target: "3x8 (+peso)", week: 1, prev: { weight: 40, week: 0 }, max: null, unit: "kg", weekShort: ws }).value, 42.5);
});

test("calculadora de barra", () => {
  assert.deepEqual(plain(G.calcBar("perSide", 90, 35)), { total: 215, perSide: 90 });
  assert.deepEqual(plain(G.calcBar("total", 235, 35)), { total: 235, perSide: 100 });
  assert.equal(G.barWeight("women", "lb"), 35);
  assert.equal(G.barWeight("men", "kg"), 20);
  assert.equal(G.barWeight("custom", "lb", "25"), 25);
});

test("máximo registrado entre ciclos, por nombre efectivo", () => {
  const r9 = fixture();
  const r8 = { ...fixture(), cycle: 8 };
  const data = {
    8: { A_0_w2: { weight: "235", reps: ["5", "5", "4", "18"] } },
    9: { A_0_w0: { weight: "215", reps: ["8", "8", "8", "8"], repsSame: true, repsSameValue: "8" } },
  };
  const recs = G.collectRecords({ 8: r8, 9: r9 }, data, "hip thrust con barra libre (PAUSA 2s arriba)");
  assert.equal(recs.length, 2);
  const max = G.findMax(recs);
  assert.equal(max.weight, 235);
  assert.equal(max.cycle, 8);
  assert.equal(max.reps, "5·5·4·18");
  assert.equal(G.repsText(data[9].A_0_w0), "4×8");
});

test("semana desde startDate y día automático", () => {
  assert.equal(G.weekFromStart("2026-11-02", new Date(2026, 10, 2)), 0);
  assert.equal(G.weekFromStart("2026-11-02", new Date(2026, 10, 10)), 1);
  assert.equal(G.weekFromStart("2026-11-02", new Date(2026, 11, 30)), 3);
  assert.equal(G.weekFromStart("2026-11-02", new Date(2026, 9, 30)), null);
  const r = fixture();
  assert.equal(G.autoDayKey(r, new Date(2026, 9, 20), null), "B");   // martes
  assert.equal(G.autoDayKey(r, new Date(2026, 9, 23), "B"), "B");    // viernes → último visto
  assert.equal(G.autoDayKey(r, new Date(2026, 9, 25), null), "A");   // domingo sin último → primero
});

test("el export usa el nombre editado y conserva el original", () => {
  const r = fixture();
  const data = {
    ovr_A_1: { name: "Zancada reversa", savedAt: "2026-10-01T00:00:00Z" },
    A_1_w0: { weight: "40", reps: ["10", "10", "9"], note: "pesada", completed: true, savedAt: "2026-10-01T10:00:00Z" },
  };
  const out = G.buildCycleExport(r, data, "lb", new Date("2026-10-21T00:00:00Z"));
  const ex = out.days[0].exercises[1];
  assert.equal(ex.name, "Zancada reversa");
  assert.equal(ex.originalName, "Sentadilla búlgara");
  assert.equal(ex.weeks[0].weight, "40");
  assert.equal(ex.weeks[0].completed, true);
  assert.equal(ex.weeks[0].date, "2026-10-01T10:00:00Z");
  assert.equal(ex.weeks[1].weight, "");
});

test("respaldo: arma y valida", () => {
  const b = G.buildBackup({ routines: { 9: fixture() }, data: { 9: {} }, unit: "lb", theme: "light" });
  assert.deepEqual(plain(G.checkBackup(b)), []);
  assert.ok(G.checkBackup({ type: "otra cosa" }).length);
  assert.ok(G.checkBackup({ ...b, routines: { 3: fixture() } }).length);
});
