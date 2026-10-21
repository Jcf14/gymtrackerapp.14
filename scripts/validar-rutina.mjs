// Valida rutinas (CLAUDE.md §4).
// Uso: npm run validar                 → todos los rutinas/*.json
//      npm run validar -- archivo.json → solo esos archivos
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCore } from "./core-node.mjs";

const G = loadCore();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTINAS = path.join(ROOT, "rutinas");

export function validateFiles(files) {
  const problems = [];
  const parsed = {};
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    let r;
    try { r = JSON.parse(readFileSync(f, "utf8")); }
    catch (e) { problems.push(`${rel}: JSON inválido (${e.message})`); continue; }
    parsed[path.basename(f)] = r;
    for (const e of G.validateRoutine(r)) problems.push(`${rel}: ${e}`);
    const m = /^ciclo-(\d+)\.json$/.exec(path.basename(f));
    if (m && Number(m[1]) !== r.cycle) problems.push(`${rel}: el nombre dice ciclo ${m[1]} pero cycle=${r.cycle}`);
  }
  // ciclo-actual.json tiene que ser copia exacta de su ciclo-N.json.
  const actualFile = files.find((f) => path.basename(f) === "ciclo-actual.json");
  const actual = parsed["ciclo-actual.json"];
  if (actualFile && actual && Number.isInteger(actual.cycle)) {
    const twinPath = path.join(path.dirname(actualFile), `ciclo-${actual.cycle}.json`);
    if (!existsSync(twinPath)) {
      problems.push(`ciclo-actual.json es el ciclo ${actual.cycle} pero no existe ciclo-${actual.cycle}.json`);
    } else {
      let twin = null;
      try { twin = JSON.parse(readFileSync(twinPath, "utf8")); } catch { /* ya reportado arriba */ }
      if (twin && JSON.stringify(twin) !== JSON.stringify(actual))
        problems.push(`ciclo-actual.json no es idéntico a ciclo-${actual.cycle}.json`);
    }
  }
  return problems;
}

export function listRutinas() {
  if (!existsSync(RUTINAS)) return [];
  return readdirSync(RUTINAS).filter((f) => f.endsWith(".json")).map((f) => path.join(RUTINAS, f));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((a) => path.resolve(a)) : listRutinas();
  if (!files.length) { console.log("No hay rutinas para validar en rutinas/."); process.exit(0); }
  const problems = validateFiles(files);
  if (problems.length) {
    console.error(`✗ ${problems.length} problema(s):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} rutina(s) válidas: ${files.map((f) => path.basename(f)).join(", ")}`);
}
