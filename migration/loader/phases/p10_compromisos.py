"""Fase 10 — compromisos sintéticos y sus hitos.

Fuentes (posiciones verificadas contra el workbook, nunca por cabecera):

* `DIM_Acciones_Hitos` (8) -> `core.compromisos`
* `DIM_Hitos` (12)         -> `core.hitos_compromiso`

Decisiones que esta fase aplica:

* **D13.** No se usan `plan_acciones`/`planes_accion` (exigen un
  `documento_id` padre que el legado no provee). Cada `ACC-xxxx` se convierte en
  un compromiso sintético y cada `HIT-xxxx` en un hito de ese compromiso.
* `codigo_compromiso = <codigo_caso>_COMP00N`: el CHECK de v9 exige el sufijo
  `_COMP` + tres dígitos y la columna es UNIQUE. El contador es por caso, así
  que no se repite entre casos distintos.
* **D26.** `unidad_responsable_id` es `NOT NULL`. Se resuelve `ID_Area` contra
  `core.cat_unidades_organicas.codigo_legado_area`; cuando el legado no trae
  área (4 de 8 filas) se usa la unidad OAIPCS (`AR-047`), la única fuente
  autoritativa externa admitida por el proyecto.
* `fecha_inicio` también es `NOT NULL` y el legado no la trae por acción: se
  copia `core.casos.fecha_inicio` del caso al que pertenece la acción.
* `estado_id` siempre queda en **2 (`En_proceso`)**, nunca `Cumplido`: el
  trigger `core.chk_compromiso()` lanza excepción si un compromiso se marca
  cumplido sin evidencia, y el legado no aporta esa evidencia a nivel de acción.
* Los hitos guardan `validacion`, `fecha_real` y `descripcion_evidencia` en las
  columnas añadidas por el parche 2 (`origen_dato='AVISA_HISTORICO'`).
* Si un hito cita una acción inexistente se encola `HITO_SIN_COMPROMISO` y no se
  inserta: `compromiso_id` es `NOT NULL` y no se inventa el padre. En esta carga
  los 12 hitos citan acciones existentes, así que la cola no recibe filas por
  este motivo.
"""

from __future__ import annotations

from datetime import date

from ...decisions import map_estado_hito, parse_fecha
from .. import legacy
from ..context import LoadContext

NUMBER = 10
NAME = "Compromisos + hitos"

_ORIGEN = "AVISA_HISTORICO"
_ESTADO_EN_PROCESO = 2

# -- DIM_Acciones_Hitos -------------------------------------------------------
_A_CODIGO = 1
_A_CASO = 2
_A_N_ACCION = 3
_A_DESCRIPCION = 4
_A_AREA = 5
_A_PUNTO_FOCAL = 6
_A_HITO = 7
_A_TIPO_EVIDENCIA = 8
_A_REDACCION = 9
_A_CLIMA = 10
_A_ALERTA = 11
_A_RR = 12
_A_LINK_EVIDENCIA = 13

# -- DIM_Hitos ----------------------------------------------------------------
_H_CODIGO = 1
_H_CASO = 2
_H_N_HITO = 3
_H_DESCRIPCION = 4
_H_RESPONSABLE = 5
_H_VALIDACION = 6
_H_FECHA_PLANIFICADA = 7
_H_FECHA_REAL = 8
_H_ESTADO = 9
_H_LINK_EVIDENCIA = 10
_H_ACCION = 11
_H_AREA = 12
_H_DESCRIPCION_EVIDENCIA = 13


def _fecha(valor: str | None) -> date | None:
    """Fecha ISO o None. El parser es defensivo: texto suelto -> None."""
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


async def _indices(ctx: LoadContext) -> dict:
    """Índices de resolución que esta fase necesita."""
    casos = await ctx.conn.fetch("SELECT id, codigo_caso, fecha_inicio FROM core.casos")
    unidades = await ctx.conn.fetch(
        "SELECT id, codigo_legado_area, siglas FROM core.cat_unidades_organicas"
    )
    oaipcs = next((fila["id"] for fila in unidades if fila["siglas"] == "OAIPCS"), None)
    if oaipcs is None:
        raise RuntimeError("no existe la unidad OAIPCS (¿falta el parche 3?)")
    return {
        "casos": {fila["codigo_caso"]: fila for fila in casos},
        "area_por_codigo": {
            fila["codigo_legado_area"]: fila["id"]
            for fila in unidades
            if fila["codigo_legado_area"]
        },
        "oaipcs": oaipcs,
    }


async def _compromisos(ctx: LoadContext, idx: dict) -> dict[str, str]:
    """Inserta los 8 compromisos. Devuelve {ID_Accion -> compromiso_id}."""
    acciones = legacy.sheet_of(ctx.sheets, "DIM_Acciones_Hitos")
    usados: dict[str, int] = {}
    ids: dict[str, str] = {}

    for indice in range(acciones.filas):
        codigo_accion = acciones.cell(indice, _A_CODIGO)
        codigo_caso = acciones.cell(indice, _A_CASO)
        descripcion = acciones.cell(indice, _A_DESCRIPCION)
        if not codigo_accion or not codigo_caso:
            raise ValueError(
                f"DIM_Acciones_Hitos fila {indice + 1}: faltan ID_Accion o ID_Caso"
            )

        caso = idx["casos"].get(codigo_caso)
        if caso is None:
            raise ValueError(
                f"DIM_Acciones_Hitos fila {indice + 1}: el caso {codigo_caso!r} "
                "no existe en core.casos"
            )
        if caso["fecha_inicio"] is None:
            raise RuntimeError(
                f"caso {codigo_caso} sin fecha_inicio: no se puede satisfacer "
                "el NOT NULL de core.compromisos"
            )

        usados[codigo_caso] = usados.get(codigo_caso, 0) + 1
        codigo_compromiso = f"{codigo_caso}_COMP{usados[codigo_caso]:03d}"

        area = acciones.cell(indice, _A_AREA)
        unidad = idx["area_por_codigo"].get(area) if area else None

        compromiso_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.compromisos
                (codigo_compromiso, caso_id, unidad_responsable_id, fecha_inicio,
                 accion_compromiso, tipo_compromiso, estado_id, origen_dato,
                 confidence, es_validado_humano, nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, 'Actividad', $6, $7, 1.00, TRUE, 2)
            RETURNING id
            """,
            codigo_compromiso,
            caso["id"],
            unidad if unidad is not None else idx["oaipcs"],
            caso["fecha_inicio"],
            descripcion,
            _ESTADO_EN_PROCESO,
            _ORIGEN,
        )
        ctx.add("core.compromisos")
        ids[codigo_accion] = compromiso_id

    return ids


async def _hitos(ctx: LoadContext, compromisos: dict[str, str]) -> None:
    """Inserta los 12 hitos y los cuelga de su compromiso."""
    hitos = legacy.sheet_of(ctx.sheets, "DIM_Hitos")

    for indice in range(hitos.filas):
        codigo_hito = hitos.cell(indice, _H_CODIGO)
        codigo_accion = hitos.cell(indice, _H_ACCION)
        if not codigo_hito:
            raise ValueError(f"DIM_Hitos fila {indice + 1}: falta ID_Hitos")

        compromiso_id = compromisos.get(codigo_accion) if codigo_accion else None
        if compromiso_id is None:
            await ctx.conflicto(
                "HITO_SIN_COMPROMISO",
                hoja="DIM_Hitos",
                fila=indice + 1,
                codigo=codigo_hito,
                detalle={"accion": codigo_accion},
            )
            continue

        estado = map_estado_hito(hitos.cell(indice, _H_ESTADO))
        if estado is None:
            raise ValueError(
                f"DIM_Hitos fila {indice + 1}: estado {hitos.cell(indice, _H_ESTADO)!r} "
                "fuera del catálogo"
            )

        await ctx.conn.execute(
            """
            INSERT INTO core.hitos_compromiso
                (compromiso_id, codigo_hito, descripcion_hito,
                 fecha_vencimiento, estado_id, fecha_real, validacion,
                 descripcion_evidencia, link_evidencia, origen_dato,
                 nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 2)
            """,
            compromiso_id,
            codigo_hito,
            hitos.cell(indice, _H_DESCRIPCION),
            _fecha(hitos.cell(indice, _H_FECHA_PLANIFICADA)),
            estado,
            _fecha(hitos.cell(indice, _H_FECHA_REAL)),
            hitos.cell(indice, _H_VALIDACION),
            hitos.cell(indice, _H_DESCRIPCION_EVIDENCIA),
            hitos.cell(indice, _H_LINK_EVIDENCIA),
            _ORIGEN,
        )
        ctx.add("core.hitos_compromiso")


async def run(ctx: LoadContext) -> None:
    idx = await _indices(ctx)
    compromisos = await _compromisos(ctx, idx)
    await _hitos(ctx, compromisos)
