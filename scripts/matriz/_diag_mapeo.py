#!/usr/bin/env python
"""Diagnóstico temporal 6: mapeo METADATOS CASOS <-> core.casos por nombre."""

from __future__ import annotations

import difflib
import os
import re
import unicodedata

import psycopg2
import psycopg2.extras
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
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(s.split())


def url():
    p = os.path.join(REPO, ".env")
    for line in open(p, encoding="utf-8"):
        if line.startswith("NEON_OWNER_URL"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")


def main():
    wb = load_workbook(XLSX, data_only=True)
    wm = wb["METADATOS CASOS"]
    meta = []
    for r in range(2, wm.max_row + 1):
        cod = wm.cell(r, 1).value
        nom = wm.cell(r, 6).value
        if cod and nom:
            meta.append(
                {
                    "fila": r,
                    "codigo": str(cod).strip(),
                    "depto": wm.cell(r, 3).value,
                    "sectorista": wm.cell(r, 4).value,
                    "prioridad": wm.cell(r, 5).value,
                    "nombre": str(nom).strip(),
                }
            )
    print(f"METADATOS: {len(meta)} filas con código+nombre")

    conn = psycopg2.connect(url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""select codigo_caso, codigo_legado, nombre_caso
                   from core.casos where anulado_en is null order by codigo_caso""")
    base = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    print(f"base: {len(base)} casos activos\n")

    usados = set()
    exactos = []
    dudosos = []
    sin_par = []
    for m in meta:
        mn = norm(m["nombre"])
        # 1) código igual
        hit = next((b for b in base if b["codigo_caso"] == m["codigo"]), None)
        how = "codigo"
        if hit is None:
            hit = next((b for b in base if b["codigo_legado"] == m["codigo"]), None)
            how = "codigo_legado"
        if hit is None:
            # 2) nombre: mejor ratio
            best, ratio = None, 0.0
            for b in base:
                r = difflib.SequenceMatcher(None, mn, norm(b["nombre_caso"])).ratio()
                if r > ratio:
                    best, ratio = b, r
            if ratio >= 0.62:
                hit, how = best, f"nombre~{ratio:.2f}"
            else:
                sin_par.append((m, ratio))
                continue
        if hit["codigo_caso"] in usados:
            dudosos.append((m, hit, how + " (ya usado)"))
        usados.add(hit["codigo_caso"])
        exactos.append((m, hit, how))

    print("== MAPEO PROPUESTO ==")
    for m, b, how in exactos:
        marca = "" if m["codigo"] == b["codigo_caso"] else "  <<< CODIGO DISTINTO"
        print(
            f"  {m['codigo']:22s} -> {b['codigo_caso']:22s} [{how}]  {m['nombre'][:58]}{marca}"
        )

    if dudosos:
        print("\n== COLISIONES ==")
        for m, b, how in dudosos:
            print(
                f"  {m['codigo']:22s} -> {b['codigo_caso']:22s} [{how}] {m['nombre'][:58]}"
            )

    if sin_par:
        print("\n== EXCEL SIN PAR EN BASE (candidatos a caso nuevo) ==")
        for m, ratio in sin_par:
            print(f"  {m['codigo']:22s} (mejor={ratio:.2f}) {m['nombre'][:70]}")

    huerfanos = [b for b in base if b["codigo_caso"] not in usados]
    print(f"\n== BASE SIN PAR EN EXCEL ({len(huerfanos)}) ==")
    for b in huerfanos:
        print(f"  {b['codigo_caso']:22s} {b['nombre_caso'][:70]}")


if __name__ == "__main__":
    main()
