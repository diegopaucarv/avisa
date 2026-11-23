"""Genera la migracion SQL del catalogo territorial desde el maestro INEI 2025.

NO ejecuta nada: escribe gis/derived/0001_distritos_inei_2025.sql

Lee:
  gis/derived/reconciliacion_distritos.csv
  gis/derived/provincias_maestro.csv
  gis/derived/distritos_maestro.csv
  gis/derived/distritos_db.csv   (para el mapeo provincia_id base -> ubigeo)

Salida: un .sql transaccional con respaldo, guardas e idempotencia.
"""

from __future__ import annotations

import csv
import pathlib
import re
import sys
import unicodedata

import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
DER = ROOT / "gis" / "derived"
SALIDA = DER / "0001_distritos_inei_2025.sql"


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    t = re.sub(r"[^A-Z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def q(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def leer(nombre):
    with (DER / nombre).open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def db_url() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("sin DATABASE_URL")


def mapear_infra(distritos):
    """Resuelve distrito_id de cada infraestructura por NOMBRE (region, provincia).

    El ubigeo textual del KML esta corrido en Tayacaja, por eso el nombre manda.
    Devuelve (pares id->ubigeo, sin_resolver).
    """
    by_reg: dict[tuple[str, str], list[str]] = {}
    by_prov: dict[tuple[str, str], list[str]] = {}
    by_ub: dict[str, str] = {}
    for r in distritos:
        by_ub[r["ubigeo"]] = r["ubigeo"]
        by_reg.setdefault((r["region_ubigeo"], norm(r["distrito"])), []).append(
            r["ubigeo"]
        )
        by_prov.setdefault((norm(r["provincia"]), norm(r["distrito"])), []).append(
            r["ubigeo"]
        )

    with psycopg.connect(db_url()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, coalesce(ubigeo_region,''), coalesce(provincia,''), "
            "coalesce(distrito,''), coalesce(ubigeo,'') FROM gis.infraestructuras_puntos"
        )
        filas = cur.fetchall()

    pares = []
    sin_resolver = []
    for iid, reg, prov, dist, ub in filas:
        reg = (reg or "").strip()
        ub = (ub or "").strip()
        c = by_reg.get((reg, norm(dist)), [])
        if len(c) == 1:
            pares.append((iid, c[0]))
            continue
        c2 = by_prov.get((norm(prov), norm(dist)), [])
        if len(c2) == 1:
            pares.append((iid, c2[0]))
            continue
        if ub in by_ub:
            pares.append((iid, ub))
            continue
        sin_resolver.append((iid, reg, prov, dist, ub))
    return pares, sin_resolver


def bloques(filas, tam=400):
    for i in range(0, len(filas), tam):
        yield filas[i : i + tam]


def main() -> int:
    recon = leer("reconciliacion_distritos.csv")
    provincias = leer("provincias_maestro.csv")
    distritos = leer("distritos_maestro.csv")
    db = leer("distritos_db.csv")

    mantener = [r for r in recon if r["accion"] == "MANTENER"]
    borrar = [r for r in recon if r["accion"] == "BORRAR"]
    revisar = [r for r in recon if r["accion"] == "REVISAR"]
    insertar = [r for r in recon if r["accion"] == "INSERTAR"]
    if revisar:
        print("Hay filas REVISAR: abortar.", file=sys.stderr)
        return 2

    # regiones por ubigeo
    regiones = {}
    for r in distritos:
        regiones.setdefault(r["region_ubigeo"], r["departamento"])

    # provincia base id -> ubigeo oficial (por region+nombre)
    base_prov = {}
    for r in db:
        base_prov.setdefault(
            r["provincia_id"], {"nombre": r["provincia"], "region": r["region"]}
        )
    idx_prov = {}
    for p in provincias:
        idx_prov.setdefault((p["region_ubigeo"], norm(p["nombre"])), p["ubigeo"])
    region_ubigeo = {norm(n): u for u, n in regiones.items()}
    prov_id_a_ubigeo = {}
    for pid, b in base_prov.items():
        ru = region_ubigeo.get(norm(b["region"]))
        pu = idx_prov.get((ru, norm(b["nombre"])))
        if pu is None:
            print(f"provincia base id={pid} sin match", file=sys.stderr)
            return 2
        prov_id_a_ubigeo[pid] = pu

    # ubigeos existentes en la base (para decidir crear/renombrar provincias)
    prov_ubigeo_existentes = set(prov_id_a_ubigeo.values())
    prov_crear = [p for p in provincias if p["ubigeo"] not in prov_ubigeo_existentes]
    prov_actualizar = [
        (
            pid,
            prov_id_a_ubigeo[pid],
            next(
                p["nombre"] for p in provincias if p["ubigeo"] == prov_id_a_ubigeo[pid]
            ),
        )
        for pid in sorted(prov_id_a_ubigeo, key=int)
    ]

    # verificar que los ubigeos de las provincias existentes no cambian
    for pid, u, nombre in prov_actualizar:
        if u != u:  # placeholder
            pass

    infra_pares, infra_sin = mapear_infra(distritos)

    L = []
    w = L.append

    w("-- Migracion del catalogo territorial a INEI 2025")
    w("-- Generado por scripts/generar_migracion_distritos.py")
    w("-- No editar a mano. Revisar gis/derived/maestro_resumen.txt antes de aplicar.")
    w("--")
    w(f"-- Provincias a crear : {len(prov_crear)}")
    w(f"-- Provincias a ajustar: {len(prov_actualizar)}")
    w(f"-- Distritos mantener : {len(mantener)}")
    w(f"-- Distritos borrar   : {len(borrar)}")
    w(f"-- Distritos insertar : {len(insertar)}")
    w("")
    w("BEGIN;")
    w("")
    w("-- Guarda de idempotencia")
    w("CREATE TABLE IF NOT EXISTS core.migracion_log (")
    w("    clave text PRIMARY KEY,")
    w("    aplicada_en timestamptz NOT NULL DEFAULT now()")
    w(");")
    w("DO $$ BEGIN")
    w(
        "  IF EXISTS (SELECT 1 FROM core.migracion_log WHERE clave = 'distritos_inei_2025') THEN"
    )
    w("    RAISE EXCEPTION 'migracion distritos_inei_2025 ya aplicada';")
    w("  END IF;")
    w("END $$;")
    w("")
    w("-- Guarda de estado esperado")
    w("DO $$ DECLARE n int; BEGIN")
    w("  SELECT count(*) INTO n FROM core.distritos;")
    w(f"  IF n <> {len(db)} THEN")
    w(f"    RAISE EXCEPTION 'se esperaban {len(db)} distritos en la base, hay %', n;")
    w("  END IF;")
    w("END $$;")
    w("")
    w("-- Respaldo reversible")
    w("DROP TABLE IF EXISTS core.distritos_backup_20261123;")
    w("CREATE TABLE core.distritos_backup_20261123 AS SELECT * FROM core.distritos;")
    w("DROP TABLE IF EXISTS core.provincias_backup_20261123;")
    w("CREATE TABLE core.provincias_backup_20261123 AS SELECT * FROM core.provincias;")
    w("")
    w("-- Se relajan las unicidades para poder re-numerar ubigeos en sitio")
    w("ALTER TABLE core.distritos DROP CONSTRAINT IF EXISTS distritos_ubigeo_key;")
    w(
        "ALTER TABLE core.distritos DROP CONSTRAINT IF EXISTS distritos_provincia_id_nombre_key;"
    )
    w("ALTER TABLE core.provincias DROP CONSTRAINT IF EXISTS provincias_ubigeo_key;")
    w(
        "ALTER TABLE core.provincias DROP CONSTRAINT IF EXISTS provincias_region_id_nombre_key;"
    )
    w("")

    # provincias existentes: nombre oficial
    w("-- 1) Provincias existentes: nombre oficial INEI")
    for pid, u, nombre in prov_actualizar:
        w(
            f"UPDATE core.provincias SET nombre = {q(nombre)} WHERE id = {pid} AND ubigeo = {q(u)};"
        )
    w("")

    # provincias nuevas
    w(f"-- 2) Provincias faltantes ({len(prov_crear)})")
    for b in bloques(prov_crear):
        w("INSERT INTO core.provincias (region_id, ubigeo, nombre)")
        w("SELECT r.id, v.ubigeo, v.nombre FROM (VALUES")
        filas = []
        for p in b:
            filas.append(
                f"  ({q(p['ubigeo'])}, {q(p['nombre'])}, {q(p['region_ubigeo'])})"
            )
        w(",\n".join(filas))
        w(") AS v(ubigeo, nombre, region_ubigeo)")
        w("JOIN core.regiones r ON r.ubigeo = v.region_ubigeo;")
        w("")

    # distritos: actualizar
    w(f"-- 3) Distritos existentes: ubigeo y nombre oficiales ({len(mantener)})")
    for b in bloques(mantener):
        w("UPDATE core.distritos d SET ubigeo = v.ubigeo, nombre = v.nombre")
        w("FROM (VALUES")
        filas = [
            f"  ({int(r['distrito_id'])}, {q(r['ubigeo_final'])}, {q(r['nombre_final'])})"
            for r in b
        ]
        w(",\n".join(filas))
        w(") AS v(id, ubigeo, nombre)")
        w("WHERE d.id = v.id;")
        w("")

    # distritos: borrar
    w(f"-- 4) Distritos fantasma sin referencias ({len(borrar)})")
    ids = ", ".join(str(int(r["distrito_id"])) for r in borrar)
    w(f"DELETE FROM core.distritos WHERE id IN ({ids});")
    w("")

    # distritos: insertar
    w(f"-- 5) Distritos faltantes ({len(insertar)})")
    for b in bloques(insertar):
        w("INSERT INTO core.distritos (provincia_id, ubigeo, nombre)")
        w("SELECT p.id, v.ubigeo, v.nombre FROM (VALUES")
        filas = [f"  ({q(r['ubigeo_final'])}, {q(r['nombre_final'])})" for r in b]
        w(",\n".join(filas))
        w(") AS v(ubigeo, nombre)")
        w("JOIN core.provincias p ON p.ubigeo = left(v.ubigeo, 4);")
        w("")

    # provincia_id coherente
    w("-- 6) Re-vincular provincia por prefijo de ubigeo")
    w("UPDATE core.distritos d SET provincia_id = p.id")
    w("FROM core.provincias p")
    w("WHERE p.ubigeo = left(d.ubigeo, 4) AND d.provincia_id <> p.id;")
    w("")

    # infraestructuras: re-vincular TODAS por nombre
    w(
        f"-- 7) Re-vincular infraestructuras por nombre ({len(infra_pares)} resueltas, {len(infra_sin)} sin resolver)"
    )
    for b in bloques(infra_pares):
        w("UPDATE gis.infraestructuras_puntos i SET distrito_id = d.id")
        w("FROM (VALUES")
        filas = [f"  ({q(iid)}, {q(ub)})" for iid, ub in b]
        w(",\n".join(filas))
        w(") AS v(id, ubigeo)")
        w("JOIN core.distritos d ON d.ubigeo = v.ubigeo")
        w("WHERE i.id = v.id AND i.distrito_id IS DISTINCT FROM d.id;")
        w("")
    if infra_sin:
        w("-- Sin resolver por nombre (se dejan como estan):")
        for iid, reg, prov, dist, ub in infra_sin:
            w(f"--   {iid}: provincia={prov!r} distrito={dist!r} ubigeo={ub!r}")
        w("")

    # re-validar uniques
    w("-- 8) Restaurar unicidades")
    w(
        "ALTER TABLE core.provincias ADD CONSTRAINT provincias_ubigeo_key UNIQUE (ubigeo);"
    )
    w(
        "ALTER TABLE core.provincias ADD CONSTRAINT provincias_region_id_nombre_key UNIQUE (region_id, nombre);"
    )
    w("ALTER TABLE core.distritos ADD CONSTRAINT distritos_ubigeo_key UNIQUE (ubigeo);")
    w(
        "ALTER TABLE core.distritos ADD CONSTRAINT distritos_provincia_id_nombre_key UNIQUE (provincia_id, nombre);"
    )
    w("")
    w("-- 9) Verificacion final (falla si no cuadra)")
    w("DO $$ DECLARE d int; p int; r int; BEGIN")
    w("  SELECT count(*) INTO d FROM core.distritos;")
    w("  SELECT count(*) INTO p FROM core.provincias;")
    w("  SELECT count(*) INTO r FROM core.regiones;")
    w(
        f"  IF d <> {len(distritos)} THEN RAISE EXCEPTION 'distritos: % (esperado {len(distritos)})', d; END IF;"
    )
    w(
        f"  IF p <> {len(provincias)} THEN RAISE EXCEPTION 'provincias: % (esperado {len(provincias)})', p; END IF;"
    )
    w("  IF r <> 25 THEN RAISE EXCEPTION 'regiones: % (esperado 25)', r; END IF;")
    w("END $$;")
    w("")
    w("-- 10) Memoria de abigeos corregidos: distritos con ubigeo distinto al previo")
    w("DO $$ DECLARE n int; BEGIN")
    w("  SELECT count(*) INTO n FROM core.distritos d")
    w("  JOIN core.distritos_backup_20261123 b ON b.id = d.id")
    w("  WHERE b.ubigeo <> d.ubigeo OR b.nombre <> d.nombre;")
    w(f"  RAISE NOTICE 'distritos re-numerados/renombrados: %', n;")
    w("END $$;")
    w("")
    w("INSERT INTO core.migracion_log (clave) VALUES ('distritos_inei_2025');")
    w("")
    w("COMMIT;")
    w("")

    SALIDA.write_text("\n".join(L), encoding="utf-8")
    print(f"escrito {SALIDA.relative_to(ROOT)}")
    print(f"  provincias crear {len(prov_crear)} ajustar {len(prov_actualizar)}")
    print(
        f"  distritos mantener {len(mantener)} borrar {len(borrar)} insertar {len(insertar)}"
    )
    print(f"  lineas {len(L)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
