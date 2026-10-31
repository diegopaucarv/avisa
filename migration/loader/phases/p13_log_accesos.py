"""Fase 13 — bitácora de accesos del legado.

Fuente (posiciones verificadas, nunca por cabecera):

* `LOG_Accesos` (857) -> `core.log_accesos`

Columnas: c01 `Fecha`, c02 `DNI`, c03 `Nombre`, c04 `Rol`, c05 `Resultado`.

Decisiones que esta fase aplica:

* **D39.** Las cuentas de prueba `11111111` (`AUT-002`, Admin) y `1234567`
  (`SEC-06`) no se vinculan a un usuario: `usuario_id` queda NULL, pero **la
  fila se carga**. Sus 25 registros siguen contando para las 857: son evidencia
  de las pruebas de acceso y no se descartan.
* `usuario_id` se resuelve contra `core.usuarios.dni`. No se usa
  `core.actores`: el DNI de las personas vive en `core.actor_datos_personales`
  y `log_accesos.usuario_id` tiene FK real a `core.usuarios`.
* Los intentos `FALLIDO` con un DNI existente se vinculan igual: la bitácora
  registra el intento, no el éxito.
* `nombre` viene vacío en 46 filas (todas `FALLIDO`) -> NULL, sin inventarlo.
* `fecha` es TIMESTAMPTZ: se copia la marca completa del legado (hora local de
  Lima) sin conversión de zona horaria.
* `origen` (`AVISA_HISTORICO`) y `nivel_clasificacion` (3) quedan con su DEFAULT.
"""

from __future__ import annotations

from ...decisions import normalize_dni
from .. import legacy
from ..context import LoadContext

NUMBER = 13
NAME = "Log de accesos"

# -- LOG_Accesos ---------------------------------------------------------------
_L_FECHA = 1
_L_DNI = 2
_L_NOMBRE = 3
_L_ROL = 4
_L_RESULTADO = 5

_CUENTAS_PRUEBA = frozenset({"11111111", "1234567"})
_RESULTADOS = frozenset({"OK", "FALLIDO"})


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


async def _usuarios_por_dni(ctx: LoadContext) -> dict[str, str]:
    """DNI -> id de `core.usuarios` (el índice parcial garantiza unicidad)."""
    filas = await ctx.conn.fetch(
        "SELECT id, dni FROM core.usuarios WHERE dni IS NOT NULL"
    )
    return {fila["dni"]: fila["id"] for fila in filas}


async def run(ctx: LoadContext) -> None:
    sheet = legacy.sheet_of(ctx.sheets, "LOG_Accesos")
    usuarios = await _usuarios_por_dni(ctx)

    for indice in range(sheet.filas):
        fecha = sheet.cell(indice, _L_FECHA)
        resultado = sheet.cell(indice, _L_RESULTADO)
        if not fecha or resultado not in _RESULTADOS:
            raise ValueError(
                f"LOG_Accesos fila {indice + 1}: falta fecha o resultado válido"
            )

        dni = normalize_dni(sheet.cell(indice, _L_DNI))
        usuario_id = None
        if dni and dni not in _CUENTAS_PRUEBA:
            usuario_id = usuarios.get(dni)

        await ctx.conn.execute(
            """
            INSERT INTO core.log_accesos
                (fecha, dni, nombre, rol_declarado, resultado, usuario_id)
            VALUES ($1::text::timestamptz, $2, $3, $4, $5, $6)
            """,
            fecha,
            dni,
            _recorta(sheet.cell(indice, _L_NOMBRE), 255),
            _recorta(sheet.cell(indice, _L_ROL), 60),
            resultado,
            usuario_id,
        )
        ctx.add("core.log_accesos")
