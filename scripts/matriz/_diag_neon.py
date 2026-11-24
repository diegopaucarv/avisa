#!/usr/bin/env python
"""Diagnóstico temporal 3: estado real en Neon (SOLO LECTURA)."""

from __future__ import annotations

import os
import re
import sys

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

    print("== cat_niveles_riesgo ==")
    for r in q(cur, "select * from core.cat_niveles_riesgo order by id"):
        print("  ", dict(r))

    print("\n== cat_estados_hito ==")
    for r in q(cur, "select * from core.cat_estados_hito order by id"):
        print("  ", dict(r))

    print("\n== cat_tematicas ==")
    for r in q(cur, "select * from core.cat_tematicas order by id"):
        print("  ", dict(r))

    print("\n== casos por nivel_riesgo ==")
    for r in q(
        cur,
        """select c.nivel_riesgo_id, nr.codigo, count(*)
                       from core.casos c left join core.cat_niveles_riesgo nr
                         on nr.id = c.nivel_riesgo_id
                       group by 1,2 order by 3 desc""",
    ):
        print("  ", dict(r))

    print("\n== casos candidatos (codigo/legado/nombre) ==")
    for r in q(
        cur,
        """select id, codigo_caso, codigo_legado, nombre_caso,
                              region_principal_id, provincia_principal_id,
                              distrito_principal_id, nivel_riesgo_id,
                              fecha_ultima_actualizacion, link_reporte_pdf,
                              punto_focal_usuario_id
                       from core.casos
                       where codigo_caso in ('CS-PA-INF-2025-02','CS-PA-REG-2019-17',
                                             'CS-PA-INF-2025-05','CS-PA-REG-2024-01')
                          or codigo_legado in ('CS-PRODUCE-2026-013','CS-PRODUCE-2026-019')
                       order by codigo_caso""",
    ):
        print("  ", dict(r))

    print("\n== todos los casos: id, codigo, legado, nombre (35) ==")
    for r in q(
        cur,
        """select id, codigo_caso, codigo_legado, left(nombre_caso,70) as nombre
                       from core.casos order by id""",
    ):
        print("  ", dict(r))

    print("\n== columnas core.casos ==")
    for r in q(
        cur,
        """select column_name, data_type, is_nullable
                       from information_schema.columns
                       where table_schema='core' and table_name='casos'
                       order by ordinal_position""",
    ):
        print(f"   {r['column_name']}: {r['data_type']} {r['is_nullable']}")

    print("\n== tablas core.* ==")
    for r in q(
        cur,
        """select table_name from information_schema.tables
                       where table_schema='core' order by 1""",
    ):
        print("  ", r["table_name"])

    print("\n== tablas analytics.* ==")
    for r in q(
        cur,
        """select table_name from information_schema.tables
                       where table_schema='analytics' order by 1""",
    ):
        print("  ", r["table_name"])

    print("\n== usuarios (id, nombre, rol) ==")
    for r in q(
        cur,
        """select column_name from information_schema.columns
                       where table_schema='core' and table_name='usuarios'
                       order by ordinal_position""",
    ):
        print("  col:", r["column_name"])

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
