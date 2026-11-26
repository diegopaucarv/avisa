"""Limpieza mecánica de la UI: subtítulos de vista, eyebrows de cabecera y
reglas de título duplicadas en los estilos inline de cada componente.

Idempotente: se puede volver a ejecutar sin efectos adicionales.
"""

from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "angular" / "src" / "app"

# Subtítulo descriptivo de la vista (bloque completo, multilínea).
PATRON_SUBTITULO = re.compile(r"[ \t]*<p class=\"view-subtitle\">[\s\S]*?</p>\s*\n")

# Eyebrows de cabecera que no aportan (sólo los que están dentro de view-head).
EYEBROWS_CABECERA = re.compile(
    r"[ \t]*<p class=\"section-eyebrow\">"
    r"(Consulta normativa|Alta Dirección · lectura ejecutiva|TERRITORIO|Ajustes personales)"
    r"</p>[ \t]*\n"
)

# Reglas CSS inline que duplican el estilo global y fijan colores.
PATRONES_ESTILO = [
    re.compile(r"\n[ \t]*\.view-head h1 \{[\s\S]*?\n[ \t]*\}[ \t]*\n"),
    re.compile(r"\n[ \t]*\.view-subtitle \{[\s\S]*?\n[ \t]*\}[ \t]*\n"),
    re.compile(r"\n[ \t]*\.drawer-head h2 \{[\s\S]*?\n[ \t]*\}[ \t]*\n"),
    re.compile(r"\n[ \t]*/\* El estilo global de \.drawer-head[^\n]*\*/\n"),
]

EXCLUIR_TEMPLATES = {"casos.page.html"}  # el contador vive dentro del subtítulo

modificados: list[str] = []

for ruta in RAIZ.rglob("*"):
    if ruta.suffix not in {".html", ".ts"}:
        continue

    original = ruta.read_text(encoding="utf-8")
    texto = original

    if ruta.name not in EXCLUIR_TEMPLATES:
        texto = PATRON_SUBTITULO.sub("", texto)
    texto = EYEBROWS_CABECERA.sub("", texto)

    if ruta.suffix == ".ts":
        for patron in PATRONES_ESTILO:
            texto = patron.sub("\n", texto)

    if texto != original:
        ruta.write_text(texto, encoding="utf-8")
        modificados.append(str(ruta.relative_to(RAIZ)))

print(f"Archivos modificados: {len(modificados)}")
for nombre in modificados:
    print(f"  - {nombre}")
