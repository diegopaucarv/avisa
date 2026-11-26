#!/usr/bin/env python
"""Parser de la matriz de conflictos del equipo (Excel) -> JSON.

Lee `docs/01_requisitos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx`
y emite `scripts/matriz/salida/casos.json` + `resumen_validacion.json`.

No escribe en la base de datos. Es sólo lectura sobre el XLSX.

Regla de parseo (verificada, no asumida)
----------------------------------------
1. Un caso empieza en toda fila donde la columna E ("Nombre de Caso") tiene
   valor. En el Excel las celdas del bloque están fusionadas, así que sólo la
   fila superior del bloque tiene valor: eso delimita el bloque.
   (El enunciado proponía usar la columna A "N°"; se comprueba que A falla:
   deja 34 bloques y engulle 3 casos que no llevan número. Ver
   `bloques_por_a` en la validación.)
2. Dentro del bloque conviven tres listas 1:N sobre el mismo eje de filas:
   - Demandas: cada fila con L no vacía es una demanda; M de esa fila es su
     temática (no se hereda).
   - Acciones: cada fila con N no vacía inicia una acción; N..R se rellenan
     hacia abajo hasta la siguiente acción.
   - Hitos: cada fila con S no vacía es un hito; se asigna a la acción cuyo
     inicio es la fila más reciente <= fila del hito.
3. Los campos de caso A..K se rellenan hacia abajo desde el inicio del bloque.

Salida
------
Un único `casos.json` global (37 casos, orden de la hoja) más un
`resumen_validacion.json`. Se elige el archivo global, no uno por caso, porque
el importador necesita el orden y los totales en una sola lectura y porque el
volumen es pequeño; el contrato queda documentado en
`docs/07_frontend/MATRIZ_CONFLICTOS_EQUIPO.md`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import unicodedata
from typing import Any

from openpyxl import load_workbook

# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
XLSX = os.path.join(
    REPO,
    "docs",
    "01_requisitos",
    "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx",
)
OUT_DIR = os.path.join(HERE, "salida")

HOJA = "CASOS OAIPCS - OPERATIVO"
HOJA_META = "METADATOS CASOS"
HOJA_REPORTE = "Reporte de avance de casos punt"
HOJA_ALERTAS = "Seguimiento de Alertas"
HOJA_REUNIONES = "Seguimiento de Reuniones"
HOJA_DVPA = "DVPA"
HOJA_DVMYPE = "DVMYPE-I"

# columnas de la hoja principal (1-based)
C_N = 1
C_DEPTO = 2
C_SECTORISTA = 3
C_PRIORIDAD = 4
C_NOMBRE = 5
C_NARRATIVA = 6
C_ANALISIS = 7
C_TIMESTAMP = 8
C_RIESGO = 9
C_ACTORES_ESTADO = 10
C_ACTORES_SOCIEDAD = 11
C_DEMANDA = 12
C_TEMATICA = 13
C_ACCION = 14
C_MEDIOS = 15
C_AREA = 16
C_PUNTO_FOCAL = 17
C_DOCUMENTOS = 18
C_HITO = 19
C_DESC_HITO = 20
C_RESP_HITO = 21
C_FECHA_PLAN = 22
C_FECHA_REAL = 23
C_ESTADO = 24

# columnas de METADATOS
M_CODIGO = 1
M_FECHA = 2
M_DEPTO = 3
M_SECTORISTA = 4
M_PRIORIDAD = 5
M_NOMBRE = 6

# columnas de Reporte de avance
R_N = 1
R_DEPTO = 2
R_ALCANCE = 3
R_NOMBRE = 4
R_SUBSECTOR = 5
R_TEMATICA = 6
R_PROBLEMATICA = 7
R_RIESGO_DESC = 8
R_RIESGO_INICIAL = 9
R_VALIDACION = 16
R_RESUMEN = 21
R_SEMANA_INI = 22
R_SEMANA_FIN = 37
R_RIESGO_ACTUAL = 38

# Catálogos (fuente: core.cat_* en Neon, leídos en modo sólo lectura)
PRIORIDAD_ID = {"urgente": 1, "moderado": 2, "bajo": 3}
TEMATICA_ID = {
    "infraestructura": 1,
    "ordenamiento y acceso territorial": 2,
    "ordenanamiento y acceso territorial": 2,  # errata del Excel
    "normatividad": 3,
    "distribucion de beneficios": 4,
    "gobernanza": 5,
    "impactos de terceros": 6,
    # valores del Reporte de avance que NO están en core.cat_tematicas:
    "recursos y regulacion": None,
    "socio-ambiental": None,
}
ESTADO_HITO_ID = {
    "cumplido": 4,
    "desestimado": 5,
    # "no cumplido" no existe en core.cat_estados_hito
    "no cumplido": None,
}


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def norm(texto: Any) -> str:
    """Minúsculas, sin tildes, espacios colapsados."""
    if texto is None:
        return ""
    s = str(texto)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def limpiar(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s != "" else None
    return v


def numero_entero(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and float(v).is_integer():
        return int(v)
    return None


def parse_fecha(v: Any) -> dict:
    """Devuelve {raw, iso, estado}. No estima: si no hay fecha completa, lo dice."""
    if v is None:
        return {"raw": None, "iso": None, "estado": "sin_dato"}
    if isinstance(v, dt.datetime):
        return {
            "raw": v.isoformat(sep=" "),
            "iso": v.date().isoformat(),
            "estado": "fecha",
        }
    if isinstance(v, dt.date):
        return {"raw": v.isoformat(), "iso": v.isoformat(), "estado": "fecha"}
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = float(v)
        if n.is_integer() and 1900 <= int(n) <= 2100:
            return {"raw": v, "iso": None, "estado": "solo_anio"}
        return {"raw": v, "iso": None, "estado": "numero_no_fecha"}
    s = str(v).strip()
    if s == "":
        return {"raw": None, "iso": None, "estado": "sin_dato"}
    low = s.lower()
    if s in {"-", "–", "—"}:
        return {"raw": s, "iso": None, "estado": "sin_dato"}
    if low in {"no aplica", "n/a", "na"}:
        return {"raw": s, "iso": None, "estado": "no_aplica"}
    m = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", s)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        try:
            return {"raw": s, "iso": dt.date(y, mo, d).isoformat(), "estado": "fecha"}
        except ValueError:
            return {"raw": s, "iso": None, "estado": "fecha_invalida"}
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        try:
            return {"raw": s, "iso": dt.date(y, mo, d).isoformat(), "estado": "fecha"}
        except ValueError:
            return {"raw": s, "iso": None, "estado": "fecha_invalida"}
    tokens = re.findall(r"\d{1,2}[./-]\d{1,2}[./-]\d{4}", s)
    if len(tokens) >= 2:
        return {"raw": s, "iso": None, "estado": "fecha_multiple"}
    if re.fullmatch(r"\d{4}", s):
        return {"raw": s, "iso": None, "estado": "solo_anio"}
    if re.search(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", s):
        return {"raw": s, "iso": None, "estado": "texto_no_fecha"}
    return {"raw": s, "iso": None, "estado": "no_reconocida"}


def mapear_tematica(raw: Any) -> dict:
    if raw is None:
        return {"raw": None, "id": None, "estado": "sin_dato"}
    k = norm(raw)
    if k in TEMATICA_ID:
        if TEMATICA_ID[k] is None:
            return {"raw": raw, "id": None, "estado": "sin_catalogo"}
        return {"raw": raw, "id": TEMATICA_ID[k], "estado": "mapeada"}
    return {"raw": raw, "id": None, "estado": "desconocida"}


def mapear_prioridad(raw: Any) -> dict:
    if raw is None:
        return {"raw": None, "id": None, "estado": "sin_dato"}
    k = norm(raw)
    if k in PRIORIDAD_ID:
        return {"raw": limpiar(raw), "id": PRIORIDAD_ID[k], "estado": "mapeada"}
    return {"raw": limpiar(raw), "id": None, "estado": "desconocida"}


def mapear_estado_hito(raw: Any) -> dict:
    if raw is None:
        return {"raw": None, "id": None, "estado": "sin_dato"}
    k = norm(raw)
    if k in ESTADO_HITO_ID:
        if ESTADO_HITO_ID[k] is None:
            return {"raw": limpiar(raw), "id": None, "estado": "sin_catalogo"}
        return {"raw": limpiar(raw), "id": ESTADO_HITO_ID[k], "estado": "mapeada"}
    return {"raw": limpiar(raw), "id": None, "estado": "desconocida"}


def mapa_merges(ws) -> dict[tuple[int, int], Any]:
    """Valor efectivo de toda celda cubierta por una fusión (el del extremo superior izquierdo).

    En Excel el valor de una celda fusionada aplica a todo el rango. openpyxl
    sólo lo devuelve en la celda superior izquierda; este mapa lo expande para
    leer, por ejemplo, un 'Responsable del Hito' que cubre varios hitos.
    """
    out: dict[tuple[int, int], Any] = {}
    for rango in ws.merged_cells.ranges:
        valor = ws.cell(rango.min_row, rango.min_col).value
        for r in range(rango.min_row, rango.max_row + 1):
            for c in range(rango.min_col, rango.max_col + 1):
                out[(r, c)] = valor
    return out


def primer_no_vacio(
    ws, fila_ini: int, fila_fin: int, col: int, merges: dict | None = None
) -> Any:
    for r in range(fila_ini, fila_fin + 1):
        v = limpiar(ws.cell(r, col).value)
        if v is None and merges is not None:
            v = limpiar(merges.get((r, col)))
        if v is not None:
            return v
    return None


# ---------------------------------------------------------------------------
# Lectura de bloques
# ---------------------------------------------------------------------------
def detectar_bloques(ws) -> list[tuple[int, int]]:
    """Bloques por E (Nombre de Caso). Incluye casos sin número."""
    starts = [
        r
        for r in range(3, ws.max_row + 1)
        if limpiar(ws.cell(r, C_NOMBRE).value) is not None
    ]
    bloques = []
    for i, r0 in enumerate(starts):
        r1 = starts[i + 1] - 1 if i + 1 < len(starts) else ws.max_row
        bloques.append((r0, r1))
    return bloques


def detectar_bloques_por_a(ws) -> list[int]:
    return [
        r
        for r in range(3, ws.max_row + 1)
        if numero_entero(ws.cell(r, C_N).value) is not None
    ]


def leer_metadatos(wb) -> dict[int, dict]:
    """Mapa fila_excel_principal_menos_1 -> metadatos.

    La hoja METADATOS replica el mismo alto de bloque que la hoja principal,
    desplazada una fila hacia arriba (su fila 2 es la fila 3 del operativo).
    Es una alineación posicional: no hay clave real entre ambas hojas.
    """
    ws = wb[HOJA_META]
    out = {}
    for r in range(2, ws.max_row + 1):
        nombre = limpiar(ws.cell(r, M_NOMBRE).value)
        fecha = ws.cell(r, M_FECHA).value
        codigo = limpiar(ws.cell(r, M_CODIGO).value)
        if nombre is None and fecha is None and codigo is None:
            continue
        out[r] = {
            "codigo_caso": codigo,
            "fecha_registro": parse_fecha(fecha),
            "departamento": limpiar(ws.cell(r, M_DEPTO).value),
            "sectorista": limpiar(ws.cell(r, M_SECTORISTA).value),
            "prioridad": limpiar(ws.cell(r, M_PRIORIDAD).value),
            "nombre_oficial": nombre,
            "fila_metadatos": r,
        }
    return out


def leer_reporte(wb) -> dict[int, dict]:
    """Bloques del Reporte de avance por N° (1..31)."""
    ws = wb[HOJA_REPORTE]
    starts = [
        r
        for r in range(2, ws.max_row + 1)
        if numero_entero(ws.cell(r, R_N).value) is not None
    ]
    out = {}
    for i, r0 in enumerate(starts):
        r1 = starts[i + 1] - 1 if i + 1 < len(starts) else ws.max_row
        n = numero_entero(ws.cell(r0, R_N).value)
        semanales = sum(
            1
            for c in range(R_SEMANA_INI, R_SEMANA_FIN + 1)
            for r in range(r0, r1 + 1)
            if limpiar(ws.cell(r, c).value) is not None
        )
        validaciones = []
        for r in range(r0, r1 + 1):
            v = limpiar(ws.cell(r, R_VALIDACION).value)
            if v is not None:
                validaciones.append(str(v))
        out[n] = {
            "fila_inicio": r0,
            "fila_fin": r1,
            "alcance_geografico_raw": limpiar(ws.cell(r0, R_ALCANCE).value),
            "subsector_raw": limpiar(ws.cell(r0, R_SUBSECTOR).value),
            "tematica_raw": limpiar(ws.cell(r0, R_TEMATICA).value),
            "problematica_resumen": limpiar(
                primer_no_vacio(ws, r0, r1, R_PROBLEMATICA)
            ),
            "riesgo_descripcion": limpiar(primer_no_vacio(ws, r0, r1, R_RIESGO_DESC)),
            "riesgo_inicial_raw": limpiar(
                primer_no_vacio(ws, r0, r1, R_RIESGO_INICIAL)
            ),
            "riesgo_actual_raw": limpiar(primer_no_vacio(ws, r0, r1, R_RIESGO_ACTUAL)),
            "validacion_hito_raw": validaciones[0] if validaciones else None,
            "resumen_ejecutivo": limpiar(primer_no_vacio(ws, r0, r1, R_RESUMEN)),
            "semanas_con_dato": semanales,
        }
    return out


def construir_caso(
    ws,
    r0: int,
    r1: int,
    meta: dict | None,
    reporte: dict | None,
    adv_globales: list,
    merges: dict,
) -> dict:
    advertencias: list[str] = []

    n = numero_entero(ws.cell(r0, C_N).value)
    nombre = limpiar(ws.cell(r0, C_NOMBRE).value)

    def eff(r: int, col: int) -> Any:
        """Valor crudo o, si está fusionada, el valor de la fusión."""
        return (
            limpiar(ws.cell(r, col).value)
            if limpiar(ws.cell(r, col).value) is not None
            else limpiar(merges.get((r, col)))
        )

    # Campos de caso A..K con relleno hacia abajo (las celdas están fusionadas;
    # se toma el primer valor no vacío del bloque).
    def campo(col: int) -> Any:
        return primer_no_vacio(ws, r0, r1, col, merges)

    analisis_celda = None
    analisis_url = None
    for r in range(r0, r1 + 1):
        c = ws.cell(r, C_ANALISIS)
        if limpiar(c.value) is not None or (c.hyperlink is not None):
            analisis_celda = limpiar(c.value)
            if c.hyperlink is not None and c.hyperlink.target:
                analisis_url = c.hyperlink.target
            break

    prioridad = mapear_prioridad(campo(C_PRIORIDAD))

    # ---- Demandas (L) -----------------------------------------------------
    demandas = []
    for r in range(r0, r1 + 1):
        texto = limpiar(ws.cell(r, C_DEMANDA).value)
        if texto is None:
            continue
        tem = mapear_tematica(ws.cell(r, C_TEMATICA).value)
        demandas.append(
            {
                "fila": r,
                "texto": texto,
                "tematica": tem,
                "destino": "core.demandas.descripcion_demanda",
                "destino_tematica": "core.demandas.tematica_id",
            }
        )
        if tem["estado"] == "sin_dato":
            advertencias.append(
                f"Demanda de la fila {r} sin Temática (M vacía); no se hereda."
            )

    # ---- Acciones (N) y su span ------------------------------------------
    inicios_accion = [
        r for r in range(r0, r1 + 1) if limpiar(ws.cell(r, C_ACCION).value) is not None
    ]
    acciones = []
    for i, ra in enumerate(inicios_accion):
        rfin = (inicios_accion[i + 1] - 1) if i + 1 < len(inicios_accion) else r1
        accidentales = []
        for c in (C_MEDIOS, C_AREA, C_PUNTO_FOCAL, C_DOCUMENTOS):
            if eff(ra, c) is None:
                extra = primer_no_vacio(ws, ra + 1, rfin, c, merges)
                if extra is not None:
                    accidentales.append(
                        {
                            "columna": c,
                            "fila": _fila_de(ws, ra + 1, rfin, c, merges),
                            "valor": extra,
                        }
                    )
        acciones.append(
            {
                "fila": ra,
                "fila_fin": rfin,
                "accion": eff(ra, C_ACCION),
                "medios_verificacion_raw": primer_no_vacio(
                    ws, ra, rfin, C_MEDIOS, merges
                ),
                "area_responsable_raw": primer_no_vacio(ws, ra, rfin, C_AREA, merges),
                "punto_focal_raw": primer_no_vacio(ws, ra, rfin, C_PUNTO_FOCAL, merges),
                "documentos_raw": primer_no_vacio(ws, ra, rfin, C_DOCUMENTOS, merges),
                "hitos": [],
                "valores_extra_en_span": accidentales,
            }
        )

    # ---- Hitos (S) -------------------------------------------------------
    hitos = []
    hitos_sin_accion = []
    for r in range(r0, r1 + 1):
        etiqueta = limpiar(ws.cell(r, C_HITO).value)
        if etiqueta is None:
            continue
        accion_destino = None
        for a in acciones:
            if a["fila"] <= r:
                accion_destino = a
        if accion_destino is None and acciones:
            # Hay casos con los hitos escritos antes de su única/primera acción
            # (caso de la fila 74). Se asigna a la primera acción y se declara,
            # en lugar de perder el hito.
            accion_destino = acciones[0]
            advertencias.append(
                f"Hito {etiqueta!r} de la fila {r} precede a la primera acción "
                f"(fila {acciones[0]['fila']}); se asigna a esa primera acción."
            )
        hito = {
            "fila": r,
            "codigo_hito": str(etiqueta),
            "descripcion_hito": eff(r, C_DESC_HITO),
            "responsable_raw": eff(r, C_RESP_HITO),
            "fecha_planificada": parse_fecha(eff(r, C_FECHA_PLAN)),
            "fecha_real": parse_fecha(eff(r, C_FECHA_REAL)),
            "estado": mapear_estado_hito(eff(r, C_ESTADO)),
            "destino": {
                "codigo_hito": "core.hitos_compromiso.codigo_hito",
                "descripcion_hito": "core.hitos_compromiso.descripcion_hito",
                "fecha_planificada": "core.hitos_compromiso.fecha_vencimiento",
                "fecha_real": "core.hitos_compromiso.fecha_real",
                "estado": "core.hitos_compromiso.estado_id",
                "responsable_raw": None,  # no existe columna
            },
        }
        if accion_destino is not None:
            accion_destino["hitos"].append(hito)
        else:
            hitos_sin_accion.append(hito)
            advertencias.append(
                f"Hito {etiqueta!r} de la fila {r} no tiene ninguna acción en el caso."
            )
        hitos.append(hito)

        for campo_fecha, etiqueta_f in (
            (hito["fecha_planificada"], "Fecha Planificada"),
            (hito["fecha_real"], "Fecha Real"),
        ):
            if campo_fecha["estado"] not in ("fecha", "sin_dato"):
                advertencias.append(
                    f"Hito fila {r}: {etiqueta_f} = {campo_fecha['raw']!r} -> {campo_fecha['estado']} (no se convierte a fecha)."
                )
        if hito["estado"]["estado"] == "sin_catalogo":
            advertencias.append(
                f"Hito fila {r}: Estado Actual = {hito['estado']['raw']!r} no existe en core.cat_estados_hito."
            )

    # Acciones sin hito
    for a in acciones:
        if not a["hitos"]:
            advertencias.append(
                f"Acción de la fila {a['fila']} sin ningún hito (S vacía en su span)."
            )
        if a["valores_extra_en_span"]:
            advertencias.append(
                f"Acción fila {a['fila']}: hay valores en filas posteriores del span {a['valores_extra_en_span']}."
            )
        # La regla dice que toda acción empieza en fila con Hito 1
        if a["hitos"] and norm(a["hitos"][0]["codigo_hito"]) != "hito 1":
            advertencias.append(
                f"Acción fila {a['fila']}: su primer hito es {a['hitos'][0]['codigo_hito']!r}, no 'Hito 1'."
            )

    # Descripciones de hito sin etiqueta S
    for r in range(r0, r1 + 1):
        if (
            limpiar(ws.cell(r, C_DESC_HITO).value) is not None
            and limpiar(ws.cell(r, C_HITO).value) is None
        ):
            advertencias.append(
                f"Fila {r}: hay 'Descripción del Hito' ({str(limpiar(ws.cell(r, C_DESC_HITO).value))[:50]!r}) sin etiqueta en S; no cuenta como hito."
            )

    meta = meta or {}
    codigo = meta.get("codigo_caso")
    if codigo is None:
        advertencias.append(
            "Caso sin Código de Caso en METADATOS CASOS (el N° del Excel no es clave)."
        )

    timestamp = limpiar(campo(C_TIMESTAMP))
    if timestamp is not None and timestamp.lower() not in ("actualizado",):
        advertencias.append(
            f"Columna H = {timestamp!r}: es un estado, no una marca de tiempo."
        )

    caso = {
        "orden": None,  # se completa luego
        "numero_excel": n,
        "codigo_caso": codigo,
        "nombre_oficial_metadatos": meta.get("nombre_oficial"),
        "nombre_caso_excel": nombre,
        "fecha_registro": meta.get(
            "fecha_registro", {"raw": None, "iso": None, "estado": "sin_dato"}
        ),
        "departamento_raw": meta.get("departamento") or campo(C_DEPTO),
        "sectorista_raw": meta.get("sectorista") or campo(C_SECTORISTA),
        "prioridad": prioridad,
        "narrativa_cronologica": campo(C_NARRATIVA),
        "analisis_canva": {
            "etiqueta": analisis_celda,
            "url": analisis_url,
            "destino": None,
        },
        "timestamp_estado": timestamp,
        "descripcion_riesgo": campo(C_RIESGO),
        "actores_estado_raw": campo(C_ACTORES_ESTADO),
        "actores_sociedad_raw": campo(C_ACTORES_SOCIEDAD),
        "fila_inicio": r0,
        "fila_fin": r1,
        "demandas": demandas,
        "acciones": acciones,
        "hitos_sin_accion": hitos_sin_accion,
        "reporte_avance": reporte,
        "advertencias": advertencias,
    }

    if caso["demandas"] and caso["fecha_registro"]["estado"] == "solo_anio":
        pass
    return caso


def _fila_de(
    ws, ini: int, fin: int, col: int, merges: dict | None = None
) -> int | None:
    for r in range(ini, fin + 1):
        if limpiar(ws.cell(r, col).value) is not None:
            return r
        if merges is not None and limpiar(merges.get((r, col))) is not None:
            return r
    return None


# ---------------------------------------------------------------------------
# Hojas auxiliares: sólo conteos para el resumen (no se importan aquí)
# ---------------------------------------------------------------------------
def contar_hojas_auxiliares(wb) -> dict:
    out = {}

    ws = wb[HOJA_ALERTAS]
    out["alertas"] = {
        "filas_con_codigo_reporte": sum(
            1
            for r in range(2, ws.max_row + 1)
            if limpiar(ws.cell(r, 2).value) is not None
        ),
        "filas_con_titulo": sum(
            1
            for r in range(2, ws.max_row + 1)
            if limpiar(ws.cell(r, 9).value) is not None
        ),
        "tipos": _conteo(ws, 1, 2),
    }

    ws = wb[HOJA_REUNIONES]
    out["reuniones"] = {
        "filas_con_tipo": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 1).value) is not None
        ),
        "filas_con_titulo": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 8).value) is not None
        ),
        "tipos": _conteo(ws, 1, 3),
        "banderas": {
            "asistencia_true": sum(
                1 for r in range(3, ws.max_row + 1) if ws.cell(r, 9).value is True
            ),
            "am_true": sum(
                1 for r in range(3, ws.max_row + 1) if ws.cell(r, 10).value is True
            ),
            "relatoria_true": sum(
                1 for r in range(3, ws.max_row + 1) if ws.cell(r, 11).value is True
            ),
            "publicacion_true": sum(
                1 for r in range(3, ws.max_row + 1) if ws.cell(r, 12).value is True
            ),
        },
    }

    ws = wb[HOJA_DVPA]
    out["dvpa"] = {
        "filas_con_nombre": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 7).value) is not None
        ),
        "filas_con_dni": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 8).value) is not None
        ),
        "filas_con_capacidades": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 21).value) is not None
        ),
        "filas_con_postura": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 20).value) is not None
        ),
        "posturas": _conteo(ws, 20, 3),
        "perfiles": _conteo(ws, 19, 3),
    }

    ws = wb[HOJA_DVMYPE]
    out["dvmype"] = {
        "filas_de_datos": sum(
            1
            for r in range(3, ws.max_row + 1)
            if limpiar(ws.cell(r, 1).value) is not None
        ),
        "celdas_por_confirmar": sum(
            1
            for r in range(1, ws.max_row + 1)
            for c in range(1, ws.max_column + 1)
            if isinstance(ws.cell(r, c).value, str)
            and "(por confirmar)" in ws.cell(r, c).value.lower()
        ),
    }
    return out


def _conteo(ws, col: int, desde: int) -> dict:
    out: dict[str, int] = {}
    for r in range(desde, ws.max_row + 1):
        v = limpiar(ws.cell(r, col).value)
        if v is not None:
            k = str(v)
            out[k] = out.get(k, 0) + 1
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    if not os.path.exists(XLSX):
        print(f"NO SE ENCUENTRA EL XLSX: {XLSX}")
        return 2

    wb = load_workbook(XLSX, data_only=True)
    ws = wb[HOJA]

    meta = leer_metadatos(wb)
    reporte = leer_reporte(wb)

    bloques = detectar_bloques(ws)
    bloques_a = detectar_bloques_por_a(ws)
    merges = mapa_merges(ws)

    adv_globales: list[str] = []
    casos = []
    for idx, (r0, r1) in enumerate(bloques, start=1):
        m = meta.get(r0 - 1)
        if m is None:
            adv_globales.append(
                f"Fila {r0}: no hay metadatos alineados en METADATOS CASOS fila {r0 - 1}."
            )
        n = numero_entero(ws.cell(r0, C_N).value)
        rep = reporte.get(n) if n is not None and n in reporte else None
        caso = construir_caso(ws, r0, r1, m, rep, adv_globales, merges)
        caso["orden"] = idx
        casos.append(caso)

    # Totales
    tot_dem = sum(len(c["demandas"]) for c in casos)
    tot_acc = sum(len(c["acciones"]) for c in casos)
    hitos_en_casos = sum(len(a["hitos"]) for c in casos for a in c["acciones"])
    hitos_sueltos = sum(len(c["hitos_sin_accion"]) for c in casos)
    tot_hit = hitos_en_casos + hitos_sueltos

    # Reparto de hitos: comprobar que ninguno quedó fuera
    hitos_filas = sum(
        1
        for r in range(3, ws.max_row + 1)
        if limpiar(ws.cell(r, C_HITO).value) is not None
    )

    b1 = casos[0]
    b1_dem = len(b1["demandas"])
    b1_acc = len(b1["acciones"])
    b1_hit = sum(len(a["hitos"]) for a in b1["acciones"])

    esperado = {"demandas": 23, "acciones": 56, "hitos": 111}
    cuadra = (
        tot_dem == esperado["demandas"]
        and tot_acc == esperado["acciones"]
        and tot_hit == esperado["hitos"]
    )
    # El bloque 1 real es 7/5/13. El enunciado decía 6 demandas; se comprueba
    # contra la realidad y se declara la discrepancia en la nota.
    bloque1_ok = (b1_dem, b1_acc, b1_hit) == (7, 5, 13)
    bloque1_enunciado = (b1_dem, b1_acc, b1_hit) == (6, 5, 13)

    # No mapeado / declaraciones (con conteos reales)
    codigos = [c["codigo_caso"] for c in casos]
    sin_codigo = [c for c in casos if c["codigo_caso"] is None]
    demandas_sin_tematica = [
        {
            "caso": c["codigo_caso"] or f"N°{c['numero_excel']}",
            "fila": d["fila"],
            "texto": d["texto"][:60],
        }
        for c in casos
        for d in c["demandas"]
        if d["tematica"]["estado"] == "sin_dato"
    ]
    acciones_sin_hito = [
        {
            "caso": c["codigo_caso"] or f"N°{c['numero_excel']}",
            "fila": a["fila"],
            "accion": str(a["accion"])[:60],
        }
        for c in casos
        for a in c["acciones"]
        if not a["hitos"]
    ]
    estados_sin_catalogo = [
        {
            "caso": c["codigo_caso"] or f"N°{c['numero_excel']}",
            "fila": h["fila"],
            "valor": h["estado"]["raw"],
        }
        for c in casos
        for a in c["acciones"]
        for h in a["hitos"]
        if h["estado"]["estado"] == "sin_catalogo"
    ]
    fechas_no_fecha = [
        {
            "caso": c["codigo_caso"] or f"N°{c['numero_excel']}",
            "fila": h["fila"],
            "campo": campo,
            "raw": h[campo]["raw"],
            "estado": h[campo]["estado"],
        }
        for c in casos
        for a in c["acciones"]
        for h in a["hitos"]
        for campo in ("fecha_planificada", "fecha_real")
        if h[campo]["estado"] not in ("fecha", "sin_dato")
    ]
    hitos_con_responsable = sum(
        1
        for c in casos
        for a in c["acciones"]
        for h in a["hitos"]
        if h["responsable_raw"] is not None
    )
    canva_urls = [
        c["analisis_canva"]["url"] for c in casos if c["analisis_canva"]["url"]
    ]
    canva_duplicadas = sorted({u for u in canva_urls if canva_urls.count(u) > 1})

    no_mapeado = [
        {
            "elemento": "Código de Caso",
            "detalle": f"{len(sin_codigo)} de {len(casos)} casos no tienen código en METADATOS CASOS",
            "casos": [
                {
                    "n": c["numero_excel"],
                    "fila": c["fila_inicio"],
                    "nombre": c["nombre_caso_excel"],
                }
                for c in sin_codigo
            ],
            "destino": None,
        },
        {
            "elemento": "Análisis de Caso (Canva), columna G",
            "detalle": f"{len(canva_urls)} hipervínculos a carpetas de Google Drive; es un enlace, no texto, y no existe columna de destino",
            "enlaces_duplicados": canva_duplicadas,
            "destino": "core.casos.link_reporte_pdf (discutible) / sin columna propia",
        },
        {
            "elemento": "Responsable del Hito, columna U",
            "detalle": f"{hitos_con_responsable} hitos traen responsable; core.hitos_compromiso no tiene columna de responsable",
            "destino": None,
        },
        {
            "elemento": "Medios de Verificaciones, columna O",
            "detalle": "es una instrucción ('Acción 1: Adjuntar'), no un adjunto ni una URI",
            "destino": "core.hitos_compromiso.descripcion_evidencia / link_evidencia (previo adjuntar)",
        },
        {
            "elemento": "Documentos / Archivos / Otros, columna R",
            "detalle": "etiqueta ('Documentos'), no un archivo",
            "destino": "core.documentos (previo alta del archivo)",
        },
        {
            "elemento": "Timestamp de última actualización, columna H",
            "detalle": "contiene estados ('No aplica', 'Pendiente', 'Actualizado'), no fechas",
            "destino": "core.casos.fecha_ultima_actualizacion (no aplicable)",
        },
        {
            "elemento": "Temática de la demanda, columna M",
            "detalle": f"{len(demandas_sin_tematica)} demandas sin temática; no se hereda de la fila anterior",
            "destino": "core.demandas.tematica_id",
        },
        {
            "elemento": "Estado Actual del hito, columna X",
            "detalle": f"{len(estados_sin_catalogo)} hitos con 'No Cumplido', valor ausente de core.cat_estados_hito",
            "destino": "core.hitos_compromiso.estado_id",
        },
        {
            "elemento": "Fechas no convertibles",
            "detalle": f"{len(fechas_no_fecha)} valores de fecha no son fechas completas",
            "valores": fechas_no_fecha,
            "destino": "core.hitos_compromiso.fecha_vencimiento / fecha_real",
        },
        {
            "elemento": "Acciones sin hito",
            "detalle": f"{len(acciones_sin_hito)} acciones no tienen ningún hito",
            "acciones": acciones_sin_hito,
            "destino": "core.compromisos + core.hitos_compromiso",
        },
        {
            "elemento": "Desglose 3P de la demanda",
            "detalle": "el Excel trae una sola columna de texto; problema/propuesta/pedido no existen",
            "destino": "core.demandas.problema_3p / propuesta_3p / pedido_3p",
        },
        {
            "elemento": "Seguimiento semanal de nudos críticos",
            "detalle": "16 columnas en 'Reporte de avance'; no hay tabla en la base",
            "destino": None,
        },
        {
            "elemento": "Nivel de Riesgo Inicial y Actual",
            "detalle": "dos escalas en 'Reporte de avance' (Inicial/Actual) con valores fuera de core.cat_niveles_riesgo",
            "destino": "core.casos.nivel_riesgo_id (sólo el actual)",
        },
        {
            "elemento": "Capacidades 1-5 y Postura vs PRODUCE (hoja DVPA)",
            "detalle": "no hay columnas en core.actores; 'Postura' sólo se parece a casos_actores.posicion",
            "destino": None,
        },
        {
            "elemento": "Sectorista, columna C",
            "detalle": "es un nombre; core.usuarios.nombre existe y la FK es punto_focal_usuario_id",
            "destino": "core.usuarios + core.casos.punto_focal_usuario_id",
        },
        {
            "elemento": "Prioridad de Atención vs Nivel de Riesgo, columna D",
            "detalle": "D sólo trae Urgente/Moderado/Bajo (prioridad); el riesgo vive en otra hoja y con otra escala",
            "destino": "core.casos.prioridad_id",
        },
    ]

    resumen = {
        "fuente": os.path.relpath(XLSX, REPO).replace("\\", "/"),
        "generado_por": "scripts/matriz/parse_matriz.py",
        "regla_bloques": "Bloque = fila con 'Nombre de Caso' (E) no vacía; los campos A..K se rellenan hacia abajo.",
        "dimensiones_hoja": {
            "filas": ws.max_row,
            "columnas": ws.max_column,
            "merges": len(ws.merged_cells.ranges),
        },
        "conteos": {
            "casos": len(casos),
            "casos_con_codigo": sum(1 for c in casos if c["codigo_caso"]),
            "casos_sin_codigo": len(sin_codigo),
            "bloques_por_a": len(bloques_a),
            "bloques_por_e": len(bloques),
            "demandas": tot_dem,
            "acciones": tot_acc,
            "hitos": tot_hit,
            "hitos_en_acciones": hitos_en_casos,
            "hitos_sin_accion": hitos_sueltos,
            "hitos_filas_etiquetadas": hitos_filas,
        },
        "validacion": {
            "esperado": esperado,
            "obtenido": {"demandas": tot_dem, "acciones": tot_acc, "hitos": tot_hit},
            "cuadra": cuadra,
            "bloque_1": {
                "esperado_por_enunciado": {"demandas": 6, "acciones": 5, "hitos": 13},
                "obtenido": {"demandas": b1_dem, "acciones": b1_acc, "hitos": b1_hit},
                "cuadra_con_realidad": bloque1_ok,
                "cuadra_con_enunciado": bloque1_enunciado,
                "nota": (
                    "El bloque 1 (filas 3..15) tiene 7 demandas, no 6: las filas 3, 4, 5, 6, 9, 12 y 15 "
                    "traen texto distinto en L, sin celdas fusionadas. El total de 23 demandas se reparte "
                    "7+3+6+3+4 entre los casos 1, 2, 8, 11 y el bloque duplicado '15'. El desvío es del "
                    "enunciado, no del parser."
                ),
            },
            "bloques_a_contra_e": {
                "por_a": len(bloques_a),
                "por_e": len(bloques),
                "casos_que_a_engulle": [
                    {
                        "fila": 118,
                        "nombre": "Presunta depredación de Anchoveta por alta pesca juvenil",
                    },
                    {
                        "fila": 127,
                        "nombre": "Disconformidad ciudadana en Chilca en horarios de asistencia",
                    },
                    {
                        "fila": 132,
                        "nombre": "Mortandad masiva de truchas (~2 millones) en Pariahuanca, Junín",
                    },
                ],
                "nota": (
                    "Usar la columna A como delimitador deja 34 bloques y atribuye las acciones de estas "
                    "tres filas a los casos 31 y al bloque '15' duplicado. La columna E delimita 37 casos "
                    "y conserva los totales 23/56/111."
                ),
            },
            "hitos_asignados": {
                "asignados_a_accion": hitos_en_casos,
                "filas_con_hito": hitos_filas,
                "cuadra": hitos_en_casos == hitos_filas,
            },
        },
        "no_mapeado": no_mapeado,
        "advertencias_globales": [
            "La numeración N° no es clave: existe un '15' duplicado en la fila 128 y faltan el 32 y los números de dos casos.",
            "METADATOS CASOS se alinea con la hoja principal por posición (su fila r-1 corresponde al caso que empieza en r); no hay clave real.",
            "Sólo 31 de 37 casos tienen Código de Caso.",
            "Los códigos del Excel no coinciden con core.casos.codigo_caso de Neon: de 31 códigos, 2 coinciden textualmente y ambos apuntan a otro caso (fuente: consulta de sólo lectura).",
            "El '15' duplicado comparte el mismo enlace de Canva que el caso 15 de la fila 48.",
        ],
    }

    salida = {
        "meta": resumen,
        "auxiliares": contar_hojas_auxiliares(wb),
        "casos": casos,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "casos.json"), "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=2)
    with open(
        os.path.join(OUT_DIR, "resumen_validacion.json"), "w", encoding="utf-8"
    ) as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=2)

    # ---- Impresión de validación ----------------------------------------
    print("=" * 78)
    print("PARSER MATRIZ DE CONFLICTOS · validación")
    print("=" * 78)
    print(
        f"Hoja: {HOJA} ({ws.max_row}x{ws.max_column}, {len(ws.merged_cells.ranges)} merges)"
    )
    print(f"Bloques por A: {len(bloques_a)}   Casos por E: {len(bloques)}")
    print("-" * 78)
    print(f"{'#':>3} {'código':<22} {'N°':>3} {'dem':>4} {'acc':>4} {'hit':>4}  nombre")
    for c in casos:
        n = "" if c["numero_excel"] is None else c["numero_excel"]
        print(
            f"{c['orden']:>3} {str(c['codigo_caso'] or '(sin código)'):<22} {str(n):>3} "
            f"{len(c['demandas']):>4} {len(c['acciones']):>4} "
            f"{sum(len(a['hitos']) for a in c['acciones']):>4}  {str(c['nombre_caso_excel'])[:38]}"
        )
    print("-" * 78)
    print(
        f"TOTAL casos={len(casos)}  demandas={tot_dem}  acciones={tot_acc}  hitos={tot_hit}"
    )
    print(
        f"Esperado          demandas={esperado['demandas']}  acciones={esperado['acciones']}  hitos={esperado['hitos']}"
    )
    print(f"CUADRA: {'SÍ' if cuadra else 'NO'}")
    print(
        f"Bloque 1: obtenido {b1_dem}/{b1_acc}/{b1_hit}  ·  realidad 7/5/13 -> {bloque1_ok}  ·  enunciado 6/5/13 -> {bloque1_enunciado}"
    )
    print(
        f"Hitos asignados a una acción: {hitos_en_casos}/{hitos_filas} (sin acción: {hitos_sueltos}) -> {resumen['validacion']['hitos_asignados']['cuadra']}"
    )
    print("-" * 78)
    print("Declaraciones (no mapeado):")
    for item in no_mapeado:
        print(f"  - {item['elemento']}: {item['detalle']}")
    print("-" * 78)
    print(f"Salida: {os.path.relpath(os.path.join(OUT_DIR, 'casos.json'), REPO)}")
    print(
        f"        {os.path.relpath(os.path.join(OUT_DIR, 'resumen_validacion.json'), REPO)}"
    )
    print("=" * 78)

    return 0 if cuadra else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
