"""Corrige tipo_actor_id de los actores creados desde la matriz.

Los 115 actores nuevos se insertaron con tipo_actor_id=2 (Actor social). Los que
vienen de la columna «Actores del Estado» deben ser 1 (Actor público).

Uso: python scripts/matriz/fix_tipo_actor_nuevos.py [--apply]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def norm(t: str | None) -> str:
    v = unicodedata.normalize("NFKD", t or "")
    v = "".join(c for c in v if not unicodedata.combining(c))
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in v).split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    datos = json.loads(
        (RAIZ / "scripts/matriz/salida/matriz_2026.json").read_text(encoding="utf-8")
    )
    origen_por_nombre: dict[str, str] = {}
    for caso in datos["casos"]:
        for actor in caso["actores"]:
            nombre = (actor.get("nombre") or "").strip()
            if nombre:
                origen_por_nombre.setdefault(norm(nombre), actor.get("origen") or "")

    cur.execute(
        "select actor_uid::text, nombre_actual from core.actores where codigo_legado is null"
    )
    candidatos = cur.fetchall()
    print(f"actores sin codigo_legado: {len(candidatos)}")

    a_publico, a_social, sin_origen = [], [], 0
    for uid, nombre in candidatos:
        origen = origen_por_nombre.get(norm(nombre))
        if origen == "Estado":
            a_publico.append(uid)
        elif origen == "Sociedad civil":
            a_social.append(uid)
        else:
            sin_origen += 1
    print(
        f"a Actor público (estado): {len(a_publico)} | siguen sociales: {len(a_social)} | sin origen: {sin_origen}"
    )

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        cur.execute(
            "update core.actores set tipo_actor_id = 1 "
            "where actor_uid = any(%s::uuid[]) and tipo_actor_id <> 1",
            (a_publico,),
        )
        n = cur.rowcount
        conn.commit()
        print(f"COMMIT: {n} actores pasaron a Actor público.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute(
        "select tipo_actor_id, count(*) from core.actores where codigo_legado is null group by 1 order by 1"
    )
    print("reparto de los nuevos por tipo:", cur.fetchall())


if __name__ == "__main__":
    main()
