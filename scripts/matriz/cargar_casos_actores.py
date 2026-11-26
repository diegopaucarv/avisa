"""Carga core.casos_actores desde legacy.bridge_caso_actor.

El puente declara (id_relacion, id_actor, id_caso): el caso está en c03, no en c01.
Dos formatos de c03: código CS-... o el número de fila de fact_casos.

Uso:
    python scripts/matriz/cargar_casos_actores.py            # ensayo
    python scripts/matriz/cargar_casos_actores.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    cur.execute(
        """select a.attname from pg_attribute a
            where a.attrelid='core.casos_actores'::regclass and a.attnum>0 and not a.attisdropped
            order by a.attnum"""
    )
    print("columnas core.casos_actores:", [r[0] for r in cur.fetchall()])
    cur.execute(
        "select pg_get_constraintdef(oid) from pg_constraint "
        "where conrelid='core.casos_actores'::regclass and contype='c'"
    )
    print("checks:", [r[0] for r in cur.fetchall()])

    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute(
        "select codigo_legado, actor_uid::text from core.actores where codigo_legado is not null"
    )
    actor_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute("select fila_n::text, c01 from legacy.fact_casos")
    codigo_por_fila = {f: c for f, c in cur.fetchall()}

    cur.execute("select c02, c03 from legacy.bridge_caso_actor")
    pares, sin_caso, sin_actor = [], 0, 0
    for actor, caso in cur.fetchall():
        codigo = caso if (caso or "").startswith("CS-") else codigo_por_fila.get(caso)
        caso_id = caso_por_codigo.get(codigo)
        actor_id = actor_por_codigo.get(actor)
        if not caso_id:
            sin_caso += 1
            continue
        if not actor_id:
            sin_actor += 1
            continue
        pares.append((caso_id, actor_id))
    unicos = sorted(set(pares))
    print(
        f"filas: 80 | resolubles: {len(unicos)} | sin caso: {sin_caso} | sin actor: {sin_actor}"
    )

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        insertados = 0
        for caso_id, actor_id in unicos:
            cur.execute(
                """insert into core.casos_actores
                     (caso_id, actor_id, nivel_influencia, posicion, vigente_desde)
                   select %s::uuid, %s::uuid, 50, 'Neutral', current_date
                    where not exists (select 1 from core.casos_actores x
                                       where x.caso_id=%s::uuid and x.actor_id=%s::uuid)""",
                (caso_id, actor_id, caso_id, actor_id),
            )
            insertados += cur.rowcount
        conn.commit()
        print(f"COMMIT: {insertados} vínculos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.casos_actores")
    print("core.casos_actores:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
