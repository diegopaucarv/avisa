"""Lectura posicional del workbook del legado AVISA 2026.

Tres reglas que este módulo encapsula y que ningún cargador debe repetir:

1. **Se mapea por posición, nunca por nombre.** Las cabeceras están mutiladas en
   el origen (`descripcin`, `situacin`, `fotografa`, `DIM_Unidades_Organicas_Responsa`).
2. **Las filas son irregulares.** Cada fila se rellena con `None` hasta el ancho
   máximo de su hoja; si no, un índice alto revienta con IndexError.
3. **Los nombres de hoja distinguen mayúsculas.** `DIM_ORGANIZACION` (singular) y
   `DIM_MESAS_GRUPOS` conviven con otras hojas de nombre parecido.

Convención de índices: la columna `cNN` del staging (1-based) es `r[NN - 1]` de
la fila de datos. Es decir, `c01` es la primera columna de datos, la misma
posición que la primera cabecera.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_XLSX = REPO_ROOT / "backend" / "BASE_CONFLICTOS_SOCIALES_2026.xlsx"


def cell_text(value) -> str | None:
    """Normaliza una celda a texto o None. '1.0' -> '1', '' -> None."""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    return text or None


@dataclass(frozen=True)
class Sheet:
    """Una hoja con sus filas ya normalizadas y rellenadas."""

    name: str
    header: tuple[str | None, ...]
    rows: tuple[tuple[str | None, ...], ...]

    @property
    def width(self) -> int:
        return len(self.header)

    @property
    def filas(self) -> int:
        return len(self.rows)

    def cell(self, row_index: int, col: int) -> str | None:
        """Celda por posición 1-based (`col=1` es `c01`)."""
        row = self.rows[row_index]
        return row[col - 1] if 0 <= col - 1 < len(row) else None


def read_sheet(worksheet) -> Sheet:
    """Lee una hoja: descarta filas totalmente vacías, la primera es cabecera."""
    raw = [
        row
        for row in worksheet.iter_rows(values_only=True)
        if any(c is not None and str(c).strip() != "" for c in row)
    ]
    if not raw:
        return Sheet(name=worksheet.title, header=(), rows=())

    width = max(len(row) for row in raw)
    header = tuple(
        cell_text(raw[0][i]) if i < len(raw[0]) else None for i in range(width)
    )

    rows: list[tuple[str | None, ...]] = []
    for row in raw[1:]:
        cells = [cell_text(c) for c in row]
        cells.extend([None] * (width - len(cells)))
        rows.append(tuple(cells))

    return Sheet(name=worksheet.title, header=header, rows=tuple(rows))


def read_workbook(path: Path | str | None = None) -> dict[str, Sheet]:
    """Todas las hojas, indexadas por nombre EXACTO (case-sensitive)."""
    source = Path(path) if path else DEFAULT_XLSX
    if not source.is_file():
        raise FileNotFoundError(f"no encuentro el workbook del legado: {source}")

    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    try:
        return {name: read_sheet(workbook[name]) for name in workbook.sheetnames}
    finally:
        workbook.close()


def sheet_of(sheets: dict[str, Sheet], name: str) -> Sheet:
    """Acceso con error útil: lista las hojas parecidas si el nombre no existe."""
    if name in sheets:
        return sheets[name]
    lowered = name.lower()
    parecidas = sorted(n for n in sheets if n.lower() == lowered)
    hint = f" ¿quisiste decir {parecidas[0]!r}?" if parecidas else ""
    raise KeyError(f"la hoja {name!r} no existe en el workbook.{hint}")


def sanitize_identifier(name: str) -> str:
    """Nombre de hoja -> identificador seguro para `legacy.*`."""
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_name).strip("_")
    if not slug:
        raise ValueError(f"nombre de hoja no identificable: {name!r}")
    if slug[0].isdigit():
        slug = f"h_{slug}"
    return slug[:60]
