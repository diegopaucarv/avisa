"""Compromiso faltante de la DPA de Huacho + sus 4 hitos.

El caso (N° 21 de la matriz) tenía cuatro hitos sin compromiso: la celda del
compromiso estaba vacía. Se crea el compromiso con el título de la obra y se le
cuelgan los hitos 1-4.

Uso:
    python scripts/matriz/compromiso_dpa_huacho.py            # ensayo
    python scripts/matriz/compromiso_dpa_huacho.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
MATRIZ = RAIZ / "scripts/matriz/salida/matriz_2026.json"
TITULO = "Construcción de la DPA de Huacho"
ESTADOS_HITO = {
    "cumplido": 4,
    "no cumplido": 6,
    "desestimado": 5,
    "en ejecución": 2,
    "paralizado": 3,
    "registrado": 1,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(RAIZ / ".env", override=False)
    conn = psycopg2.connect(
        os.environ.get("NEON_OWNER_URL") or os.environ["DATABASE_URL"]
    )
    cur = conn.cursor()

    datos = json.loads(MATRIZ.read_text(encoding="utf-8"))
    caso = next(
        c for c in datos["casos"] if c["filas"][0] == 74 and not c["duplicado_de"]
    )
    hitos = [h for h in caso["hitos"] if not h["compromiso"]]
    print(f"caso N° {caso['n']}: {caso['nombre'][:60]}")
    print(f"hitos huérfanos: {len(hitos)}")

    cur.execute(
        "select id::text, codigo_caso from core.casos where nombre_caso like 'DPA Huacho%'"
    )
    fila = cur.fetchone()
    if not fila:
        raise SystemExit("No se encontró el caso en la base.")
    caso_id, codigo_caso = fila
    print(f"caso en base: {codigo_caso}")

    cur.execute(
        "select codigo_compromiso from core.compromisos where caso_id=%s order by 1",
        (caso_id,),
    )
    existentes = [r[0] for r in cur.fetchall()]
    print(f"compromisos actuales: {existentes}")

    if not args.apply:
        print("\nENSAYO: se crearía 1 compromiso y", len(hitos), "hitos. Usa --apply.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )

        cur.execute(
            """insert into core.compromisos
                 (codigo_compromiso, caso_id, unidad_responsable_id, fecha_inicio,
                  accion_compromiso, tipo_compromiso, origen_dato)
               values (%s,%s,1,current_date,%s,'Actividad','MANUAL') returning id""",
            (f"{codigo_caso}_COMP002", caso_id, TITULO),
        )
        compromiso_id = cur.fetchone()[0]

        for i, h in enumerate(hitos, 1):
            cur.execute(
                """insert into core.hitos_compromiso
                     (compromiso_id, codigo_hito, descripcion_hito, estado_id,
                      fecha_vencimiento, fecha_real, origen_dato)
                   values (%s,%s,%s,%s,%s,%s,'MANUAL')""",
                (
                    compromiso_id,
                    f"{codigo_caso}_C002_H{i:03d}",
                    (h["descripcion"] or h["etiqueta"] or "Hito")[:20000],
                    ESTADOS_HITO.get((h["estado"] or "").lower(), 1),
                    h["fecha_planificada"],
                    h["fecha_real"],
                ),
            )
        conn.commit()
        print("COMMIT: compromiso y", len(hitos), "hitos insertados.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.hitos_compromiso")
    print("hitos en base:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
