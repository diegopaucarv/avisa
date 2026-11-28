"""Planificación pura de la carga histórica (sin base de datos).

Recibe las hojas del libro ya leídas y los mapas resueltos contra la base
(catálogos, territorio, usuarios, existentes y bases de secuencia) y devuelve
un `Plan` con las filas a insertar, las que ya existen, los rechazos y las
advertencias. No importa `psycopg2` ni toca la base: es determinista y
verificable con fixtures en memoria.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

ORIGENES_VALIDOS = {"MANUAL", "KAG", "WORKFLOW", "AVISA_HISTORICO", "WHATSAPP"}
VISIBILIDADES = {"interna", "ejecutiva", "sectorial"}
TABLAS_RESUMEN = (
    "alertas_tempranas",
    "alerta_hechos",
    "alertas_actores",
    "actores",
    "demandas",
    "reuniones_dialogo",
    "documentos",
    "documento_actores",
)
CLAVES_CONTENIDO = (
    "alcance",
    "subsector",
    "region",
    "provincia",
    "nivel_riesgo",
    "hechos",
    "riesgos",
    "acciones_sugeridas",
    "acciones_en_desarrollo",
    "acuerdos",
    "seguimiento",
    "fuente",
    "texto_original",
)


# --------------------------------------------------------------------------
# Coerción y normalización
# --------------------------------------------------------------------------


def clave(texto: object | None) -> str:
    """Clave tolerante equivalente a `core.normalizar_ref`: minúsculas, sin
    tildes y sin separadores (espacios, guiones bajos y guiones)."""
    base = "" if texto is None else str(texto)
    base = unicodedata.normalize("NFKD", base)
    base = "".join(c for c in base if not unicodedata.combining(c))
    base = base.lower()
    return re.sub(r"[\s_\-]+", "", base)


def texto(valor: object | None) -> str:
    if valor is None:
        return ""
    if isinstance(valor, datetime):
        return valor.isoformat(sep=" ")
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def entero(valor: object | None) -> int | None:
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, float):
        return int(valor)
    crudo = str(valor).strip()
    if not crudo:
        return None
    try:
        return int(float(crudo))
    except ValueError:
        return None


def booleano(valor: object | None) -> bool | None:
    if valor is None:
        return None
    if isinstance(valor, bool):
        return valor
    crudo = str(valor).strip().lower()
    if crudo in ("", "none", "null", "nan"):
        return None
    if crudo in ("true", "verdadero", "1", "si", "sí", "x"):
        return True
    if crudo in ("false", "falso", "0", "no"):
        return False
    return None


def fecha(valor: object | None) -> date | None:
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    crudo = str(valor).strip()
    if not crudo:
        return None
    for formato in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(crudo, formato).date()
        except ValueError:
            continue
    return None


def _fecha_iso(valor: object | None) -> str | None:
    f = fecha(valor)
    return f.isoformat() if f else None


# --------------------------------------------------------------------------
# Estructuras del plan
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Insercion:
    tabla: str
    clave: str
    datos: dict[str, Any]


@dataclass(frozen=True)
class Rechazo:
    tabla: str
    codigo_legado: str
    motivo: str


@dataclass(frozen=True)
class Omision:
    tabla: str
    codigo_legado: str
    motivo: str


@dataclass
class Contextos:
    """Todo lo resuelto contra la base, ya normalizado."""

    alcances: dict[str, int] = field(default_factory=dict)
    subsectores: dict[str, int] = field(default_factory=dict)
    niveles_riesgo: dict[str, int] = field(default_factory=dict)
    tipos_actor: dict[str, int] = field(default_factory=dict)
    roles_actor: dict[str, int] = field(default_factory=dict)
    perfiles_actor: dict[str, int] = field(default_factory=dict)
    tipos_documento: dict[str, int] = field(default_factory=dict)
    tipos_reunion: dict[str, int] = field(default_factory=dict)
    usuarios: dict[str, str] = field(default_factory=dict)
    regiones: dict[str, int] = field(default_factory=dict)
    provincias: dict[tuple[str, str], int] = field(default_factory=dict)
    distritos: dict[tuple[str, str, str], int] = field(default_factory=dict)
    distritos_por_nombre: dict[str, int] = field(default_factory=dict)
    actores_directorio: dict[str, str] = field(default_factory=dict)
    existentes: dict[str, dict[str, str]] = field(default_factory=dict)
    secuencias: dict[tuple[str, int], int] = field(default_factory=dict)
    alias: dict[str, dict[str, str]] = field(default_factory=dict)
    # Registros que ya están en la base con otro `codigo_legado`:
    # {tabla: {codigo_legado_del_libro: motivo con el código existente}}.
    duplicados: dict[str, dict[str, str]] = field(default_factory=dict)
    # Destino concreto de cada duplicado:
    # {tabla: {codigo_legado_del_libro: id_destino}}.
    duplicados_ids: dict[str, dict[str, str]] = field(default_factory=dict)
    # {tabla: {codigo_legado_del_libro: codigo_destino}}.
    duplicados_codigos: dict[str, dict[str, str]] = field(default_factory=dict)
    # Límites `varchar(n)` leídos de `information_schema`:
    # {(tabla, columna): max_caracteres}.
    longitudes: dict[tuple[str, str], int] = field(default_factory=dict)


@dataclass
class Plan:
    inserciones: list[Insercion]
    rechazos: list[Rechazo]
    advertencias: list[str]
    resumen: dict[str, dict[str, int]]
    omitidos: list[Omision] = field(default_factory=list)
    alias_usados: dict[str, int] = field(default_factory=dict)

    def huella(self) -> str:
        """Hash estable del plan para comprobar determinismo."""
        carga = {
            "inserciones": [[i.tabla, i.clave, i.datos] for i in self.inserciones],
            "omitidos": [[o.tabla, o.codigo_legado, o.motivo] for o in self.omitidos],
            "rechazos": [[r.tabla, r.codigo_legado, r.motivo] for r in self.rechazos],
            "advertencias": self.advertencias,
        }
        serial = json.dumps(carga, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha256(serial.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Resolución de catálogos y territorio
# --------------------------------------------------------------------------


def _resolver_catalogo(
    catalogo: dict[str, int],
    dimension: str,
    valor: object | None,
    etiqueta: str,
    advertencias: list[str],
    alias: dict[str, dict[str, str]],
    alias_usados: dict[str, int],
) -> int | None:
    crudo = texto(valor)
    if not crudo:
        return None
    k = clave(crudo)
    if k in catalogo:
        return catalogo[k]
    destinos = alias.get(dimension, {})
    if k in destinos:
        destino = destinos[k]
        dk = clave(destino)
        if dk in catalogo:
            alias_usados[dimension] = alias_usados.get(dimension, 0) + 1
            return catalogo[dk]
        advertencias.append(
            f"{etiqueta}: el alias '{crudo}' apunta a '{destino}', que no "
            "existe en el catálogo; se deja NULL."
        )
        return None
    advertencias.append(
        f"{etiqueta}: valor de catálogo desconocido '{crudo}'; se deja NULL."
    )
    return None


def _resolver_territorio(
    ctx: Contextos,
    region: object | None,
    provincia: object | None,
    distrito: object | None,
    etiqueta: str,
    advertencias: list[str],
) -> tuple[int | None, int | None, int | None]:
    reg_txt, prov_txt, dist_txt = texto(region), texto(provincia), texto(distrito)
    region_id = ctx.regiones.get(clave(reg_txt)) if reg_txt else None
    if reg_txt and region_id is None:
        advertencias.append(
            f"{etiqueta}: la región '{reg_txt}' no existe en core.regiones."
        )

    provincia_id = None
    if prov_txt and region_id is not None:
        provincia_id = ctx.provincias.get((clave(reg_txt), clave(prov_txt)))
        if provincia_id is None:
            advertencias.append(
                f"{etiqueta}: la provincia '{prov_txt}' no existe en la "
                f"región '{reg_txt}'."
            )

    distrito_id = None
    if dist_txt:
        if provincia_id is not None:
            distrito_id = ctx.distritos.get(
                (clave(reg_txt), clave(prov_txt), clave(dist_txt))
            )
            if distrito_id is None:
                advertencias.append(
                    f"{etiqueta}: el distrito '{dist_txt}' no existe en "
                    f"'{prov_txt} · {reg_txt}'."
                )
        else:
            distrito_id = ctx.distritos_por_nombre.get(clave(dist_txt))
            if distrito_id is None:
                advertencias.append(
                    f"{etiqueta}: el distrito '{dist_txt}' es ambiguo o no "
                    "existe sin su provincia; se deja NULL."
                )
    return region_id, provincia_id, distrito_id


# --------------------------------------------------------------------------
# Planificador de actores (deduplicación contra el directorio y el libro)
# --------------------------------------------------------------------------


class PlanificadorActores:
    def __init__(
        self,
        ctx: Contextos,
        advertencias: list[str],
        alias_usados: dict[str, int],
        fase_actores: list[Insercion],
    ) -> None:
        self.ctx = ctx
        self.advertencias = advertencias
        self.alias_usados = alias_usados
        self.fase_actores = fase_actores
        self.registro: dict[str, str | None] = {}
        self.rol_defecto = ctx.roles_actor.get(clave("No determinado"))
        if self.rol_defecto is None:
            advertencias.append(
                "El catálogo core.cat_roles_actor no tiene 'No determinado'; "
                "los actores nuevos no se podrán crear."
            )

    def ref(
        self,
        nombre: object | None,
        descripcion: object | None,
        celular: object | None,
        tipo_actor: object | None,
        perfil: object | None,
    ) -> str | None:
        nombre_txt = texto(nombre)
        k = clave(nombre_txt)
        if not k:
            return None
        if k in self.registro:
            return self.registro[k]

        existente = self.ctx.actores_directorio.get(k)
        if existente:
            self.registro[k] = existente
            if texto(celular):
                self.advertencias.append(
                    f"Actor existente '{nombre_txt}': su celular no se "
                    "sobrescribe (se conserva el del directorio)."
                )
            return existente

        tipo_id = _resolver_catalogo(
            self.ctx.tipos_actor,
            "tipo_actor",
            tipo_actor,
            f"Actor '{nombre_txt}' · tipo_actor",
            self.advertencias,
            self.ctx.alias,
            self.alias_usados,
        )
        if tipo_id is None or self.rol_defecto is None:
            self.advertencias.append(
                f"Actor '{nombre_txt}': sin tipo_actor resoluble; no se crea "
                "en core.actores ni se vincula (sigue en actores_clave)."
            )
            self.registro[k] = None
            return None

        perfil_id = _resolver_catalogo(
            self.ctx.perfiles_actor,
            "perfil",
            perfil,
            f"Actor '{nombre_txt}' · perfil",
            self.advertencias,
            self.ctx.alias,
            self.alias_usados,
        )

        ref = f"nuevo:{k}"
        descripcion_txt = texto(descripcion)
        datos: dict[str, Any] = {
            "nombre_actual": nombre_txt,
            "naturaleza": "organizacion",
            "tipo_actor_id": tipo_id,
            "rol_actor_id": self.rol_defecto,
            "perfil_id": perfil_id,
            "cargo_actual": descripcion_txt or None,
            "origen_dato": "AVISA_HISTORICO",
            "es_validado_humano": False,
        }
        telefono = texto(celular)
        if telefono:
            datos["telefono"] = telefono
        self.fase_actores.append(Insercion("actores", ref, datos))
        self.registro[k] = ref
        return ref


# --------------------------------------------------------------------------
# Construcción del plan
# --------------------------------------------------------------------------


def _agrupar(
    filas: list[dict[str, Any]],
    columna_padre: str,
    columna_valor: str,
) -> dict[str, list[dict[str, Any]]]:
    grupos: dict[str, list[dict[str, Any]]] = {}
    for fila in filas:
        padre = texto(fila.get(columna_padre))
        if not padre:
            continue
        grupos.setdefault(padre, []).append(fila)
    return grupos


def _valores_ordenados(filas: list[dict[str, Any]], columna: str) -> list[str]:
    pares = []
    for fila in filas:
        valor = texto(fila.get(columna))
        if not valor:
            continue
        pares.append((entero(fila.get("orden")) or 0, valor))
    pares.sort(key=lambda par: par[0])
    return [valor for _, valor in pares]


def _lineas_actores(filas: list[dict[str, Any]]) -> list[str]:
    pares = []
    for fila in filas:
        nombre = texto(fila.get("nombre"))
        if not nombre:
            continue
        descripcion = texto(fila.get("descripcion"))
        linea = f"{nombre} — {descripcion}" if descripcion else nombre
        pares.append((entero(fila.get("orden")) or 0, linea))
    pares.sort(key=lambda par: par[0])
    return [linea for _, linea in pares]


def _sig(secuencias: dict[tuple[str, int], int], tabla: str, anio: int) -> int:
    llave = (tabla, anio)
    n = secuencias.get(llave, 1)
    secuencias[llave] = n + 1
    return n


def _origen_valido(
    valor: object | None, tabla: str, legado: str, rechazos: list[Rechazo]
) -> str | None:
    crudo = texto(valor)
    if not crudo:
        rechazos.append(Rechazo(tabla, legado, "origen_dato ausente en el libro"))
        return None
    if crudo not in ORIGENES_VALIDOS:
        rechazos.append(
            Rechazo(
                tabla,
                legado,
                f"origen_dato '{crudo}' fuera de los valores permitidos",
            )
        )
        return None
    return crudo


def _recortar_a_limites(
    inserciones: list[Insercion],
    longitudes: dict[tuple[str, str], int],
    advertencias: list[str],
) -> None:
    """Recorta los textos que exceden el `varchar(n)` de su columna.

    El límite viene de la base (`information_schema`), nunca fijo en el código.
    Recorta en sitio porque `datos` es un dict aunque `Insercion` sea frozen.
    """
    for ins in inserciones:
        for columna, valor in list(ins.datos.items()):
            if not isinstance(valor, str):
                continue
            limite = longitudes.get((ins.tabla, columna))
            if limite is None or len(valor) <= limite:
                continue
            recorte = valor[:limite]
            espacio = recorte.rfind(" ")
            if espacio >= limite * 0.6:
                recorte = recorte[:espacio]
            ins.datos[columna] = recorte.rstrip()
            advertencias.append(
                f"{ins.tabla} {ins.clave}: {columna} recortado de {len(valor)} "
                f"a {limite} caracteres"
            )


def construir_plan(
    hojas: dict[str, list[dict[str, Any]]],
    ctx: Contextos,
) -> Plan:
    ins_alertas: list[Insercion] = []
    ins_hechos: list[Insercion] = []
    ins_actores: list[Insercion] = []
    ins_alertas_actores: list[Insercion] = []
    ins_demandas_alerta: list[Insercion] = []
    ins_reuniones: list[Insercion] = []
    ins_documentos: list[Insercion] = []
    ins_documento_actores: list[Insercion] = []
    ins_demandas_doc: list[Insercion] = []

    rechazos: list[Rechazo] = []
    omitidos: list[Omision] = []
    advertencias: list[str] = []
    alias_usados: dict[str, int] = {}
    secuencias = dict(ctx.secuencias)

    existentes_alertas = ctx.existentes.get("alertas_tempranas", {})
    existentes_documentos = ctx.existentes.get("documentos", {})
    existentes_demandas = ctx.existentes.get("demandas", {})
    existentes_reuniones = ctx.existentes.get("reuniones_dialogo", {})
    duplicados_alertas = ctx.duplicados.get("alertas_tempranas", {})
    duplicados_documentos = ctx.duplicados.get("documentos", {})
    duplicados_demandas = ctx.duplicados.get("demandas", {})
    # Legados fusionados con una fila existente: están en `duplicados_ids`
    # (se detectaron como duplicado), ya pasaron a `existentes` y salieron de
    # `duplicados`. Solo esos dejan insertar sus hijos.
    fusionadas_alertas = {
        legado
        for legado in ctx.duplicados_ids.get("alertas_tempranas", {})
        if legado in existentes_alertas and legado not in duplicados_alertas
    }
    fusionados_documentos = {
        legado
        for legado in ctx.duplicados_ids.get("documentos", {})
        if legado in existentes_documentos and legado not in duplicados_documentos
    }

    actores_por_alerta = _agrupar(
        hojas.get("alertas_actores", []), "alerta_codigo_legado", "nombre"
    )
    riesgos_por_alerta = _agrupar(
        hojas.get("alertas_riesgos", []), "alerta_codigo_legado", "riesgo"
    )
    acciones_por_alerta = _agrupar(
        hojas.get("alertas_acciones", []), "alerta_codigo_legado", "accion"
    )

    planificador = PlanificadorActores(ctx, advertencias, alias_usados, ins_actores)

    alertas_insertadas: set[str] = set()
    alertas_rechazadas: set[str] = set()
    documentos_insertados: set[str] = set()
    reuniones_insertadas: set[str] = set()

    # ---- Alertas -------------------------------------------------------
    vistas_legado: set[str] = set()
    vistas_firma: set[str] = set()
    for fila in hojas.get("alertas_tempranas", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado:
            rechazos.append(Rechazo("alertas_tempranas", "", "codigo_legado vacío"))
            continue
        if legado in vistas_legado:
            rechazos.append(
                Rechazo(
                    "alertas_tempranas",
                    legado,
                    "codigo_legado duplicado dentro del libro",
                )
            )
            continue
        vistas_legado.add(legado)

        if legado in existentes_alertas:
            omitidos.append(
                Omision(
                    "alertas_tempranas",
                    legado,
                    "ya existe en core.alertas_tempranas",
                )
            )
            continue
        if legado in duplicados_alertas:
            omitidos.append(
                Omision("alertas_tempranas", legado, duplicados_alertas[legado])
            )
            continue

        f_reporte = fecha(fila.get("fecha_reporte"))
        if f_reporte is None:
            rechazos.append(
                Rechazo(
                    "alertas_tempranas",
                    legado,
                    "fecha_reporte ausente: no se deja que el DEFAULT la invente",
                )
            )
            alertas_rechazadas.add(legado)
            continue

        titulo = texto(fila.get("titulo"))
        firma = f"{clave(titulo)}|{f_reporte.isoformat()}"
        if firma in vistas_firma:
            rechazos.append(
                Rechazo(
                    "alertas_tempranas",
                    legado,
                    "duplicado interno por (tipo, título normalizado, fecha)",
                )
            )
            alertas_rechazadas.add(legado)
            continue
        vistas_firma.add(firma)

        origen = _origen_valido(
            fila.get("origen_dato"), "alertas_tempranas", legado, rechazos
        )
        if origen is None:
            alertas_rechazadas.add(legado)
            continue

        visibilidad = texto(fila.get("visibilidad")) or None
        if visibilidad is not None and visibilidad not in VISIBILIDADES:
            rechazos.append(
                Rechazo(
                    "alertas_tempranas",
                    legado,
                    f"visibilidad '{visibilidad}' fuera de los valores permitidos",
                )
            )
            alertas_rechazadas.add(legado)
            continue

        etiqueta = f"Alerta {legado}"
        region_id, provincia_id, distrito_id = _resolver_territorio(
            ctx,
            fila.get("region"),
            fila.get("provincia"),
            fila.get("distrito"),
            etiqueta,
            advertencias,
        )
        alcance_id = _resolver_catalogo(
            ctx.alcances,
            "alcance",
            fila.get("alcance"),
            f"{etiqueta} · alcance",
            advertencias,
            ctx.alias,
            alias_usados,
        )
        subsector_id = _resolver_catalogo(
            ctx.subsectores,
            "subsector",
            fila.get("subsector"),
            f"{etiqueta} · subsector",
            advertencias,
            ctx.alias,
            alias_usados,
        )
        nivel_riesgo_id = _resolver_catalogo(
            ctx.niveles_riesgo,
            "nivel_riesgo",
            fila.get("nivel_riesgo"),
            f"{etiqueta} · nivel_riesgo",
            advertencias,
            ctx.alias,
            alias_usados,
        )
        sectorista = texto(fila.get("sectorista"))
        sectorista_id = ctx.usuarios.get(clave(sectorista)) if sectorista else None
        if sectorista and sectorista_id is None:
            advertencias.append(
                f"{etiqueta}: el sectorista '{sectorista}' no existe en "
                "core.usuarios; sectorista_usuario_id queda NULL."
            )

        codigo_alerta = (
            f"AT-{f_reporte.year}-{_sig(secuencias, 'alerta', f_reporte.year):02d}"
        )

        detalle_actores = _lineas_actores(actores_por_alerta.get(legado, []))
        riesgos = _valores_ordenados(riesgos_por_alerta.get(legado, []), "riesgo")
        acciones = _valores_ordenados(acciones_por_alerta.get(legado, []), "accion")

        ins_alertas.append(
            Insercion(
                "alertas_tempranas",
                legado,
                {
                    "codigo_alerta": codigo_alerta,
                    "codigo_legado": legado,
                    "titulo": titulo or None,
                    "fecha_reporte": f_reporte,
                    "region_id": region_id,
                    "provincia_id": provincia_id,
                    "distrito_id": distrito_id,
                    "alcance_id": alcance_id,
                    "subsector_id": subsector_id,
                    "nivel_riesgo_id": nivel_riesgo_id,
                    "sectorista_usuario_id": sectorista_id,
                    "situacion_actual": texto(fila.get("situacion_actual")) or None,
                    "hechos_recientes": texto(fila.get("hechos_recientes")) or None,
                    "acciones_oaipcs": texto(fila.get("acciones_oaipcs")) or None,
                    "descripcion_riesgo": texto(fila.get("descripcion_riesgo")) or None,
                    "fuente_tipo": texto(fila.get("fuente_tipo")) or None,
                    "fuente_descripcion": texto(fila.get("fuente_descripcion")) or None,
                    "fuente_url": texto(fila.get("fuente_url")) or None,
                    "visibilidad": visibilidad,
                    "origen_dato": origen,
                    "es_validado_humano": False,
                    "plantilla_whatsapp": texto(fila.get("plantilla_whatsapp")) or None,
                    "riesgos_json": riesgos or None,
                    "acciones_sugeridas_json": acciones or None,
                    "actores_clave": detalle_actores or None,
                },
            )
        )
        alertas_insertadas.add(legado)

    # ---- Hechos --------------------------------------------------------
    for fila in hojas.get("alerta_hechos", []):
        padre = texto(fila.get("alerta_codigo_legado"))
        if not padre:
            rechazos.append(Rechazo("alerta_hechos", "", "alerta_codigo_legado vacío"))
            continue
        if padre not in alertas_insertadas:
            if padre not in fusionadas_alertas:
                if padre in existentes_alertas or padre in duplicados_alertas:
                    omitidos.append(
                        Omision(
                            "alerta_hechos",
                            padre,
                            "la alerta ya existe; no se duplican hijos",
                        )
                    )
                elif padre in alertas_rechazadas:
                    rechazos.append(
                        Rechazo(
                            "alerta_hechos",
                            padre,
                            "la alerta padre fue rechazada",
                        )
                    )
                else:
                    rechazos.append(
                        Rechazo(
                            "alerta_hechos",
                            padre,
                            "la alerta padre no existe en el libro ni en la base",
                        )
                    )
                continue
        descripcion = texto(fila.get("descripcion"))
        if not descripcion:
            rechazos.append(Rechazo("alerta_hechos", padre, "hecho sin descripción"))
            continue
        ins_hechos.append(
            Insercion(
                "alerta_hechos",
                f"{padre}|{entero(fila.get('orden')) or 0}",
                {
                    "alerta_ref": padre,
                    "descripcion": descripcion,
                    "orden": entero(fila.get("orden")) or 0,
                    "fecha": fecha(fila.get("fecha")),
                },
            )
        )

    # ---- Alertas_actores ----------------------------------------------
    vistas_relacion: set[tuple[str, str]] = set()
    for fila in hojas.get("alertas_actores", []):
        padre = texto(fila.get("alerta_codigo_legado"))
        if not padre:
            rechazos.append(
                Rechazo("alertas_actores", "", "alerta_codigo_legado vacío")
            )
            continue
        if padre not in alertas_insertadas:
            if padre not in fusionadas_alertas:
                if padre in existentes_alertas or padre in duplicados_alertas:
                    omitidos.append(
                        Omision(
                            "alertas_actores",
                            padre,
                            "la alerta ya existe; no se duplican vínculos",
                        )
                    )
                elif padre in alertas_rechazadas:
                    rechazos.append(
                        Rechazo(
                            "alertas_actores", padre, "la alerta padre fue rechazada"
                        )
                    )
                else:
                    rechazos.append(
                        Rechazo(
                            "alertas_actores",
                            padre,
                            "la alerta padre no existe en el libro ni en la base",
                        )
                    )
                continue
        nombre = texto(fila.get("nombre"))
        if not nombre:
            rechazos.append(Rechazo("alertas_actores", padre, "actor sin nombre"))
            continue
        ref = planificador.ref(
            nombre,
            fila.get("descripcion"),
            fila.get("celular"),
            fila.get("tipo_actor"),
            fila.get("perfil"),
        )
        if ref is None:
            continue
        llave = (padre, ref)
        if llave in vistas_relacion:
            continue
        vistas_relacion.add(llave)
        ins_alertas_actores.append(
            Insercion(
                "alertas_actores",
                f"{padre}|{ref}",
                {"alerta_ref": padre, "actor_ref": ref},
            )
        )

    # ---- Reuniones -----------------------------------------------------
    vistas_legado = set()
    vistas_firma = set()
    for fila in hojas.get("reuniones_dialogo", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado:
            rechazos.append(Rechazo("reuniones_dialogo", "", "codigo_legado vacío"))
            continue
        if legado in vistas_legado:
            rechazos.append(
                Rechazo(
                    "reuniones_dialogo",
                    legado,
                    "codigo_legado duplicado dentro del libro",
                )
            )
            continue
        vistas_legado.add(legado)
        if legado in existentes_reuniones:
            omitidos.append(
                Omision(
                    "reuniones_dialogo",
                    legado,
                    "ya existe en core.reuniones_dialogo",
                )
            )
            continue
        f_reunion = fecha(fila.get("fecha"))
        if f_reunion is None:
            rechazos.append(
                Rechazo(
                    "reuniones_dialogo",
                    legado,
                    "fecha ausente: la columna es NOT NULL sin DEFAULT",
                )
            )
            continue
        titulo = texto(fila.get("titulo"))
        firma = f"{clave(titulo)}|{f_reunion.isoformat()}"
        if firma in vistas_firma:
            rechazos.append(
                Rechazo(
                    "reuniones_dialogo",
                    legado,
                    "duplicado interno por (tipo, título normalizado, fecha)",
                )
            )
            continue
        vistas_firma.add(firma)

        origen = _origen_valido(
            fila.get("origen_dato"), "reuniones_dialogo", legado, rechazos
        )
        if origen is None:
            continue

        codigo_reunion = (
            f"RD-{f_reunion.year}-{_sig(secuencias, 'reunion', f_reunion.year):03d}"
        )
        datos: dict[str, Any] = {
            "codigo_reunion": codigo_reunion,
            "codigo_legado": legado,
            "titulo": titulo or None,
            "fecha": f_reunion,
            "lugar": texto(fila.get("lugar")) or None,
            "region_texto": texto(fila.get("region_texto")) or None,
            "origen_dato": origen,
            "es_validado_humano": False,
        }
        # `programada` es NOT NULL con DEFAULT true: si el libro no lo declara,
        # se omite la columna para que aplique el default (nunca `false`).
        programada = booleano(fila.get("programada"))
        if programada is not None:
            datos["programada"] = programada
        for columna in (
            "asistencia_registrada",
            "acta_am",
            "relatoria_registrada",
            "publicacion_registrada",
        ):
            valor = booleano(fila.get(columna))
            if valor is not None:
                datos[columna] = valor

        ins_reuniones.append(Insercion("reuniones_dialogo", legado, datos))
        reuniones_insertadas.add(legado)

    # ---- Documentos ----------------------------------------------------
    vistas_legado = set()
    vistas_firma = set()
    for fila in hojas.get("documentos", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado:
            rechazos.append(Rechazo("documentos", "", "codigo_legado vacío"))
            continue
        if legado in vistas_legado:
            rechazos.append(
                Rechazo(
                    "documentos",
                    legado,
                    "codigo_legado duplicado dentro del libro",
                )
            )
            continue
        vistas_legado.add(legado)
        if legado in existentes_documentos:
            omitidos.append(
                Omision("documentos", legado, "ya existe en core.documentos")
            )
            continue
        if legado in duplicados_documentos:
            omitidos.append(
                Omision("documentos", legado, duplicados_documentos[legado])
            )
            continue

        etiqueta = f"Documento {legado}"
        tipo_codigo = texto(fila.get("tipo_documento"))
        tipo_id = ctx.tipos_documento.get(clave(tipo_codigo)) if tipo_codigo else None
        if tipo_id is None:
            rechazos.append(
                Rechazo(
                    "documentos",
                    legado,
                    f"tipo_documento '{tipo_codigo}' no existe en "
                    "core.cat_tipos_documento (tipo_id es NOT NULL)",
                )
            )
            continue
        titulo = texto(fila.get("titulo"))
        if not titulo:
            rechazos.append(Rechazo("documentos", legado, "titulo vacío (NOT NULL)"))
            continue
        f_doc = fecha(fila.get("fecha"))
        if f_doc is None:
            rechazos.append(
                Rechazo(
                    "documentos",
                    legado,
                    "fecha ausente: no se deja que el DEFAULT la invente",
                )
            )
            continue
        firma = f"{clave(tipo_codigo)}|{clave(titulo)}|{f_doc.isoformat()}"
        if firma in vistas_firma:
            rechazos.append(
                Rechazo(
                    "documentos",
                    legado,
                    "duplicado interno por (tipo, título normalizado, fecha)",
                )
            )
            continue
        vistas_firma.add(firma)

        origen = _origen_valido(fila.get("origen_dato"), "documentos", legado, rechazos)
        if origen is None:
            continue

        _, _, distrito_id = _resolver_territorio(
            ctx,
            fila.get("region"),
            fila.get("provincia"),
            fila.get("distrito"),
            etiqueta,
            advertencias,
        )

        contenido: dict[str, Any] = {}
        for clave_contenido in CLAVES_CONTENIDO:
            if clave_contenido in ("region", "provincia"):
                valor = texto(fila.get(clave_contenido))
            else:
                valor = texto(fila.get(f"contenido_json.{clave_contenido}"))
            if valor:
                contenido[clave_contenido] = valor

        reunion_legado = texto(fila.get("reunion_codigo_legado"))
        reunion_ref = None
        if reunion_legado:
            if (
                reunion_legado in reuniones_insertadas
                or reunion_legado in existentes_reuniones
            ):
                reunion_ref = reunion_legado
            else:
                advertencias.append(
                    f"{etiqueta}: la reunión '{reunion_legado}' no existe en "
                    "el libro ni en la base; reunion_id queda NULL."
                )

        codigo = f"RED-{f_doc.year}-{_sig(secuencias, 'documento', f_doc.year):03d}"
        ins_documentos.append(
            Insercion(
                "documentos",
                legado,
                {
                    "tipo_id": tipo_id,
                    "codigo": codigo,
                    "codigo_legado": legado,
                    "titulo": titulo,
                    "fecha": f_doc,
                    "contenido_json": contenido,
                    "distrito_id": distrito_id,
                    "reunion_ref": reunion_ref,
                    "resumen_ejecutivo": texto(fila.get("resumen_ejecutivo")) or None,
                    "autor_texto": texto(fila.get("autor_texto")) or None,
                    "estado": texto(fila.get("estado")) or None,
                    "origen_dato": origen,
                    "es_validado_humano": False,
                },
            )
        )
        documentos_insertados.add(legado)

    # ---- Documento_actores --------------------------------------------
    vistas_relacion = set()
    for fila in hojas.get("documento_actores", []):
        padre = texto(fila.get("documento_codigo_legado"))
        if not padre:
            rechazos.append(
                Rechazo("documento_actores", "", "documento_codigo_legado vacío")
            )
            continue
        if padre not in documentos_insertados:
            if padre not in fusionados_documentos:
                if padre in existentes_documentos or padre in duplicados_documentos:
                    omitidos.append(
                        Omision(
                            "documento_actores",
                            padre,
                            "el documento ya existe; no se duplican vínculos",
                        )
                    )
                else:
                    rechazos.append(
                        Rechazo(
                            "documento_actores",
                            padre,
                            "el documento padre no existe en el libro ni en la base",
                        )
                    )
                continue
        nombre = texto(fila.get("nombre"))
        if not nombre:
            rechazos.append(Rechazo("documento_actores", padre, "actor sin nombre"))
            continue
        ref = planificador.ref(
            nombre,
            fila.get("descripcion"),
            fila.get("celular"),
            fila.get("tipo_actor"),
            fila.get("perfil"),
        )
        if ref is None:
            continue
        llave = (padre, ref)
        if llave in vistas_relacion:
            continue
        vistas_relacion.add(llave)
        ins_documento_actores.append(
            Insercion(
                "documento_actores",
                f"{padre}|{ref}",
                {
                    "documento_ref": padre,
                    "actor_ref": ref,
                    "rol": texto(fila.get("rol")) or None,
                    "es_principal": (entero(fila.get("orden")) == 1),
                },
            )
        )

    # ---- Demandas ------------------------------------------------------
    vistas_legado = set()
    for fila in hojas.get("demandas", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado:
            rechazos.append(Rechazo("demandas", "", "codigo_legado vacío"))
            continue
        if legado in vistas_legado:
            rechazos.append(
                Rechazo(
                    "demandas",
                    legado,
                    "codigo_legado duplicado dentro del libro",
                )
            )
            continue
        vistas_legado.add(legado)
        if legado in existentes_demandas:
            omitidos.append(Omision("demandas", legado, "ya existe en core.demandas"))
            continue
        if legado in duplicados_demandas:
            omitidos.append(Omision("demandas", legado, duplicados_demandas[legado]))
            continue

        descripcion = texto(fila.get("descripcion_demanda"))
        if not descripcion:
            rechazos.append(Rechazo("demandas", legado, "descripcion_demanda vacía"))
            continue

        alerta_legado = texto(fila.get("alerta_codigo_legado"))
        documento_legado = texto(fila.get("documento_codigo_legado"))
        if bool(alerta_legado) == bool(documento_legado):
            rechazos.append(
                Rechazo(
                    "demandas",
                    legado,
                    "debe tener exactamente un padre: alerta o documento",
                )
            )
            continue

        datos = {
            "codigo_legado": legado,
            "descripcion_demanda": descripcion,
            "fecha_registro": fecha(fila.get("fecha_registro")),
            "origen_dato": None,
            "es_validado_humano": False,
        }

        if alerta_legado:
            if (
                alerta_legado in duplicados_alertas
                and alerta_legado not in alertas_insertadas
            ):
                omitidos.append(
                    Omision(
                        "demandas",
                        legado,
                        f"la alerta padre ya existe: {duplicados_alertas[alerta_legado]}",
                    )
                )
                continue
            if alerta_legado not in alertas_insertadas and (
                alerta_legado not in existentes_alertas
                and alerta_legado not in duplicados_alertas
            ):
                motivo = (
                    "la alerta padre fue rechazada"
                    if alerta_legado in alertas_rechazadas
                    else "la alerta padre no existe en el libro ni en la base"
                )
                rechazos.append(Rechazo("demandas", legado, motivo))
                continue
            datos["alerta_ref"] = alerta_legado
            datos["codigo_padre_legado"] = alerta_legado
            destino = ins_demandas_alerta
        else:
            if (
                documento_legado in duplicados_documentos
                and documento_legado not in documentos_insertados
            ):
                omitidos.append(
                    Omision(
                        "demandas",
                        legado,
                        f"el documento padre ya existe: "
                        f"{duplicados_documentos[documento_legado]}",
                    )
                )
                continue
            if documento_legado not in documentos_insertados and (
                documento_legado not in existentes_documentos
                and documento_legado not in duplicados_documentos
            ):
                rechazos.append(
                    Rechazo(
                        "demandas",
                        legado,
                        "el documento padre no existe en el libro ni en la base",
                    )
                )
                continue
            datos["documento_ref"] = documento_legado
            datos["codigo_padre_legado"] = documento_legado
            destino = ins_demandas_doc

        origen = _origen_valido(
            fila.get("origen_dato") or "AVISA_HISTORICO",
            "demandas",
            legado,
            rechazos,
        )
        if origen is None:
            continue
        datos["origen_dato"] = origen
        destino.append(Insercion("demandas", legado, datos))

    inserciones = (
        ins_alertas
        + ins_hechos
        + ins_actores
        + ins_alertas_actores
        + ins_demandas_alerta
        + ins_reuniones
        + ins_documentos
        + ins_documento_actores
        + ins_demandas_doc
    )

    _recortar_a_limites(inserciones, ctx.longitudes, advertencias)

    resumen = {
        tabla: {"insertar": 0, "omitidos": 0, "rechazos": 0} for tabla in TABLAS_RESUMEN
    }
    for insercion in inserciones:
        resumen.setdefault(
            insercion.tabla, {"insertar": 0, "omitidos": 0, "rechazos": 0}
        )
        resumen[insercion.tabla]["insertar"] += 1
    for omision in omitidos:
        resumen.setdefault(omision.tabla, {"insertar": 0, "omitidos": 0, "rechazos": 0})
        resumen[omision.tabla]["omitidos"] += 1
    for rechazo in rechazos:
        resumen.setdefault(rechazo.tabla, {"insertar": 0, "omitidos": 0, "rechazos": 0})
        resumen[rechazo.tabla]["rechazos"] += 1

    return Plan(
        inserciones=inserciones,
        rechazos=rechazos,
        advertencias=advertencias,
        resumen=resumen,
        omitidos=omitidos,
        alias_usados=alias_usados,
    )
