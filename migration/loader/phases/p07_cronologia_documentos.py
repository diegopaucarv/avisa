"""Fase 7 — cronología del caso y documentos del legado.

Fuentes (posiciones verificadas contra el workbook, nunca por cabecera):

* `FACT_Hechos_Casos` (80)      -> `core.caso_cronologia`
* `DIM_Alertas.Link_PDF_Drive`  -> `core.documentos` (83, tipo 13)
* `DIM_REDACCION` (51)          -> `core.documentos` (tipos 10/11/15)
* `DIM_COORDINACION_TECNICA` (4)-> `core.documentos`
* `DIM_Reporte_Rapido` (1)      -> `core.documentos` (tipo 1)
* `DIM_ClimaSocial` (7)         -> `core.documentos` (tipo 2)
* `DIM_ClimaSocial_Focalizado` (6)-> `core.documentos` (tipo 3)
* `FACT_Analisis_Casos` (1)     -> `core.documentos` (tipo 6)

Total `core.documentos` = 83 + 51 + 4 + 1 + 7 + 6 + 1 = **153**.

Detalles que esta fase respeta:

* `FACT_Hechos_Casos.ID_Hecho` tiene 2 duplicados (`HECHO-012`, `HECHO-047`):
  el segundo se sufija `-2` (D41). `DIM_REDACCION.ID_Redaccion` repite
  `RED-2026-010` (50 distintos de 51), igual tratamiento.
* `FACT_Historial_Estado` NO se carga (D7): sus columnas vienen intercambiadas.
* `FACT_Hechos_Casos.ID_Alerta` trae 2 URL y 3 códigos `AT-`; el vínculo
  alerta↔hecho se completa en la fase 8 (`cronologia_vinculos`), no aquí. Los 2
  vínculos hecho↔documento (`ID_Redaccion` = `RED-2026-007/023`) sí se insertan
  en esta fase.
* `ID_Ubigeo` de los documentos es un **departamento** (`DEP-xx`): `distrito_id`
  queda NULL, no se deriva un distrito que el legado no declara.
* Los documentos sin `Titulo_*` usan como título el texto real de
  `Situacion_Actual` recortado; si tampoco hubiera, el código legado.
"""

from __future__ import annotations

import re
from datetime import date

from ...decisions import boolean_si_no, norm_key, parse_fecha
from .. import legacy
from ..context import LoadContext

NUMBER = 7
NAME = "Cronología + documentos"

_ORIGEN = "AVISA_HISTORICO"

# -- FACT_Hechos_Casos --------------------------------------------------------
_H_CODIGO = 1
_H_CASO = 2
_H_FECHA = 3
_H_TIPO = 4
_H_CRITICO = 5
_H_DESCRIPCION = 6
_H_SECTORISTA = 7
_H_TIPO_EVIDENCIA = 8
_H_ALERTA = 10
_H_LINK = 12
_H_REDACCION = 13

# -- DIM_Alertas --------------------------------------------------------------
_AL_CODIGO = 1
_AL_CASO = 2
_AL_FECHA = 4
_AL_TITULO = 10
_AL_SITUACION = 12
_AL_PDF = 22

_TIPO_DOC_ALERTA = 13

# -- bloque común de DIM_REDACCION / DIM_COORDINACION_TECNICA -----------------
_D_CODIGO = 1
_D_CASO = 2
_D_FECHA = 3
_D_TITULO = 4
_D_TIPO_DOC = 5
_D_DESCRIPCION = 6
_D_LINK_ARCHIVO = 8
_D_LINK_LISTA = 9
_D_LINK_FOTO = 10
_D_ESTADO = 11
_D_SECTORISTA = 13

_RE_SUFIJO = re.compile(r"^(.*)-(\d+)$")


def _fecha(valor: str | None) -> date | None:
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _recorta(valor: str | None, limite: int) -> str | None:
    return valor[:limite] if valor else None


def _unico(usados: dict[str, int], codigo: str) -> str:
    """D41: segunda aparición de un código -> `-2`, `-3`…"""
    usados[codigo] = usados.get(codigo, 0) + 1
    n = usados[codigo]
    return codigo if n == 1 else f"{codigo}-{n}"


def _contenido(sheet: legacy.Sheet, indice: int) -> dict:
    """Toda la fila del origen como JSON, sin perder ninguna columna."""
    return {
        f"c{i + 1:02d}": valor
        for i, valor in enumerate(sheet.rows[indice])
        if valor is not None
    }


def _titulo(principal: str | None, respaldo: str | None, codigo: str) -> str:
    """`documentos.titulo` es NOT NULL: se usa el texto real del legado."""
    if principal and principal.strip():
        return principal.strip()[:255]
    if respaldo and respaldo.strip():
        return respaldo.strip()[:255]
    return codigo


async def _indices(ctx: LoadContext) -> dict:
    casos = {
        fila["codigo_caso"]: fila["id"]
        for fila in await ctx.conn.fetch("SELECT id, codigo_caso FROM core.casos")
    }
    usuarios = {
        fila["codigo_legado"]: fila["id"]
        for fila in await ctx.conn.fetch(
            "SELECT id, codigo_legado FROM core.usuarios WHERE codigo_legado IS NOT NULL"
        )
    }
    tipos_hecho = {
        norm_key(fila["nombre"]): fila["id"]
        for fila in await ctx.conn.fetch("SELECT id, nombre FROM core.cat_tipos_hecho")
    }
    tipos_doc = {
        norm_key(fila["nombre"]): fila["id"]
        for fila in await ctx.conn.fetch(
            "SELECT id, nombre FROM core.cat_tipos_documento"
        )
    }
    # El legado escribe `Otro`; el catálogo lo llama `Otro (sin clasificar)`.
    tipos_doc[norm_key("Otro")] = tipos_doc[norm_key("Otro (sin clasificar)")]
    return {
        "casos": casos,
        "usuarios": usuarios,
        "tipos_hecho": tipos_hecho,
        "tipos_doc": tipos_doc,
    }


async def _cronologia(ctx: LoadContext, idx: dict) -> dict[str, str]:
    """`core.caso_cronologia` desde `FACT_Hechos_Casos` (80). Devuelve código→id."""
    hechos = legacy.sheet_of(ctx.sheets, "FACT_Hechos_Casos")
    usados: dict[str, int] = {}
    ids: dict[str, str] = {}

    for indice in range(hechos.filas):
        codigo = hechos.cell(indice, _H_CODIGO)
        caso_codigo = hechos.cell(indice, _H_CASO)
        descripcion = hechos.cell(indice, _H_DESCRIPCION)
        fecha = _fecha(hechos.cell(indice, _H_FECHA))
        if not codigo or not descripcion or fecha is None:
            raise ValueError(
                f"FACT_Hechos_Casos fila {indice + 1}: falta código, descripción o fecha"
            )
        caso_id = idx["casos"].get(caso_codigo)
        if caso_id is None:
            raise ValueError(
                f"FACT_Hechos_Casos fila {indice + 1}: caso {caso_codigo!r} inexistente"
            )

        codigo_unico = _unico(usados, codigo)
        tipo = hechos.cell(indice, _H_TIPO)
        sectorista = hechos.cell(indice, _H_SECTORISTA)

        cronologia_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.caso_cronologia
                (caso_id, fecha_evento, descripcion_hecho, tipo_hecho_id,
                 es_hecho_critico, sectorista_usuario_id,
                 tipo_evidencia_legado, link_evidencia, codigo_legado,
                 origen_dato, confidence, es_validado_humano, nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1.00, TRUE, 2)
            RETURNING id
            """,
            caso_id,
            fecha,
            descripcion,
            idx["tipos_hecho"].get(norm_key(tipo)) if tipo else None,
            boolean_si_no(hechos.cell(indice, _H_CRITICO), default_when_null=False),
            idx["usuarios"].get(sectorista) if sectorista else None,
            _recorta(hechos.cell(indice, _H_TIPO_EVIDENCIA), 80),
            _recorta(hechos.cell(indice, _H_LINK), 500),
            codigo_unico,
            _ORIGEN,
        )
        ctx.add("core.caso_cronologia")
        ids[codigo_unico] = cronologia_id
        ids.setdefault(codigo, cronologia_id)
    return ids


async def _insertar_documento(
    ctx: LoadContext,
    *,
    tipo_id: int | None,
    codigo: str,
    caso_id: str | None,
    titulo: str,
    fecha: date | None,
    resumen: str | None,
    url_pdf: str | None = None,
    url_lista: str | None = None,
    url_foto: str | None = None,
    estado: str | None = None,
    responsable: str | None = None,
    contenido: dict | None = None,
) -> str:
    documento_id = await ctx.conn.fetchval(
        """
        INSERT INTO core.documentos
            (tipo_id, codigo, codigo_legado, caso_id, titulo, fecha,
             resumen_ejecutivo, contenido_json, url_pdf, url_lista, url_foto,
             estado, responsable_usuario_id, origen_dato, confidence,
             es_validado_humano, nivel_clasificacion)
        VALUES ($1, $2, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7::jsonb,
                $8, $9, $10, $11, $12, $13, 1.00, TRUE, 2)
        RETURNING id
        """,
        tipo_id,
        codigo,
        caso_id,
        titulo,
        fecha,
        resumen,
        _json(contenido or {}),
        url_pdf,
        url_lista,
        url_foto,
        estado,
        responsable,
        _ORIGEN,
    )
    ctx.add("core.documentos")
    return documento_id


def _json(valor: dict) -> str:
    import json

    return json.dumps(valor, ensure_ascii=False, sort_keys=True, default=str)


async def _documentos(ctx: LoadContext, idx: dict) -> dict[str, str]:
    """Los 153 documentos de las siete fuentes. Devuelve código→id."""
    usados: dict[str, int] = {}
    ids: dict[str, str] = {}

    async def guardar(codigo_base: str, **campos) -> None:
        codigo = _unico(usados, codigo_base)
        if campos.get("tipo_id") is None:
            campos["tipo_id"] = idx["tipos_doc"][norm_key("Otro")]
        ids[codigo_base] = await _insertar_documento(ctx, codigo=codigo, **campos)

    # 1. Alertas -> reporte de alerta temprana (83)
    alertas = legacy.sheet_of(ctx.sheets, "DIM_Alertas")
    for indice in range(alertas.filas):
        codigo_alerta = alertas.cell(indice, _AL_CODIGO)
        caso_codigo = alertas.cell(indice, _AL_CASO)
        await guardar(
            f"{codigo_alerta}_pdf",
            tipo_id=_TIPO_DOC_ALERTA,
            caso_id=idx["casos"].get(caso_codigo) if caso_codigo else None,
            titulo=_titulo(
                alertas.cell(indice, _AL_TITULO),
                alertas.cell(indice, _AL_SITUACION),
                codigo_alerta,
            ),
            fecha=_fecha(alertas.cell(indice, _AL_FECHA)),
            resumen=alertas.cell(indice, _AL_SITUACION),
            url_pdf=_recorta(alertas.cell(indice, _AL_PDF), 500),
        )

    # 2-3. Redacciones y coordinaciones técnicas
    for hoja in ("DIM_REDACCION", "DIM_COORDINACION_TECNICA"):
        sheet = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(sheet.filas):
            codigo = sheet.cell(indice, _D_CODIGO)
            caso_codigo = sheet.cell(indice, _D_CASO)
            sectorista = sheet.cell(indice, _D_SECTORISTA)
            tipo = sheet.cell(indice, _D_TIPO_DOC)
            await guardar(
                codigo,
                tipo_id=idx["tipos_doc"].get(norm_key(tipo)) if tipo else None,
                caso_id=idx["casos"].get(caso_codigo) if caso_codigo else None,
                titulo=_titulo(sheet.cell(indice, _D_TITULO), None, codigo),
                fecha=_fecha(sheet.cell(indice, _D_FECHA)),
                resumen=sheet.cell(indice, _D_DESCRIPCION),
                url_pdf=_recorta(sheet.cell(indice, _D_LINK_ARCHIVO), 500),
                url_lista=_recorta(sheet.cell(indice, _D_LINK_LISTA), 500),
                url_foto=_recorta(sheet.cell(indice, _D_LINK_FOTO), 500),
                estado=_recorta(sheet.cell(indice, _D_ESTADO), 40),
                responsable=idx["usuarios"].get(sectorista) if sectorista else None,
            )

    # 4. Reporte rápido (1) — 25 columnas completas
    reportes = legacy.sheet_of(ctx.sheets, "DIM_Reporte_Rapido")
    for indice in range(reportes.filas):
        codigo = reportes.cell(indice, 1)
        sectorista = reportes.cell(indice, 3)
        await guardar(
            codigo,
            tipo_id=idx["tipos_doc"].get(norm_key("Reporte Rápido (RR)")),
            caso_id=None,
            titulo=_titulo(
                reportes.cell(indice, 12), reportes.cell(indice, 14), codigo
            ),
            fecha=_fecha(reportes.cell(indice, 4)),
            resumen=reportes.cell(indice, 14),
            url_pdf=_recorta(reportes.cell(indice, 18), 500),
            responsable=idx["usuarios"].get(sectorista) if sectorista else None,
            contenido=_contenido(reportes, indice),
        )

    # 5-6. Clima social general (7) y focalizado (6)
    for hoja, tipo_nombre in (
        ("DIM_ClimaSocial", "Clima Social General"),
        ("DIM_ClimaSocial_Focalizado", "Clima Social Focalizado"),
    ):
        sheet = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(sheet.filas):
            codigo = sheet.cell(indice, 1)
            caso_codigo = sheet.cell(indice, 2)
            sectorista = sheet.cell(indice, 3)
            await guardar(
                codigo,
                tipo_id=idx["tipos_doc"].get(norm_key(tipo_nombre)),
                caso_id=idx["casos"].get(caso_codigo) if caso_codigo else None,
                titulo=_titulo(
                    sheet.cell(indice, 11),
                    sheet.cell(indice, 13),
                    codigo,
                ),
                fecha=_fecha(sheet.cell(indice, 4)),
                resumen=sheet.cell(indice, 13),
                url_pdf=_recorta(sheet.cell(indice, 21), 500),
                responsable=idx["usuarios"].get(sectorista) if sectorista else None,
                contenido=_contenido(sheet, indice),
            )

    # 7. Análisis de caso (1) — 26 columnas completas
    analisis = legacy.sheet_of(ctx.sheets, "FACT_Analisis_Casos")
    for indice in range(analisis.filas):
        codigo = analisis.cell(indice, 1)
        caso_codigo = analisis.cell(indice, 2)
        await guardar(
            codigo,
            tipo_id=idx["tipos_doc"].get(norm_key("Análisis de Caso")),
            caso_id=idx["casos"].get(caso_codigo) if caso_codigo else None,
            titulo=_titulo(analisis.cell(indice, 3), None, codigo),
            fecha=_fecha(analisis.cell(indice, 9)),
            resumen=analisis.cell(indice, 4),
            contenido=_contenido(analisis, indice),
        )

    return ids


async def _vinculos(
    ctx: LoadContext, cronologias: dict[str, str], documentos: dict[str, str]
) -> None:
    """Los 2 vínculos hecho↔documento (`FACT_Hechos_Casos.ID_Redaccion`)."""
    hechos = legacy.sheet_of(ctx.sheets, "FACT_Hechos_Casos")
    for indice in range(hechos.filas):
        codigo_hecho = hechos.cell(indice, _H_CODIGO)
        codigo_documento = hechos.cell(indice, _H_REDACCION)
        if not codigo_hecho or not codigo_documento:
            continue
        cronologia_id = cronologias.get(codigo_hecho)
        documento_id = documentos.get(codigo_documento)
        if cronologia_id is None or documento_id is None:
            continue
        await ctx.conn.execute(
            """
            INSERT INTO core.cronologia_vinculos (cronologia_id, documento_id)
            VALUES ($1, $2)
            """,
            cronologia_id,
            documento_id,
        )
        ctx.add("core.cronologia_vinculos")


async def run(ctx: LoadContext) -> None:
    idx = await _indices(ctx)
    cronologias = await _cronologia(ctx, idx)
    documentos = await _documentos(ctx, idx)
    await _vinculos(ctx, cronologias, documentos)
