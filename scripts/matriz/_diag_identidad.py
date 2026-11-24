#!/usr/bin/env python
"""Diagnóstico temporal: bloques Los Órganos / Chimbote + catálogos Maestros.

Sólo lectura sobre el XLSX y sobre casos.json. No escribe en la base.
"""

from __future__ import annotations

import json
import os
import sys
import unicodedata

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO, "docs", "01_requisitos", "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx"
)


def norm(t):
    if t is None:
        return ""
    s = unicodedata.normalize("NFKD", str(t))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


def main():
    wb = load_workbook(XLSX, data_only=True)
    print("== HOJAS ==")
    for n in wb.sheetnames:
        ws = wb[n]
        print(f"  {n!r}: {ws.max_row} x {ws.max_column}")

    ws = wb["CASOS OAIPCS - OPERATIVO"]

    # 1) localizar bloques por columna E
    print("\n== BLOQUES E que mencionan organos/chimbote ==")
    hits = []
    for r in range(1, ws.max_row + 1):
        e = ws.cell(r, 5).value
        a = ws.cell(r, 1).value
        if e and any(k in norm(e) for k in ("organo", "chimbote")):
            hits.append(r)
            print(f"  fila {r}: A={a!r} E={str(e)[:120]!r}")
    # también por A
    print("\n== FILAS cuyo A cita INF-2025-02/05 ==")
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if a and "inf-2025-0" in norm(a):
            print(f"  fila {r}: A={a!r} E={str(ws.cell(r, 5).value)[:80]!r}")

    # 2) volcar bloques alrededor de cada hit (hasta 40 filas)
    cols = "ABCDEFGHIJKLMNOPQRSTUVWX"
    for r0 in hits:
        print(f"\n===== BLOQUE desde fila {r0} =====")
        for r in range(max(1, r0 - 1), min(ws.max_row, r0 + 40) + 1):
            vals = []
            for ci, letter in enumerate(cols, start=1):
                v = ws.cell(r, ci).value
                if v is not None and str(v).strip() != "":
                    vals.append(f"{letter}={str(v)[:160]!r}")
            if vals:
                print(f"  r{r}: " + " | ".join(vals))
            # cortar si aparece otro caso en E
            if r > r0 and ws.cell(r, 5).value:
                print(f"  -- fin bloque (nuevo caso E en r{r}) --")
                break

    # 3) METADATOS para esos códigos
    if "METADATOS CASOS" in wb.sheetnames:
        print("\n== METADATOS CASOS (filas con organos/chimbote/inf-2025) ==")
        wm = wb["METADATOS CASOS"]
        for r in range(1, wm.max_row + 1):
            fila = [wm.cell(r, c).value for c in range(1, wm.max_column + 1)]
            txt = norm(" ".join(str(x) for x in fila if x is not None))
            if any(k in txt for k in ("organo", "chimbote", "inf-2025")):
                print(f"  r{r}: {fila}")

    # 4) catálogos Maestros
    print("\n== HOJAS tipo MAESTRO/CATALOGO ==")
    for n in wb.sheetnames:
        if any(k in norm(n) for k in ("maestro", "catalogo", "lista", "param")):
            wm = wb[n]
            print(f"\n--- {n} ({wm.max_row}x{wm.max_column}) ---")
            for r in range(1, min(wm.max_row, 120) + 1):
                fila = [
                    wm.cell(r, c).value for c in range(1, min(wm.max_column, 12) + 1)
                ]
                if any(x is not None for x in fila):
                    print(f"  r{r}: {fila}")

    # 5) casos.json: los dos casos por código
    p = os.path.join(HERE, "salida", "casos.json")
    if os.path.exists(p):
        data = json.load(open(p, encoding="utf-8"))
        casos = data["casos"] if isinstance(data, dict) and "casos" in data else data
        print(f"\n== casos.json: {len(casos)} casos ==")
        for c in casos:
            blob = norm(json.dumps(c, ensure_ascii=False)[:4000])
            if "organo" in blob or "chimbote" in blob:
                print("\n  --- CASO ---")
                for k in (
                    "n",
                    "codigo",
                    "nombre",
                    "depto",
                    "sectorista",
                    "prioridad",
                    "narrativa",
                    "analisis",
                    "timestamp",
                    "riesgo",
                    "demandas",
                    "acciones",
                    "hitos",
                ):
                    if k in c:
                        v = c[k]
                        if isinstance(v, list):
                            print(f"    {k}: {len(v)} items")
                        else:
                            print(f"    {k}: {str(v)[:300]!r}")


if __name__ == "__main__":
    main()
