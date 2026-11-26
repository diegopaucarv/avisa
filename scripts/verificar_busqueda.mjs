/**
 * Verificación de la búsqueda libre por palabras.
 *
 *   node scripts/verificar_busqueda.mjs          → comprobaciones sin base
 *   node scripts/verificar_busqueda.mjs --db     → además compara viejo vs nuevo
 *
 * El modo `--db` es SÓLO LECTURA: ejecuta dos `select count(*)` sobre
 * `core.casos` (el `where` anterior y el nuevo) y los imprime. No escribe,
 * no migra y no abre transacciones de escritura.
 *
 * La cadena se toma de `APP_DATABASE_URL` (o `DATABASE_URL`) del entorno o del
 * `.env`. Nunca se imprime.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** En Windows `import()` exige una URL `file://`, no una ruta con `c:` */
const MODULO_BUSQUEDA = pathToFileURL(
  path.join(ROOT, "lib", "db", "busqueda.ts"),
).href;

/* ── comprobaciones puras ─────────────────────────────────────────────────── */

async function comprobarFunciones() {
  const { palabrasDe, condicionesTexto, filtroTexto } = await import(
    MODULO_BUSQUEDA
  );

  // Recorta, colapsa espacios, descarta vacíos y acota a 6 palabras.
  assert.deepEqual(palabrasDe("  San   Juan de Lurigancho  "), [
    "San",
    "Juan",
    "de",
    "Lurigancho",
  ]);
  assert.deepEqual(palabrasDe("uno dos tres cuatro cinco seis siete ocho"), [
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
  ]);
  assert.deepEqual(palabrasDe("   "), []);
  assert.deepEqual(palabrasDe(undefined), []);

  // Un `and` por palabra, un `or` por columna, y un parámetro por palabra.
  const params = [];
  const bind = (valor) => {
    params.push(valor);
    return `$${params.length}`;
  };
  assert.equal(filtroTexto(["a.x"], "", bind), null);

  const sql = filtroTexto(["a.x", "b.y"], "agua rio", bind);
  assert.equal(
    sql,
    "((core.normalizar_ref(a.x) like core.normalizar_ref($1) or core.normalizar_ref(b.y) like core.normalizar_ref($1))" +
      " and (core.normalizar_ref(a.x) like core.normalizar_ref($2) or core.normalizar_ref(b.y) like core.normalizar_ref($2)))",
  );
  assert.deepEqual(params, ["%agua%", "%rio%"]);

  assert.deepEqual(condicionesTexto(["a.x"], null, bind), []);

  console.log("OK · funciones: palabras, and por palabra y parámetros");
}

/* ── comparación contra la base (sólo lectura) ───────────────────────────── */

function leerCadena() {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  try {
    const env = readFileSync(path.join(ROOT, ".env"), "utf8");
    const linea = env
      .split(/\r?\n/)
      .find((fila) => fila.startsWith("APP_DATABASE_URL="));
    return linea ? linea.slice("APP_DATABASE_URL=".length).trim() : null;
  } catch {
    return null;
  }
}

/** Predicado anterior: un único `like` con el término completo. */
const WHERE_VIEJO = `(
  core.normalizar_ref(c.codigo_caso) like core.normalizar_ref($1)
  or core.normalizar_ref(c.nombre_caso) like core.normalizar_ref($1)
  or core.normalizar_ref(coalesce(c.resumen_ejecutivo, '')) like core.normalizar_ref($1)
)`;

/** Predicado nuevo: aparece cada palabra, en cualquier orden. */
const WHERE_NUEVO = `coalesce((select bool_and(
           core.normalizar_ref(c.codigo_caso) like core.normalizar_ref(pal)
        or core.normalizar_ref(c.nombre_caso) like core.normalizar_ref(pal)
        or core.normalizar_ref(coalesce(c.resumen_ejecutivo, '')) like core.normalizar_ref(pal))
        from unnest($1::text[]) as t(pal)), true)`;

async function compararContraBase() {
  const cadena = leerCadena();
  if (!cadena) {
    console.error("Falta APP_DATABASE_URL (entorno o .env).");
    process.exitCode = 1;
    return;
  }

  const { default: pg } = await import("pg");
  const { palabrasDe } = await import(MODULO_BUSQUEDA);
  const client = new pg.Client({ connectionString: cadena });
  await client.connect();

  try {
    const terminos = ["agua", "agua rio", "rio agua", "conflicto minero por agua"];
    const filas = [];

    for (const termino of terminos) {
      const patrones = palabrasDe(termino).map((palabra) => `%${palabra}%`);
      const viejo = await client.query(
        `select count(*)::int as total from core.casos c where ${WHERE_VIEJO}`,
        [`%${termino}%`],
      );
      const nuevo = await client.query(
        `select count(*)::int as total from core.casos c where ${WHERE_NUEVO}`,
        [patrones],
      );
      filas.push({
        termino,
        viejo: viejo.rows[0].total,
        nuevo: nuevo.rows[0].total,
      });
    }

    console.table(filas);
    console.log(
      "Sólo lectura. `viejo` = un like con el término completo; `nuevo` = todas las palabras.",
    );
  } finally {
    await client.end();
  }
}

/* ── main ───────────────────────────────────────────────────────────────── */

await comprobarFunciones();
if (process.argv.includes("--db")) {
  await compararContraBase();
}
