#!/usr/bin/env python
"""Inspección de columnas 18..40 del Reporte de avance (sólo lectura)."""

import os

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO, "docs", "01_requisitos", "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx"
)

wb = load_workbook(XLSX, data_only=True)
ws = wb["Reporte de avance de casos punt"]
print("max_row", ws.max_row, "max_col", ws.max_column)

print("\n=== Encabezados (filas 1..3) cols 1..40 ===")
for r in range(1, 4):
    vals = []
    for c in range(1, 41):
        v = ws.cell(r, c).value
        if v is not None:
            vals.append(f"{c}:{str(v)[:38]!r}")
    print(f"fila {r}: " + " | ".join(vals))

print("\n=== Merges que tocan cols>=18 ===")
for m in ws.merged_cells.ranges:
    if m.min_col >= 18 or m.max_col >= 18:
        print(m)

print("\n=== Primer bloque con datos semanales ===")
starts = [r for r in range(2, ws.max_row + 1) if ws.cell(r, 1).value is not None]
print("starts:", starts[:8])
if len(starts) >= 2:
    r0, r1 = starts[0], starts[1] - 1
    for r in range(r0, min(r1, r0 + 8) + 1):
        vals = []
        for c in range(18, 41):
            v = ws.cell(r, c).value
            if v is not None:
                vals.append(f"c{c}={str(v)[:60]!r}")
        print(f"  fila {r}: " + (" | ".join(vals) if vals else "(vacía)"))
