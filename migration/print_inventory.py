"""Imprime un resumen legible del inventario: hoja, filas, columnas con posición."""

import json
import os

path = os.path.join(os.path.dirname(__file__), "legacy_inventory.json")
with open(path, encoding="utf-8") as fh:
    inv = json.load(fh)

for name, info in inv.items():
    if info["rows"] == 0:
        print(f"\n## {name} :: 0 filas (VACIA)")
        continue
    print(f"\n## {name} :: {info['rows']} filas x {info['cols']} cols")
    for col in info["columns"]:
        hdr = col["header"] if col["header"] else "<sin nombre>"
        print(
            f"  {col['pos']:>2}. {hdr!r}  nn={col['non_null']} d={col['distinct']} len={col['max_len'] if 'max_len' in col else col['maxlen']}"
        )
