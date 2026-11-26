"""Aplica los mapeos seguros que dejó el análisis de llaves.

1) alertas_actores: normaliza el código de alerta a (año, entero), que resuelve
   81/83 — el fallo era de ancho dentro del propio legado (AT-2026-001 vs
   AT-2026-26), no entre legado y base.
2) casos_actores: resuelve las 18 filas restantes por relleno de ceros
   (CS-PRODUCE-2026-07 -> CS-PRODUCE-2026-007) donde el destino es inequívoco.

Uso:
    python scripts/matriz/aplicar_mapeos_llaves.py            # ensayo
    python scripts/matriz/aplicar_mapeos_llaves.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PATRON = re.compile(r"^(?P<pref>[A-Z]+)-(?P<anio>\d{4})-(?P<num>\d+)$")


def clave(codigo: str | None):
    """(prefijo, año, entero) — ignora el relleno de ceros."""
    m = PATRON.match((codigo or "").strip().upper())
    if not m:
        return None
    return (m.group("pref"), int(m.group("anio")), int(m.group("num")))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    # --- alertas por (año, entero) ---
    cur.execute(
        "select codigo_legado, id::text from core.alertas_tempranas where codigo_legado is not null"
    )
    alerta_por_clave = {}
    for codigo, aid in cur.fetchall():
        k = clave(codigo)
        if k:
            alerta_por_clave.setdefault(k, aid)

    cur.execute(
        "select codigo_legado, actor_uid::text from core.actores where codigo_legado is not null"
    )
    actor_por_codigo = {c: i for c, i in cur.fetchall()}

    cur.execute("select c02, c03 from legacy.bridge_alerta_actor")
    pares_alerta = set()
    for alerta, actor in cur.fetchall():
        aid = alerta_por_clave.get(clave(alerta))
        uid = actor_por_codigo.get(actor)
        if not aid and actor:
            aid = alerta_por_clave.get(clave(actor))  # 3 filas traen c02/c03 invertidas
            uid = actor_por_codigo.get(alerta) or uid
        if aid and uid:
            pares_alerta.add((aid, uid))
    print(f"alerta-actor resolubles por (año, entero): {len(pares_alerta)}")

    # --- caso-actor por relleno de ceros ---
    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_clave = {}
    for codigo, cid in cur.fetchall():
        k = clave(codigo)
        if k:
            caso_por_clave.setdefault(k, cid)

    cur.execute("select c02, c03 from legacy.bridge_caso_actor")
    pares_caso, ambiguos = set(), set()
    for actor, caso in cur.fetchall():
        uid = actor_por_codigo.get(actor)
        k = clave(caso)
        if not uid or not k:
            continue
        cid = caso_por_clave.get(k)
        if not cid:
            continue
        pares_caso.add((cid, uid))
        if sum(1 for kk in caso_por_clave if kk == k) > 1:
            ambiguos.add(k)
    print(
        f"caso-actor resolubles por relleno: {len(pares_caso)} | claves ambiguas: {len(ambiguos)}"
    )

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )

        n1 = 0
        for aid, uid in sorted(pares_alerta):
            cur.execute(
                """insert into core.alertas_actores (alerta_id, actor_id)
                   select %s::uuid, %s::uuid
                    where not exists (select 1 from core.alertas_actores x
                                       where x.alerta_id=%s::uuid and x.actor_id=%s::uuid)""",
                (aid, uid, aid, uid),
            )
            n1 += cur.rowcount

        n2 = 0
        for cid, uid in sorted(pares_caso):
            cur.execute(
                """insert into core.casos_actores
                     (caso_id, actor_id, nivel_influencia, posicion, vigente_desde)
                   select %s::uuid, %s::uuid, 50, 'Neutral', current_date
                    where not exists (select 1 from core.casos_actores x
                                       where x.caso_id=%s::uuid and x.actor_id=%s::uuid)""",
                (cid, uid, cid, uid),
            )
            n2 += cur.rowcount
        conn.commit()
        print(f"COMMIT: {n1} alerta-actor y {n2} caso-actor nuevos.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    for tabla in ("alertas_actores", "casos_actores"):
        cur.execute(f"select count(*) from core.{tabla}")
        print(f"core.{tabla}:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
