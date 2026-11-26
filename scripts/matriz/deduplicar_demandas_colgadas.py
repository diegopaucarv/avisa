"""Deduplica las demandas colgadas de alertas inexistentes.

Para los códigos que el análisis mandó «colgar de una alerta existente»
(AT-2026-19 -> 49, AT-2026-34 -> 18, AT-2026-39 -> 40), la demanda huérfana
tiene una gemela textual ya vinculada a la alerta destino. En vez de duplicar,
se anula la huérfana.

Uso: python scripts/matriz/deduplicar_demandas_colgadas.py [--apply]
"""

from __future__ import annotations

import argparse
import os
import sys
import unicodedata
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAPEO = {
    "AT-2026-19": "AT-2026-49",
    "AT-2026-34": "AT-2026-18",
    "AT-2026-39": "AT-2026-40",
}


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

    plan, sin_gemela = [], 0
    for origen, destino in MAPEO.items():
        cur.execute(
            "select codigo_legado, id::text from core.alertas_tempranas where codigo_legado = %s",
            (destino,),
        )
        fila = cur.fetchone()
        if not fila:
            print(f"  {origen}: alerta destino {destino} no existe")
            continue
        alerta_id = fila[1]

        cur.execute(
            """select d.id::text, d.descripcion_demanda
                 from legacy.dim_demandas l
                 join core.demandas d on d.codigo_legado = l.c01
                where l.c05 = %s and d.anulado_en is null""",
            (origen,),
        )
        huerfanas = cur.fetchall()
        for demanda_id, texto in huerfanas:
            cur.execute(
                """select id::text from core.demandas
                    where alerta_id = %s::uuid and anulado_en is null
                      and id <> %s::uuid""",
                (alerta_id, demanda_id),
            )
            candidatas = cur.fetchall()
            gemela = None
            for (candidata,) in candidatas:
                cur.execute(
                    "select descripcion_demanda from core.demandas where id = %s",
                    (candidata,),
                )
                if norm(cur.fetchone()[0]) == norm(texto):
                    gemela = candidata
                    break
            if gemela:
                plan.append((demanda_id, gemela, origen, destino, (texto or "")[:60]))
            else:
                sin_gemela += 1

    print(
        f"huérfanas con gemela en la alerta destino: {len(plan)} | sin gemela: {sin_gemela}"
    )
    for p in plan:
        print(f"  anular {p[0][:8]} (gemela {p[1][:8]}) {p[2]}->{p[3]} | {p[4]!r}")

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        n = 0
        for demanda_id, _gemela, origen, _destino, _t in plan:
            cur.execute(
                """update core.demandas
                      set anulado_en = now(),
                          motivo_anulacion = %s
                    where id = %s::uuid and anulado_en is null""",
                (
                    f"Duplicado textual de una demanda ya vinculada a la alerta destino ({origen}).",
                    demanda_id,
                ),
            )
            n += cur.rowcount
        conn.commit()
        print(f"COMMIT: {n} demandas anuladas por duplicidad.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.demandas where anulado_en is null")
    print("demandas vigentes:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
