"""Reconstruye core.caso_distritos y core.caso_factores desde el legado.

Distritos: fact_casos.c09 (DIS-xxxx) -> dim_distritos.c02 (ubigeo) -> core.distritos.
Factores : fact_casos.c14 (RIE-xxx) -> catálogo de factores del caso.

Uso:
    python scripts/matriz/cargar_caso_geo_factores.py            # ensayo
    python scripts/matriz/cargar_caso_geo_factores.py --apply
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

    # ¿a qué catálogo apunta caso_factores.factor_id?
    cur.execute(
        """select ccu.table_schema, ccu.table_name
             from information_schema.table_constraints tc
             join information_schema.constraint_column_usage ccu
               on ccu.constraint_name = tc.constraint_name
            where tc.table_schema='core' and tc.table_name='caso_factores'
              and tc.constraint_type='FOREIGN KEY'"""
    )
    print("FK de caso_factores:", cur.fetchall())

    cur.execute(
        "select column_name from information_schema.columns where table_schema='core' and table_name='distritos' order by ordinal_position"
    )
    cols_distrito = [r[0] for r in cur.fetchall()]
    print("columnas core.distritos:", cols_distrito[:10])
    col_ubigeo = next(
        (c for c in cols_distrito if c in ("ubigeo", "codigo", "codigo_inei")), None
    )

    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}

    cur.execute("select c01, c02 from legacy.dim_distritos")
    # c01 = código DIS-xxxx, c02 = ubigeo (el legado perdió el cero inicial).
    ubigeo_por_codigo = {r[0]: str(r[1]).zfill(6) for r in cur.fetchall() if r[1]}

    cur.execute(f"select {col_ubigeo}::text, id from core.distritos")
    # El legado perdió el cero inicial (10101 vs 010101): se compara a 6 dígitos.
    distrito_core = {str(r[0]).zfill(6): r[1] for r in cur.fetchall()}

    cur.execute("select c01, c09, c14 from legacy.fact_casos")
    filas = cur.fetchall()

    distritos, factores, sin_d = [], [], 0
    for codigo, dis, rie in filas:
        caso_id = caso_por_codigo.get(codigo)
        if not caso_id:
            continue
        ubigeo = ubigeo_por_codigo.get(dis)
        distrito_id = distrito_core.get(ubigeo) if ubigeo else None
        if distrito_id:
            distritos.append((caso_id, distrito_id))
        elif dis:
            sin_d += 1

    distritos = sorted(set(distritos))
    print(f"distritos resolubles: {len(distritos)} | sin distrito en core: {sin_d}")
    print("factores (RIE) del origen: ver catálogo de caso_factores arriba")

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        insertados = 0
        for caso_id, distrito_id in distritos:
            cur.execute(
                """insert into core.caso_distritos (caso_id, distrito_id)
                   select %s::uuid, %s::integer
                    where not exists (select 1 from core.caso_distritos x
                                       where x.caso_id=%s::uuid and x.distrito_id=%s::integer)""",
                (caso_id, distrito_id, caso_id, distrito_id),
            )
            insertados += cur.rowcount
        conn.commit()
        print(f"COMMIT: {insertados} distritos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.caso_distritos")
    print("core.caso_distritos:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
