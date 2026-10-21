// Carga app/js/core.js (script clásico del navegador) dentro de Node.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const CORE_PATH = new URL("../app/js/core.js", import.meta.url);

export function loadCore() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(CORE_PATH, "utf8"), ctx, { filename: "core.js" });
  return ctx.Gluteo;
}
