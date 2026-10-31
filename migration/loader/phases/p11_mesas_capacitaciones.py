"""Fase 11 — mesas de diálogo, capacitaciones y locales.

Fuentes (posiciones verificadas contra el workbook, nunca por cabecera):

* `DIM_MESAS_GRUPOS` (21)             -> `core.mesas_dialogo`
* `DIM_MESAS_GRUPOS.c15|c16|c19|c20`  -> `core.mesa_miembros` (62)
* `DIM_Capacitaciones` (1)             -> `core.capacitaciones`
* `BRIDGE_Capacitacion_Participant` (9) -> `core.capacitacion_participantes`
* `DIM_Locales` (27)                   -> `core.locales`

Decisiones que esta fase aplica:

* **D14.** Los integrantes de mesa llegan como texto libre (sin código de
  actor): se cargan en `mesa_miembros.nombre_texto`, sin fuzzy ni
  `actor_uid`. Cada mesa aporta hasta cuatro roles según qué columna traiga
  nombre: `PRESIDENTE` (21), `SECRETARIO_TECNICO` (12), `TITULAR` (15) y
  `ALTERNO` (14) = **62** filas.
* **D37 (corregida).** El literal `'Sin fecha'` —que el plan ubicaba en
  `FECHA_FIN_VIGENCIA`— está realmente en `ESTADO_VIGENCIA` (2 filas). Ahí se
  copia como texto; `FECHA_FIN_VIGENCIA` sólo trae fechas u 8 vacíos. El parser
  de fechas es defensivo y devuelve NULL ante cualquier valor no ISO.
* `tipo_espacio_id` se resuelve por **match exacto** del nombre contra las 7
  filas de `core.cat_tipos_espacio_dialogo`; el legado usa esos mismos 7
  valores. `naturaleza` cae dentro del CHECK cerrado
  (`Permanente`/`Temporal`/`No definida`).
* `CON_NORMA` (`Sí` 19 / `No` 2) alimenta la columna nueva `tiene_norma`
  (parche 2). `FECHA_NORMA` llega con hora: se castea a `date`.
* **D46.** Sólo 1 de las 9 filas de `BRIDGE_Capacitacion_Participant` trae
  `ID_Capacitacion`; como hay un único curso (`CAP-2026-001`), las 9 se
  asignan a él (`confidence=0.90` implícito en la decisión).
* `ID_Ubigeo` es un departamento (`DEP-xx`) tanto en capacitaciones como en
  locales: `distrito_id` queda NULL y no se inventa un distrito.
"""

from __future__ import annotations

from datetime import date

from ...decisions import boolean_si_no, parse_fecha
from .. import legacy
from ..context import LoadContext

NUMBER = 11
NAME = "Mesas + capacitaciones + locales"

_ORIGEN = "AVISA_HISTORICO"

# -- DIM_MESAS_GRUPOS ---------------------------------------------------------
_M_CODIGO = 1
_M_TIPO_ESPACIO = 2
_M_CON_NORMA = 3
_M_LINEA = 4
_M_TITULO = 5
_M_TIPO_INSTRUMENTO = 6
_M_BASE_LEGAL = 7
_M_FECHA_NORMA = 8
_M_PRORROGAS = 9
_M_FECHA_INSTALACION = 10
_M_NATURALEZA = 11
_M_FECHA_FIN_VIGENCIA = 12
_M_ESTADO_VIGENCIA = 13
_M_OBJETIVO = 14
_M_PRESIDENTE = 15
_M_SECRETARIO = 16
_M_ROL_PRODUCE = 17
_M_AMBITO = 18
_M_TITULAR = 19
_M_ALTERNO = 20
_M_DOC_DESIGNACION = 21
_M_SECTORISTA = 22
_M_LINK_EVIDENCIA = 23

# -- DIM_Capacitaciones -------------------------------------------------------
_C_CODIGO = 1
_C_TIPO = 2
_C_TITULO = 3
_C_OBJETIVO = 4
_C_LUGAR = 5
_C_UBIGEO = 6
_C_MODALIDAD = 7
_C_INICIO = 8
_C_FIN = 9
_C_DURACION = 10
_C_LINK_DOCUMENTO = 11
_C_ESTADO = 12

# -- BRIDGE_Capacitacion_Participant ------------------------------------------
_B_RELACION = 1
_B_CAPACITACION = 2
_B_ACTOR = 3
_B_INSCRITO = 4
_B_CULMINO = 5

# -- DIM_Locales --------------------------------------------------------------
_L_CODIGO = 1
_L_UBIGEO = 2
_L_NOMBRE = 3
_L_DIRECCION = 4
_L_UBICACION = 5
_L_FOTOGRAFIA = 6
_L_AFORO = 7
_L_INGRESOS = 8
_L_PROYECTOR = 9
_L_COMPUTO = 10
_L_AUDIO = 11
_L_CONTACTO = 12
_L_CELULAR = 13
_L_EMAIL = 14
_L_RECOMENDACION = 15

# Roles de mesa y la columna que los trae (D14).
_ROLES_MESA = (
    (_M_PRESIDENTE, "Presidente"),
    (_M_SECRETARIO, "Secretario_tecnico"),
    (_M_TITULAR, "Titular"),
    (_M_ALTERNO, "Alterno"),
)


def _fecha(valor: str | None) -> date | None:
    """Fecha ISO o None. Cualquier texto no-ISO (p. ej. 'Sin fecha') -> None."""
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _entero(valor: str | None) -> int | None:
    """Entero o None; tolera el '80.0' que deja el origen."""
    if valor is None:
        return None
    limpio = valor.strip().removesuffix(".0")
    return int(limpio) if limpio.isdigit() else None


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


def _si_no(valor: str | None, por_defecto: bool | None = None) -> bool | None:
    """'Sí'/'Si'/'No' -> bool; vacío -> el default de la columna."""
    return boolean_si_no(valor, por_defecto)


async def _tipos(ctx: LoadContext) -> dict[str, int]:
    """Nombres de los catálogos de espacio y de capacitación -> id."""
    espacios = await ctx.conn.fetch(
        "SELECT id, nombre FROM core.cat_tipos_espacio_dialogo"
    )
    capacitaciones = await ctx.conn.fetch(
        "SELECT id, nombre FROM core.cat_tipos_capacitacion"
    )
    return {
        "espacios": {fila["nombre"]: fila["id"] for fila in espacios},
        "capacitaciones": {fila["nombre"]: fila["id"] for fila in capacitaciones},
    }


async def _usuarios(ctx: LoadContext) -> dict[str, str]:
    filas = await ctx.conn.fetch(
        "SELECT id, codigo_legado FROM core.usuarios WHERE codigo_legado IS NOT NULL"
    )
    return {fila["codigo_legado"]: fila["id"] for fila in filas}


async def _actores(ctx: LoadContext) -> dict[str, str]:
    """`ACT-EST-xxx` -> actor_uid por `codigo_legado`."""
    filas = await ctx.conn.fetch(
        "SELECT actor_uid, codigo_legado FROM core.actores "
        "WHERE codigo_legado IS NOT NULL"
    )
    return {fila["codigo_legado"]: fila["actor_uid"] for fila in filas}


async def _mesas(
    ctx: LoadContext, tipos: dict[str, int], usuarios: dict[str, str]
) -> dict[str, str]:
    """Inserta las 21 mesas y sus 62 integrantes. Devuelve {codigo -> id}."""
    mesas = legacy.sheet_of(ctx.sheets, "DIM_MESAS_GRUPOS")
    ids: dict[str, str] = {}

    for indice in range(mesas.filas):
        codigo = mesas.cell(indice, _M_CODIGO)
        titulo = mesas.cell(indice, _M_TITULO)
        if not codigo or not titulo:
            raise ValueError(
                f"DIM_MESAS_GRUPOS fila {indice + 1}: faltan ID_MESA_GRUPO o TITULO_MESA"
            )

        tipo_espacio = mesas.cell(indice, _M_TIPO_ESPACIO)
        sectorista = mesas.cell(indice, _M_SECTORISTA)
        doc_designacion = mesas.cell(indice, _M_DOC_DESIGNACION)

        mesa_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.mesas_dialogo
                (codigo, tipo_espacio_id, linea_oaipcs, titulo,
                 tipo_instrumento, base_legal, fecha_norma,
                 prorrogas_modificatorias, fecha_instalacion, naturaleza,
                 fecha_fin_vigencia, estado_vigencia, objetivo, rol_produce,
                 ambito_departamento, doc_designacion, link_evidencia,
                 sectorista_usuario_id, tiene_norma, origen_dato,
                 nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, 2)
            RETURNING id
            """,
            codigo,
            tipos["espacios"].get(tipo_espacio) if tipo_espacio else None,
            _recorta(mesas.cell(indice, _M_LINEA), 60),
            _recorta(titulo, 255),
            _recorta(mesas.cell(indice, _M_TIPO_INSTRUMENTO), 80),
            _recorta(mesas.cell(indice, _M_BASE_LEGAL), 150),
            _fecha(mesas.cell(indice, _M_FECHA_NORMA)),
            mesas.cell(indice, _M_PRORROGAS),
            _fecha(mesas.cell(indice, _M_FECHA_INSTALACION)),
            _recorta(mesas.cell(indice, _M_NATURALEZA), 30),
            _fecha(mesas.cell(indice, _M_FECHA_FIN_VIGENCIA)),
            _recorta(mesas.cell(indice, _M_ESTADO_VIGENCIA), 30),
            mesas.cell(indice, _M_OBJETIVO),
            _recorta(mesas.cell(indice, _M_ROL_PRODUCE), 40),
            mesas.cell(indice, _M_AMBITO),
            doc_designacion,
            _recorta(mesas.cell(indice, _M_LINK_EVIDENCIA), 500),
            usuarios.get(sectorista) if sectorista else None,
            _si_no(mesas.cell(indice, _M_CON_NORMA)),
            _ORIGEN,
        )
        ctx.add("core.mesas_dialogo")
        ids[codigo] = mesa_id

        for columna, rol in _ROLES_MESA:
            nombre = mesas.cell(indice, columna)
            if not nombre:
                continue
            await ctx.conn.execute(
                """
                INSERT INTO core.mesa_miembros
                    (mesa_id, rol, nombre_texto, doc_designacion)
                VALUES ($1, $2, $3, $4)
                """,
                mesa_id,
                rol,
                _recorta(nombre, 255),
                _recorta(doc_designacion, 255),
            )
            ctx.add("core.mesa_miembros")

    return ids


async def _capacitaciones(ctx: LoadContext, tipos: dict[str, int]) -> dict[str, str]:
    """Inserta la única capacitación. Devuelve {codigo -> id}."""
    sheet = legacy.sheet_of(ctx.sheets, "DIM_Capacitaciones")
    ids: dict[str, str] = {}

    for indice in range(sheet.filas):
        codigo = sheet.cell(indice, _C_CODIGO)
        titulo = sheet.cell(indice, _C_TITULO)
        if not codigo or not titulo:
            raise ValueError(
                f"DIM_Capacitaciones fila {indice + 1}: faltan ID_Capacitacion o Titulo"
            )

        tipo = sheet.cell(indice, _C_TIPO)
        # `ID_Ubigeo` es un departamento (DEP-xx): no hay distrito que resolver.
        capacitacion_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.capacitaciones
                (codigo, tipo_id, titulo, objetivo, lugar, distrito_id,
                 modalidad, fecha_inicio, fecha_fin, duracion, url_documento,
                 estado, origen_dato, nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, 2)
            RETURNING id
            """,
            codigo,
            tipos["capacitaciones"].get(tipo) if tipo else None,
            _recorta(titulo, 255),
            sheet.cell(indice, _C_OBJETIVO),
            _recorta(sheet.cell(indice, _C_LUGAR), 255),
            _recorta(sheet.cell(indice, _C_MODALIDAD), 40),
            _fecha(sheet.cell(indice, _C_INICIO)),
            _fecha(sheet.cell(indice, _C_FIN)),
            _recorta(sheet.cell(indice, _C_DURACION), 60),
            _recorta(sheet.cell(indice, _C_LINK_DOCUMENTO), 500),
            _recorta(sheet.cell(indice, _C_ESTADO), 40),
            _ORIGEN,
        )
        ctx.add("core.capacitaciones")
        ids[codigo] = capacitacion_id

    return ids


async def _participantes(
    ctx: LoadContext, capacitaciones: dict[str, str], actores: dict[str, str]
) -> None:
    """Las 9 filas del bridge, asignadas al único curso (D46)."""
    sheet = legacy.sheet_of(ctx.sheets, "BRIDGE_Capacitacion_Participant")
    unico = next(iter(capacitaciones.values()), None)

    for indice in range(sheet.filas):
        codigo_actor = sheet.cell(indice, _B_ACTOR)
        codigo_curso = sheet.cell(indice, _B_CAPACITACION)

        capacitacion_id = capacitaciones.get(codigo_curso) if codigo_curso else None
        if capacitacion_id is None and len(capacitaciones) == 1:
            capacitacion_id = unico
        if capacitacion_id is None:
            await ctx.conflicto(
                "PARTICIPANTE_SIN_CAPACITACION",
                hoja="BRIDGE_Capacitacion_Participant",
                fila=indice + 1,
                codigo=codigo_actor,
                detalle={"capacitacion": codigo_curso},
            )
            continue

        actor_uid = actores.get(codigo_actor) if codigo_actor else None
        if actor_uid is None:
            continue

        await ctx.conn.execute(
            """
            INSERT INTO core.capacitacion_participantes
                (capacitacion_id, actor_uid, inscrito, culmino)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
            """,
            capacitacion_id,
            actor_uid,
            _si_no(sheet.cell(indice, _B_INSCRITO), True),
            _si_no(sheet.cell(indice, _B_CULMINO), False),
        )
        ctx.add("core.capacitacion_participantes")


async def _locales(ctx: LoadContext) -> None:
    """Inserta los 27 locales. `ID_Ubigeo` es DEP-xx: sin distrito."""
    sheet = legacy.sheet_of(ctx.sheets, "DIM_Locales")

    for indice in range(sheet.filas):
        codigo = sheet.cell(indice, _L_CODIGO)
        nombre = sheet.cell(indice, _L_NOMBRE)
        if not codigo or not nombre:
            raise ValueError(
                f"DIM_Locales fila {indice + 1}: faltan ID_Local o Nombre_Local"
            )

        await ctx.conn.execute(
            """
            INSERT INTO core.locales
                (codigo, nombre, distrito_id, direccion, ubicacion_ref,
                 foto_url, aforo, ingresos, tiene_proyector,
                 tiene_equipos_computo, tiene_audio_micro, contacto_nombre,
                 contacto_celular, contacto_email, recomendacion)
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14)
            """,
            codigo,
            _recorta(sheet.cell(indice, _L_NOMBRE), 255),
            _recorta(sheet.cell(indice, _L_DIRECCION), 255),
            _recorta(sheet.cell(indice, _L_UBICACION), 255),
            _recorta(sheet.cell(indice, _L_FOTOGRAFIA), 500),
            _entero(sheet.cell(indice, _L_AFORO)),
            _recorta(sheet.cell(indice, _L_INGRESOS), 100),
            _si_no(sheet.cell(indice, _L_PROYECTOR)),
            _si_no(sheet.cell(indice, _L_COMPUTO)),
            _si_no(sheet.cell(indice, _L_AUDIO)),
            _recorta(sheet.cell(indice, _L_CONTACTO), 255),
            _recorta(sheet.cell(indice, _L_CELULAR), 50),
            _recorta(sheet.cell(indice, _L_EMAIL), 255),
            sheet.cell(indice, _L_RECOMENDACION),
        )
        ctx.add("core.locales")


async def run(ctx: LoadContext) -> None:
    tipos = await _tipos(ctx)
    usuarios = await _usuarios(ctx)
    actores = await _actores(ctx)
    await _mesas(ctx, tipos, usuarios)
    capacitaciones = await _capacitaciones(ctx, tipos)
    await _participantes(ctx, capacitaciones, actores)
    await _locales(ctx)
