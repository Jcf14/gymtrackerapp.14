// Historial_Bloques.xlsx: una hoja por ciclo, armada desde exports/ciclo-N-export.json.
// Solo agrega las hojas que faltan (el Excel crece; no se reescriben ciclos ya cargados).
const fs = require("fs"), path = require("path");
const ExcelJS = require("exceljs");
const root = process.argv[2];
const exportsDir = path.join(root, "exports");
const out = path.join(exportsDir, "Historial_Bloques.xlsx");

const AZUL = "FF1F3C56", CELESTE = "FFE8EFF6", GRIS = "FFF3F5F8", ROJO = "FFFDECEA";

(async () => {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(out)) await wb.xlsx.readFile(out);
  const files = fs.readdirSync(exportsDir).filter((f) => /^ciclo-\d+-export\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const added = [];
  for (const f of files) {
    const e = JSON.parse(fs.readFileSync(path.join(exportsDir, f), "utf8"));
    const sheetName = `Ciclo ${e.cycle}`;
    if (wb.getWorksheet(sheetName)) continue;
    const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });
    ws.columns = [
      { key: "dia", width: 6 }, { key: "fecha", width: 11 }, { key: "semana", width: 13 },
      { key: "ejercicio", width: 46 }, { key: "patron", width: 24 }, { key: "objetivo", width: 26 },
      { key: "peso", width: 8 }, { key: "unidad", width: 7 }, { key: "lado", width: 9 },
      { key: "reps", width: 14 }, { key: "hecho", width: 7 }, { key: "nota", width: 36 },
    ];
    ws.mergeCells("A1:L1");
    ws.getCell("A1").value = `${e.cycleName}`;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: AZUL } };
    ws.mergeCells("A2:L2");
    ws.getCell("A2").value = `Inicio: ${e.startDate || "no registrado"} · Export: ${e.exportedAt.slice(0, 10)} · Unidad por defecto: ${e.unit}`;
    ws.getCell("A2").font = { color: { argb: "FF68758A" } };
    const head = ws.getRow(4);
    head.values = ["Día", "Fecha", "Semana", "Ejercicio", "Patrón", "Objetivo", "Peso", "Unidad", "Por lado", "Reps", "Hecho", "Nota"];
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; c.alignment = { vertical: "middle" }; });

    let shade = false;
    for (const d of e.days) {
      for (const s of d.sessions || []) {
        if (!s.status) continue;
        const row = ws.addRow({ dia: d.day, fecha: s.date || "", semana: s.week, ejercicio: `${d.title} — día NO completado`, nota: s.reason || "" });
        row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROJO } }; });
        row.font = { italic: true };
      }
      for (const ex of d.exercises) {
        shade = !shade;
        for (const w of ex.weeks) {
          const s = (d.sessions || []).find((x) => x.week === w.week);
          const peso = parseFloat(w.weight);
          const row = ws.addRow({
            dia: d.day,
            fecha: (s && s.date) || (w.date ? w.date.slice(0, 10) : ""),
            semana: w.week,
            ejercicio: w.exercise || ex.name,
            patron: ex.pattern || "",
            objetivo: w.target,
            peso: Array.isArray(w.setWeights) && w.setWeights.length ? w.setWeights.join(" · ") : peso > 0 ? peso : "",
            unidad: peso > 0 ? w.unit || e.unit : "",
            lado: w.perSide != null ? w.perSide : "",
            reps: w.repsText || "",
            hecho: w.completed ? "✓" : "",
            nota: [w.skipped ? `No hecho${w.skipReason ? `: ${w.skipReason}` : ""}` : "", w.note, w.altUsed ? "alternativa" : ""].filter(Boolean).join(" · "),
          });
          if (shade) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } }; });
          if (/S4/.test(w.week)) row.getCell("semana").font = { color: { argb: "FF2E6DA4" } };
        }
      }
    }
    ws.autoFilter = { from: "A4", to: "L4" };
    added.push(sheetName);
  }
  // hojas en orden de ciclo
  wb.worksheets.sort?.((a, b) => parseInt(a.name.match(/\d+/)) - parseInt(b.name.match(/\d+/)));
  await wb.xlsx.writeFile(out);
  console.log(added.length ? `✓ agregadas: ${added.join(", ")}` : "sin hojas nuevas", "→", out);
  const check = new ExcelJS.Workbook(); await check.xlsx.readFile(out);
  check.worksheets.forEach((w) => console.log(`  ${w.name}: ${w.rowCount} filas`));
})().catch((e) => { console.error(e); process.exit(1); });
