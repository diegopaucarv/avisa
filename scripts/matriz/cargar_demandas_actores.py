"""Carga core.demandas_actores por vía transitiva: demanda <- alerta -> actor.

`dim_demandas` no guarda el actor (c08/c09 son etiqueta y código de hecho).
El vínculo se deriva de `bridge_alerta_demandas` x `bridge_alerta_actor`.

Uso:
    python scripts/matriz/cargar_demandas_actores.py            # ensayo
    python scripts/matriz/cargar_demandas_actores.py --apply
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
ROL = "Afectado"  # el legado no declara rol; valor permitido por el CHECK


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
        "select codigo_legado, id::text from core.demandas where codigo_legado is not null"
    )
    demanda_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute(
        "select codigo_legado, actor_uid::text from core.actores where codigo_legado is not null"
    )
    actor_por_codigo = {c: i for c, i in cur.fetchall()}

    cur.execute(
        """select b.c05 as demanda, a.c03 as actor
             from legacy.bridge_alerta_demandas b
             join legacy.bridge_alerta_actor a on a.c02 = b.c03"""
    )
    filas = cur.fetchall()

    pares, sin_demanda, sin_actor = [], 0, 0
    for demanda, actor in filas:
        did = demanda_por_codigo.get(demanda)
        uid = actor_por_codigo.get(actor)
        if not did:
            sin_demanda += 1
            continue
        if not uid:
            sin_actor += 1
            continue
        pares.append((did, uid))
    unicos = sorted(set(pares))
    print(
        f"pares transitivos: {len(filas)} | únicos resolubles: {len(unicos)}"
        f" | sin demanda: {sin_demanda} | sin actor: {sin_actor}"
    )
    print(
        f"demandas distintas: {len({p[0] for p in unicos})} | actores distintos: {len({p[1] for p in unicos})}"
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
        for demanda_id, actor_id in unicos:
            cur.execute(
                """insert into core.demandas_actores (demanda_id, actor_id, rol_en_demanda)
                   select %s::uuid, %s::uuid, %s
                    where not exists (select 1 from core.demandas_actores x
                                       where x.demanda_id=%s::uuid and x.actor_id=%s::uuid)""",
                (demanda_id, actor_id, ROL, demanda_id, actor_id),
            )
            insertados += cur.rowcount
        conn.commit()
        print(f"COMMIT: {insertados} vínculos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.demandas_actores")
    print("core.demandas_actores:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
