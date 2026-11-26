"""Reconstruye core.alertas_tempranas desde legacy.dim_alertas.

Uso:
    python scripts/matriz/cargar_alertas.py            # ensayo
    python scripts/matriz/cargar_alertas.py --apply
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

# La consola de Windows usa cp1252 y los datos traen emojis: sin esto, un error
# real queda oculto por un UnicodeEncodeError al imprimirlo.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")


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
        "select codigo_legado, id from core.casos where codigo_legado is not null"
    )
    caso_por_codigo = {c: i for c, i in cur.fetchall()}
    cur.execute("select codigo_legado, id from core.cat_niveles_alerta")
    nivel_por_codigo = {c: i for c, i in cur.fetchall() if c}
    cur.execute("select nombre, id from core.regiones")
    region_por_nombre = {norm(n): i for n, i in cur.fetchall()}
    region_por_nombre.setdefault("lima provincias", region_por_nombre.get("lima"))
    cur.execute("select c01, c02 from legacy.dim_departamentos")
    dep_a_nombre = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute("select codigo_alerta from core.alertas_tempranas")
    existentes = {r[0] for r in cur.fetchall()}

    cur.execute(
        """select c01, c02, c03, c04, c06, c10, c12, c13, c14, c17, c22, c27
             from legacy.dim_alertas order by c01"""
    )
    filas = cur.fetchall()
    print(f"alertas en el legado: {len(filas)}")

    plan = []
    sin_caso = sin_nivel = sin_region = repetidas = 0
    for c01, c02, c03, c04, c06, c10, c12, c13, c14, c17, c22, c27 in filas:
        if c01 in existentes:
            repetidas += 1
            continue
        caso_id = caso_por_codigo.get(c02) if c02 else None
        if c02 and not caso_id:
            sin_caso += 1
        nivel_id = nivel_por_codigo.get(c14)
        if not nivel_id:
            sin_nivel += 1
        region_id = region_por_nombre.get(norm(dep_a_nombre.get(c06)))
        if c06 and not region_id:
            sin_region += 1
        plan.append(
            {
                "codigo": c01,
                "caso_id": caso_id,
                "fecha": c04,
                "titulo": c10,
                "situacion": c12,
                "hechos": c13,
                "acciones": c17,
                "nivel": nivel_id,
                "region": region_id,
                "fuente_url": c22,
                "estado": c27,
            }
        )

    print(
        f"a insertar: {len(plan)} | ya existían: {repetidas} | caso no resuelto: {sin_caso}"
        f" | sin nivel: {sin_nivel} | sin región: {sin_region}"
    )
    if not args.apply:
        print("\nENSAYO: usa --apply para ejecutar.")
        return

    try:
        cur.execute("select set_config('app.rol_codigo','administrador',true)")
        cur.execute(
            "select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true)"
        )
        for a in plan:
            cur.execute(
                """insert into core.alertas_tempranas
                     (codigo_alerta, codigo_legado, caso_id, fecha_reporte, titulo,
                      situacion_actual, hechos_recientes, acciones_oaipcs,
                      nivel_alerta_id, region_id, fuente_url, estado_legado, origen_dato)
                   values (%s,%s,%s,coalesce(%s::timestamp::date, current_date),%s,
                           %s,%s,%s,%s,%s,%s,%s,'AVISA_HISTORICO')
                   on conflict (codigo_alerta) do nothing""",
                (
                    a["codigo"],
                    a["codigo"],
                    a["caso_id"],
                    a["fecha"],
                    (a["titulo"] or a["codigo"])[:255],
                    a["situacion"],
                    a["hechos"],
                    a["acciones"],
                    a["nivel"],
                    a["region"],
                    a["fuente_url"],
                    a["estado"],
                ),
            )
        conn.commit()
        print(f"COMMIT: {len(plan)} alertas insertadas.")
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        print("ROLLBACK:", error)
        raise SystemExit(1)

    cur.execute("select count(*) from core.alertas_tempranas")
    print("core.alertas_tempranas:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
