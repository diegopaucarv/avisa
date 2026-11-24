#!/usr/bin/env python
"""Diagnóstico temporal 7: normalizar_ref, tablas de alias, unidades."""

from __future__ import annotations

import os

import psycopg2
import psycopg2.extras


def url():
    p = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    for line in open(p, encoding="utf-8"):
        if line.startswith("NEON_OWNER_URL"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("sin NEON_OWNER_URL")


def q(cur, sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall()


def main():
    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("== funciones *normaliz* ==")
    for r in q(
        cur,
        """select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where p.proname ilike '%normaliz%' order by 1,2""",
    ):
        print("  ", dict(r))

    print("\n== DDL de core.normalizar_ref si existe ==")
    for r in q(
        cur,
        """select pg_get_functiondef(p.oid) ddl
                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='core' and p.proname='normalizar_ref'""",
    ):
        print(r["ddl"])

    print("\n== tablas con alias/equivalencia ==")
    for r in q(
        cur,
        """select table_schema, table_name from information_schema.tables
                       where table_name ilike '%alias%' or table_name ilike '%equival%'
                          or table_name ilike '%sinonimo%' or table_name ilike '%mapeo%'
                       order by 1,2""",
    ):
        print("  ", dict(r))

    print("\n== core.cat_unidades_organicas ==")
    for r in q(cur, "select * from core.cat_unidades_organicas order by id"):
        print("  ", dict(r))

    print("\n== core.roles ==")
    for r in q(cur, "select * from core.roles order by id"):
        print("  ", dict(r))

    print("\n== core.cat_tipos_documento (ya visto) - columnas extra ==")
    for r in q(
        cur,
        """select column_name from information_schema.columns
                       where table_schema='core' and table_name='documentos'
                       order by ordinal_position""",
    ):
        pass

    print("\n== casos: distrito faltante ==")
    for r in q(
        cur,
        """select codigo_caso, nombre_caso from core.casos
                       where anulado_en is null and distrito_principal_id is null""",
    ):
        print("  ", dict(r))

    print("\n== core.caso_regiones muestra ==")
    for r in q(cur, "select * from core.caso_regiones limit 10"):
        print("  ", dict(r))

    print("\n== ultima migracion aplicada? tablas con 'migracion' o similar ==")
    for r in q(
        cur,
        """select table_schema, table_name from information_schema.tables
                       where table_name ilike '%migrac%' order by 1,2""",
    ):
        print("  ", dict(r))

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
