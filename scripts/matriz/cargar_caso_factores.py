"""Carga core.caso_factores desde fact_casos.c14 (RIE-xxx).

Uso: python scripts/matriz/cargar_caso_factores.py [--apply]
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
        "select column_name from information_schema.columns where table_schema='core' and table_name='cat_factores_contexto' order by ordinal_position"
    )
    print("cat_factores_contexto:", [r[0] for r in cur.fetchall()])
    cur.execute("select * from core.cat_factores_contexto order by 1")
    catalogo = cur.fetchall()
    print("filas del catálogo:", catalogo)

    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute("select c01, c06, c14 from legacy.fact_casos")
    filas = cur.fetchall()

    pares, sin_factor, sin_caso = [], 0, 0
    for codigo, fecha, rie in filas:
        caso_id = caso_por_codigo.get(codigo)
        if not caso_id:
            sin_caso += 1
            continue
        if not rie:
            sin_factor += 1
            continue
        pares.append((caso_id, rie, fecha))
    print(
        f"filas: {len(filas)} | con factor: {len(pares)} | sin factor: {sin_factor} | sin caso: {sin_caso}"
    )
    print("valores RIE:", sorted({p[1] for p in pares}))

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return
    print(
        "Carga no implementada aun: falta confirmar el mapeo RIE -> cat_factores_contexto."
    )


if __name__ == "__main__":
    main()
