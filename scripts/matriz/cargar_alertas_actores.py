"""Completa core.alertas_actores desde legacy.bridge_alerta_actor.

Uso:
    python scripts/matriz/cargar_alertas_actores.py            # ensayo
    python scripts/matriz/cargar_alertas_actores.py --apply
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
        """select column_name, is_nullable, column_default
             from information_schema.columns
            where table_schema='core' and table_name='alertas_actores'
            order by ordinal_position"""
    )
    print("core.alertas_actores:", cur.fetchall())

    cur.execute(
        "select codigo_legado, id::text from core.alertas_tempranas where codigo_legado is not null"
    )
    alerta_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute(
        "select codigo_legado, actor_uid::text from core.actores where codigo_legado is not null"
    )
    actor_por_codigo = {c: i for c, i in cur.fetchall()}
    print(
        f"alertas con código: {len(alerta_por_codigo)} | actores con código: {len(actor_por_codigo)}"
    )

    cur.execute("select c02, c03 from legacy.bridge_alerta_actor")
    filas = cur.fetchall()
    pares, sin_alerta, sin_actor = [], 0, 0
    for alerta, actor in filas:
        aid = alerta_por_codigo.get(alerta)
        uid = actor_por_codigo.get(actor)
        if not aid:
            sin_alerta += 1
            continue
        if not uid:
            sin_actor += 1
            continue
        pares.append((aid, uid))
    unicos = sorted(set(pares))
    print(
        f"origen: {len(filas)} | resolubles: {len(unicos)} | sin alerta: {sin_alerta}"
        f" | sin actor: {sin_actor}"
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
        for alerta_id, actor_uid in unicos:
            cur.execute(
                """insert into core.alertas_actores (alerta_id, actor_id)
                   select %s::uuid, %s::uuid
                    where not exists (select 1 from core.alertas_actores x
                                       where x.alerta_id=%s::uuid and x.actor_id=%s::uuid)""",
                (alerta_id, actor_uid, alerta_id, actor_uid),
            )
            insertados += cur.rowcount
        conn.commit()
        print(f"COMMIT: {insertados} vínculos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.alertas_actores")
    print("core.alertas_actores:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
