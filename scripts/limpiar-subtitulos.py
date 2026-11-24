"""Elimina subtítulos descriptivos y notas heredadas de las pantallas Angular.

Uso puntual (no idempotente por diseño): recorre las plantillas de `features`
y quita el texto de apoyo que la auditoría marcó como subtítulo descriptivo.
No toca `.case-resumen` (dato real del caso) ni los `small.detail-hint`
(ayudas en línea de un campo).
"""

from __future__ import annotations

import pathlib
import re

BASE = (
    pathlib.Path(__file__).resolve().parent.parent
    / "angular"
    / "src"
    / "app"
    / "features"
)

PATRONES = [
    # Etiquetas superiores (eyebrows) y pies de tabla descriptivos.
    r"\n[ \t]*<p class=\"section-eyebrow\">.*?</p>",
    r"\n[ \t]*<caption class=\"table-caption\">.*?</caption>",
    # Subtítulos de paneles.
    r"\n[ \t]*<p class=\"[a-z-]+-panel-sub\">.*?</p>",
    r"\n[ \t]*<p class=\"alerta-alta-ayuda\"[^>]*>.*?</p>",
    # Notas explicativas.
    r"\n[ \t]*<p class=\"alerta-nota\">.*?</p>",
    r"\n[ \t]*<p class=\"panel-nota\">.*?</p>",
    r"\n[ \t]*<p class=\"tabla-nota\">.*?</p>",
    r"\n[ \t]*<p class=\"cola-pendiente\">.*?</p>",
    r"\n[ \t]*<p class=\"cola-nota\">.*?</p>",
    # Subtítulos de sección (sólo <p>, nunca los <small> de ayuda de campo).
    r"\n[ \t]*<p class=\"detail-hint\">.*?</p>",
    # Frases descriptivas concretas dentro de encabezados de superficie.
    r"\n[ \t]*<p>\s*Filas ya cargadas de las tres fuentes;.*?</p>",
    r"\n[ \t]*<p>\s*Cuatro niveles de la Guía.*?</p>",
    r"\n[ \t]*<p>\{\{ notaBase\(\) \}\}</p>",
    r"\n[ \t]*<p>\s*Pegue o elija el CSV.*?</p>",
    r"\n[ \t]*<p>\s*La unidad de este corte es la cola.*?</p>",
    r"\n[ \t]*<p>\s*Las cinco alertas tempranas registradas.*?</p>",
    r"\n[ \t]*<p>\s*Compromisos vencidos y los que vencen entre hoy.*?</p>",
    r"\n[ \t]*<p>\s*@if \(modoAlta\(\)\) \{.*?</p>",
    # Instrucción de desarrollo heredada en la importación de la matriz.
    r"\n[ \t]*<p class=\"form-hint\">\s*Esta previsualización no escribe.*?</p>",
]


def limpiar(texto: str) -> tuple[str, int]:
    total = 0
    for patron in PATRONES:
        texto, n = re.subn(patron, "", texto, flags=re.DOTALL)
        total += n
    return texto, total


def main() -> None:
    archivos = 0
    eliminados = 0
    for ruta in BASE.rglob("*"):
        if ruta.suffix not in {".html", ".ts"}:
            continue
        original = ruta.read_text(encoding="utf-8")
        nuevo, n = limpiar(original)
        if n:
            ruta.write_text(nuevo, encoding="utf-8")
            archivos += 1
            eliminados += n
            print(f"{ruta.relative_to(BASE.parent.parent.parent)}: {n}")
    print(f"\n{archivos} archivos, {eliminados} subtítulos eliminados.")


if __name__ == "__main__":
    main()
