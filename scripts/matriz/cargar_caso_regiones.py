"""Reconstruye core.caso_regiones desde legacy.bridge_caso_depto.

Uso:
    python scripts/matriz/cargar_caso_regiones.py            # ensayo
    python scripts/matriz/cargar_caso_regiones.py --apply
"""

from __future__ import annotations

import argparse
import os
import unicodedata
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]


def norm(texto: str | None) -> str:
    v = unicodedata.normalize("NFKD", texto or "")
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = "".join(c.lower() if c.isalnum() else " " for c in v)
    return " ".join(v.split())


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
        """select column_name, is_nullable from information_schema.columns
            where table_schema='core' and table_name='caso_regiones'
            order by ordinal_position"""
    )
    print("columnas core.caso_regiones:", cur.fetchall())

    cur.execute(
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute("select nombre, id from core.regiones")
    region_por_nombre = {norm(n): i for n, i in cur.fetchall()}
    # El legado separa «Lima Provincias» (DEP-16) de Lima Metropolitana; en
    # `core.regiones` ambos caen en Lima. Se documenta el alias.
    region_por_nombre.setdefault("lima provincias", region_por_nombre.get("lima"))

    cur.execute("select c01, c02, c03, c04, c05 from legacy.dim_departamentos")
    dep_a_nombre = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute("select c02, c04 from legacy.bridge_caso_depto")
    filas = cur.fetchall()
    print(f"filas del puente: {len(filas)}")

    pares = []
    sin_caso = sin_region = 0
    for codigo, dep in filas:
        caso_id = caso_por_codigo.get(codigo)
        nombre_dep = dep_a_nombre.get(dep)
        region_id = region_por_nombre.get(norm(nombre_dep))
        if not caso_id:
            sin_caso += 1
            continue
        if not region_id:
            sin_region += 1
            print("  sin región:", codigo, dep, nombre_dep)
            continue
        pares.append((caso_id, region_id))

    unicos = sorted(set(pares))
    print(
        f"pares únicos: {len(unicos)} | sin caso: {sin_caso} | sin región: {sin_region}"
    )

    if not args.apply:
        print("\nENSAYO: se insertarían", len(unicos), "vínculos. Usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        insertados = 0
        for caso_id, region_id in unicos:
            cur.execute(
                """insert into core.caso_regiones (caso_id, region_id, es_principal)
                   select %s::uuid, %s::integer, false
                    where not exists (
                      select 1 from core.caso_regiones r
                       where r.caso_id = %s::uuid and r.region_id = %s::integer)""",
                (caso_id, region_id, caso_id, region_id),
            )
            insertados += cur.rowcount
        # Región principal: la primera del puente, si el caso no tiene una.
        cur.execute(
            """update core.casos c set region_principal_id = (
                   select min(r.region_id) from core.caso_regiones r where r.caso_id = c.id
               )
                 where c.region_principal_id is null
                   and exists (select 1 from core.caso_regiones r where r.caso_id = c.id)"""
        )
        principal = cur.rowcount
        # Marca la fila principal para quien la consulte por `es_principal`.
        cur.execute(
            """update core.caso_regiones r set es_principal = true
                 from core.casos c
                where c.id = r.caso_id and r.region_id = c.region_principal_id
                  and not r.es_principal
                  and not exists (
                        select 1 from core.caso_regiones x
                         where x.caso_id = c.id and x.es_principal)"""
        )
        conn.commit()
        print(
            f"COMMIT: {insertados} vínculos insertados; región principal en {principal} casos."
        )
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.caso_regiones")
    print("core.caso_regiones:", cur.fetchone()[0])
    cur.execute(
        "select count(*) from core.casos c where not exists "
        "(select 1 from core.caso_regiones r where r.caso_id=c.id)"
    )
    print("casos sin región:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
