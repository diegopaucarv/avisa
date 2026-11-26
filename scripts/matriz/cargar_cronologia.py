"""Reconstruye core.caso_cronologia desde legacy.fact_hechos_casos.

80 hechos, 100 % resolubles por `core.casos.codigo_legado`.

Uso:
    python scripts/matriz/cargar_cronologia.py            # ensayo
    python scripts/matriz/cargar_cronologia.py --apply
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
        "select codigo_legado, id::text from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute(
        "select codigo_legado from core.caso_cronologia where codigo_legado is not null"
    )
    existentes = {r[0] for r in cur.fetchall()}

    cur.execute(
        "select c01, c02, c03, c04, c05, c06, c10 from legacy.fact_hechos_casos order by c01"
    )
    filas = cur.fetchall()

    plan, sin_caso, repetidos, sin_fecha = [], 0, 0, 0
    for codigo, caso, fecha, tipo, critico, descripcion, link in filas:
        if codigo in existentes:
            repetidos += 1
            continue
        caso_id = caso_por_codigo.get(caso)
        if not caso_id:
            sin_caso += 1
            continue
        if not fecha:
            sin_fecha += 1
            continue
        plan.append(
            {
                "codigo": codigo,
                "caso_id": caso_id,
                "fecha": fecha,
                "tipo": tipo,
                "critico": (critico or "").strip().lower() in ("si", "sí", "true", "1"),
                "descripcion": (descripcion or "").strip(),
                "link": link,
            }
        )

    con_desc = sum(1 for p in plan if p["descripcion"])
    print(
        f"hechos origen: {len(filas)} | a insertar: {len(plan)} | ya existían: {repetidos}"
        f" | sin caso: {sin_caso} | sin fecha: {sin_fecha} | con descripción: {con_desc}"
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
        for p in plan:
            cur.execute(
                """insert into core.caso_cronologia
                     (caso_id, fecha_evento, descripcion_hecho, es_hecho_critico,
                      link_evidencia, tipo_evidencia_legado, codigo_legado, origen_dato)
                   values (%s::uuid, %s::date, %s, %s, %s, %s, %s, 'AVISA_HISTORICO')
                   on conflict do nothing""",
                (
                    p["caso_id"],
                    p["fecha"],
                    p["descripcion"] or "(sin descripción en el origen)",
                    p["critico"],
                    p["link"],
                    p["tipo"],
                    p["codigo"],
                ),
            )
            insertados += cur.rowcount
        conn.commit()
        print(f"COMMIT: {insertados} hechos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.caso_cronologia")
    print("core.caso_cronologia:", cur.fetchone()[0])
    cur.execute("select count(distinct caso_id) from core.caso_cronologia")
    print("casos con cronología:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
