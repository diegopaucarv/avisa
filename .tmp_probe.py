# -*- coding: utf-8 -*-
import os

import psycopg2

url = None
for line in open(".env", encoding="utf-8", errors="replace"):
    if line.startswith("NEON_OWNER_URL="):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
if not url:
    raise SystemExit("sin NEON_OWNER_URL")

conn = psycopg2.connect(url)
conn.set_session(readonly=True, autocommit=True)
cur = conn.cursor()


def q(sql):
    try:
        cur.execute(sql)
        return cur.fetchall()
    except Exception as e:
        return [("ERROR", str(e)[:90])]


print("== conteos ==")
for t in [
    "core.casos",
    "core.demandas",
    "core.compromisos",
    "core.hitos_compromiso",
    "core.reuniones_dialogo",
    "core.actores",
    "core.casos_actores",
    "core.documentos",
]:
    print("%-28s %s" % (t, q("select count(*) from " + t)[0][0]))

print("\n== columnas core.hitos_compromiso ==")
for r in q("""select column_name from information_schema.columns
              where table_schema='core' and table_name='hitos_compromiso'
              order by ordinal_position"""):
    print(" ", r[0])

print("\n== columnas core.compromisos ==")
for r in q("""select column_name from information_schema.columns
              where table_schema='core' and table_name='compromisos'
              order by ordinal_position"""):
    print(" ", r[0])

print("\n== cat_tematicas ==")
for r in q("select id, nombre from core.cat_tematicas order by id"):
    print(" ", r)

print("\n== cat_estados_hito ==")
for r in q("select id, nombre from core.cat_estados_hito order by id"):
    print(" ", r)

print("\n== cat_niveles_riesgo ==")
for r in q("select id, nombre from core.cat_niveles_riesgo order by id"):
    print(" ", r)

print("\n== columnas core.casos (filtradas) ==")
for r in q("""select column_name from information_schema.columns
              where table_schema='core' and table_name='casos'
              order by ordinal_position"""):
    print(" ", r[0])

print("\n== tablas que suenen a nudo/seguimiento/reunion/matriz ==")
for r in q("""select table_schema, table_name from information_schema.tables
              where table_name ~* '(nudo|seguimiento|reunion|matriz|intervencion|accion)'
              order by 1,2"""):
    print(" ", r[0], r[1])

print("\n== estados de hito en uso ==")
for r in q(
    """select estado_id, count(*) from core.hitos_compromiso group by estado_id order by 1"""
):
    print(" ", r)

conn.close()
