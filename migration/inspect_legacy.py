"""Inventario detallado de las 86 hojas del legado AVISA 2026.

Salida: migration/legacy_inventory.json
  { sheet: { rows, cols, columns: [ {pos, header, non_null, distinct, maxlen, samples} ] } }

Uso: python migration/inspect_legacy.py
"""

import json
import os
import sys

import openpyxl

XLSX = os.path.join(
    os.path.dirname(__file__), "..", "backend", "BASE_CONFLICTOS_SOCIALES_2026.xlsx"
)
OUT = os.path.join(os.path.dirname(__file__), "legacy_inventory.json")

MAX_SAMPLES = 4
MAX_SAMPLE_LEN = 90


def cell_text(value):
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    if text == "":
        return None
    return text


def main():
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    inventory = {}

    for name in wb.sheetnames:
        ws = wb[name]
        rows = list(ws.iter_rows(values_only=True))
        rows = [
            r for r in rows if any(c is not None and str(c).strip() != "" for c in r)
        ]

        if not rows:
            inventory[name] = {"rows": 0, "cols": 0, "columns": []}
            continue

        header_row = rows[0]
        data = rows[1:]

        # Ancho real = mayor fila no vacía
        width = max(len(r) for r in rows)
        columns = []
        for idx in range(width):
            header = cell_text(header_row[idx]) if idx < len(header_row) else None
            values = [cell_text(r[idx]) if idx < len(r) else None for r in data]
            non_null = [v for v in values if v is not None]
            distinct = len(set(non_null))
            samples = []
            for v in non_null:
                if v not in samples:
                    samples.append(v[:MAX_SAMPLE_LEN])
                if len(samples) >= MAX_SAMPLES:
                    break
            columns.append(
                {
                    "pos": idx + 1,
                    "header": header,
                    "non_null": len(non_null),
                    "distinct": distinct,
                    "maxlen": max((len(v) for v in non_null), default=0),
                    "samples": samples,
                }
            )

        inventory[name] = {"rows": len(data), "cols": width, "columns": columns}

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(inventory, fh, ensure_ascii=False, indent=1)

    empty = [n for n, v in inventory.items() if v["rows"] == 0]
    print(
        f"hojas={len(inventory)} con_datos={len(inventory) - len(empty)} vacias={len(empty)}"
    )
    print(f"filas_totales={sum(v['rows'] for v in inventory.values())}")
    print(f"-> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
