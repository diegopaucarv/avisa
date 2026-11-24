#!/usr/bin/env python
"""Diagnóstico temporal 5: usuarios, roles y mapeo Excel -> base."""

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

    print("== core.usuarios ==")
    for r in q(cur, "select * from core.usuarios order by nombre limit 40"):
        d = dict(r)
        d.pop("clave_hash", None)
        print("  ", d)

    print("\n== tablas de rol / usuario_rol ==")
    for r in q(
        cur,
        """select table_schema, table_name from information_schema.tables
                       where table_name ilike '%rol%' or table_name ilike '%unidad%'
                       order by 1,2""",
    ):
        print("  ", r["table_schema"], r["table_name"])

    print("\n== core.regiones ==")
    for r in q(cur, "select * from core.regiones order by id limit 40"):
        print("  ", dict(r))

    print("\n== casos con codigo y nombre completo (para mapeo) ==")
    rows = q(
        cur,
        """select codigo_caso, codigo_legado, nombre_caso,
                            region_principal_id, distrito_principal_id
                     from core.casos where anulado_en is null order by codigo_caso""",
    )
    for r in rows:
        print(f"  {r['codigo_caso']}|{r['codigo_legado']}|{r['nombre_caso']}")
    print(f"\n  total casos: {len(rows)}")

    print("\n== demandas por caso (top) ==")
    for r in q(
        cur,
        """select c.codigo_caso, count(d.id) n
                       from core.casos c left join core.demandas d on d.caso_id=c.id
                       group by 1 order by 2 desc limit 12""",
    ):
        print("  ", dict(r))

    print("\n== documentos por tipo ==")
    for r in q(
        cur,
        """select t.codigo, count(*) n from core.documentos d
                       join core.cat_tipos_documento t on t.id=d.tipo_id
                       group by 1 order by 2 desc""",
    ):
        print("  ", dict(r))

    print("\n== documentos con responsable_usuario_id no nulo ==")
    print(
        "  ",
        dict(
            q(
                cur,
                """select count(*) total,
                                      count(responsable_usuario_id) con_resp
                               from core.documentos""",
            )[0]
        ),
    )

    print("\n== compromisos: caso y unidad ==")
    for r in q(
        cur,
        """select cc.codigo_compromiso, c.codigo_caso, u.codigo as unidad,
                              cc.accion_compromiso is not null as tiene_accion
                       from core.compromisos cc
                       join core.casos c on c.id=cc.caso_id
                       left join core.cat_unidades u on u.id=cc.unidad_responsable_id
                       order by 1""",
    ):
        print("  ", dict(r))

    print("\n== hitos: estado y fecha ==")
    for r in q(
        cur,
        """select h.codigo_hito, c.codigo_caso, h.estado_id,
                              h.fecha_vencimiento, h.fecha_real
                       from core.hitos_compromiso h
                       join core.compromisos cc on cc.id=h.compromiso_id
                       join core.casos c on c.id=cc.caso_id
                       order by 1 limit 20""",
    ):
        print("  ", dict(r))

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
