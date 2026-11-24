#!/usr/bin/env python
"""Diagnóstico temporal 8: cat_mapeo_estado_externo (patrón de conciliación)."""

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


def main():
    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("== columnas cat_mapeo_estado_externo ==")
    cur.execute("""select column_name, data_type, is_nullable, column_default
                   from information_schema.columns
                   where table_schema='core' and table_name='cat_mapeo_estado_externo'
                   order by ordinal_position""")
    for r in cur.fetchall():
        print("  ", dict(r))

    print("\n== filas ==")
    cur.execute("select * from core.cat_mapeo_estado_externo order by 1")
    for r in cur.fetchall():
        print("  ", dict(r))

    print("\n== indices / constraints ==")
    cur.execute("""select conname, pg_get_constraintdef(oid) def
                   from pg_constraint
                   where conrelid='core.cat_mapeo_estado_externo'::regclass""")
    for r in cur.fetchall():
        print("  ", dict(r))

    print("\n== comentario de tabla/columnas ==")
    cur.execute(
        """select obj_description('core.cat_mapeo_estado_externo'::regclass) c"""
    )
    print("  ", cur.fetchone())

    print("\n== ejemplo de uso: triggers o funciones que la usan ==")
    cur.execute("""select n.nspname, p.proname
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where pg_get_functiondef(p.oid) ilike '%cat_mapeo_estado_externo%'""")
    for r in cur.fetchall():
        print("  ", dict(r))

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
