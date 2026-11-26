"""Contexto que reciben todas las fases del cargador.

Centraliza lo que ninguna fase debe improvisar: el conteo de filas escritas, el
registro de conflictos en `core.migracion_conflicto` y el acceso al staging ya
leído (`ctx.sheets`).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import asyncpg

from . import legacy

# Valores permitidos por el CHECK de core.migracion_conflicto.
CATEGORIAS = frozenset(
    {
        "DNI_DUPLICADO",
        "PERSONA_HOMONIMA",
        "MEMBRESIA_SIN_MATCH",
        "ORGANIZACION_SIN_ACTOR",
        "CASO_CODIGO_SERIE_ANTERIOR",
        "ALERTA_INEXISTENTE",
        "ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE",
        "HITO_SIN_COMPROMISO",
        "PARTICIPANTE_SIN_CAPACITACION",
        "TERRITORIO_NO_RESUELTO",
        "BRIDGE_CLAVE_DUPLICADA",
    }
)


@dataclass
class LoadContext:
    """Estado de una corrida. Una sola instancia por ejecución."""

    conn: asyncpg.Connection
    admin_id: str
    sheets: dict[str, legacy.Sheet]
    fase: int = -1
    counts: Counter[str] = field(default_factory=Counter)
    conflictos: Counter[str] = field(default_factory=Counter)

    def add(self, tabla: str, filas: int = 1) -> None:
        """Suma filas escritas a una tabla (se muestra en el resumen final)."""
        if filas:
            self.counts[tabla] += filas

    async def conflicto(
        self,
        categoria: str,
        *,
        hoja: str | None = None,
        fila: int | None = None,
        codigo: str | None = None,
        detalle: dict | None = None,
    ) -> None:
        """Encola una duda revisable en vez de perder el dato o inventarlo.

        `fila` es el número de fila lógico del staging (`fila_n`), no el de Excel.
        """
        if categoria not in CATEGORIAS:
            raise ValueError(
                f"categoría desconocida {categoria!r}; permitidas: {sorted(CATEGORIAS)}"
            )
        await self.conn.execute(
            """
            INSERT INTO core.migracion_conflicto
                (fase, categoria, hoja_legado, fila_legado, codigo_legado, detalle)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            """,
            self.fase,
            categoria,
            hoja,
            fila,
            codigo,
            _json(detalle or {}),
        )
        self.conflictos[categoria] += 1


def _json(value: dict) -> str:
    """Serialización determinista para columnas JSONB."""
    import json

    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
