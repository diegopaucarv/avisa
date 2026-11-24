#!/usr/bin/env python
"""Diagnóstico: volumen de nudos críticos + estructura de Alertas y Reuniones."""

import collections
import os

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO, "docs", "01_requisitos", "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx"
)

wb = load_workbook(XLSX, data_only=True)
ws = wb["Reporte de avance de casos punt"]

# --- nudos críticos ---
semanas = {}
for c in range(22, 38, 2):
    semanas[c] = ws.cell(1, c).value
print("=== Pares nudo/seguimiento ===")
for c, h in semanas.items():
    n_nudo = sum(1 for r in range(2, ws.max_row + 1) if ws.cell(r, c).value is not None)
    n_seg = sum(
        1 for r in range(2, ws.max_row + 1) if ws.cell(r, c + 1).value is not None
    )
    print(f"  c{c}: nudos={n_nudo} seguimientos={n_seg}  {str(h)[:45]!r}")

tot_n = sum(
    1
    for r in range(2, ws.max_row + 1)
    for c in range(22, 38, 2)
    if ws.cell(r, c).value is not None
)
tot_s = sum(
    1
    for r in range(2, ws.max_row + 1)
    for c in range(22, 38, 2)
    if ws.cell(r, c + 1).value is not None
)
print(f"TOTAL nudos={tot_n} seguimientos={tot_s}")

print("\n=== Nudos sin Seguimiento / Seguimiento sin Nudo ===")
for r in range(2, ws.max_row + 1):
    for c in range(22, 38, 2):
        nv = ws.cell(r, c).value
        sv = ws.cell(r, c + 1).value
        if (nv is None) != (sv is None):
            print(
                f"  fila {r} c{c}: nudo={'SÍ' if nv else 'no'} seguimiento={'SÍ' if sv else 'no'}"
            )

# --- Alertas ---
for hoja in ("Seguimiento de Alertas", "Seguimiento de Reuniones"):
    if hoja not in wb.sheetnames:
        print(f"\n!! no existe hoja {hoja!r}; hojas={wb.sheetnames}")
        continue
    s = wb[hoja]
    print(f"\n=== {hoja}: max_row={s.max_row} max_col={s.max_column} ===")
    for r in range(1, min(4, s.max_row) + 1):
        vals = []
        for c in range(1, s.max_column + 1):
            v = s.cell(r, c).value
            if v is not None:
                vals.append(f"{c}:{str(v)[:34]!r}")
        print(f"  fila {r}: " + (" | ".join(vals) if vals else "(vacía)"))
    no_vacias = sum(
        1
        for r in range(2, s.max_row + 1)
        if any(s.cell(r, c).value is not None for c in range(1, s.max_column + 1))
    )
    print(f"  filas con algún dato: {no_vacias}")
