#!/usr/bin/env python
"""Diagnóstico temporal 9: bloques del Excel (E) vs casos base, lado a lado."""

from __future__ import annotations

import os
import unicodedata

import psycopg2
import psycopg2.extras
from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO, "docs", "01_requisitos", "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx"
)


def url():
    for line in open(os.path.join(REPO, ".env"), encoding="utf-8"):
        if line.startswith("NEON_OWNER_URL"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")


def main():
    wb = load_workbook(XLSX, data_only=True)
    ws = wb["CASOS OAIPCS - OPERATIVO"]
    print("== BLOQUES DEL EXCEL (col E) ==")
    bloques = []
    for r in range(3, ws.max_row + 1):
        e = ws.cell(r, 5).value
        if e and str(e).strip():
            a = ws.cell(r, 1).value
            bloques.append(
                {
                    "fila": r,
                    "n": a,
                    "depto": ws.cell(r, 2).value,
                    "sectorista": ws.cell(r, 3).value,
                    "prioridad": ws.cell(r, 4).value,
                    "nombre": str(e).strip(),
                }
            )
    for b in bloques:
        print(f"  [{b['n']}] r{b['fila']} {b['depto']} · {b['sectorista']}")
        print(f"        {b['nombre'][:150]}")
    print(f"\n  TOTAL bloques: {len(bloques)}")

    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""select codigo_caso, codigo_legado, nombre_caso, region_principal_id
                   from core.casos where anulado_en is null order by codigo_caso""")
    base = [dict(r) for r in cur.fetchall()]
    cur.execute("select id, nombre from core.regiones order by id")
    reg = {r["id"]: r["nombre"] for r in cur.fetchall()}
    cur.close()
    conn.close()

    print("\n== CASOS EN BASE ==")
    for b in base:
        print(
            f"  {b['codigo_caso']:22s} [{reg.get(b['region_principal_id'], '?'):18s}] {b['nombre_caso'][:110]}"
        )
    print(f"\n  TOTAL base: {len(base)}")


if __name__ == "__main__":
    main()
