"""Segunda pasada de solo lectura sobre Neon: polígonos, población, naturalezas."""

import psycopg2

ENV = ".env"


def neon_url():
    for line in open(ENV, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("NEON_OWNER_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("sin NEON_OWNER_URL")


conn = psycopg2.connect(neon_url(), connect_timeout=25)
conn.set_session(readonly=True, autocommit=False)
cur = conn.cursor()


def q(sql, args=None):
    if args is None:
        cur.execute(sql)
    else:
        cur.execute(sql, args)
    return cur.fetchall()


print("== Esquemas ==")
print(
    [
        r[0]
        for r in q(
            "select nspname from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' order by 1"
        )
    ]
)

print("\n== Geometrias en TODOS los esquemas ==")
rows = q(
    "select f_table_schema, f_table_name, f_geometry_column, type, srid from geometry_columns order by 1,2"
)
print(rows if rows else "  NINGUNA")

print("\n== Objetos con 'distrito' o 'ubigeo' en el nombre ==")
print(
    q("""select n.nspname, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where c.relname ~* 'distrito|ubigeo' order by 1,2""")
)

print("\n== Columnas candidatas a poblacion ==")
print(
    q("""select table_schema, table_name, column_name, data_type from information_schema.columns
           where column_name ~* 'pobl|habitante|censo|censad|omitid|total_' order by 1,2""")
)

print("\n== territorio.lugares ==")
print("filas:", q("select count(*) from territorio.lugares")[0][0])
print(q("select * from territorio.lugares limit 5"))

print("\n== cat_naturalezas_caso ==")
print(q("select * from core.cat_naturalezas_caso order by 1"))

print("\n== distribucion de naturaleza_id en casos ==")
print(q("select naturaleza_id, count(*) from core.casos group by 1 order by 1"))

print("\n== vistas gis ==")
for v in ("gis.v_infraestructuras_por_distrito", "gis.v_desembarcaderos"):
    print(v, "->", q(f"select count(*) from {v}")[0][0])

print("\n== tablas territorio.* con filas ==")
for (t,) in q(
    "select table_name from information_schema.tables where table_schema='territorio' and table_type='BASE TABLE' order by 1"
):
    try:
        print(f"   {t}: {q('select count(*) from territorio.' + t)[0][0]}")
    except Exception:
        conn.rollback()
        print(f"   {t}: error")

print("\n== columnas de core.casos (para nivel/estado/naturaleza) ==")
print(
    q("""select column_name, data_type from information_schema.columns
           where table_schema='core' and table_name='casos' order by ordinal_position""")
)

conn.rollback()
cur.close()
conn.close()
