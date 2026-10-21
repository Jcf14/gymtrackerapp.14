# CLAUDE.md — Gym Tracker (PWA personal + generador de rutinas)

> Instrucciones permanentes del proyecto. Leelas completas antes de hacer cualquier cosa.
> Idioma de trabajo: español, directo y cercano. Si un dato no está en este archivo ni en HISTORIAL.md, no lo inventes: preguntalo.

---

## 1. Contexto del proyecto

Este repo tiene dos partes:

1. **Una PWA personal (un solo usuario)** para registrar mis entrenamientos del gimnasio: pesos, reps por serie, notas, fechas y "completado" por ejercicio, más un historial. Tiene que funcionar **sin conexión**: en mi gimnasio la señal es inestable (en algunas zonas solo hay 3G).
2. **La generación de rutinas de 4 semanas ("ciclos")**: Claude Code genera cada ciclo nuevo como un JSON que la app importa, apoyándose en `HISTORIAL.md` para decidir qué mantener, qué rotar y cuánto cargar.

La app nació como un *artifact* de claude.ai, pero **la PWA se hizo de cero** (decisión del 21/10/2026): el artifact no está en el repo ni se usa como base. La sección 6 describe el comportamiento esperado. Código en `/app/` (HTML/CSS/JS vanilla, sin frameworks ni bundler).

Estructura del repo:

```
/CLAUDE.md                  ← este archivo
/HISTORIAL.md               ← resumen de cada ciclo (leer SIEMPRE antes de generar una rutina)
/app/                       ← la PWA (index.html, css/, js/core.js = lógica pura, js/app.js = interfaz, sw.js, manifest, icons/)
/rutinas/ciclo-N.json       ← una rutina por ciclo
/rutinas/ciclo-actual.json  ← copia del ciclo vigente (es lo que carga la app)
/exports/                   ← exports JSON de la app al cerrar cada ciclo + Historial_Bloques.xlsx
/scripts/                   ← build.mjs, validar-rutina.mjs, iconos.mjs, serve.mjs
/tests/                     ← node --test: core.test.mjs (lógica) y app.test.mjs (jsdom)
/dist/                      ← salida del build (no se versiona); es lo único que se publica
```

Comandos: `npm test` · `npm run validar` · `npm run build` · `npm run serve` (prueba local de `dist/`) · `npm run iconos`.

**Publicación:** repo privado en GitHub → Cloudflare Pages (build command `npm run build`, output `dist`). El build valida todas las rutinas (si alguna falla, no publica), copia `app/` + `rutinas/ciclo-actual.json` y versiona el service worker. `CLAUDE.md`, `HISTORIAL.md` y `exports/` nunca se publican.

Estado inicial: el ciclo vigente es el **2**. Al migrar, duplicar `rutinas/ciclo-actual.json` como `rutinas/ciclo-2.json`.

---

## 2. Mi perfil

**Persona y objetivo**
- Mujer. Entreno con barra de mujer (35 lb / ~15 kg).
- Objetivo principal: **resultados físicos** (no me interesa la comunidad ni los "retos"). Hipertrofia y fuerza de **glúteo**, con énfasis en tren inferior y metodología de **Bret Contreras**. También quiero **buenos cuádriceps, isquios y pantorrillas**, y **sin descuidar el tren superior** (bíceps, tríceps y hombros bien trabajados).
- Por qué cambié de método: durante años hice los retos genéricos de RichFitTips (3 por año, ejercicios que cambian cada semana, sin personalizar) y **no progresé en pesos**. Quiero **progresión de cargas medible**.

**Nivel:** intermedio. Años entrenando, pero sin progresión estructurada. Referencia de fuerza (ciclo 1): hip thrust con barra libre, 100 lb por lado + barra de mujer (235 lb en total), series de 4–6 reps @RPE9.

**Disponibilidad**
- 5 días por semana: **lunes, martes, miércoles, jueves y sábado**. Descanso: **viernes y domingo**.
- Si no puedo el sábado, hago el Día E el viernes. A veces invierto días (una vez hice D y C intercambiados): la app debe permitir elegir el día a mano.
- Tiempo por sesión: **no definido** → preguntarme antes de generar un ciclo. (Las sesiones actuales tienen 6–8 ejercicios; duración real: no registrada.)
- Actividad extra: meta de 8.000–10.000 pasos diarios; camino ~10 min en walking pad en casa por la tarde-noche. A veces hago el ejercicio de abdomen en casa, de noche: es válido.

**Unidades y carga**
- Libras por defecto (la app permite kg). Cargo la barra **por lado** ("90 lb por lado + barra de mujer"), así que la app necesita calculadora por lado/total.
- Discos confirmados: 45, 25 y 5 lb. El salto mínimo en máquinas y mancuernas suele ser de 5 lb.

**Lesiones / limitaciones:** ninguna reportada. Sudo mucho y los días de pierna pesada el cansancio "pega" (probé electrolitos; sin mareos ni calambres). Preguntarme por molestias al iniciar cada ciclo.

**Dispositivo:** solo el celular (iPhone, Safari, app anclada a la pantalla de inicio).

**Estética de la app:** tonos azules, celeste y gris; fondo blanco o gris muy claro; limpia y profesional. Modo claro por defecto (no seguir el modo oscuro del sistema salvo que yo lo elija). Tarjetas plegables (resumen por defecto, formulario al tocar).

**Equipo del gimnasio**
- *Confirmado:* barra libre (de mujer), banco, discos, mancuernas (siempre hay), máquina Smith (la uso casi siempre para sentadilla), prensa de piernas, extensión de cuádriceps, curl femoral (sentado y arrodillado unilateral), abducción sentada, aducción, poleas/cables (abducción, patadas, pushdown, cuerda, remo bajo, curl bajo), hiperextensión 45°, bandas de resistencia.
- *Incluido en mis rutinas pero NO confirmado explícitamente:* curl femoral acostado, kickback en máquina de glúteo, reverse pec deck, press de pecho en máquina, jalón al pecho, dominadas, rueda abdominal, elevación de talones de pie y sentado.
- **Limitación clave:** las Smith de mi gym **no sirven para hip thrust** → el hip thrust siempre es con **barra libre en banco**.

**NO quiero / no puedo / no me convencen** (no volver a incluir sin preguntarme):
- Sentadilla frontal · hip thrust con pies elevados (American) · fondos en paralelas · flexiones diamante · monster walk cargado con banda · curl femoral con balón suizo · pull-through en polea/banda.
- Hip thrust en Smith · puente de glúteo desde el suelo con barra (incómodo de montar).
- Frog pump en el suelo como ejercicio principal (no puedo cargar suficiente peso; solo sirve como *alternativa* en reps altas).
- Plancha copenhague como principal (prefiero aducción en máquina; queda como alternativa).

**Imprescindibles / preferidos**
- **Sentadilla búlgara** ("un must"), hip thrust con barra libre, sentadilla en Smith con pies adelante.
- También me gustan: zancada reversa, step-ups, hiperextensión 45°, aducción en máquina, kickbacks.
- Una **alternativa por ejercicio** si la máquina/barra está ocupada (las de mancuerna no la necesitan).

**Cómo quiero que trabajes conmigo**
- Antes de cerrar un ciclo nuevo, mostrame la lista de ejercicios para que marque cuáles no conozco o no me gustan.
- No me digas que algo está listo sin haberlo probado (me pasó con la app; ver sección 6).
- Explicame el porqué de las recomendaciones de forma simple (RPE, deload, progresión).
- Si cambio un ejercicio, actualizá todo junto: JSON del ciclo + app + HISTORIAL.md.

---

## 3. Pautas para generar rutinas

### 3.1 Estructura del ciclo (4 semanas)

| Semana | Fase | Esfuerzo | Series y notas |
|---|---|---|---|
| S1 | Adaptación | RPE 7 (3 reps en reserva) | Plan completo. Calibrar el peso con la primera serie. |
| S2 | Intensificación | RPE 8 (2 en reserva) | Plan completo; subir peso donde el target diga "(+peso)". |
| S3 | Pico | RPE 9 (1 en reserva) en los básicos | 3–4 series pesadas de menos reps; hip thrust del Día A suma 1 serie de rematado 15–20 reps. |
| S4 | Descarga (deload) | RPE 5–6 | 2 series, ~50–60% del peso de S3 (la app sugiere 55%). Sin pulsos ni rematado. |

- En descarga puedo hacer 3 series si quiero (2 se me hace poco): no es problema mientras el peso siga liviano y termine con 4+ reps en reserva.
- La descarga usa los **mismos ejercicios** del ciclo (cambia carga y volumen, no el movimiento).

### 3.2 Semana tipo

| Día | Clave | Enfoque |
|---|---|---|
| Lunes | A | Glúteo #1 — sesgo vertical |
| Martes | B | Tren superior — empuje |
| Miércoles | C | Glúteo #2 — sesgo unilateral |
| Jueves | D | Tren superior — tirón |
| Viernes | — | Descanso (o Día E si no pude el sábado) |
| Sábado | E | Glúteo #3 — metabólico / lockout |
| Domingo | — | Descanso |

### 3.3 Metodología Bret Contreras ("regla de tercios")

- Los 3 días de pierna son **días de glúteo completos**: cada uno trabaja los 4 patrones — **thrust/bridge, squat/lunge, hinge/pull y abducción** — rotando la variante de cada patrón entre sesiones. No hay días separados de "cuádriceps" o "isquios" (el volumen que viene después de un patrón que te fríe las piernas se vuelve volumen basura).
- Reparto semanal aproximado: 1/3 patrones verticales, 1/3 horizontales, 1/3 abducción (lateral/rotacional).
- Variantes dentro de cada patrón: thrust (rango completo + trabajo de lockout: pausas, pulsos, barra + banda) · squat/lunge (bilateral + unilateral) · hinge (vertical + horizontal: RDL, hipers) · abducción (plano frontal + transverso).
- Volumen orientativo: ~4 ejercicios de glúteo por sesión × 3 sesiones ≈ 36 series semanales de glúteo. Cuádriceps e isquios reciben ~9 series cada uno de forma indirecta, más un accesorio dedicado (extensión de cuádriceps / curl femoral) para reforzarlos.
- **El hip thrust cambia de variante en cada día de glúteo:** Día A pesado con pausa de 2 s arriba → Día C más liviano (≈15–20% menos peso que el Día A) con pulsos → Día E unilateral / B-stance. Siempre con barra libre.
- **Pulsos:** se hacen **al final de la serie** (después de la última repetición, quedándose arriba), no en cada rep. 10 pulsos en S1–S2, 15 en S3. Ninguno en descarga.
- Tren superior: 2 días de ~7 ejercicios. Empuje con **2 ejercicios de tríceps**; tirón con **2 de bíceps**; hombro lateral y posterior; core.
- Frecuencias mínimas por semana: pantorrillas 2×, curl femoral 2×, cuádriceps accesorio 1–2×, aducción 1×.
- **Core:** 1 ejercicio por día de entrenamiento (~15 series semanales), variando el tipo: anti-extensión (planchas, rueda), anti-rotación (bird dog, dead bug, Pallof) y flexión (elevaciones de piernas). Son `noWeight` (no exigen peso). Puedo hacerlos en casa de noche.
- Activación previa en días de pierna (bandas: monster walk, clamshell, sentadilla o puente con banda). En tren superior: movilidad + series de aproximación.

### 3.4 Progresión de carga

- El esfuerzo se guía por **RPE**, no por números fijos. Los pesos de las tablas son estimaciones: manda la primera serie.
- **Doble progresión** en accesorios y en máquinas de saltos de 5 lb: primero subir reps dentro del rango; al llegar al techo en todas las series, subir 5 lb y volver al piso del rango. Es normal quedarse 2–3 semanas con el mismo peso.
- "(+peso)" en un target = subir peso respecto de la semana anterior (la app sugiere +5 lb).
- Entre ciclos se compara **S1 contra S1** (mismo RPE y rango), nunca la S1 nueva contra el pico de la S3. Peso de arranque: S1 del ciclo anterior **+5–10%** en compuestos grandes (+5–10 lb) y +2,5–5 lb en tren superior; en accesorios, primero reps.
- Ejercicio que vuelve tras una o más rotaciones de ausencia: tomar como referencia su **último peso pico registrado** (HISTORIAL.md / exports) y arrancar igual o apenas más alto; confirmar con el RPE de la primera serie.
- Si en S1 un peso se siente RPE 8–9 (más pesado de lo previsto): bajar 10–15 lb en la sesión siguiente, o dejarlo y reutilizarlo en S2 (que pide RPE 8).
- Serie de rematado (S3, hip thrust del Día A): 1×15–20 con ~40–50% menos del peso de las series pesadas.
- Descarga: 50–60% del peso de S3, RPE 5–6.

### 3.5 Rangos de series, reps y descanso

- Compuestos pesados: 3–4 series. Reps por semana: S1 8–10 · S2 6–8 · S3 4–6. Peso muerto (sumo/convencional): 4×6–8 → 4×5–6 → 3×3–5.
- Unilaterales: 3×8–12 por pierna/lado.
- Accesorios: 3×12–15. Abducción/aducción 3×15–20 (20–25 en S3). Gemelos 3–4×12–25.
- Core: reps o segundos según el ejercicio, 3 series (2 en descarga).
- **Descanso sugerido** (orientativo; ajusto según cómo me sienta): peso muerto pesado 120–150 s · compuestos principales 90–120 s · unilaterales/moderados 75–90 s · accesorios 45–60 s · core 30–45 s.

### 3.6 Cómo elegir y rotar ejercicios

- Cada ciclo nuevo **rota variantes dentro de cada patrón** (estímulo fresco) y conserva los "imprescindibles" de la sección 2. Respetar siempre la lista de "NO quiero".
- Rotar, no reinventar: se mantienen la estructura de días, el orden de patrones, la progresión y el descanso; cambian las variantes.
- Todo ejercicio que dependa de máquina, barra o banco fijo lleva **alternativa**; los de mancuerna o peso corporal llevan `"alt": null`.
- Se pueden reutilizar variantes de ciclos anteriores después de 1–2 ciclos, usando el peso de referencia registrado.
- Catálogo por patrón (`[C1]` / `[C2]` = ya usado en ciclo 1 / ciclo 2):
  - **Thrust/Bridge:** hip thrust barra libre con pausa 2 s [C2] · barra + banda + pulsos [C1] · barra + pulsos, más liviano [C2] · unipodal / puente a 1 pierna [C1] · B-stance [C2] · alternativas: con mancuerna en banco, en máquina (sin confirmar), frog pump con mancuerna en reps altas.
  - **Squat/Lunge:** sentadilla en Smith (trasera [C1], pies adelante [C2]) · prensa de piernas (alt.) · búlgara [C1 alt., C2] · step-up [C1 alt., C2] · zancada reversa con déficit [C2] · zancada caminando [C1 alt.] · split squat y goblet (alt.).
  - **Hinge:** RDL bilateral [C1] · RDL a una pierna [C2] · peso muerto convencional [C1] · peso muerto sumo [C2] · hiperextensión 45° [C1] · buenos días [C2] · versiones con mancuernas (alt.).
  - **Abducción/rotación:** máquina sentada [C1] · de pie en cable [C2] · máquina sentada con torso inclinado [C2] · kickback en polea [C1] · kickback en máquina de glúteo [C2] · banda de pie (alt.).
  - **Aducción:** máquina [C1, C2] · plancha copenhague (alt.).
  - **Cuádriceps accesorio:** extensión de cuádriceps [C1] · extensión unilateral (la hice en lugar de la zancada en el ciclo 2).
  - **Isquios accesorio:** curl femoral sentado [C1] · arrodillado a una pierna [C2] · acostado [C2] · puente de isquios con talones en banco (alt.).
  - **Pantorrillas:** de pie [C2] · sentado [C2].
  - **Empuje:** press banca plano [C1] · inclinado con mancuernas [C2] · press militar con mancuernas [C1] · Arnold [C2] · press de pecho en máquina [C2] · laterales con mancuerna [C1] / en polea [C2] · tríceps: pushdown [C1], overhead con cuerda [C2], press francés o copa [C1, C2].
  - **Tirón:** dominadas/jalón [C1] · jalón agarre neutro [C2] · remo con barra [C1] · remo en polea baja [C2] · remo unilateral con mancuerna [C1, C2] · face pull [C1] · reverse pec deck [C2] · curl barra/mancuerna [C1] · curl en polea baja [C2] · martillo/inclinado [C1] · concentrado [C2].
  - **Core:** elevación de piernas colgado [C1] · plancha con elevación de pierna [C2] · plancha lateral [C1] · plancha con toque de hombro [C2] · plancha con desplazamiento [C2] · Pallof [C1] · rueda abdominal [C2] · dead bug [C1] · bird dog [C2].
- Antes de guardar el ciclo: mostrarme la lista final de ejercicios para que la apruebe o la cambie.

### 3.7 Cierre de ciclo

1. Pedirme el export JSON de la app → guardarlo en `/exports/ciclo-N-export.json`.
2. Resumir en `HISTORIAL.md`: pesos pico por ejercicio (con las reps de ese pico) y cómo me fue.
3. Agregar **una hoja por ciclo** a `/exports/Historial_Bloques.xlsx` (semanas con fechas, pesos, reps, notas). Un solo Excel que crece; nada de un archivo por ciclo.

---

## 4. Formato JSON de una rutina

Cada ciclo es un archivo `rutinas/ciclo-N.json`. Se basa en el arreglo `DAYS` del artifact (campos marcados *original*) más metadatos nuevos (*nuevo*).

### Ejemplo corto

```json
{
  "schemaVersion": 1,
  "cycle": 3,
  "name": "Programa Glúteo — Ciclo 3",
  "startDate": "2026-11-02",
  "unitDefault": "lb",
  "weeks": ["Semana 1", "Semana 2", "Semana 3", "Semana 4"],
  "weekShort": ["S1", "S2", "S3", "S4 (Deload)"],
  "notes": "Texto libre: qué cambió respecto del ciclo anterior.",
  "days": [
    {
      "key": "A",
      "label": "Lun · A",
      "dayName": "Lunes",
      "weekday": 1,
      "title": "Glúteo #1 — Sesgo Vertical",
      "type": "lower",
      "warmup": "Banda en tobillos: monster walk 2x15 pasos + clamshell 2x15 c/lado",
      "exercises": [
        {
          "pattern": "Thrust/Bridge",
          "name": "Hip thrust con barra libre (pausa 2s arriba)",
          "alt": "Hip thrust con mancuerna en banco",
          "rest": "90-120s",
          "targets": ["4x8-10 @RPE7", "4x6-8 @RPE8", "3x4-6 @RPE9 + 1x15-20", "2x10 @RPE6"],
          "sets": [4, 4, 4, 2]
        },
        {
          "pattern": "Core",
          "name": "Plancha con elevación de pierna alterna",
          "alt": null,
          "rest": "30-45s",
          "noWeight": true,
          "targets": ["3x10 c/lado", "3x10 c/lado", "3x12 c/lado", "2x8 c/lado"],
          "sets": [3, 3, 3, 2]
        }
      ]
    }
  ]
}
```

### Referencia de campos

| Campo | Tipo | Origen | Descripción |
|---|---|---|---|
| `schemaVersion` | número | nuevo | Versión del formato (hoy 1). |
| `cycle` | número | nuevo | N del ciclo; coincide con el nombre del archivo. |
| `name`, `notes` | texto | nuevo | Nombre del ciclo y notas libres. |
| `startDate` | `"YYYY-MM-DD"` o `null` | nuevo | Inicio real del ciclo. |
| `unitDefault` | `"lb"` o `"kg"` | nuevo | Unidad por defecto. |
| `weeks`, `weekShort` | 4 textos | original | Etiquetas de semana (constantes `WEEKS`, `WEEK_SHORT`). |
| `days[].key` | `"A"`–`"E"` | original | Identificador fijo del día (parte de la clave de almacenamiento). |
| `days[].label`, `dayName`, `title` | texto | original | Etiqueta corta, nombre del día y título. |
| `days[].weekday` | 0–6 (domingo = 0) | **nuevo** | Día real para la autodetección. En el artifact estaba fijo en el código `{1:0, 2:1, 3:2, 4:3, 6:4}`: la app nueva debe leerlo de acá. |
| `days[].type` | `"lower"` o `"upper"` | original | Define el color (pierna / tren superior). |
| `days[].warmup` | texto | original | Activación del día. |
| `exercises[].pattern` | texto o `null` | original | Patrón de Contreras; `null` en tren superior salvo `"Core"`. |
| `exercises[].name` | texto | original | Nombre mostrado. |
| `exercises[].alt` | texto o `null` | original | Alternativa si el equipo está ocupado. |
| `exercises[].rest` | texto | original | Descanso sugerido, ej. `"90-120s"`. |
| `exercises[].noWeight` | `true` (opcional) | original | No exige peso para guardar o completar (core / peso corporal). |
| `exercises[].targets` | **4 textos** | original | Objetivo por semana (S1–S4). |
| `exercises[].sets` | **4 números** | original | Series de trabajo por semana = casilleros de reps en la app. |

### Reglas del formato

- `weeks`, `weekShort`, `targets` y `sets` tienen **exactamente 4 elementos**.
- `sets[i]` debe coincidir con el primer número de `targets[i]` (`"4x8 @RPE7"` → 4). Si hay serie de rematado se suma: `"3x4-6 @RPE9 + 1x15-20"` → 4.
- **Convenciones de texto que la app interpreta** en `targets`:
  - `(+peso)` → sugiere subir ~5 lb respecto de la semana anterior.
  - `(liviano)` (o un paréntesis que empiece así, ej. `(liviano/asistido)`), `@RPE5-6` o `@RPE6` → semana de descarga: sugiere ~55% del peso de la semana previa.
  - La S4 de cualquier ejercicio sin `noWeight` **debe** incluir una de esas marcas, o la sugerencia de descarga no se activa.
  - `c/pierna`, `c/lado` y `+ N pulsos` son solo descriptivos.
- Las claves de día son `A`–`E` y no cambian. El orden de los ejercicios dentro de un día **es parte de la clave de almacenamiento** (`A_0_w0` = día A, ejercicio 0, semana 1): no reordenar ni insertar ejercicios a mitad de un ciclo. Un ciclo nuevo usa un espacio de almacenamiento nuevo.
- Antes de guardar un JSON, validarlo con un script (parsea, 4 elementos, `sets` vs `targets`, marca de descarga).

---

## 5. Reglas de trabajo

Al generar una rutina nueva:

1. **Leer `HISTORIAL.md` completo** (y el último `rutinas/ciclo-N.json`) antes de proponer nada.
2. Preguntarme lo que falte: tiempo por sesión, molestias, cambios de equipo, ejercicios que quiero cambiar.
3. Proponer la lista de ejercicios y esperar mi OK (sección 3.6).
4. Guardar la rutina en **`/rutinas/ciclo-N.json`** (N = último ciclo + 1) y copiarla a `rutinas/ciclo-actual.json`.
5. Validar el JSON (sección 4).
6. **Agregar una entrada nueva a `HISTORIAL.md`** (formato abajo) y actualizar "Notas para el próximo ciclo".

Siempre:

- **No inventar datos** (fechas, pesos, resultados): si no existen, escribir "no registrado".
- Si cambio un ejercicio a pedido: actualizar el JSON del ciclo, `HISTORIAL.md` y la app juntos.
- **Verificar antes de decir "listo"**: `npm test` + ejecutar la app (smoke test) y comprobar el flujo que cambió. No prometer funciones que no se hayan probado.

**Formato de entrada en HISTORIAL.md** (una por ciclo, del más viejo al más nuevo):

```
## Ciclo N — <nombre> (<fechas aproximadas>)
- Estado: completado | en curso
- Enfoque:
- Estructura:
- Ejercicios principales:
- Cómo me fue:
- Cambios y por qué:
- Archivos: rutinas/ciclo-N.json, exports/...
```

---

## 6. La app: qué conservar, trampas conocidas y pendientes

### 6.1 Comportamiento esperado (heredado del artifact, implementado de cero)

- **Navegación:** pestañas "Rutina" / "Historial" en una barra inferior; arriba, botón ⓘ (glosario) y ⚙ (ajustes). En Rutina: selector de **semana** arriba y de **día** abajo (orden pedido por mí). Autodetecta el día por la fecha real (lun–jue y sáb); viernes y domingo respetan el último día visto.
- **Tarjeta por ejercicio:** plegada muestra número, patrón, nombre, objetivo de la semana, 🏆 máximo (peso×reps), y el peso guardado o, si no hay, el **sugerido con % y qué se espera**. Un círculo de "completado" se toca directo. Desplegada: descanso, sugerido y máximo como mini estadísticas, el porqué de la sugerencia, alternativa, renombrar, reps por serie, calculadora de barra, peso, nota y Guardar.
- **Validación:** no se puede guardar ni completar sin peso, salvo `noWeight`.
- **Reps por serie:** un casillero por serie, o "todas las series fueron iguales" (un solo campo).
- **Calculadora de barra:** barra Mujer (35 lb / 15 kg), Hombre (45 lb / 20 kg) o personalizada; modo "por lado" o "total"; muestra el total o el equivalente por lado; "Usar este peso" lo vuelca al campo.
- **Editar ejercicio:** reemplaza el nombre del ejercicio en ese espacio (todas las semanas); "Restablecer" vuelve al original.
- **Sugerencias:** siempre dicen en simple qué se espera: "Más peso, menos reps", "Mismo peso, más reps", "Más peso y más reps", "Menos peso", etc. (no usar jerga como "doble progresión"), con el % contra la referencia. Reglas: descarga → 55% de la semana previa · "(+peso)" → anterior + 5 · rango de reps más bajo que la semana anterior → +5% (mín. +5 lb) · si no llegó al techo del rango en todas las series → mismo peso, más reps; si llegó → +5 lb · S1 → S1 del ciclo anterior +5% (o mismo peso si allí no llegó al techo) · sin referencia → ~90% del máximo ("Calibrá el peso"). La semana anterior solo cuenta si fue el mismo ejercicio (no la alternativa).
- **Historial:** lista de ejercicios de **todos los ciclos**, con buscador (ignora tildes) y filtros Todos / Pierna / Superior / Core. Cada fila muestra solo el máximo actual (peso × reps) y su fecha. Al tocar: máximo actual, **récords anteriores** (cada vez que se superó el máximo: más peso, o mismo peso con más reps) y todas las sesiones con sus notas.
- **Alternativa:** "Usar esta semana" marca `altUsed` en ese registro (el peso cuenta para la alternativa, no para el original); "Usar en todo el ciclo" crea un override de nombre (se deshace con Renombrar → Restablecer).
- **Glosario:** solo desde el botón ⓘ del encabezado (se sacó de cada tarjeta a pedido). Incluye RPE, reps en reserva, rango, semanas, descarga, (+peso), sugerido, máximo, pulsos, rematado, c/lado, por lado/total, alternativa. Textos sacados de la sección 3; si se agrega un término nuevo a las rutinas, sumarlo a `GLOSSARY` en app.js.
- **Ajustes:** apariencia (Claro por defecto / Oscuro / Automático), unidad lb/kg (solo cambia etiquetas; no convierte valores guardados) y exportar datos.
- **Aviso flotante ("toast")** al guardar: tiene que sobrevivir al re-render.
- **Offline primero:** todo se guarda al instante en el dispositivo.

### 6.2 Esquema de almacenamiento (localStorage)

Todos los valores se guardan como JSON (`JSON.stringify`).

- `gluteo_tracker_ciclo-<N>` → un objeto por ciclo con:
  - `"<día>_<idxEjercicio>_w<semana0-3>"` → `{ weight (string, peso total), weightMode ("perSide"|"total"), perSideDisplay (número o null), note, completed (bool), reps (array de strings), repsSame (bool), repsSameValue, altUsed (bool, se hizo la alternativa esa semana), savedAt (ISO o null) }`
  - `"ovr_<día>_<idxEjercicio>"` → `{ name, savedAt }` (`name: null` = override borrado).
- `gluteo_rutinas` → `{ "<N>": rutina }`: cada rutina cargada (del servidor o importada) queda guardada, así se pueden consultar ciclos anteriores sin conexión. `gluteo_ciclo_activo` → N.
- `gluteo_unit` (`lb`/`kg`) · `gluteo_theme` (`light`/`dark`/`auto`; por defecto `light`) · `gluteo_last_day` · `gluteo_last_week` (`{ cycle, week }`) · `gluteo_last_backup` (ISO).
- Al arrancar, la app trae `rutinas/ciclo-actual.json` (en el service worker: red primero con tope de 4 s, después caché). Si es un ciclo mayor al activo, pasa a ese ciclo sola.
- **Export de ciclo** (`gluteo-ciclo-N-FECHA.json`): `{ exportedAt, type: "gluteo-cycle-export", cycle, cycleName, unit, days: [{ day, title, exercises: [{ name (editado), originalName, pattern, weeks: [{ week, target, weight, weightMode, perSide, reps, repsText, note, completed, date }] }] }] }`. Es el que va a `/exports/ciclo-N-export.json`.
- **Respaldo completo** (`gluteo-respaldo-FECHA.json`): `{ type: "gluteo-backup", version: 1, exportedAt, prefs, routines, data: { "<N>": {...} } }`. Se restaura desde ⚙. La app avisa si pasaron 7 días o más sin respaldo.
- En iOS, exportar y respaldar abren la hoja de compartir ("Guardar en Archivos"). Si no está disponible, se usa una descarga `<a download>`.

### 6.3 Trampas conocidas (bugs reales que tuvimos)

1. **Selector solapado:** `card.querySelector(".use-btn:not(.save-btn)")` agarraba el botón "Guardar nombre" y le pisaba su `onclick` con el de la calculadora. Resultado: guardar el nombre no guardaba nada y se colaba un peso. Usar clases únicas por botón.
2. **Ediciones fallidas en silencio:** un cambio que supuestamente agregaba la sincronización nunca llegó al archivo; el resto de la página quedó llamando a una función inexistente. Después de cada cambio, comprobar que el archivo realmente lo contiene.
3. **Referencias a elementos inexistentes:** un `getElementById(...)` sobre un botón que no estaba en el HTML cortó todo el script y la app quedó en blanco. Verificar que cada id/clase referenciada exista.
4. **Feedback que desaparece:** mostrar "Guardado ✓" dentro de la tarjeta y volver a renderizar al instante lo borraba. Usar un toast global.
5. **Sin prueba no hay "listo":** el smoke test se hizo con jsdom (cargar la página, abrir una tarjeta, editar nombre, guardar peso, usar la calculadora, restablecer) y comprobar que no haya errores en consola.

### 6.4 Decisiones de implementación

- Estilo (pedido: limpia, intuitiva, moderna, con efectos): estética de app de fitness iOS. Superficies sin bordes con sombras suaves, tarjeta del día con degradé azul y anillo de progreso, tira de días tipo calendario, peso con − / +, interruptor "Todas iguales", recuadro "Sugerido para hoy". Títulos en la fuente del sistema; números en Barlow Condensed (`app/fonts/`, licencia OFL); íconos SVG en línea (no emojis). Animaciones solo en lo que cambia (entrada de vista, apertura de tarjeta, pop del check, brillo de nuevo récord, hoja que sube), vía clases `fx-*` que se consumen en cada render; respetan "reducir movimiento".
- Clics resueltos por `data-action` con un único manejador (evita la trampa 1). Los formularios abiertos guardan un **borrador en memoria**, así que un re-render (por ejemplo, completar otra tarjeta) no borra lo que estaba escrito.
- Sin sincronización en la nube (solo uso el celular). El resguardo es el respaldo JSON.
- `npm test` cubre: validación de rutinas, sugerencias, calculadora, máximo entre ciclos, export con nombre editado, respaldo y, en jsdom, los flujos de la sección 6.3 (guardar/completar sin peso, editar/restablecer nombre, calculadora, toast, borradores, historial, ajustes, persistencia, ids y `data-action` existentes).
- Probado también en Chrome real (390×844): el service worker se activa, la app recarga **sin conexión** con los datos y no hay errores de consola. **Falta probarla en el iPhone real** (Safari + pantalla de inicio).

### 6.5 Pendientes

1. Conseguir el JSON del ciclo 2 (`rutinas/ciclo-2.json`, copiado como `ciclo-actual.json`) o generar directamente el ciclo 3.
2. Datos del ciclo 2 que están en el artifact: si se quieren en la app nueva, exportarlos (⚙ → Exportar datos del artifact) y escribir un importador. Como mínimo, guardarlos en `/exports/` para HISTORIAL.
3. Primera publicación en Cloudflare Pages y prueba en el iPhone: instalar en la pantalla de inicio, modo avión, ícono, exportar a Archivos.
4. Hoja del ciclo en `exports/Historial_Bloques.xlsx` al cerrar cada ciclo (§3.7).

### 6.6 Paleta de la app (variables CSS del artifact)

Claro: `--bg #F7F8FA` · `--surface #FFFFFF` · `--surface-2 #F0F2F5` · `--text #1A2433` · `--text-2 #68758A` · `--border #E1E5EB` · `--primary #1F3C56` · `--lower #2E6DA4` (pierna) · `--upper #5FA8D3` (tren superior) · `--danger #C0392B` · `--ok #2E8B57`.
Oscuro: `--bg #10141C` · `--surface #1A212E` · `--primary #7FB3DE` · `--lower #5B9BD5` · `--upper #9CCDEB`.