"""Exporta el catalogo territorial de la base local a CSV (solo lectura).

No escribe en la base: solo SELECT. Uso:
    python scripts/distritos_export_db.py
Salida: gis/derived/distritos_db.csv
"""

from __future__ import annotations

import csv
import os
import pathlib

import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "gis" / "derived" / "distritos_db.csv"


def database_url() -> str:
    """Lee DATABASE_URL de .env (base local) sin imprimir credenciales."""
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("falta DATABASE_URL en .env")


Q = """
SELECT d.id           AS distrito_id,
       d.ubigeo       AS ubigeo,
       d.nombre       AS distrito,
       p.id           AS provincia_id,
       p.nombre       AS provincia,
       r.id           AS region_id,
       r.nombre       AS region
  FROM core.distritos d
  JOIN core.provincias p ON p.id = d.provincia_id
  JOIN core.regiones   r ON r.id = p.region_id
 ORDER BY d.ubigeo
"""


def main() -> None:
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute(Q)
        rows = cur.fetchall()
        cols = [c.name for c in cur.description]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        w.writerows(rows)

    print(f"{len(rows)} filas -> {OUT.relative_to(ROOT)}")
    print("columnas:", ", ".join(cols))
    print(
        "regiones:",
        len({r[6] for r in rows}),
        "| provincias:",
        len({r[4] for r in rows}),
    )


if __name__ == "__main__":
    main()
