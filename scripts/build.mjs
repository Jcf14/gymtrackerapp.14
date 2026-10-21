// Arma dist/ para Cloudflare Pages: app/ + rutinas/ciclo-actual.json + service worker versionado.
// Solo se publica dist/: CLAUDE.md, HISTORIAL.md y exports/ nunca salen del repo.
import { cp, rm, mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFiles, listRutinas } from "./validar-rutina.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
const DIST = path.join(ROOT, "dist");
const RUTINA = path.join(ROOT, "rutinas", "ciclo-actual.json");
const NOT_PRECACHED = new Set(["sw.js", "_headers"]);

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

await rm(DIST, { recursive: true, force: true });
await cp(APP, DIST, { recursive: true });

const problems = validateFiles(listRutinas());
if (problems.length) {
  console.error(`✗ Hay rutinas inválidas:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
if (existsSync(RUTINA)) {
  await mkdir(path.join(DIST, "rutinas"), { recursive: true });
  await copyFile(RUTINA, path.join(DIST, "rutinas", "ciclo-actual.json"));
} else {
  console.warn("⚠ No existe rutinas/ciclo-actual.json: la app publicada arrancará sin rutina (se puede importar a mano).");
}

const files = (await walk(DIST)).filter((f) => !NOT_PRECACHED.has(f));
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(await readFile(path.join(DIST, f)));
const version = hash.digest("hex").slice(0, 12);

const swPath = path.join(DIST, "sw.js");
const sw = await readFile(swPath, "utf8");
const assets = ["./", ...files];
const out = sw
  .replace('const VERSION = "dev"; // build:version', `const VERSION = "${version}"; // build:version`)
  .replace("const ASSETS = []; // build:assets", `const ASSETS = ${JSON.stringify(assets)}; // build:assets`);
// Trampa conocida (CLAUDE.md §6.3 #2): comprobar que el reemplazo realmente ocurrió.
if (!out.includes(`"${version}"`) || !out.includes('"./index.html"')) {
  console.error("✗ No se pudo versionar sw.js (¿cambiaron las líneas marcadas con build:?).");
  process.exit(1);
}
await writeFile(swPath, out);
console.log(`✓ dist/ listo · versión ${version} · ${assets.length} archivos precargados`);
