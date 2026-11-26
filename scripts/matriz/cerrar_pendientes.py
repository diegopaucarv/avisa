"""Cierra los pendientes del informe de duplicados.

(a) Deduplica por similitud >= 0.9 las demandas colgadas que no tenían gemela
    exacta (se anulan con motivo, reversible).
(b) Crea los 6 actores que el análisis marcó como «entidad distinta».

Uso: python scripts/matriz/cerrar_pendientes.py [--apply]
"""

from __future__ import annotations

import argparse
import os
import sys
import unicodedata
from difflib import SequenceMatcher
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
UMBRAL = 0.9

# Decisiones del informe de actores dudosos: (nombre, tipo_actor_id)
ACTORES = [
    ("OSPAS DE LOMAS", 1),
    ("Asociación de Buzos Artesanales Isla Blanca", 2),
    ("Procuraduría PRODUCE", 1),
    ("ADARPESCA", 2),
    ("OSPA Asociación de Bolichitos de Marcona", 2),
    ("Municipalidad de San José", 1),
]


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

    # ---------- (a) dedup difuso ----------
    anular, sin_par = [], 0
    for origen, destino in MAPEO.items():
        cur.execute(
            "select id::text from core.alertas_tempranas where codigo_legado=%s",
            (destino,),
        )
        fila = cur.fetchone()
        if not fila:
            continue
        alerta_id = fila[0]
        cur.execute(
            """select d.id::text, d.descripcion_demanda
                 from legacy.dim_demandas l join core.demandas d on d.codigo_legado=l.c01
                where l.c05=%s and d.anulado_en is null""",
            (origen,),
        )
        huerfanas = cur.fetchall()
        cur.execute(
            "select id::text, descripcion_demanda from core.demandas "
            "where alerta_id=%s::uuid and anulado_en is null",
            (alerta_id,),
        )
        vinculadas = cur.fetchall()
        for demanda_id, texto in huerfanas:
            mejor, ratio = None, 0.0
            for candidata, ctexto in vinculadas:
                if candidata == demanda_id:
                    continue
                r = SequenceMatcher(None, norm(texto), norm(ctexto)).ratio()
                if r > ratio:
                    mejor, ratio = candidata, r
            if mejor and ratio >= UMBRAL:
                anular.append(
                    (demanda_id, mejor, origen, round(ratio, 3), (texto or "")[:55])
                )
            else:
                sin_par += 1

    print(f"dedup >= {UMBRAL}: {len(anular)} | sin par suficiente: {sin_par}")
    for a in anular:
        print(f"  anular {a[0][:8]} ~ {a[1][:8]} ({a[2]}) r={a[3]} | {a[4]!r}")

    # ---------- (b) actores ----------
    cur.execute("select nombre_actual from core.actores")
    existentes = {norm(r[0]) for r in cur.fetchall()}
    crear = [(n, t) for n, t in ACTORES if norm(n) not in existentes]
    print(f"actores a crear: {len(crear)} de {len(ACTORES)}")

    if not args.apply:
        print("\nENSAYO: usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )

        n_anul = 0
        for demanda_id, gemela, origen, _r, _t in anular:
            cur.execute(
                """update core.demandas
                      set anulado_en = now(),
                          motivo_anulacion = %s
                    where id=%s::uuid and anulado_en is null""",
                (
                    f"Duplicado por similitud con la demanda {gemela[:8]} ({origen}).",
                    demanda_id,
                ),
            )
            n_anul += cur.rowcount

        n_act = 0
        for nombre, tipo in crear:
            cur.execute(
                """insert into core.actores
                     (nombre_actual, naturaleza, tipo_actor_id, rol_actor_id,
                      origen_dato, nivel_clasificacion, nivel_identificacion_id, es_validado_humano)
                   values (%s,'organizacion',%s,7,'AVISA_HISTORICO',2,3,false)""",
                (nombre, tipo),
            )
            n_act += cur.rowcount
        conn.commit()
        print(f"COMMIT: {n_anul} demandas anuladas y {n_act} actores creados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.demandas where anulado_en is null")
    print("demandas vigentes:", cur.fetchone()[0])
    cur.execute("select count(*) from core.actores")
    print("actores:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
