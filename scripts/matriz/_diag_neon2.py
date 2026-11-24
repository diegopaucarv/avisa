#!/usr/bin/env python
"""Diagnóstico temporal 4: nombres completos, ubigeo, columnas y conteos."""

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


def cols(cur, tabla):
    return [
        r["column_name"]
        for r in q(
            cur,
            """select column_name from information_schema.columns
                where table_schema='core' and table_name=%s
                order by ordinal_position""",
            (tabla,),
        )
    ]


def main():
    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("== nombres completos de los casos de infraestructura/órganos/chimbote ==")
    for r in q(
        cur,
        """select codigo_caso, codigo_legado, nombre_caso, latitud, longitud,
                              region_principal_id, provincia_principal_id, distrito_principal_id,
                              tematica_id, nivel_conflicto_id, nivel_riesgo_id, prioridad_id,
                              estado_id, fecha_inicio, resumen_ejecutivo is not null as tiene_resumen
                       from core.casos
                       where nombre_caso ilike '%rgano%' or nombre_caso ilike '%Chimbote%'
                          or nombre_caso ilike '%Chorrillos%' or nombre_caso ilike '%Olaya%'
                          or nombre_caso ilike '%Marcona%'
                       order by codigo_caso""",
    ):
        d = dict(r)
        print(f"  {d['codigo_caso']} | legado={d['codigo_legado']}")
        print(f"    nombre={d['nombre_caso']}")
        print(
            f"    lat/long={d['latitud']}/{d['longitud']} reg={d['region_principal_id']} "
            f"prov={d['provincia_principal_id']} dist={d['distrito_principal_id']}"
        )
        print(
            f"    tema={d['tematica_id']} conflicto={d['nivel_conflicto_id']} riesgo={d['nivel_riesgo_id']} "
            f"prior={d['prioridad_id']} estado={d['estado_id']} fini={d['fecha_inicio']} resumen={d['tiene_resumen']}"
        )

    print("\n== casos con su región (join cat) ==")
    # descubrir tabla de regiones
    for r in q(
        cur,
        """select table_schema, table_name from information_schema.tables
                       where table_name ilike '%region%' or table_name ilike '%ubigeo%'
                       order by 1,2""",
    ):
        print("  ", r["table_schema"], r["table_name"])

    print("\n== conteos ==")
    for t in (
        "casos",
        "demandas",
        "compromisos",
        "hitos_compromiso",
        "reuniones_dialogo",
        "documentos",
        "alertas_tempranas",
        "actores",
        "casos_actores",
        "caso_cronologia",
        "plan_acciones",
    ):
        try:
            n = q(cur, f"select count(*) c from core.{t}")[0]["c"]
            print(f"  core.{t}: {n}")
        except Exception as e:
            print(f"  core.{t}: ERROR {e}")

    print("\n== columnas de tablas objetivo ==")
    for t in (
        "hitos_compromiso",
        "compromisos",
        "documentos",
        "alertas_tempranas",
        "usuarios",
        "reuniones_dialogo",
        "demandas",
        "cat_niveles_riesgo",
        "cat_estados_hito",
        "cat_tipos_documento",
    ):
        try:
            print(f"\n  -- core.{t}")
            print("   ", ", ".join(cols(cur, t)))
        except Exception as e:
            print(f"\n  -- core.{t}: ERROR {e}")

    print("\n== cat_tipos_documento filas ==")
    try:
        for r in q(cur, "select * from core.cat_tipos_documento order by id"):
            print("  ", dict(r))
    except Exception as e:
        print("  ERROR", e)

    print("\n== usuarios ==")
    for r in q(
        cur,
        """select id, nombres, apellidos, email, rol_id
                       from core.usuarios order by apellidos limit 30""",
    ):
        print("  ", dict(r))

    print("\n== cat_roles (o similar) ==")
    for r in q(
        cur,
        """select table_name from information_schema.tables
                       where table_schema='core' and table_name like 'cat_%'
                       order by 1""",
    ):
        print("  ", r["table_name"])

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
