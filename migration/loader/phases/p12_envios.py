"""Fase 12 — envíos de comunicación y suscripciones fijas.

Fuentes (posiciones verificadas contra el workbook, nunca por cabecera):

* `LOG_Envios` (17)             -> `core.envios_comunicacion`
* `DIM_Destinatarios_Fijos` (4) -> `core.suscripcion_notificacion`

`LOG_Envios` es la hoja más corrida del legado (D38). Además del corrimiento ya
documentado —`ID_Tipo_Reporte` (c04) trae el código de caso e `ID_Documento`
(c05) el número de paso—, el origen mezcla **dos variantes de fila**:

* **Detallada** (`ENV-0001..ENV-0007`, `c13` con resultado): `c06` = código del
  punto focal, `c07` = canal de correo, `c08` = email, `c09` = canal de
  WhatsApp, `c10` = celular, `c11` = mensaje, `c12` = remitente (`AUT-001` /
  `SEC-02`) y `c13` = resultado.
* **Corrida** (`ENV-0008..ENV-0017`, `c13` vacío): `c07` = remitente
  (`Sistema`), `c09` = destinatario (email o celular), `c11` = mensaje y
  `c12` = resultado.

La variante se detecta por la presencia de `c13` (o del código `PF-xx` en
`c06`), no por la cabecera: los nombres de columna no describen el dato real.

Decisiones que esta fase aplica:

* **D38.** `canal` sale de `c03` (`Correo`/`WhatsApp`); `Caso` y cualquier otro
  valor se mapean a `Otro`, que es el único valor extra admitido por el CHECK.
* `entidad_tipo='caso'`; `entidad_id` se resuelve contra `core.casos`. Dos filas
  traen el código a dos dígitos (`CS-PRODUCE-2026-02`): se rellena a tres
  (`CS-PRODUCE-2026-002`) para que coincida con `FACT_Casos`.
* El punto focal de las filas detalladas (`c06`) identifica al **destinatario**,
  no al remitente: el mensaje saluda al punto focal y firma la autoridad.
  `destinatario_texto` guarda el email (`c08`) o, si falta, el celular (`c10`);
  en las filas corridas, `c09`.
* `remitente_usuario_id` se resuelve por `codigo_legado` y, si el código no
  sobrevivió a la fusión de la fase 4, por el DNI que el legado declara para ese
  código: `AUT-001` es la misma persona que `SEC-11` (DNI 41907320), que es el
  código que conserva `core.usuarios`. `Sistema` no es un usuario: NULL.
* `url_pdf` queda NULL en las 17 filas. La hoja no trae ninguna URL (`c10` es
  el celular en las filas detalladas) aunque la cabecera se llame
  `Link_PDF_Drive`.
* El número de paso (`c05`) se anexa a `observacion`: v9 no tiene columna
  propia.
* `AR-000` (2 suscripciones) no existe en `DIM_Area_Responsable`:
  `unidad_id` queda NULL y la fila se conserva.
"""

from __future__ import annotations

import re

from ...decisions import boolean_si_no, norm_key, normalize_dni
from .. import legacy
from ..context import LoadContext

NUMBER = 12
NAME = "Envíos + suscripciones"

# -- LOG_Envios ---------------------------------------------------------------
_E_CODIGO = 1
_E_FECHA = 2
_E_CANAL = 3
_E_CASO = 4
_E_PASO = 5
_E_PUNTO_FOCAL = 6
_E_EMAIL = 8
_E_CELULAR = 10
_E_OBSERVACION = 11
_E_DESTINATARIO_CORRIDO = 9
_E_REMITENTE_CORRIDO = 7
_E_RESULTADO_CORRIDO = 12
_E_REMITENTE_DETALLE = 12
_E_RESULTADO_DETALLE = 13

# -- DIM_Destinatarios_Fijos ---------------------------------------------------
_S_CODIGO = 1
_S_AREA = 2
_S_ALERTA = 3
_S_CLIMA = 4
_S_RR = 5
_S_CANAL = 6
_S_ACTIVO = 7

_CANALES = {norm_key("Correo"): "Correo", norm_key("WhatsApp"): "WhatsApp"}

_RE_CASO = re.compile(r"^(?P<serie>.+)-(?P<numero>\d+)$")

_HOJAS_PERSONAS = ("DIM_Sectoristas", "DIM_Punto_Focal", "DIM_Autoridades")


def _canal(valor: str | None) -> str:
    """`Correo`/`WhatsApp` se conservan; `Caso` y el resto son `Otro`."""
    return _CANALES.get(norm_key(valor), "Otro")


def _caso_id(valor: str | None, casos: dict[str, str]) -> str | None:
    """Código de caso -> id. Los dos dígitos de `-02` se rellenan a `-002`."""
    if not valor:
        return None
    if valor in casos:
        return casos[valor]
    m = _RE_CASO.match(valor)
    if m is None:
        return None
    return casos.get(f"{m.group('serie')}-{int(m.group('numero')):03d}")


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


def _observacion(mensaje: str | None, paso: str | None) -> str | None:
    """El legado no tiene columna de paso: se anexa al texto del mensaje."""
    if not paso:
        return mensaje
    etiqueta = f"Paso {paso}"
    return f"{mensaje}\n\n{etiqueta}" if mensaje else etiqueta


async def _usuarios_por_codigo(ctx: LoadContext) -> dict[str, str]:
    """`SEC-xx`/`PF-xxx`/`AUT-xxx` -> id, con respaldo por DNI de la fusión.

    La fase 4 absorbió `AUT-001` en `SEC-11` (misma persona, DNI 41907320) y sólo
    conserva el código del sectorista. Como `LOG_Envios` cita `AUT-001`, el mapa
    se completa con el DNI que el propio legado declara para cada código.
    """
    filas = await ctx.conn.fetch("SELECT id, codigo_legado, dni FROM core.usuarios")
    mapa = {
        fila["codigo_legado"]: fila["id"] for fila in filas if fila["codigo_legado"]
    }
    por_dni = {fila["dni"]: fila["id"] for fila in filas if fila["dni"]}

    for hoja in _HOJAS_PERSONAS:
        sheet = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(sheet.filas):
            codigo = sheet.cell(indice, 1)
            dni = normalize_dni(sheet.cell(indice, 3))
            if codigo and dni and dni in por_dni:
                mapa.setdefault(codigo, por_dni[dni])
    return mapa


async def _envios(ctx: LoadContext, idx: dict) -> None:
    """Los 17 envíos de `LOG_Envios` en `core.envios_comunicacion`."""
    sheet = legacy.sheet_of(ctx.sheets, "LOG_Envios")

    for indice in range(sheet.filas):
        codigo = sheet.cell(indice, _E_CODIGO)
        fecha = sheet.cell(indice, _E_FECHA)
        if not codigo or not fecha:
            raise ValueError(
                f"LOG_Envios fila {indice + 1}: faltan ID_Envio o Fecha_Envio"
            )

        detallada = (
            sheet.cell(indice, _E_RESULTADO_DETALLE) is not None
            or sheet.cell(indice, _E_PUNTO_FOCAL) is not None
        )
        if detallada:
            remitente = sheet.cell(indice, _E_REMITENTE_DETALLE)
            resultado = sheet.cell(indice, _E_RESULTADO_DETALLE)
            destinatario = sheet.cell(indice, _E_EMAIL) or sheet.cell(
                indice, _E_CELULAR
            )
        else:
            remitente = sheet.cell(indice, _E_REMITENTE_CORRIDO)
            resultado = sheet.cell(indice, _E_RESULTADO_CORRIDO)
            destinatario = sheet.cell(indice, _E_DESTINATARIO_CORRIDO)

        await ctx.conn.execute(
            """
            INSERT INTO core.envios_comunicacion
                (codigo, fecha_envio, canal, entidad_tipo, entidad_id,
                 remitente_usuario_id, rol_remitente, destinatario_texto,
                 url_pdf, resultado, observacion)
            VALUES ($1, $2::text::timestamptz, $3, 'caso', $4, $5, NULL, $6,
                    NULL, $7, $8)
            """,
            codigo,
            fecha,
            _canal(sheet.cell(indice, _E_CANAL)),
            _caso_id(sheet.cell(indice, _E_CASO), idx["casos"]),
            idx["usuarios"].get(remitente) if remitente else None,
            destinatario,
            _recorta(resultado, 255),
            _observacion(
                sheet.cell(indice, _E_OBSERVACION),
                sheet.cell(indice, _E_PASO),
            ),
        )
        ctx.add("core.envios_comunicacion")


async def _suscripciones(ctx: LoadContext, areas: dict[str, int]) -> None:
    """Las 4 suscripciones fijas de `DIM_Destinatarios_Fijos`."""
    sheet = legacy.sheet_of(ctx.sheets, "DIM_Destinatarios_Fijos")

    for indice in range(sheet.filas):
        codigo = sheet.cell(indice, _S_CODIGO)
        if not codigo:
            raise ValueError(
                f"DIM_Destinatarios_Fijos fila {indice + 1}: falta ID_Destinatario"
            )

        area = sheet.cell(indice, _S_AREA)
        await ctx.conn.execute(
            """
            INSERT INTO core.suscripcion_notificacion
                (unidad_id, recibe_alerta, recibe_clima_social,
                 recibe_reporte_rapido, canal_preferido, activo, codigo_legado)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            areas.get(area) if area else None,
            boolean_si_no(sheet.cell(indice, _S_ALERTA), default_when_null=False),
            boolean_si_no(sheet.cell(indice, _S_CLIMA), default_when_null=False),
            boolean_si_no(sheet.cell(indice, _S_RR), default_when_null=False),
            _recorta(sheet.cell(indice, _S_CANAL), 30),
            boolean_si_no(sheet.cell(indice, _S_ACTIVO), default_when_null=True),
            codigo,
        )
        ctx.add("core.suscripcion_notificacion")


async def run(ctx: LoadContext) -> None:
    idx = {
        "casos": {
            fila["codigo_caso"]: fila["id"]
            for fila in await ctx.conn.fetch("SELECT id, codigo_caso FROM core.casos")
        },
        "usuarios": await _usuarios_por_codigo(ctx),
    }
    areas = {
        fila["codigo_legado_area"]: fila["id"]
        for fila in await ctx.conn.fetch(
            "SELECT id, codigo_legado_area FROM core.cat_unidades_organicas "
            "WHERE codigo_legado_area IS NOT NULL"
        )
    }
    await _envios(ctx, idx)
    await _suscripciones(ctx, areas)
