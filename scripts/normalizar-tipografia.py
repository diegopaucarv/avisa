"""Normaliza la escala tipográfica de la app.

- Sube el mínimo a 12 px y comprime la diferencia entre tamaños (máx. ~20 px).
- Sólo toca declaraciones `font-size:` y el shorthand `font: <peso> <tamaño>px`,
  nunca padding, gap, width, etc.
- Una sola pasada: la tabla se aplica al valor original, sin efectos en cascada.
"""

from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "angular" / "src"

ESCALA = {
    "7": "12",
    "7.5": "12",
    "8": "12",
    "8.5": "12",
    "9": "12",
    "9.5": "12",
    "10": "12.5",
    "10.5": "13",
    "11": "13",
    "11.5": "13.5",
    "12": "14",
    "13": "14.5",
    "14": "15",
    "15": "16",
    "16": "17",
    "17": "17.5",
    "18": "18",
    "19": "19",
    "20": "20",
    "21": "20",
    "22": "20",
    "23": "20",
    "24": "20",
    "25": "20",
    "26": "20",
    "27": "20",
    "28": "20",
    "29": "20",
    "30": "20",
}

PX_FONT_SIZE = re.compile(r"(font-size:\s*)(\d+(?:\.\d+)?)px")
PX_FONT = re.compile(r"(font:\s*\d{3}\s+)(\d+(?:\.\d+)?)px")


def mapear(match: re.Match[str]) -> str:
    valor = match.group(2)
    return match.group(1) + ESCALA.get(valor, valor) + "px"


archivos = [RAIZ / "styles" / "global.css"]
archivos += list((RAIZ / "app").rglob("*.ts"))

total = 0
for ruta in archivos:
    original = ruta.read_text(encoding="utf-8")
    texto = PX_FONT.sub(mapear, original)
    texto = PX_FONT_SIZE.sub(mapear, texto)
    if texto != original:
        ruta.write_text(texto, encoding="utf-8")
        total += 1

print(f"Archivos con tipografía ajustada: {total}")
