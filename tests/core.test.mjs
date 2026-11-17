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
  for (const t of ["2x10 @RPE6", "2x10 @RPE5-6", "2x10 (liviano)", "2x10 (liviano/asistido)", "2x10 (asistido o liviano)"]) assert.ok(G.isDeloadTarget(t), t);
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
  assert.match(errs, /alt debe ser texto, null o una lista/);
  assert.match(errs, /key repetida/);
});

test("recomendación: dice si toca más peso, más reps o ambos", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const base = { unit: "lb", weekShort: ws, max: null, lastS1: null };
  // (+peso) con cambio de rango: el peso sale de la fuerza estimada (215 × 10 @RPE7 → ~230 para 6-8 @RPE8)
  let r = G.recommend({ ...base, target: "4x6-8 @RPE8 (+peso)", prevTarget: "4x8-10 @RPE7", week: 1, prev: { weight: 215, week: 0 }, prevRec: {} });
  assert.equal(r.value, 230); assert.equal(r.pct, 7); assert.equal(r.goal, "Más peso, menos reps");
  // (+peso) con el mismo rango: el escalón siguiente si es menor a 20% (30 → 35 = +17%)
  r = G.recommend({ ...base, target: "3x10-12 (+peso)", prevTarget: "3x10-12", week: 1, prev: { weight: 30, week: 0 }, prevRec: { reps: ["10", "10", "10"] } });
  assert.equal(r.value, 35);
  // …pero un escalón de 20% o más (25 → 30) pide antes 2 reps más que el techo
  r = G.recommend({ ...base, target: "3x10-12 (+peso)", prevTarget: "3x10-12", week: 1, prev: { weight: 25, week: 0 }, prevRec: { reps: ["12", "12", "12"] } });
  assert.equal(r.value, 25); assert.equal(r.mode, "reps"); assert.match(r.text, /salto grande \(\+20%\).*hasta 14 en todas/);
  r = G.recommend({ ...base, target: "3x10-12 (+peso)", prevTarget: "3x10-12", week: 1, prev: { weight: 25, week: 0 }, prevRec: { reps: ["14", "14", "14"] } });
  assert.equal(r.value, 30); assert.match(r.text, /toca el salto/);
  r = G.recommend({ ...base, target: "3x10-12 (+peso)", prevTarget: "3x10-12", week: 1, prev: { weight: 100, week: 0 }, prevRec: { reps: ["10", "10", "10"] } });
  assert.equal(r.value, 105);
  // descarga: 55% de la semana previa
  r = G.recommend({ ...base, target: "2x10 @RPE6", prevTarget: "3x4-6 @RPE9", week: 3, prev: { weight: 235, week: 2 }, prevRec: {} });
  assert.equal(r.value, 130); assert.equal(r.mode, "deload"); assert.equal(r.pct, -45); assert.equal(r.goal, "Menos peso");
  // no llegó al techo del rango: mismo peso, más reps
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["13", "12", "12"] } });
  assert.equal(r.value, 50); assert.equal(r.mode, "reps"); assert.equal(r.goal, "Mismo peso, más reps"); assert.match(r.text, /13·12·12/);
  // llegó al techo en todas: más peso
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["15", "15", "15"] } });
  assert.equal(r.value, 55); assert.equal(r.mode, "up"); assert.equal(r.pct, 10);
  // S3 con menos reps que S2: más carga según la fuerza estimada (220 × 8 @RPE8 → 235 para 4-6 @RPE9)
  r = G.recommend({ ...base, target: "3x4-6 @RPE9", prevTarget: "4x6-8 @RPE8", week: 2, prev: { weight: 220, week: 1 }, prevRec: {} });
  assert.equal(r.value, 235); assert.equal(r.goal, "Más peso, menos reps");
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

test("recomendación con datos reales (hip thrust del ciclo 2): sigue la fuerza, no un +5% fijo", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const base = { unit: "lb", weekShort: ws, max: null, lastS1: null };
  const T = ["4x8-10 @RPE7", "4x6-8 @RPE8", "3x4-6 @RPE9 + 1x15-20", "2x10 @RPE6"];
  // S1 215 × 10 → S2 ~230 (hizo 255 × 6) · S2 255 × 6 → S3 260 (hizo 260 × 4)
  let r = G.recommend({ ...base, target: T[1], prevTarget: T[0], week: 1, prev: { weight: 215, week: 0 }, prevRec: { reps: ["10", "10", "10", "10"] } });
  assert.equal(r.value, 230);
  assert.match(r.text, /En S1 hiciste 215 × 10·10·10·10: para 6-8 reps @RPE8 te corresponde ~230 lb/);
  r = G.recommend({ ...base, target: T[2], prevTarget: T[1], week: 2, prev: { weight: 255, week: 1 }, prevRec: { reps: ["6", "6", "6", "6"] } });
  assert.equal(r.value, 260);
  // S2 sin registrar: se estima desde S1 y lo avisa
  r = G.recommend({ ...base, target: T[2], prevTarget: T[0], week: 2, prev: { weight: 215, week: 0 }, prevRec: { reps: ["10", "10", "10", "10"] } });
  assert.equal(r.value, 250); // 249,8 estimado: casi 250
  assert.match(r.text, /estimado desde S1: S2 todavía sin registrar/);
  // accesorio al que le sube el rango (abducción 15-20 → 20-25): no baja el peso, pide más reps
  r = G.recommend({ ...base, target: "3x20-25", prevTarget: "3x15-20 (+peso)", week: 2, prev: { weight: 100, week: 1 }, prevRec: { reps: ["18", "17", "16"] } });
  assert.equal(r.value, 100); assert.equal(r.goal, "Mismo peso, más reps");
  // accesorio con el mismo rango: sigue siendo "mismo peso, más reps"
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["13", "12", "12"] } });
  assert.equal(r.value, 50); assert.equal(r.goal, "Mismo peso, más reps");
});

test("recomendación: S3 contra S3 del ciclo anterior y qué falta para el récord", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const max = { weight: 260, topReps: 4 };
  const lastSame = { cycle: 2, weight: 260, repsArr: [4, 4, 4, 4], target: "3x4-6 @RPE9" };
  // con lo de este ciclo daría 235; el S3 anterior fue 260 × 4: sube hasta ~10% (255)
  let r = G.recommend({ unit: "lb", weekShort: ws, target: "3x4-6 @RPE9", prevTarget: "4x6-8 @RPE8", week: 2,
    prev: { weight: 220, week: 1 }, prevRec: { reps: ["8", "8", "8", "8"] }, lastSame, max });
  // apunta al S3 anterior pero sin saltar más de 10% sobre S2 (220 → 240)
  assert.equal(r.value, 240);
  assert.match(r.text, /En S3 del ciclo 2 hiciste 260 lb × 4·4·4·4/);
  assert.equal(r.record, "Esta es la semana para el récord (260 lb × 4): hacé 260 lb × 5 o subí a 265 lb.");
  // si este ciclo viene más fuerte, manda este ciclo
  r = G.recommend({ unit: "lb", weekShort: ws, target: "3x4-6 @RPE9", prevTarget: "4x6-8 @RPE8", week: 2,
    prev: { weight: 260, week: 1 }, prevRec: { reps: ["7", "7", "7", "7"] }, lastSame, max });
  assert.equal(r.value, 275); // 274 estimado: casi 275
  assert.equal(r.record, "Con este peso ya superás tu récord (260 lb × 4).");
  // fuera de la semana pico, el récord no se busca
  r = G.recommend({ unit: "lb", weekShort: ws, target: "4x6-8 @RPE8", prevTarget: "4x8-10 @RPE7", week: 1,
    prev: { weight: 200, week: 0 }, prevRec: { reps: ["10"] }, max });
  assert.match(r.record, /se busca en la semana pico/);
  // la descarga no habla de récords
  r = G.recommend({ unit: "lb", weekShort: ws, target: "2x10 @RPE6", prevTarget: "3x4-6 @RPE9", week: 3, prev: { weight: 255, week: 2 }, prevRec: {}, max });
  assert.equal(r.record, undefined);
});

test("poleas y máquinas de pila (unit kg, step 5): todo cae en 5, 10, 15…", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const base = { unit: "kg", step: 5, weekShort: ws, max: null, lastS1: null };
  // llegó al techo, pero 20 → 25 kg es +25%: primero 18 reps en todas
  let r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 20, week: 0 }, prevRec: { reps: ["15", "15", "15"] } });
  assert.equal(r.value, 20); assert.match(r.text, /hasta 18 en todas/);
  // con 18+ en todas, sube un casillero (5 kg, no 2,5)
  r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 20, week: 0 }, prevRec: { reps: ["18", "18", "18"] } });
  assert.equal(r.value, 25);
  // (+peso) desde un peso fuera de la pila: queda en la pila
  r = G.recommend({ ...base, target: "3x12-15 (+peso)", prevTarget: "3x12-15", week: 1, prev: { weight: 22, week: 0 }, prevRec: { reps: ["18"] } });
  assert.equal(r.value, 25);
  // descarga: 55% de 25 = 13,75 → 15
  r = G.recommend({ ...base, target: "2x12 (liviano)", prevTarget: "3x15", week: 3, prev: { weight: 25, week: 2 }, prevRec: {} });
  assert.equal(r.value, 15);
  // qué falta para el récord: el siguiente casillero
  r = G.recommend({ ...base, target: "3x10 c/lado @RPE9", prevTarget: "3x10-12 c/lado", week: 2, prev: { weight: 20, week: 1 }, prevRec: { reps: ["10", "10", "10"] }, max: { weight: 25, topReps: 10 } });
  assert.match(r.record, /subí a 30 kg/);
  // sin step, kg sigue de a 2,5
  r = G.recommend({ ...base, step: undefined, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 20, week: 0 }, prevRec: { reps: ["18", "18", "18"] } });
  assert.equal(r.value, 22.5);
  // validación de los campos nuevos
  const bad = fixture();
  bad.days[0].exercises[0].step = 5;
  assert.match(G.validateRoutine(bad).join("\n"), /step necesita unit/);
});

test("S3 sin @RPE9 escrito igual es la semana del récord (no 'dejá reps en reserva')", () => {
  const r = G.recommend({ unit: "lb", weekShort: ["S1", "S2", "S3", "S4"], target: "3x15 @RPE8", prevTarget: "3x12-15 (+peso)", week: 2,
    prev: { weight: 40, week: 1 }, prevRec: { reps: ["12", "12", "12"] }, max: { weight: 45, topReps: 12 } });
  assert.doesNotMatch(r.record, /reps en reserva/);
  assert.match(r.record, /semana para el récord \(45 lb × 12\)/);
});

test("RPE real marcado: afina la estimación y sube si sobró", () => {
  const base = { unit: "lb", weekShort: ["S1", "S2", "S3", "S4"], max: null };
  // 215 × 10 marcado RPE 9 (no el 7 del plan): para 6-8 @RPE8 corresponde menos que con RPE 7
  const plan = G.recommend({ ...base, target: "4x6-8 @RPE8", prevTarget: "4x8-10 @RPE7", week: 1, prev: { weight: 215, week: 0 }, prevRec: { reps: ["10"] } });
  const felt = G.recommend({ ...base, target: "4x6-8 @RPE8", prevTarget: "4x8-10 @RPE7", week: 1, prev: { weight: 215, week: 0 }, prevRec: { reps: ["10"], rpe: 9 } });
  assert.equal(plan.value, 230); assert.equal(felt.value, 220);
  assert.match(felt.text, /lo marcaste RPE 9/);
  // accesorio sin llegar al techo pero marcado RPE 6 cuando se pedía 8: subí
  const r = G.recommend({ ...base, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 50, week: 0 }, prevRec: { reps: ["13", "13", "13"], rpe: 6 } });
  assert.equal(r.value, 55); assert.match(r.text, /te sobraron reps/);
});

test("equipo: lo deduce del nombre y cada uno sube de a lo que se puede", () => {
  const eq = (n) => G.inferEquip(n);
  assert.equal(eq("Peso muerto rumano con barra"), "barbell");
  assert.equal(eq("Hip thrust con mancuerna en banco"), "dumbbell");
  assert.equal(eq("Abducción de pie en polea"), "cable");
  assert.equal(eq("Jalón al pecho"), "cable");
  assert.equal(eq("Aducción en máquina"), "machine4");
  assert.equal(eq("Elevación posterior en máquina (reverse pec deck)"), "machine4");
  assert.equal(eq("Extensión de cuádriceps"), "machine5");
  assert.equal(eq("Remo T en máquina"), "plates");
  assert.equal(eq("Press de pecho inclinado en máquina"), "plates", "lo cargo con discos (10 lb c/l)");
  assert.equal(eq("Curl femoral arrodillado a una pierna (máquina)"), "plates");
  assert.equal(eq("Elevación de talones de pie"), "plates");
  assert.equal(eq("Hiperextensión (45°)"), null);
  // mancuernas: de 5 en 5 hasta 40, después de 10 en 10
  const db = G.loadScale("dumbbell", "lb");
  assert.equal(db.next(35), 40); assert.equal(db.next(40), 50); assert.equal(db.next(50), 60);
  assert.equal(db.prev(50), 40); assert.equal(db.round(44), 40); assert.equal(db.round(47), 50); assert.equal(db.floor(57), 50);
  // aductor: de 4 en 4 kg · polea: de 5 en 5 kg · barra: 5 lb (2,5 por lado)
  const m4 = G.loadScale("machine4", "kg");
  assert.equal(m4.next(20), 24); assert.equal(m4.round(26), 28); assert.equal(m4.prev(22), 20);
  assert.equal(G.loadScale("cable", "kg").next(12), 15);
  assert.equal(G.loadScale("barbell", "lb").next(185), 190);
  // en otra unidad que la del equipo: pasos genéricos
  assert.equal(G.loadScale("machine4", "lb").next(20), 25);
  // la sugerencia cae en un valor posible: aductor 20 kg con reps de sobra → 24 (no 22,5)
  let r = G.recommend({ unit: "kg", scale: m4, weekShort: ["S1", "S2", "S3", "S4"], target: "3x15-20", prevTarget: "3x15-20", week: 1,
    prev: { weight: 20, week: 0 }, prevRec: { reps: ["23", "23", "23"] } });
  assert.equal(r.value, 24);
  // mancuernas de 40: el salto a 50 (+25%) pide 13 reps en todas primero
  r = G.recommend({ unit: "lb", scale: db, weekShort: ["S1", "S2", "S3", "S4"], target: "3x8-10", prevTarget: "3x8-10", week: 1,
    prev: { weight: 40, week: 0 }, prevRec: { reps: ["10", "10", "10"] } });
  assert.equal(r.value, 40);
  r = G.recommend({ unit: "lb", scale: db, weekShort: ["S1", "S2", "S3", "S4"], target: "3x8-10", prevTarget: "3x8-10", week: 1,
    prev: { weight: 40, week: 0 }, prevRec: { reps: ["13", "13", "13"] } });
  assert.equal(r.value, 50);
});

test("RPE real más alto que el pedido: no sube aunque haya llegado al techo", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  // Smith 90 × 8 en 4x8 @RPE7, pero lo sentí RPE 9 → S2 (6-8 @RPE8) se queda en 90
  let r = G.recommend({ unit: "lb", weekShort: ws, target: "4x6-8 @RPE8", prevTarget: "4x8 @RPE7", week: 1,
    prev: { weight: 90, week: 0 }, prevRec: { reps: ["8", "8", "8", "8"], rpe: 9 } });
  assert.equal(r.value, 90); assert.match(r.text, /costó más de lo pedido/);
  // sin RPE marcado, sube
  r = G.recommend({ unit: "lb", weekShort: ws, target: "4x6-8 @RPE8", prevTarget: "4x8 @RPE7", week: 1,
    prev: { weight: 90, week: 0 }, prevRec: { reps: ["8", "8", "8", "8"] } });
  assert.equal(r.value, 95);
  // (+peso) pero costó 2+ RPE más: todavía no
  r = G.recommend({ unit: "lb", weekShort: ws, target: "3x8-10 @RPE8 (+peso)", prevTarget: "3x8-10 @RPE7", week: 1,
    prev: { weight: 95, week: 0 }, prevRec: { reps: ["10", "10", "9"], rpe: 9 } });
  assert.equal(r.value, 95); assert.match(r.text, /todavía no subas/);
  // mismo peso que el récord: una rep más ya es récord (no "dejá reps en reserva")
  r = G.recommend({ unit: "kg", scale: G.loadScale("cable", "kg"), slow: true, weekShort: ws, target: "3x15", prevTarget: "3x15", week: 1,
    prev: { weight: 5, week: 0 }, prevRec: { reps: ["15", "15", "15"] }, max: { weight: 5, topReps: 15 } });
  assert.equal(r.record, "Con 5 kg × 16 superás tu récord (5 kg × 15).");
});

test("ejercicios que progresan lento (elevación lateral en polea): reps antes del salto", () => {
  assert.ok(G.isSlowLift("Elevación lateral en polea"));
  assert.ok(G.isSlowLift("Extensión de tríceps en polea"));
  assert.ok(!G.isSlowLift("Curl femoral sentado"));
  assert.ok(!G.isSlowLift("Hip thrust con barra libre"));
  const cable = G.loadScale("cable", "kg");
  const args = { unit: "kg", scale: cable, slow: true, weekShort: ["S1", "S2", "S3", "S4"], target: "3x15", prevTarget: "3x15 c/lado", week: 1, prev: { weight: 5, week: 0 } };
  // 5 → 10 kg es +100%: con 15 reps no alcanza; pide 20 en todas
  let r = G.recommend({ ...args, prevRec: { reps: ["15", "15", "15"] } });
  assert.equal(r.value, 5); assert.equal(r.goal, "Mismo peso, más reps");
  assert.match(r.text, /salto grande \(\+100%\) y este ejercicio progresa lento: quedate en 5 kg y sumá reps hasta 21 en todas/);
  // con 21 en todas, recién ahí sugiere 10 kg
  r = G.recommend({ ...args, prevRec: { reps: ["20", "20", "20"] } });
  assert.equal(r.value, 5);
  r = G.recommend({ ...args, prevRec: { reps: ["21", "21", "21"] } });
  assert.equal(r.value, 10);
});

test("casos reales del ciclo 3 (respaldo del 17/11): lo que salió y lo que no", () => {
  const ws = ["S1", "S2", "S3", "S4"];
  const go = (o) => G.recommend({ unit: "lb", weekShort: ws, max: null, ...o });
  // Abducción en máquina 32 kg × 20 (techo) con (+peso): 36 kg (+12,5%) se sugiere (hizo 44 × 15)
  let r = go({ unit: "kg", scale: G.loadScale("machine4", "kg"), target: "3x15-20 (+peso)", prevTarget: "3x15-20", week: 1, prev: { weight: 32, week: 0 }, prevRec: { reps: ["20", "20", "20"] } });
  assert.equal(r.value, 36);
  // Aducción 20 kg × 20 con (+peso): 24 kg es +20% → pide 22 reps (hizo 20 kg × 22, y al subir a 24 salió 12·12·8)
  r = go({ unit: "kg", scale: G.loadScale("machine4", "kg"), target: "3x15-20 (+peso)", prevTarget: "3x15-20", week: 1, prev: { weight: 20, week: 0 }, prevRec: { reps: ["20", "20", "20"] } });
  assert.equal(r.value, 20); assert.match(r.text, /hasta 22 en todas/);
  // Press militar 25 × 8 → 6-8 @RPE8: la fuerza dice 25; 30 (+20%) no se fuerza (hizo 30 × 5, debajo del rango)
  r = go({ scale: G.loadScale("dumbbell", "lb"), target: "4x6-8 @RPE8", prevTarget: "4x8-10 @RPE7", week: 1, prev: { weight: 25, week: 0 }, prevRec: { reps: ["8", "8", "8", "8"] } });
  assert.equal(r.value, 25);
  // Jalón 35 kg × 8 al techo de 6-8 → 40 kg (+14%) se sugiere (hizo 40)
  r = go({ unit: "kg", scale: G.loadScale("cable", "kg"), target: "3x6-8 @RPE9", prevTarget: "4x6-8 @RPE8 (+peso)", week: 2, prev: { weight: 35, week: 1 }, prevRec: { reps: ["8", "8", "8", "8"] } });
  assert.equal(r.value, 40);
  // Lateral con mancuerna 10 lb × 20: 15 lb (+50%) no (hizo 15 × 8, debajo del rango)
  r = go({ scale: G.loadScale("dumbbell", "lb"), slow: true, target: "3x12-15", prevTarget: "3x12-15", week: 1, prev: { weight: 10, week: 0 }, prevRec: { reps: ["20", "20", "20"] } });
  assert.equal(r.value, 10);
});

test("mancuernas: peso de una + cantidad; conversión del peso muerto del ciclo 3", () => {
  assert.equal(G.defaultDbCount("Press militar con mancuernas"), 2);
  assert.equal(G.defaultDbCount("Peso muerto convencional con mancuernas"), 2);
  assert.equal(G.defaultDbCount("Patada de tríceps con mancuerna"), 1);
  assert.equal(G.defaultDbCount("Remo unilateral con mancuerna"), 1);
  assert.equal(G.defaultDbCount("Sentadilla goblet con mancuerna"), 1);
  assert.equal(G.dbTotal({ weight: "40", dbCount: 2 }), 80);
  assert.equal(G.dbTotal({ weight: "40" }), 40);
  // ciclo 3: el peso muerto con mancuernas estaba anotado como total → pasa a una mancuerna × 2 (una sola vez)
  const data = {
    ovr_C_2: { name: "Peso muerto convencional con mancuernas" },
    C_2_w0: { weight: "70", reps: ["10"] }, C_2_w1: { weight: "80", reps: ["8"] }, C_2_w2: { weight: "80", reps: ["10"] },
    B_0_w0: { weight: "25", reps: ["8"] },
  };
  assert.equal(G.migrateData(3, data), true);
  assert.deepEqual([data.C_2_w0.weight, data.C_2_w1.weight, data.C_2_w2.weight], ["35", "40", "40"]);
  assert.equal(data.C_2_w1.dbCount, 2);
  assert.equal(G.dbTotal(data.C_2_w1), 80, "el total no cambia");
  assert.equal(data.B_0_w0.weight, "25", "el resto no se toca");
  assert.equal(G.migrateData(3, data), false, "no se repite");
  assert.equal(data.C_2_w1.weight, "40");
  // otros ciclos o datos vacíos: nada
  const other = { C_2_w0: { weight: "70" }, ovr_C_2: { name: "Peso muerto convencional con mancuernas" } };
  assert.equal(G.migrateData(4, other), false); assert.equal(other.C_2_w0.weight, "70");
  const empty = {};
  assert.equal(G.migrateData(3, empty), false); assert.deepEqual(empty, {});
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

test("unidades: conversión y máximo comparando lb con kg", () => {
  assert.equal(G.round1(G.convert(100, "kg", "lb")), 220.5);
  assert.equal(G.roundHalf(G.convert(215, "lb", "kg")), 97.5);
  const r = fixture();
  const data = {
    A_0_w0: { weight: "215", reps: ["8"], unit: "lb", savedAt: "2026-10-01T10:00:00Z" },
    A_0_w1: { weight: "100", reps: ["6"], unit: "kg", savedAt: "2026-10-08T10:00:00Z" },   // 220,5 lb
    A_0_w2: { weight: "99", reps: ["9"], unit: "kg", savedAt: "2026-10-15T10:00:00Z" },    // 218,3 lb
  };
  const recs = G.collectRecords({ 9: r }, { 9: data }, r.days[0].exercises[0].name);
  const max = G.findMax(recs);
  assert.equal(max.weight, 100); assert.equal(max.unit, "kg");
  assert.equal(G.prHistory(recs).length, 2);
  // registros sin unidad (anteriores) se leen con la unidad de la rutina
  assert.equal(G.collectRecords({ 9: r }, { 9: { A_0_w0: { weight: "200" } } }, r.days[0].exercises[0].name)[0].unit, "lb");
  const out = G.buildCycleExport(r, data, "lb");
  assert.equal(out.days[0].exercises[0].weeks[1].unit, "kg");
});

test("fechas del ciclo y orden real de récords entre ciclos", () => {
  const r = fixture();
  const data = { meta: { startDate: "2026-09-07", dayDates: { A_w1: "2026-09-15" } } };
  assert.equal(G.plannedDate(r, data, "B", 0), "2026-09-08");
  assert.equal(G.dayDate(r, data, "A", 1), "2026-09-15");
  assert.equal(G.dayDate(r, {}, "A", 0), null);
  // un ciclo viejo cargado después sigue siendo anterior
  const recs = [
    { cycle: 2, week: 0, weight: 215, topReps: 8, date: "2026-10-01T10:00:00Z" },
    { cycle: 1, week: 2, weight: 235, topReps: 5, date: "2026-10-21T10:00:00Z" },
  ];
  assert.deepEqual(plain(G.prHistory(recs).map((x) => x.cycle)), [1]);
});

test("cerrar ciclo: pasa todo al historial y verifica los máximos", () => {
  const r = fixture();
  const data = {
    meta: { startDate: "2026-09-07", dayStatus: { B_w2: { status: "skipped", reason: "Viaje" } } },
    A_0_w0: { weight: "215", reps: ["10", "10", "9", "9"], unit: "lb", completed: true, note: "pesado" },
    A_0_w2: { weight: "235", reps: ["5", "5", "4", "18"], unit: "lb", completed: true },
    A_1_w1: { weight: "60", reps: ["12", "12", "12"], unit: "lb", altUsed: false },
    A_2_w0: { completed: true, reps: ["10", "10", "10"] },                 // core sin peso
    ovr_A_1: { name: "Zancada reversa" },
  };
  const res = G.closeCycle(null, r, data, new Date("2026-10-21T00:00:00Z"));
  assert.deepEqual(plain(res.missing), []);
  assert.equal(res.sessions, 4);
  assert.equal(res.exercises, 3);
  assert.equal(res.hist.cycles[0].cycle, 9);
  assert.equal(res.hist.skipped[0].reason, "Viaje");
  const s = res.hist.sessions.find((x) => x.week === 1);
  assert.equal(s.exercise, "Zancada reversa", "guarda el nombre editado");
  assert.equal(s.date, "2026-09-14");
  const max = G.findMax(G.historyRecords(res.hist, r.days[0].exercises[0].name));
  assert.equal(max.weight, 235); assert.equal(max.topReps, 18);
  assert.ok(G.isClosed(res.hist, 9));
  assert.match(G.closeCycle(res.hist, r, data).error, /ya estaba cerrado/);
  // el índice del historial sigue mostrando los ejercicios del ciclo cerrado
  const idx = G.exerciseIndex({}, {}, null, res.hist);
  assert.equal(idx.find((e) => e.name.startsWith("Hip thrust")).max.weight, 235);
});

test("protocolo: opcional, texto, y la alternativa no lo hereda", () => {
  const r = fixture();
  r.days[0].exercises[0].protocol = "Pausa 2 s";
  assert.deepEqual(plain(G.validateRoutine(r)), []);
  r.days[0].exercises[0].protocol = 3;
  assert.match(G.validateRoutine(r).join(), /protocol debe ser un texto/);
  const ex = { protocol: "Pausa", alt: "Con mancuerna" };
  assert.equal(G.slotProtocol({}, ex), "Pausa");
  assert.equal(G.slotProtocol({ altUsed: true }, ex), "");
});

test("alt: texto, null o lista de 1–2", () => {
  const r = fixture();
  r.days[0].exercises[0].alt = ["A", "B"];
  assert.deepEqual(plain(G.validateRoutine(r)), []);
  r.days[0].exercises[0].alt = ["A", "B", "C"];
  assert.match(G.validateRoutine(r).join(), /lista de 1 o 2/);
  assert.deepEqual(plain(G.alts({ alt: "X" })), ["X"]);
  assert.deepEqual(plain(G.alts({ alt: null })), []);
  assert.equal(G.slotName({ A_0_w0: { altUsed: true, altIdx: 1 } }, "A", 0, { name: "N", alt: ["X", "Y"] }, 0), "Y");
  assert.equal(G.slotName({ A_0_w0: { altUsed: true } }, "A", 0, { name: "N", alt: "X" }, 0), "X", "registros viejos sin altIdx");
});

test("peso fijo (pirámide): sin marca de descarga y siempre 'mismo peso, más reps'", () => {
  const r = fixture();
  const ex = r.days[0].exercises[0];
  ex.fixedLoad = true;
  ex.targets = ["1x5 @RPE9", "1x6 @RPE9", "1x7 @RPE9", "1x8 @RPE9"];
  ex.sets = [1, 1, 1, 1];
  assert.deepEqual(plain(G.validateRoutine(r)), [], "la S4 no necesita marca de descarga");
  const x = G.recommend({ target: "1x8 @RPE9", prevTarget: "1x7 @RPE9", week: 3, prev: { weight: 250, week: 2 }, prevRec: { reps: ["7"] }, unit: "lb", fixedLoad: true });
  assert.equal(x.value, 250); assert.equal(x.goal, "Mismo peso, más reps");
  ex.fixedLoad = "si";
  assert.match(G.validateRoutine(r).join(), /fixedLoad solo puede ser true/);
});

test("discos por lado: 45, 35, 25, 10, 5 y 2,5 lb (los menos discos posibles)", () => {
  assert.deepEqual(plain(G.platesFor(185, 45)), { side: 70, plates: [45, 25], rest: 0 });
  assert.deepEqual(plain(G.platesFor(215, 35)), { side: 90, plates: [45, 45], rest: 0 });
  assert.deepEqual(plain(G.platesFor(200, 35)), { side: 82.5, plates: [45, 35, 2.5], rest: 0 });
  assert.deepEqual(plain(G.platesFor(245, 35)), { side: 105, plates: [45, 35, 25], rest: 0 });
  assert.deepEqual(plain(G.platesFor(160, 35)), { side: 62.5, plates: [35, 25, 2.5], rest: 0 });
  assert.deepEqual(plain(G.platesFor(201, 45)), { side: 78, plates: [45, 25, 5, 2.5], rest: 0.5 });
  assert.equal(G.platesFor(30, 35), null);
});
