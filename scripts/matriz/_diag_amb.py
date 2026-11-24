#!/usr/bin/env python
"""Diagnóstico temporal 10: METADATOS en orden + caso anulado + ambigüedades."""

from __future__ import annotations

import os

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
    wm = wb["METADATOS CASOS"]
    print("== METADATOS CASOS en orden ==")
    for r in range(2, wm.max_row + 1):
        cod = wm.cell(r, 1).value
        nom = wm.cell(r, 6).value
        if cod and nom:
            print(
                f"  r{r} {str(cod):22s} | {wm.cell(r, 3).value} | {wm.cell(r, 4).value} | "
                f"{str(wm.cell(r, 5).value):10s} | {str(nom)[:95]}"
            )

    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("\n== caso anulado ==")
    for r in (
        cur.execute("""select codigo_caso, codigo_legado, nombre_caso, anulado_en, motivo_anulacion
                            from core.casos where anulado_en is not null""")
        or []
    ):
        pass
    for r in cur.fetchall():
        print("  ", dict(r))

    print("\n== detalle de los casos sin par (La Paradita, FEN, Callao infra) ==")
    for r in [
        dict(x)
        for x in (
            cur.execute("""select codigo_caso, nombre_caso, descripcion_riesgo,
                                                     left(coalesce(resumen_ejecutivo,''),300) r
                                              from core.casos
                                              where codigo_caso in ('CS-PA-INF-2022-01','CS-PA-ITE-2026-02',
                                                                    'CS-PA-ITE-2022-01','CS-PA-NOR-2025-01')
                                              order by 1""")
            or []
        )
    ]:
        print(f"\n  {r['codigo_caso']} — {r['nombre_caso']}")
        print(f"    riesgo: {str(r['descripcion_riesgo'])[:200]}")
        print(f"    resumen: {str(r['r'])[:300]}")

    print("\n== todos: anulado o no ==")
    for r in [
        dict(x)
        for x in (
            cur.execute("""select codigo_caso, anulado_en is not null as anulado
                                               from core.casos order by 1""")
            or []
        )
    ]:
        if r["anulado"]:
            print("  ANULADO:", r["codigo_caso"])

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
