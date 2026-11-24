#!/usr/bin/env python
"""Parser de las hojas auxiliares de la matriz de conflictos -> JSON.

Lee `docs/01_requisitos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx`
y emite `scripts/matriz/salida/hojas_auxiliares.json`.

No escribe en la base de datos. Es sólo lectura sobre el XLSX.

Hojas que procesa
-----------------
- `Seguimiento de Alertas`      -> lista `alertas` (101 registros).
- `Seguimiento de Reuniones`    -> lista `reuniones` (46 registros).
- `Reporte de avance de casos punt` -> listas `nudos` (118 celdas con nudo)
  y `bloques_reporte` (31 bloques, uno por caso).

Principio del proyecto: el dato ausente se declara, no se estima. Cuando un
valor no se puede tipar, se devuelve crudo y se añade una advertencia a
`advertencias_globales`.
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

HOJA_ALERTAS = "Seguimiento de Alertas"
HOJA_REUNIONES = "Seguimiento de Reuniones"
HOJA_REPORTE = "Reporte de avance de casos punt"

# ---------------------------------------------------------------------------
# Columnas (1-based)
# ---------------------------------------------------------------------------
# Seguimiento de Alertas
A_TIPO = 1
A_CODIGO_REPORTE = 2
A_CODIGO_CASO = 3
A_RESPONSABLE = 4
A_FECHA = 5
A_REGION = 6
A_PROVINCIA = 7
A_DISTRITO = 8
A_TITULO = 9
A_TIPO_ALERTA = 10
A_RESUMEN = 11
A_CONTENIDO = 12
A_CONCLUSIONES = 13
A_DOCUMENTO = 14

# Seguimiento de Reuniones
R_TIPO = 1
R_CODIGO = 2
R_SECTOR = 3
R_RESPONSABLE = 4
R_FECHA = 5
R_DEPARTAMENTO = 6
R_LUGAR = 7
R_TITULO = 8
R_ASISTENCIA = 9
R_AM = 10
R_RELATORIA = 11
R_PUBLICACION = 12
R_DOCUMENTOS = 13

# Reporte de avance de casos punt
RP_N = 1
RP_ALCANCE = 3
RP_NOMBRE = 4
RP_SUBSECTOR = 5
RP_TEMATICA = 6
RP_PROBLEMATICA = 7
RP_RIESGO_DESC = 8
RP_RIESGO_INICIAL = 9
RP_VALIDACION = 16
RP_RESUMEN = 21
RP_SEMANA_INI = 22  # primera columna de nudo (par)
RP_SEMANA_FIN = 37  # última columna de seguimiento (impar)
RP_RIESGO_ACTUAL = 38

# Número de pares «Nudo crítico» / «Seguimiento» (cols 22..37)
NUM_PARES_SEMANA = 8

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
# Errores de Excel que se tratan como dato ausente (verificado: el Resumen
# Ejecutivo de la fila 2 del Reporte es `#REF!`).
ERRORES_EXCEL = {"#REF!", "#N/A", "#VALUE!", "#DIV/0!", "#NAME?", "#NULL!", "#NUM!"}

# Meses en español (sin tilde, tras `norm`) -> número de mes.
MESES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

# Rango «del DD al DD de MES de YYYY» (mismo mes). El «de» previo al mes es
# opcional porque algunos rótulos de Seguimiento lo omiten («09 Marzo»).
_RE_MISMO_MES = re.compile(
    r"del\s+(\d{1,2})\s+al\s+(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+de\s+(\d{4})"
)
# Rango «del DD de MES al DD de MES de YYYY» (meses distintos).
_RE_DOS_MESES = re.compile(
    r"del\s+(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+al\s+(\d{1,2})"
    r"\s+(?:de\s+)?([a-z]+)\s+de\s+(\d{4})"
)

# Rango de fecha tipo «08-09/07/2026» (día-día/mes/año).
_RE_RANGO_FECHA = re.compile(r"\d{1,2}-\d{1,2}/\d{1,2}/\d{4}")

# Fecha simple «DD/MM/YYYY», «DD-MM-YYYY» o «DD.MM.YYYY».
_RE_FECHA_SIMPLE = re.compile(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})")

# Lista global de advertencias; se reinicia en `leer_hojas_auxiliares`.
_advertencias: list[str] = []


def _advertir(msg: str) -> None:
    """Añade una advertencia a la lista global."""
    _advertencias.append(msg)


def norm(texto: Any) -> str:
    """Minúsculas, sin tildes, espacios colapsados (para comparar, no almacenar)."""
    if texto is None:
        return ""
    s = str(texto)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def limpiar(v: Any) -> Any:
    """None si vacío o sólo espacios; colapsa espacios internos y saltos de línea.

    Para cadenas devuelve `str`; para otros tipos (fechas, números) devuelve el
    valor tal cual para no perder el tipo.
    """
    if v is None:
        return None
    if isinstance(v, str):
        s = re.sub(r"\s+", " ", v).strip()
        return s if s != "" else None
    return v


def numero_entero(v: Any) -> int | None:
    """Convierte un número (int o float entero) a int; None en otro caso."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and float(v).is_integer():
        return int(v)
    return None


def es_error_excel(v: Any) -> bool:
    """True si el valor es un error de Excel (`#REF!`, `#N/A`, ...)."""
    return isinstance(v, str) and v.strip().upper() in ERRORES_EXCEL


def _celda(ws, r: int, c: int, contexto: str = "") -> Any:
    """Lee una celda aplicando el filtro de errores de Excel.

    Si la celda contiene un error de Excel, se trata como `None` y se añade una
    advertencia. Devuelve el valor crudo (sin `limpiar`).
    """
    v = ws.cell(r, c).value
    if es_error_excel(v):
        _advertir(
            f"{contexto} (fila {r}, col {c}): celda con error de Excel "
            f"{v!r} tratada como ausente."
        )
        return None
    return v


def fecha_desde_celda(valor: Any) -> tuple[str | None, str | None, str]:
    """Tipa una celda de fecha -> `(iso, texto, estado)`.

    Estados: `fecha`, `rango`, `sin_dato`, `no_convertible`. Para un rango no se
    elige un día: `iso=None` y `texto` conserva el literal.
    """
    if valor is None:
        return (None, None, "sin_dato")
    if isinstance(valor, dt.datetime):
        return (valor.date().isoformat(), None, "fecha")
    if isinstance(valor, dt.date):
        return (valor.isoformat(), None, "fecha")
    s = str(valor).strip()
    if s == "":
        return (None, None, "sin_dato")
    if _RE_RANGO_FECHA.fullmatch(s):
        return (None, s, "rango")
    m = _RE_FECHA_SIMPLE.fullmatch(s)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        try:
            return (dt.date(y, mo, d).isoformat(), None, "fecha")
        except ValueError:
            return (None, s, "no_convertible")
    return (None, s, "no_convertible")


def normalizar_booleano(v: Any, contexto: str = "") -> bool | None:
    """Normaliza un booleano: `bool` tal cual, texto 'True'/'False' a bool real.

    Cualquier otro valor -> `None` + advertencia.
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        s = v.strip().lower()
        if s == "true":
            return True
        if s == "false":
            return False
    _advertir(f"{contexto}: valor booleano no reconocido {v!r} tratado como None.")
    return None


def parsear_rango_semana(rotulo: Any) -> tuple[str | None, str | None]:
    """Parsea el rango de fechas de un rótulo de semana -> `(desde, hasta)`.

    Acepta `del DD al DD de MES de YYYY` y `del DD de MES al DD de MES de YYYY`.
    Devuelve `(None, None)` si no se puede parsear.
    """
    if not rotulo:
        return (None, None)
    s = norm(rotulo)
    m = _RE_DOS_MESES.search(s)
    if m:
        d1, mes1, d2, mes2, y = m.groups()
        m1, m2 = MESES.get(mes1), MESES.get(mes2)
        if m1 and m2:
            try:
                return (
                    dt.date(int(y), m1, int(d1)).isoformat(),
                    dt.date(int(y), m2, int(d2)).isoformat(),
                )
            except ValueError:
                return (None, None)
    m = _RE_MISMO_MES.search(s)
    if m:
        d1, d2, mes, y = m.groups()
        mn = MESES.get(mes)
        if mn:
            try:
                return (
                    dt.date(int(y), mn, int(d1)).isoformat(),
                    dt.date(int(y), mn, int(d2)).isoformat(),
                )
            except ValueError:
                return (None, None)
    return (None, None)


# ---------------------------------------------------------------------------
# Lectura de hojas
# ---------------------------------------------------------------------------
def _leer_alertas(wb) -> list[dict]:
    """Hoja `Seguimiento de Alertas`: encabezado fila 1, datos desde fila 2."""
    ws = wb[HOJA_ALERTAS]
    alertas: list[dict] = []
    for r in range(2, ws.max_row + 1):
        tipo = limpiar(_celda(ws, r, A_TIPO, "Alertas"))
        if tipo is None:
            # Fila sin dato: la columna Tipo delimita el registro.
            continue

        codigo_reporte = limpiar(_celda(ws, r, A_CODIGO_REPORTE, "Alertas"))
        codigo_caso = limpiar(_celda(ws, r, A_CODIGO_CASO, "Alertas"))
        responsable_raw = limpiar(_celda(ws, r, A_RESPONSABLE, "Alertas"))
        fecha = _celda(ws, r, A_FECHA, "Alertas")
        region = limpiar(_celda(ws, r, A_REGION, "Alertas"))
        provincia = limpiar(_celda(ws, r, A_PROVINCIA, "Alertas"))
        distrito = limpiar(_celda(ws, r, A_DISTRITO, "Alertas"))
        titulo = limpiar(_celda(ws, r, A_TITULO, "Alertas"))
        tipo_alerta_raw = limpiar(_celda(ws, r, A_TIPO_ALERTA, "Alertas"))
        resumen = limpiar(_celda(ws, r, A_RESUMEN, "Alertas"))
        contenido = limpiar(_celda(ws, r, A_CONTENIDO, "Alertas"))
        conclusiones = limpiar(_celda(ws, r, A_CONCLUSIONES, "Alertas"))
        documento = limpiar(_celda(ws, r, A_DOCUMENTO, "Alertas"))

        # Normalizaciones (conservando el crudo).
        tipo_alerta_normalizado = None
        if tipo_alerta_raw is not None:
            tipo_alerta_normalizado = tipo_alerta_raw.strip().upper()

        responsable_normalizado = None
        if responsable_raw is not None:
            responsable_normalizado = re.sub(r"\s+", " ", responsable_raw).strip()

        fecha_iso, fecha_texto, fecha_estado = fecha_desde_celda(fecha)

        if titulo is None:
            _advertir(f"Alerta fila {r}: sin 'Titulo'.")

        alertas.append(
            {
                "fila": r,
                "tipo": tipo,
                "codigo_reporte": codigo_reporte,
                "caso_codigo_excel": codigo_caso,
                "requiere_vinculo_caso": codigo_caso is None,
                "responsable_raw": responsable_raw,
                "responsable_normalizado": responsable_normalizado,
                "fecha_iso": fecha_iso,
                "fecha_texto": fecha_texto,
                "fecha_estado": fecha_estado,
                "region": region,
                "provincia": provincia,
                "distrito": distrito,
                "titulo": titulo,
                "tipo_alerta_raw": tipo_alerta_raw,
                "tipo_alerta_normalizado": tipo_alerta_normalizado,
                "resumen_ejecutivo": resumen,
                "contenido": contenido,
                "conclusiones_recomendaciones": conclusiones,
                "documento": documento,
            }
        )
    return alertas


def _leer_reuniones(wb) -> list[dict]:
    """Hoja `Seguimiento de Reuniones`: título fila 1, encabezado fila 2, datos 3..48."""
    ws = wb[HOJA_REUNIONES]
    reuniones: list[dict] = []
    for r in range(3, ws.max_row + 1):
        # Fila con dato si alguna de las columnas 1..13 tiene valor.
        if all(limpiar(_celda(ws, r, c, "Reuniones")) is None for c in range(1, 14)):
            continue

        tipo_raw = limpiar(_celda(ws, r, R_TIPO, "Reuniones"))
        codigo = limpiar(_celda(ws, r, R_CODIGO, "Reuniones"))
        sector_raw = limpiar(_celda(ws, r, R_SECTOR, "Reuniones"))
        responsable_raw = limpiar(_celda(ws, r, R_RESPONSABLE, "Reuniones"))
        fecha = _celda(ws, r, R_FECHA, "Reuniones")
        departamento = limpiar(_celda(ws, r, R_DEPARTAMENTO, "Reuniones"))
        lugar = limpiar(_celda(ws, r, R_LUGAR, "Reuniones"))
        titulo = limpiar(_celda(ws, r, R_TITULO, "Reuniones"))
        asistencia = normalizar_booleano(
            _celda(ws, r, R_ASISTENCIA, "Reuniones"),
            f"Reuniones fila {r} col {R_ASISTENCIA}",
        )
        am = normalizar_booleano(
            _celda(ws, r, R_AM, "Reuniones"), f"Reuniones fila {r} col {R_AM}"
        )
        relatoria = normalizar_booleano(
            _celda(ws, r, R_RELATORIA, "Reuniones"),
            f"Reuniones fila {r} col {R_RELATORIA}",
        )
        publicacion = normalizar_booleano(
            _celda(ws, r, R_PUBLICACION, "Reuniones"),
            f"Reuniones fila {r} col {R_PUBLICACION}",
        )
        documentos = limpiar(_celda(ws, r, R_DOCUMENTOS, "Reuniones"))

        # Normalización del sector: «Mypes e Industria» -> «MYPE e Industria».
        sector_normalizado = sector_raw
        if sector_raw is not None and norm(sector_raw) == norm("Mypes e Industria"):
            sector_normalizado = "MYPE e Industria"

        fecha_iso, fecha_texto, fecha_estado = fecha_desde_celda(fecha)

        if tipo_raw is None or sector_raw is None or responsable_raw is None:
            _advertir(
                f"Reunión fila {r}: sin tipo/sector/responsable "
                f"(tipo={tipo_raw!r}, sector={sector_raw!r}, "
                f"responsable={responsable_raw!r})."
            )
        if fecha_estado == "sin_dato":
            _advertir(f"Reunión fila {r}: sin 'Fecha'.")

        reuniones.append(
            {
                "fila": r,
                "tipo_raw": tipo_raw,
                "codigo": codigo,
                "sector_raw": sector_raw,
                "sector_normalizado": sector_normalizado,
                "responsable_raw": responsable_raw,
                "fecha_iso": fecha_iso,
                "fecha_texto": fecha_texto,
                "fecha_estado": fecha_estado,
                "departamento": departamento,
                "lugar": lugar,
                "titulo": titulo,
                "asistencia": asistencia,
                "am": am,
                "relatoria": relatoria,
                "publicacion": publicacion,
                "documentos": documentos,
            }
        )
    return reuniones


def _primer_no_vacio(ws, r0: int, r1: int, c: int) -> Any:
    """Primer valor no vacío (con filtro de errores) de la columna `c` en el bloque."""
    for r in range(r0, r1 + 1):
        v = limpiar(_celda(ws, r, c, "Reporte"))
        if v is not None:
            return v
    return None


def _leer_nudos(wb) -> tuple[list[dict], list[dict], list[dict]]:
    """Hoja `Reporte de avance de casos punt`: bloques por N° y nudos por fila.

    Devuelve `(nudos, bloques_reporte, semanas)`.
    """
    ws = wb[HOJA_REPORTE]

    # Bloques delimitados por la columna 1 (N°) con valor.
    starts = [
        r
        for r in range(2, ws.max_row + 1)
        if numero_entero(_celda(ws, r, RP_N, "Reporte")) is not None
    ]

    # Rótulos de semana en el encabezado (fila 1), un par por semana.
    semanas: list[dict] = []
    for i in range(NUM_PARES_SEMANA):
        c = RP_SEMANA_INI + 2 * i
        rotulo_nudo = limpiar(_celda(ws, 1, c, "Reporte"))
        rotulo_seguimiento = limpiar(_celda(ws, 1, c + 1, "Reporte"))
        nudo_desde, nudo_hasta = parsear_rango_semana(rotulo_nudo)
        seg_desde, seg_hasta = parsear_rango_semana(rotulo_seguimiento)

        # Discrepancia entre las dos mitades del par (verificado en c36/c37).
        if (
            nudo_desde
            and seg_desde
            and (nudo_desde, nudo_hasta) != (seg_desde, seg_hasta)
        ):
            _advertir(
                f"Semana {i} (cols {c}/{c + 1}): rótulo de nudo y seguimiento "
                f"descuadrados. Nudo={rotulo_nudo!r} vs "
                f"Seguimiento={rotulo_seguimiento!r}."
            )

        semanas.append(
            {
                "indice": i,
                "col_nudo": c,
                "col_seguimiento": c + 1,
                "rotulo_nudo": rotulo_nudo,
                "rotulo_seguimiento": rotulo_seguimiento,
                "semana_desde": nudo_desde,
                "semana_hasta": nudo_hasta,
            }
        )

    bloques_reporte: list[dict] = []
    nudos: list[dict] = []

    for idx, r0 in enumerate(starts):
        r1 = starts[idx + 1] - 1 if idx + 1 < len(starts) else ws.max_row
        n = numero_entero(_celda(ws, r0, RP_N, "Reporte"))
        nombre = limpiar(_celda(ws, r0, RP_NOMBRE, "Reporte"))
        alcance = limpiar(_celda(ws, r0, RP_ALCANCE, "Reporte"))
        subsector = limpiar(_celda(ws, r0, RP_SUBSECTOR, "Reporte"))
        tematica = limpiar(_celda(ws, r0, RP_TEMATICA, "Reporte"))
        problematica = _primer_no_vacio(ws, r0, r1, RP_PROBLEMATICA)
        riesgo_desc = _primer_no_vacio(ws, r0, r1, RP_RIESGO_DESC)
        riesgo_inicial = _primer_no_vacio(ws, r0, r1, RP_RIESGO_INICIAL)
        riesgo_actual = _primer_no_vacio(ws, r0, r1, RP_RIESGO_ACTUAL)
        validacion = _primer_no_vacio(ws, r0, r1, RP_VALIDACION)
        resumen = _primer_no_vacio(ws, r0, r1, RP_RESUMEN)

        bloques_reporte.append(
            {
                "numero_excel": n,
                "fila_inicio": r0,
                "fila_fin": r1,
                "nombre_caso_reporte": nombre,
                "alcance_geografico_raw": alcance,
                "subsector_raw": subsector,
                "tematica_raw": tematica,
                "problematica_resumen": problematica,
                "riesgo_descripcion": riesgo_desc,
                "riesgo_inicial_raw": riesgo_inicial,
                "riesgo_actual_raw": riesgo_actual,
                "validacion_hito_raw": validacion,
                "resumen_ejecutivo": resumen,
            }
        )

        # Nudos a nivel de fila (coinciden con las filas de hitos).
        for r in range(r0, r1 + 1):
            for sem in semanas:
                c = sem["col_nudo"]
                nudo_val = limpiar(_celda(ws, r, c, "Reporte"))
                seg_val = limpiar(_celda(ws, r, c + 1, "Reporte"))
                if nudo_val is None and seg_val is None:
                    continue
                if nudo_val is not None and not isinstance(nudo_val, str):
                    _advertir(
                        f"Nudo fila {r} col {c}: valor no textual {nudo_val!r} "
                        f"devuelto crudo."
                    )
                if seg_val is not None and not isinstance(seg_val, str):
                    _advertir(
                        f"Seguimiento fila {r} col {c + 1}: valor no textual "
                        f"{seg_val!r} devuelto crudo."
                    )
                if sem["semana_desde"] is None:
                    _advertir(
                        f"Nudo fila {r} (bloque {n}, semana {sem['indice']}): "
                        f"sin semana_desde (rótulo no parseable)."
                    )
                nudos.append(
                    {
                        "fila": r,
                        "bloque_inicio": r0,
                        "numero_excel": n,
                        "nombre_caso_reporte": nombre,
                        "semana_indice": sem["indice"],
                        "col_nudo": c,
                        "col_seguimiento": c + 1,
                        "rotulo_nudo": sem["rotulo_nudo"],
                        "rotulo_seguimiento": sem["rotulo_seguimiento"],
                        "semana_desde": sem["semana_desde"],
                        "semana_hasta": sem["semana_hasta"],
                        "nudo": nudo_val,
                        "seguimiento": seg_val,
                    }
                )

    return nudos, bloques_reporte, semanas


def _validar_conteos(
    alertas: list[dict],
    reuniones: list[dict],
    nudos: list[dict],
    bloques_reporte: list[dict],
    semanas: list[dict],
) -> None:
    """Compara los conteos reales contra los esperados; informa, no revienta."""
    nudos_no_vacios = sum(1 for n in nudos if n["nudo"] is not None)
    seguimientos_no_vacios = sum(1 for n in nudos if n["seguimiento"] is not None)

    esperado = {
        "alertas": 101,
        "reuniones": 46,
        "nudos": 118,
        "seguimientos": 137,
        "bloques_reporte": 31,
        "pares_semana": 8,
    }
    obtenido = {
        "alertas": len(alertas),
        "reuniones": len(reuniones),
        "nudos": nudos_no_vacios,
        "seguimientos": seguimientos_no_vacios,
        "bloques_reporte": len(bloques_reporte),
        "pares_semana": len(semanas),
    }

    for clave in esperado:
        if obtenido[clave] != esperado[clave]:
            _advertir(
                f"Conteo {clave}: esperado {esperado[clave]}, obtenido "
                f"{obtenido[clave]} (diferencia {obtenido[clave] - esperado[clave]})."
            )


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------
def leer_hojas_auxiliares(xlsx_path: str) -> dict:
    """Devuelve {"alertas": [...], "reuniones": [...], "nudos": [...],
    "bloques_reporte": [...], "advertencias_globales": [...]}"""
    global _advertencias
    _advertencias = []

    wb = load_workbook(xlsx_path, data_only=True)

    alertas = _leer_alertas(wb)
    reuniones = _leer_reuniones(wb)
    nudos, bloques_reporte, semanas = _leer_nudos(wb)

    _validar_conteos(alertas, reuniones, nudos, bloques_reporte, semanas)

    return {
        "alertas": alertas,
        "reuniones": reuniones,
        "nudos": nudos,
        "bloques_reporte": bloques_reporte,
        "advertencias_globales": list(_advertencias),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    if not os.path.exists(XLSX):
        print(f"NO SE ENCUENTRA EL XLSX: {XLSX}")
        return 2

    resultado = leer_hojas_auxiliares(XLSX)

    alertas = resultado["alertas"]
    reuniones = resultado["reuniones"]
    nudos = resultado["nudos"]
    bloques = resultado["bloques_reporte"]
    adv = resultado["advertencias_globales"]

    nudos_no_vacios = sum(1 for n in nudos if n["nudo"] is not None)
    seguimientos_no_vacios = sum(1 for n in nudos if n["seguimiento"] is not None)

    # Escritura del JSON.
    os.makedirs(OUT_DIR, exist_ok=True)
    salida_path = os.path.join(OUT_DIR, "hojas_auxiliares.json")
    with open(salida_path, "w", encoding="utf-8") as fh:
        json.dump(resultado, fh, ensure_ascii=False, indent=1)

    # Resumen de conteos.
    print("=" * 78)
    print("HOJAS AUXILIARES · resumen")
    print("=" * 78)
    print(f"alertas:            {len(alertas)}")
    print(f"reuniones:          {len(reuniones)}")
    print(f"nudos (no vacíos):  {nudos_no_vacios}")
    print(f"seguimientos:       {seguimientos_no_vacios}")
    print(f"bloques_reporte:    {len(bloques)}")
    print(f"advertencias:       {len(adv)}")
    print("-" * 78)

    # Primeras 3 filas de cada lista.
    for nombre, lista in (
        ("alertas", alertas),
        ("reuniones", reuniones),
        ("nudos", nudos),
        ("bloques_reporte", bloques),
    ):
        print(f"\n--- {nombre} (primeras 3) ---")
        for item in lista[:3]:
            print(json.dumps(item, ensure_ascii=False, indent=1))

    print("\n" + "-" * 78)
    print("Advertencias globales:")
    for a in adv:
        print(f"  - {a}")
    print("-" * 78)
    print(f"Salida: {os.path.relpath(salida_path, REPO)}")
    print("=" * 78)

    return 0


if __name__ == "__main__":
    sys.exit(main())
