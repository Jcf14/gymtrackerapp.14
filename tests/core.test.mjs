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

test("recomendación: dice si toca más peso, más reps o ambos", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const base = { unit: "lb", weekShort: ws, max: null, lastS1: null };
  // (+peso): anterior + 5
  let r = G.recommend({ ...base, target: "4x6-8 @RPE8 (+peso)", prevTarget: "4x8-10 @RPE7", week: 1, prev: { weight: 215, week: 0 }, prevRec: {} });
  assert.equal(r.value, 220); assert.equal(r.pct, 2); assert.equal(r.goal, "Más peso, menos reps");
  // descarga: 55% de la semana previa
  r = G.recommend({ ...base, target: "2x10 @RPE6", prevTarget: "3x4-6 @RPE9", week: 3, prev: { weight: 235, week: 2 }, prevRec: {} });
  assert.equal(r.value, 130); assert.equal(r.mode, "deload"); assert.equal(r.pct, -45); assert.equal(r.goal, "Menos peso");
  // no llegó al techo del rango: mismo peso, más reps
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["13", "12", "12"] } });
  assert.equal(r.value, 50); assert.equal(r.mode, "reps"); assert.equal(r.goal, "Mismo peso, más reps"); assert.match(r.text, /13·12·12/);
  // llegó al techo en todas: más peso
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["15", "15", "15"] } });
  assert.equal(r.value, 55); assert.equal(r.mode, "up"); assert.equal(r.pct, 10);
  // S3 con menos reps que S2: más carga (al menos +5%)
  r = G.recommend({ ...base, target: "3x4-6 @RPE9", prevTarget: "4x6-8 @RPE8", week: 2, prev: { weight: 220, week: 1 }, prevRec: {} });
  assert.equal(r.value, 230); assert.equal(r.goal, "Más peso, menos reps");
  // S1 nueva contra S1 del ciclo anterior: +5%
  r = G.recommend({ ...base, target: "4x8-10 @RPE7", prevTarget: null, week: 0, prev: null, prevRec: null,
    lastS1: { cycle: 2, weight: 215, repsArr: [10, 10, 10, 10] }, lastS1Target: "4x8-10 @RPE7" });
  assert.equal(r.value, 225); assert.equal(r.goal, "Más peso, mismas reps");
  // ...pero si en esa S1 no llegó al techo: mismo peso, más reps
  r = G.recommend({ ...base, target: "4x8-10 @RPE7", week: 0, prev: null, lastS1: { cycle: 2, weight: 215, repsArr: [10, 9, 8, 8] } });
  assert.equal(r.value, 215); assert.equal(r.goal, "Mismo peso, más reps");
  // sin referencia directa pero con máximo: calibrar
  r = G.recommend({ ...base, target: "3x8", week: 0, prev: null, max: { weight: 100 } });
  assert.equal(r.value, 90); assert.equal(r.goal, "Calibrá el peso");
  assert.equal(G.recommend({ ...base, target: "3x8", week: 0, prev: null }), null);
});

test("récords: se guarda cada vez que se supera el máximo", () => {
  const recs = [
    { cycle: 2, week: 0, weight: 215, topReps: 8, date: "2026-10-01T10:00:00Z" },
    { cycle: 2, week: 1, weight: 215, topReps: 10, date: "2026-10-08T10:00:00Z" },
    { cycle: 2, week: 2, weight: 235, topReps: 5, date: "2026-10-15T10:00:00Z" },
    { cycle: 2, week: 3, weight: 130, topReps: 10, date: "2026-10-22T10:00:00Z" },
  ];
  const prs = G.prHistory(recs);
  assert.deepEqual(plain(prs.map((r) => [r.weight, r.topReps])), [[215, 8], [215, 10], [235, 5]]);
  assert.equal(G.findMax(recs).weight, 235);
  assert.equal(G.lastRecord(recs).weight, 130);
});

test("la alternativa usada una semana cuenta como otro ejercicio", () => {
  const r = fixture();
  const data = { A_0_w0: { weight: "215", reps: ["8"] }, A_0_w1: { weight: "60", reps: ["12"], altUsed: true } };
  assert.equal(G.slotName(data, "A", 0, r.days[0].exercises[0], 1), "Hip thrust con mancuerna en banco");
  assert.equal(G.findMax(G.collectRecords({ 9: r }, { 9: data }, "Hip thrust con mancuerna en banco")).weight, 60);
  assert.equal(G.findMax(G.collectRecords({ 9: r }, { 9: data }, r.days[0].exercises[0].name)).weight, 215);
  // la semana con alternativa no sirve de referencia para el original
  assert.equal(G.prevWeight({ ...data, A_0_w2: {} }, "A", 0, 2, r.days[0].exercises[0]).week, 0);
  const idx = G.exerciseIndex({ 9: r }, { 9: data }, 9);
  assert.ok(idx.some((e) => e.name === "Hip thrust con mancuerna en banco" && e.max.weight === 60));
  assert.equal(idx[0].name, r.days[0].exercises[0].name, "ordena por día y posición del ciclo activo");
  assert.equal(idx.find((e) => e.name.startsWith("Plancha")).group, "core");
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
