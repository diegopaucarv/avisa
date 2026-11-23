"""Inspección de solo lectura de Neon: estado GIS, X3 y población (item 131).

No imprime la cadena de conexión. Fuerza sesión de solo lectura.
"""

import sys

import psycopg2

ENV = ".env"


def neon_url():
    for line in open(ENV, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("NEON_OWNER_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("NEON_OWNER_URL no encontrada")


def q(cur, sql, args=None):
    cur.execute(sql, args or ())
    return cur.fetchall()


def main():
    conn = psycopg2.connect(neon_url(), connect_timeout=25)
    conn.set_session(readonly=True, autocommit=False)
    cur = conn.cursor()
    db, ver = q(cur, "select current_database(), version()")[0]
    print("BD:", db, "|", ver.split(",")[0])

    print("\n== 1 · ¿Qué hay en el esquema gis ==")
    for r in q(
        cur,
        """
        select table_schema, table_name, table_type
        from information_schema.tables
        where table_schema in ('gis','territorio')
        order by 1,2""",
    ):
        print("  ", r)

    print("\n== 2 · Columnas con geometría (PostGIS) ==")
    for r in q(
        cur,
        """
        select f_table_schema, f_table_name, f_geometry_column, type, srid
        from geometry_columns where f_table_schema in ('gis','territorio','core')
        order by 1,2""",
    ):
        print("  ", r)

    print("\n== 3 · Conteos clave ==")
    checks = [
        (
            "gis.infraestructuras_puntos",
            "select count(*) from gis.infraestructuras_puntos",
        ),
        (
            "infra con distrito_id",
            "select count(*) from gis.infraestructuras_puntos where distrito_id is not null",
        ),
        ("core.distritos", "select count(*) from core.distritos"),
        ("core.provincias", "select count(*) from core.provincias"),
        ("core.regiones", "select count(*) from core.regiones"),
        ("core.casos", "select count(*) from core.casos"),
        (
            "casos con distrito_principal_id",
            "select count(*) from core.casos where distrito_principal_id is not null",
        ),
        ("alertas", "select count(*) from core.alertas_tempranas"),
        (
            "alertas con distrito_id",
            "select count(*) from core.alertas_tempranas where distrito_id is not null",
        ),
    ]
    for label, sql in checks:
        try:
            print(f"   {label}: {q(cur, sql)[0][0]}")
        except Exception as e:
            conn.rollback()
            print(
                f"   {label}: ERROR {type(e).__name__} {str(e).splitlines()[0][:120]}"
            )

    print("\n== 4 · Columnas de distritos (centroide, área, población) ==")
    for r in q(
        cur,
        """
        select column_name, data_type
        from information_schema.columns
        where table_schema='core' and table_name='distritos'
        order by ordinal_position""",
    ):
        print("  ", r[0], "|", r[1])

    print("\n== 5 · Tablas/vistas con población ==")
    for r in q(
        cur,
        """
        select table_schema, table_name, column_name, data_type
        from information_schema.columns
        where column_name ~* 'pobla'
        order by 1,2""",
    ):
        print("  ", r)

    print("\n== 6 · Rastros de latente / manifiesto / naturaleza ==")
    for r in q(
        cur,
        """
        select table_schema, table_name, column_name, data_type
        from information_schema.columns
        where column_name ~* 'latent|manifiest|naturaleza'
        order by 1,2""",
    ):
        print("  ", r)
    for r in q(
        cur,
        """
        select n.nspname, c.relname, c.relkind
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relname ~* 'latent|manifiest|naturaleza'
        order by 1,2""",
    ):
        print("   objeto:", r)

    print("\n== 7 · Vistas de analytics que mencionan latente/manifiesto ==")
    for r in q(
        cur,
        """
        select schemaname, viewname
        from pg_views
        where definition ~* 'latent|manifiest'
        order by 1,2""",
    ):
        print("  ", r)

    print("\n== 8 · cat_estados_caso ==")
    try:
        for r in q(cur, "select * from core.cat_estados_caso order by 1"):
            print("  ", r)
    except Exception as e:
        conn.rollback()
        print("   ERROR", e)

    print("\n== 9 · Migraciones recientes ==")
    for sql in [
        "select to_regclass('core.distritos_backup_20261123')",
        "select to_regclass('core.provincias_backup_20261123')",
        "select to_regclass('territorio.lugares')",
    ]:
        try:
            print("  ", sql, "->", q(cur, sql)[0][0])
        except Exception as e:
            conn.rollback()
            print("  ", sql, "ERROR")

    conn.rollback()
    cur.close()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
