"""Lectura y validación estructural del libro de carga histórica.

El libro tiene una hoja por tabla de destino (más `prompt`, que es texto de
instrucciones y se ignora) y cada encabezado es el nombre de la columna. Este
módulo solo lee: no conoce la base ni decide inserciones. Devuelve las filas
tal como vienen (fechas como `datetime`, vacíos como `None`) para que la
planificación decida su tratamiento.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import openpyxl

HOJA_PROMPT = "prompt"

# Columnas mínimas que debe traer cada hoja. Si el libro cambia, el error
# indica la hoja y las columnas faltantes en lugar de fallar con KeyError.
COLUMNAS_REQUERIDAS: dict[str, tuple[str, ...]] = {
    "alertas_tempranas": (
        "codigo_alerta",
        "codigo_legado",
        "titulo",
        "fecha_reporte",
        "region",
        "provincia",
        "distrito",
        "alcance",
        "subsector",
        "nivel_riesgo",
        "nivel_alerta",
        "prioridad",
        "situacion_actual",
        "hechos_recientes",
        "acciones_oaipcs",
        "descripcion_riesgo",
        "fuente_tipo",
        "fuente_descripcion",
        "fuente_url",
        "sectorista",
        "visibilidad",
        "origen_dato",
        "es_validado_humano",
        "plantilla_whatsapp",
    ),
    "alerta_hechos": (
        "alerta_codigo_legado",
        "orden",
        "fecha",
        "descripcion",
    ),
    "alertas_actores": (
        "alerta_codigo_legado",
        "orden",
        "nombre",
        "descripcion",
        "celular",
        "tipo_actor",
        "perfil",
        "texto_original",
    ),
    "alertas_riesgos": (
        "alerta_codigo_legado",
        "orden",
        "riesgo",
    ),
    "alertas_acciones": (
        "alerta_codigo_legado",
        "orden",
        "accion",
    ),
    "documentos": (
        "codigo",
        "codigo_legado",
        "tipo_documento",
        "titulo",
        "fecha",
        "region",
        "provincia",
        "distrito",
        "reunion_codigo_legado",
        "resumen_ejecutivo",
        "contenido_json.alcance",
        "contenido_json.subsector",
        "contenido_json.nivel_riesgo",
        "contenido_json.hechos",
        "contenido_json.riesgos",
        "contenido_json.acciones_sugeridas",
        "contenido_json.acciones_en_desarrollo",
        "contenido_json.acuerdos",
        "contenido_json.seguimiento",
        "contenido_json.fuente",
        "contenido_json.texto_original",
        "autor_texto",
        "estado",
        "origen_dato",
        "es_validado_humano",
    ),
    "documento_actores": (
        "documento_codigo_legado",
        "orden",
        "nombre",
        "descripcion",
        "celular",
        "tipo_actor",
        "perfil",
        "rol",
        "texto_original",
    ),
    "demandas": (
        "codigo_legado",
        "alerta_codigo_legado",
        "documento_codigo_legado",
        "orden",
        "grupo",
        "descripcion_demanda",
        "fecha_registro",
    ),
    "reuniones_dialogo": (
        "codigo_reunion",
        "codigo_legado",
        "titulo",
        "fecha",
        "lugar",
        "region_texto",
        "programada",
        "asistencia_registrada",
        "acta_am",
        "relatoria_registrada",
        "publicacion_registrada",
        "origen_dato",
    ),
}


class ErrorEstructura(Exception):
    """El libro no tiene la forma esperada (hoja o columna ausente)."""


@dataclass
class LibroHistorico:
    """Filas del libro ya leídas, agrupadas por hoja."""

    hojas: dict[str, list[dict[str, object]]]
    cabeceras: dict[str, list[str]]
    prompt: str

    def filas(self, hoja: str) -> list[dict[str, object]]:
        return self.hojas.get(hoja, [])


def _texto(valor: object) -> str:
    if valor is None:
        return ""
    return str(valor).strip()


def _fila_vacia(fila: tuple[object, ...]) -> bool:
    return all(v is None or (isinstance(v, str) and v.strip() == "") for v in fila)


def leer_libro(ruta: str | Path) -> LibroHistorico:
    """Lee el libro y valida hojas y encabezados. No escribe nada."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise ErrorEstructura(f"No existe el archivo: {ruta}")

    libro = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    try:
        hojas: dict[str, list[dict[str, object]]] = {}
        cabeceras: dict[str, list[str]] = {}

        for nombre, requeridas in COLUMNAS_REQUERIDAS.items():
            if nombre not in libro.sheetnames:
                raise ErrorEstructura(
                    f"Falta la hoja '{nombre}' en el libro {ruta.name}."
                )
            hoja = libro[nombre]
            iterador = hoja.iter_rows(values_only=True)
            try:
                primera = next(iterador)
            except StopIteration:
                raise ErrorEstructura(f"La hoja '{nombre}' está vacía.") from None

            cabecera = [_texto(c) for c in primera]
            faltan = [col for col in requeridas if col not in cabecera]
            if faltan:
                raise ErrorEstructura(
                    f"A la hoja '{nombre}' le faltan columnas: {', '.join(faltan)}."
                )

            filas: list[dict[str, object]] = []
            for cruda in iterador:
                if _fila_vacia(cruda):
                    continue
                fila = {
                    col: (cruda[i] if i < len(cruda) else None)
                    for i, col in enumerate(cabecera)
                    if col
                }
                filas.append(fila)

            hojas[nombre] = filas
            cabeceras[nombre] = cabecera

        prompt = ""
        if HOJA_PROMPT in libro.sheetnames:
            lineas = []
            for cruda in libro[HOJA_PROMPT].iter_rows(values_only=True):
                texto = " ".join(_texto(c) for c in cruda if _texto(c))
                if texto:
                    lineas.append(texto)
            prompt = "\n".join(lineas)

        return LibroHistorico(hojas=hojas, cabeceras=cabeceras, prompt=prompt)
    finally:
        libro.close()
