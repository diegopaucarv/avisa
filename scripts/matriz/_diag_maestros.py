#!/usr/bin/env python
"""Diagnóstico temporal 2: resto de Maestros + encabezados de Reporte de avance."""

from __future__ import annotations

import os

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO, "docs", "01_requisitos", "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx"
)


def main():
    wb = load_workbook(XLSX, data_only=True)

    wm = wb["Maestros"]
    print("== Maestros filas 63..99 ==")
    for r in range(63, wm.max_row + 1):
        fila = [wm.cell(r, c).value for c in range(1, 13)]
        if any(x is not None for x in fila):
            print(f"  r{r}: {fila}")
    print("\n== Maestros columnas N..AA (13..27) ==")
    for r in range(1, wm.max_row + 1):
        fila = [wm.cell(r, c).value for c in range(13, 28)]
        if any(x is not None for x in fila):
            print(f"  r{r}: {fila}")

    wr = wb["Reporte de avance de casos punt"]
    print("\n== Reporte de avance: fila 1 y 2 (encabezados) ==")
    for r in (1, 2):
        for c in range(1, wr.max_column + 1):
            v = wr.cell(r, c).value
            if v is not None:
                print(f"  r{r}c{c}: {str(v)[:200]!r}")
        print("  ---")

    print("\n== Reporte de avance: primeras 6 filas de datos ==")
    for r in range(3, 9):
        fila = []
        for c in range(1, wr.max_column + 1):
            v = wr.cell(r, c).value
            if v is not None:
                fila.append(f"c{c}={str(v)[:90]!r}")
        if fila:
            print(f"  r{r}: " + " | ".join(fila))


if __name__ == "__main__":
    main()
