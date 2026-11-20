"""Cargador del legado AVISA 2026 hacia el esquema v9.

Contrato de una fase:

    NUMBER: int                  # número en registry.PHASES
    NAME: str                    # etiqueta legible
    async def run(ctx) -> None   # escribe con ctx.conn y contabiliza con ctx.add()

Reglas comunes a todas las fases:

* Leer del staging (`legacy.*`) por posición: `c01` == `r[0]`.
* No inventar datos: lo que no se pueda resolver va a `ctx.conflicto(...)`.
* No abrir transacciones propias: la maneja `run.py` (una sola para toda la carga
  o una por fase con `--per-phase-commit`).
* Toda escritura ocurre ya con `app.user_id` y `app.clasificacion_max` fijados.
"""

__all__ = ["legacy", "registry", "context", "bootstrap", "run"]
