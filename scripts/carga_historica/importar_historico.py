"""Carga histórica de alertas desde el libro del sectorista.

Lee el libro con `excel_historico`, construye un plan puro con `plan_historico`
y, opcionalmente, lo aplica en una sola transacción.

Por defecto es un ensayo de solo lectura: no escribe en la base. Aplicar exige
las dos banderas `--apply --confirmar`. `--ensayo-escritura --confirmar` ejecuta
las inserciones en una transacción y siempre la revierte, para validar
constraints y triggers sin persistir nada.

Uso:
    python scripts/carga_historica/importar_historico.py --excel LIBRO.xlsx
    python scripts/carga_historica/importar_historico.py --excel LIBRO.xlsx --apply --confirmar
    python scripts/carga_historica/importar_historico.py --excel LIBRO.xlsx --ensayo-escritura --confirmar
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from excel_historico import ErrorEstructura, leer_libro
from plan_historico import (
    Contextos,
    Insercion,
    Plan,
    clave,
    construir_plan,
    fecha,
    texto,
)
from psycopg2 import sql

RAIZ = Path(__file__).resolve().parents[2]
ALIAS_POR_DEFECTO = Path(__file__).resolve().parent / "alias_catalogos.json"
INFORMES = Path(__file__).resolve().parent

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

TABLAS_RESUMEN = (
    "alertas_tempranas",
    "alerta_hechos",
    "actores",
    "alertas_actores",
    "demandas",
    "reuniones_dialogo",
    "documentos",
    "documento_actores",
)

# Tablas sin columna `id`: el insert no devuelve identificador.
SIN_ID = {"alertas_actores", "documento_actores"}
COLUMNA_ID = {"actores": "actor_uid", "actor_datos_personales": "actor_uid"}

JSONB = {
    "alertas_tempranas": ("riesgos_json", "acciones_sugeridas_json", "actores_clave"),
    "documentos": ("contenido_json",),
}

PREFIJOS = (
    ("alertas_tempranas", "codigo_alerta", "AT", "alerta"),
    ("documentos", "codigo", "RED", "documento"),
    ("reuniones_dialogo", "codigo_reunion", "RD", "reunion"),
)


class ErrorDependencia(Exception):
    """No se puede escribir la fila porque su padre no existe en la base."""


class YaExiste(Exception):
    """La fila de vínculo ya estaba en la base; no hay nada que insertar."""


# --------------------------------------------------------------------------
# Conexión
# --------------------------------------------------------------------------


def conectar(dsn: str | None, solo_lectura: bool):
    load_dotenv(RAIZ / ".env", override=False)
    url = dsn or os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "No hay DSN: usa --dsn o define NEON_OWNER_URL/DATABASE_URL en .env."
        )
    conn = psycopg2.connect(url, connect_timeout=20)
    conn.set_session(readonly=solo_lectura, autocommit=solo_lectura)
    return conn


# --------------------------------------------------------------------------
# Contexto resuelto contra la base
# --------------------------------------------------------------------------


def _mapa_catalogo(cur, tabla: str, columnas: tuple[str, ...]) -> dict[str, int]:
    cur.execute(
        sql.SQL("select id, {cols} from core.{tabla}").format(
            cols=sql.SQL(", ").join(map(sql.Identifier, columnas)),
            tabla=sql.Identifier(tabla),
        )
    )
    mapa: dict[str, int] = {}
    for fila in cur.fetchall():
        for valor in fila[1:]:
            if valor:
                mapa.setdefault(clave(valor), int(fila[0]))
    return mapa


def _longitudes(cur) -> dict[tuple[str, str], int]:
    """Límites `varchar(n)` de las tablas que escribe la carga."""
    tablas = tuple(TABLAS_RESUMEN) + ("actor_datos_personales",)
    cur.execute(
        """
        select table_name, column_name, character_maximum_length
          from information_schema.columns
         where table_schema = 'core'
           and character_maximum_length is not null
           and table_name = any(%s)
        """,
        (list(tablas),),
    )
    return {
        (tabla, columna): int(longitud) for tabla, columna, longitud in cur.fetchall()
    }


def _existentes(cur, tabla: str, columna: str) -> dict[str, str]:
    cur.execute(
        sql.SQL("select {col}, id from core.{tabla} where {col} is not null").format(
            col=sql.Identifier(columna),
            tabla=sql.Identifier(tabla),
        )
    )
    return {fila[0]: str(fila[1]) for fila in cur.fetchall()}


def _secuencias(
    cur, tabla: str, columna: str, prefijo: str, etiqueta: str
) -> dict[tuple[str, int], int]:
    """Siguiente sufijo por año, con el mismo criterio que la aplicación."""
    cur.execute(
        sql.SQL(
            """
            select substring({col} from %s) as anio,
                   coalesce(max((regexp_match({col}, '(\\d+)$'))[1]::int), 0) as maximo
              from core.{tabla}
             where {col} ~ %s
             group by 1
            """
        ).format(col=sql.Identifier(columna), tabla=sql.Identifier(tabla)),
        (rf"^{prefijo}-(\d{{4}})-", rf"^{prefijo}-\d{{4}}-"),
    )
    return {
        (etiqueta, int(anio)): int(maximo) + 1
        for anio, maximo in cur.fetchall()
        if anio
    }


def _territorio(
    cur,
) -> tuple[
    dict[str, int],
    dict[tuple[str, str], int],
    dict[tuple[str, str, str], int],
    dict[str, int],
]:
    cur.execute("select id, nombre from core.regiones")
    nombre_region = {int(id_): nombre for id_, nombre in cur.fetchall() if nombre}
    regiones = {clave(nombre): id_ for id_, nombre in nombre_region.items()}

    cur.execute("select id, region_id, nombre from core.provincias")
    filas_provincia = [
        (int(id_), int(region_id) if region_id is not None else 0, nombre)
        for id_, region_id, nombre in cur.fetchall()
        if nombre
    ]
    nombre_provincia = {id_: nombre for id_, _, nombre in filas_provincia}
    region_de_provincia = {id_: region_id for id_, region_id, _ in filas_provincia}
    provincias = {
        (clave(nombre_region.get(region_id, "")), clave(nombre)): id_
        for id_, region_id, nombre in filas_provincia
    }

    cur.execute("select id, provincia_id, nombre from core.distritos")
    distritos: dict[tuple[str, str, str], int] = {}
    por_nombre: dict[str, list[int]] = {}
    for id_, provincia_id, nombre in cur.fetchall():
        if not nombre:
            continue
        provincia_id = int(provincia_id) if provincia_id is not None else 0
        region = nombre_region.get(region_de_provincia.get(provincia_id, 0), "")
        distritos[
            (
                clave(region),
                clave(nombre_provincia.get(provincia_id, "")),
                clave(nombre),
            )
        ] = int(id_)
        por_nombre.setdefault(clave(nombre), []).append(int(id_))

    unicos = {k: v[0] for k, v in por_nombre.items() if len(v) == 1}
    return regiones, provincias, distritos, unicos


def _actores_directorio(cur) -> dict[str, str]:
    cur.execute("select actor_uid, nombre_actual from core.actores")
    mapa: dict[str, str] = {}
    for actor_uid, nombre in cur.fetchall():
        if nombre:
            mapa.setdefault(clave(nombre), str(actor_uid))

    cur.execute("select to_regclass('core.actor_alias')")
    if cur.fetchone()[0] is not None:
        cur.execute("select actor_uid, alias from core.actor_alias")
        for actor_uid, alias in cur.fetchall():
            if alias:
                mapa.setdefault(clave(alias), str(actor_uid))
    return mapa


# Umbrales de la deduplicación por contenido. La distancia entre el grupo de
# repetidos (>= 0,89 en el libro real) y el de nuevos (<= 0,49) es amplia.
UMBRAL_CASI = 0.85
UMBRAL_DUDA = 0.70
DIAS_TITULO = 7
VENTANA_TEXTO = 600


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


_NO_ALFANUMERICO = re.compile(r"[^0-9a-z]+")


def _clave_texto(valor: object | None) -> str:
    """`clave` más agresiva: además quita toda la puntuación.

    Se usa solo para comparar contenido; los códigos y catálogos siguen
    usando `clave` porque la puntuación puede ser significativa.
    """
    return _NO_ALFANUMERICO.sub("", clave(valor))


def _dias(a: date | None, b: date | None) -> int | None:
    if a is None or b is None:
        return None
    return abs((a - b).days)


CAMPOS_ALERTA = ("plantilla_whatsapp", "situacion_actual")
CAMPOS_DOCUMENTO = ("contenido_json.texto_original",)


def _mejor_candidato(
    fila: dict[str, Any],
    candidatos: list[dict[str, Any]],
    campos: tuple[str, ...],
) -> tuple[dict[str, Any] | None, float, str]:
    """Mejor candidato comparando campo contra campo, como se cargó."""
    titulo = _clave_texto(fila.get("titulo"))
    propios = [
        (_clave_texto(fila.get(campo))[:VENTANA_TEXTO], campo)
        for campo in campos
        if _clave_texto(fila.get(campo))
    ]
    mejor: dict[str, Any] | None = None
    puntaje = 0.0
    dimension = "titulo"
    for candidato in candidatos:
        por_titulo = _sim(titulo, candidato["titulo_n"])
        if por_titulo > puntaje:
            puntaje, mejor, dimension = por_titulo, candidato, "titulo"
        for valor, campo in propios:
            ajeno = candidato["cuerpos"].get(campo, "")[:VENTANA_TEXTO]
            por_campo = _sim(valor, ajeno)
            if por_campo > puntaje:
                puntaje, mejor, dimension = por_campo, candidato, "texto"
    return mejor, puntaje, dimension


def _alertas_para_comparar(cur) -> list[dict[str, Any]]:
    cur.execute(
        """
        select id, codigo_alerta, fecha_reporte, titulo, situacion_actual,
               plantilla_whatsapp
          from core.alertas_tempranas
         where anulado_en is null
        """
    )
    filas = []
    for id_, codigo, fecha_db, titulo, situacion, plantilla in cur.fetchall():
        filas.append(
            {
                "id": str(id_),
                "codigo": codigo,
                "fecha": fecha_db,
                "titulo_n": _clave_texto(titulo),
                "cuerpos": {
                    "plantilla_whatsapp": _clave_texto(plantilla),
                    "situacion_actual": _clave_texto(situacion),
                },
            }
        )
    return filas


def _documentos_para_comparar(cur) -> list[dict[str, Any]]:
    cur.execute(
        """
        select id, codigo, fecha, titulo, contenido_json->>'texto_original'
          from core.documentos
         where anulado_en is null
        """
    )
    return [
        {
            "id": str(id_),
            "codigo": codigo or "(sin código)",
            "fecha": fecha_db,
            "titulo_n": _clave_texto(titulo),
            "cuerpos": {"contenido_json.texto_original": _clave_texto(texto_original)},
        }
        for id_, codigo, fecha_db, titulo, texto_original in cur.fetchall()
    ]


def detectar_duplicados(
    cur, libro, ctx: Contextos
) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Marca los registros del libro que ya están en la base con otro código.

    El `codigo_legado` del libro no existe en la base, pero el contenido puede
    ser el mismo reporte cargado antes por otra vía. Se compara por texto
    normalizado y por (título, fecha) antes de insertar.
    """
    duplicados: dict[str, dict[str, str]] = {
        "alertas_tempranas": {},
        "documentos": {},
    }
    duplicados_ids: dict[str, dict[str, str]] = {
        "alertas_tempranas": {},
        "documentos": {},
    }
    duplicados_codigos: dict[str, dict[str, str]] = {
        "alertas_tempranas": {},
        "documentos": {},
    }
    avisos: list[str] = []

    alertas = _alertas_para_comparar(cur)
    for fila in libro.hojas.get("alertas_tempranas", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado or legado in ctx.existentes.get("alertas_tempranas", {}):
            continue

        cuerpo = _clave_texto(fila.get("plantilla_whatsapp"))
        situacion = _clave_texto(fila.get("situacion_actual"))
        titulo = _clave_texto(fila.get("titulo"))
        fecha_libro = fecha(fila.get("fecha_reporte"))

        identico = next(
            (
                a
                for a in alertas
                if (cuerpo and a["cuerpos"]["plantilla_whatsapp"] == cuerpo)
                or (situacion and a["cuerpos"]["situacion_actual"] == situacion)
            ),
            None,
        )
        if identico is None and titulo and fecha_libro:
            identico = next(
                (
                    a
                    for a in alertas
                    if a["titulo_n"] == titulo and a["fecha"] == fecha_libro
                ),
                None,
            )
        if identico is not None:
            duplicados["alertas_tempranas"][legado] = (
                f"ya existe como {identico['codigo']}: mismo título y fecha o mismo "
                "texto del reporte"
            )
            duplicados_ids["alertas_tempranas"][legado] = identico["id"]
            duplicados_codigos["alertas_tempranas"][legado] = identico["codigo"]
            continue

        candidato, puntaje, dimension = _mejor_candidato(fila, alertas, CAMPOS_ALERTA)
        if candidato is None:
            continue
        cercano = dimension == "titulo"
        if cercano:
            distancia = _dias(fecha_libro, candidato["fecha"])
            cercano = distancia is None or distancia <= DIAS_TITULO
        if puntaje >= UMBRAL_CASI and (dimension == "texto" or cercano):
            duplicados["alertas_tempranas"][legado] = (
                f"ya existe como {candidato['codigo']} (similitud {puntaje:.2f} "
                f"en {dimension})"
            )
            duplicados_ids["alertas_tempranas"][legado] = candidato["id"]
            duplicados_codigos["alertas_tempranas"][legado] = candidato["codigo"]
        elif puntaje >= UMBRAL_DUDA:
            avisos.append(
                f"Alerta {legado}: posible duplicado de {candidato['codigo']} "
                f"(similitud {puntaje:.2f}); se carga igual"
            )

    documentos = _documentos_para_comparar(cur)
    for fila in libro.hojas.get("documentos", []):
        legado = texto(fila.get("codigo_legado"))
        if not legado or legado in ctx.existentes.get("documentos", {}):
            continue
        cuerpo = _clave_texto(fila.get("contenido_json.texto_original"))
        titulo = _clave_texto(fila.get("titulo"))
        fecha_libro = fecha(fila.get("fecha"))

        identico = None
        if cuerpo:
            identico = next(
                (
                    d
                    for d in documentos
                    if d["cuerpos"]["contenido_json.texto_original"] == cuerpo
                ),
                None,
            )
        if identico is None and titulo and fecha_libro:
            identico = next(
                (
                    d
                    for d in documentos
                    if d["titulo_n"] == titulo and d["fecha"] == fecha_libro
                ),
                None,
            )
        if identico is not None:
            duplicados["documentos"][legado] = (
                f"ya existe como {identico['codigo']}: mismo título y fecha o mismo "
                "texto del reporte"
            )
            duplicados_ids["documentos"][legado] = identico["id"]
            duplicados_codigos["documentos"][legado] = identico["codigo"]
            continue

        candidato, puntaje, dimension = _mejor_candidato(
            fila, documentos, CAMPOS_DOCUMENTO
        )
        if candidato is not None and puntaje >= UMBRAL_CASI and dimension == "texto":
            duplicados["documentos"][legado] = (
                f"ya existe como {candidato['codigo']} (similitud {puntaje:.2f} en texto)"
            )
            duplicados_ids["documentos"][legado] = candidato["id"]
            duplicados_codigos["documentos"][legado] = candidato["codigo"]
        elif candidato is not None and puntaje >= UMBRAL_DUDA:
            avisos.append(
                f"Documento {legado}: posible duplicado de {candidato['codigo']} "
                f"(similitud {puntaje:.2f}); se carga igual"
            )

    ctx.duplicados_ids = duplicados_ids
    ctx.duplicados_codigos = duplicados_codigos
    return duplicados, avisos


# --------------------------------------------------------------------------
# Fusión con filas ya existentes
# --------------------------------------------------------------------------

# Tablas donde se puede estampar el `codigo_legado` del libro sobre una fila
# que ya existe con otro código, y su columna de código legible.
TABLAS_MARCABLES = {
    "alertas_tempranas": "codigo_alerta",
    "documentos": "codigo",
}

_SIMILITUD_RE = re.compile(r"similitud ([0-9.]+)")


def _similitud_de(motivo: str) -> float:
    """Similitud declarada en un motivo de duplicado; 1,0 si es idéntico."""
    coincidencia = _SIMILITUD_RE.search(motivo)
    return float(coincidencia.group(1)) if coincidencia else 1.0


def _fusionar(ctx: Contextos, tabla: str, legado: str, id_destino: str) -> None:
    """Trata el legado como existente y deja de reportarlo como duplicado."""
    ctx.existentes.setdefault(tabla, {})[legado] = id_destino
    ctx.duplicados.get(tabla, {}).pop(legado, None)


def marcar_duplicados(
    cur, ctx: Contextos, simular: bool
) -> tuple[list[dict[str, Any]], list[str]]:
    """Estampa el `codigo_legado` del libro en la fila existente con otro código.

    Con `simular` no escribe en la base: solo refleja en `ctx` lo que haría el
    apply. Nunca sobrescribe un `codigo_legado` distinto: en ese caso lo deja
    como duplicado y devuelve una advertencia de conflicto.
    """
    marcas: list[dict[str, Any]] = []
    avisos: list[str] = []
    for tabla in TABLAS_MARCABLES:
        ids = ctx.duplicados_ids.get(tabla, {})
        codigos = ctx.duplicados_codigos.get(tabla, {})
        for legado, id_destino in ids.items():
            if legado in ctx.existentes.get(tabla, {}):
                continue
            codigo_destino = codigos.get(legado)
            motivo = ctx.duplicados.get(tabla, {}).get(legado, "")
            marca = {
                "tabla": tabla,
                "legado": legado,
                "id_destino": id_destino,
                "codigo_destino": codigo_destino,
                "similitud": _similitud_de(motivo),
            }
            if simular:
                marca["estado"] = "simulado"
                _fusionar(ctx, tabla, legado, id_destino)
                marcas.append(marca)
                continue

            cur.execute(
                sql.SQL(
                    "update core.{tabla} set codigo_legado = %s "
                    "where id = %s and codigo_legado is null"
                ).format(tabla=sql.Identifier(tabla)),
                (legado, id_destino),
            )
            if cur.rowcount == 1:
                marca["estado"] = "marcado"
                _fusionar(ctx, tabla, legado, id_destino)
                marcas.append(marca)
                continue

            cur.execute(
                sql.SQL("select codigo_legado from core.{tabla} where id = %s").format(
                    tabla=sql.Identifier(tabla)
                ),
                (id_destino,),
            )
            fila = cur.fetchone()
            existente = fila[0] if fila else None
            if existente == legado:
                marca["estado"] = "ya marcado"
                _fusionar(ctx, tabla, legado, id_destino)
            elif codigo_destino is not None and existente == codigo_destino:
                # El `codigo_legado` actual es el propio código generado (un
                # molde de relleno), no un legado ajeno: se sustituye.
                cur.execute(
                    sql.SQL(
                        "update core.{tabla} set codigo_legado = %s "
                        "where id = %s and codigo_legado = %s"
                    ).format(tabla=sql.Identifier(tabla)),
                    (legado, id_destino, existente),
                )
                if cur.rowcount == 1:
                    marca["estado"] = "marcado"
                    _fusionar(ctx, tabla, legado, id_destino)
                else:
                    marca["estado"] = "conflicto"
                    avisos.append(
                        f"{tabla} {legado}: no se pudo reemplazar el código "
                        f"de relleno de {codigo_destino}; no se fusiona"
                    )
            else:
                marca["estado"] = "conflicto"
                avisos.append(
                    f"{tabla} {legado}: la fila {codigo_destino} ya tiene "
                    f"codigo_legado '{existente}'; no se fusiona"
                )
            marcas.append(marca)
    return marcas, avisos


def deduplicar_demandas(cur, libro, ctx: Contextos) -> list[str]:
    """Omite las demandas del libro que ya existen en su padre de la base.

    Solo compara demandas cuyo padre está entre los `existentes` (por id), que
    es el caso tras fusionar una alerta o documento duplicado.
    """
    avisos: list[str] = []
    vistas = ctx.duplicados.setdefault("demandas", {})
    cache: dict[tuple[str, str], list[str]] = {}

    for fila in libro.hojas.get("demandas", []):
        legado = texto(fila.get("codigo_legado"))
        if (
            not legado
            or legado in ctx.existentes.get("demandas", {})
            or legado in vistas
        ):
            continue
        descripcion = texto(fila.get("descripcion_demanda"))
        if not descripcion:
            continue

        alerta_legado = texto(fila.get("alerta_codigo_legado"))
        documento_legado = texto(fila.get("documento_codigo_legado"))
        if bool(alerta_legado) == bool(documento_legado):
            continue

        if alerta_legado:
            tabla, padre_legado, columna = (
                "alertas_tempranas",
                alerta_legado,
                "alerta_id",
            )
        else:
            tabla, padre_legado, columna = (
                "documentos",
                documento_legado,
                "documento_origen_id",
            )

        padre_id = ctx.existentes.get(tabla, {}).get(padre_legado)
        if not padre_id:
            continue

        llave = (tabla, padre_id)
        if llave not in cache:
            cur.execute(
                sql.SQL(
                    "select descripcion_demanda from core.demandas where {col} = %s"
                ).format(col=sql.Identifier(columna)),
                (padre_id,),
            )
            cache[llave] = [
                norm
                for norm in map(_clave_texto, (r[0] for r in cur.fetchall()))
                if norm
            ]

        existentes = cache[llave]
        normal = _clave_texto(descripcion)
        codigo_padre = ctx.duplicados_codigos.get(tabla, {}).get(
            padre_legado, padre_legado
        )
        if normal and any(normal == existente for existente in existentes):
            vistas[legado] = f"ya existe en {codigo_padre}: misma descripción"
            continue

        mejor = 0.0
        for existente in existentes:
            mejor = max(mejor, _sim(normal, existente))
        if mejor >= UMBRAL_CASI:
            vistas[legado] = (
                f"ya existe en {codigo_padre}: descripción parecida "
                f"(similitud {mejor:.2f})"
            )
        elif mejor >= UMBRAL_DUDA:
            avisos.append(
                f"Demanda {legado}: posible duplicado en {codigo_padre} "
                f"(similitud {mejor:.2f}); se carga igual"
            )
    return avisos


def contexto_completo(cur, alias: dict[str, dict[str, str]]) -> Contextos:
    ctx = Contextos(alias=alias)

    ctx.alcances = _mapa_catalogo(cur, "cat_alcances_alerta", ("codigo",))
    ctx.subsectores = _mapa_catalogo(cur, "cat_subsectores", ("nombre",))
    ctx.niveles_riesgo = _mapa_catalogo(cur, "cat_niveles_riesgo", ("codigo",))
    ctx.tipos_actor = _mapa_catalogo(cur, "cat_tipos_actor", ("nombre",))
    ctx.roles_actor = _mapa_catalogo(cur, "cat_roles_actor", ("nombre",))
    ctx.perfiles_actor = _mapa_catalogo(cur, "cat_perfiles_actor", ("nombre",))
    ctx.tipos_documento = _mapa_catalogo(
        cur, "cat_tipos_documento", ("codigo", "nombre")
    )
    ctx.tipos_reunion = _mapa_catalogo(cur, "cat_tipos_reunion", ("codigo",))

    cur.execute("select id, nombre from core.usuarios")
    ctx.usuarios = {clave(nombre): str(id_) for id_, nombre in cur.fetchall() if nombre}

    (
        ctx.regiones,
        ctx.provincias,
        ctx.distritos,
        ctx.distritos_por_nombre,
    ) = _territorio(cur)

    ctx.actores_directorio = _actores_directorio(cur)

    ctx.existentes = {
        "alertas_tempranas": _existentes(cur, "alertas_tempranas", "codigo_legado"),
        "documentos": _existentes(cur, "documentos", "codigo_legado"),
        "demandas": _existentes(cur, "demandas", "codigo_legado"),
        "reuniones_dialogo": _existentes(cur, "reuniones_dialogo", "codigo_legado"),
    }
    ctx.longitudes = _longitudes(cur)

    for tabla, columna, prefijo, etiqueta in PREFIJOS:
        ctx.secuencias.update(_secuencias(cur, tabla, columna, prefijo, etiqueta))

    return ctx


# --------------------------------------------------------------------------
# Ejecución
# --------------------------------------------------------------------------


def _columnas_y_valores(
    tabla: str, datos: dict[str, Any]
) -> tuple[list[str], list[Any]]:
    columnas = list(datos)
    valores = [
        psycopg2.extras.Json(valor)
        if valor is not None and columna in JSONB.get(tabla, ())
        else valor
        for columna, valor in datos.items()
    ]
    return columnas, valores


def _insertar(cur, tabla: str, datos: dict[str, Any]) -> str | None:
    columnas, valores = _columnas_y_valores(tabla, datos)
    devolver = (
        sql.SQL("")
        if tabla in SIN_ID
        else sql.SQL(" returning {col} as id").format(
            col=sql.Identifier(COLUMNA_ID.get(tabla, "id"))
        )
    )
    consulta = sql.SQL(
        "insert into core.{tabla} ({columnas}) values ({marcas}){devolver}"
    ).format(
        tabla=sql.Identifier(tabla),
        columnas=sql.SQL(", ").join(map(sql.Identifier, columnas)),
        marcas=sql.SQL(", ").join(sql.Placeholder() * len(columnas)),
        devolver=devolver,
    )
    if tabla in SIN_ID:
        consulta = sql.SQL("{consulta} on conflict do nothing").format(
            consulta=consulta
        )
    cur.execute(consulta, valores)
    if tabla in SIN_ID:
        return None
    return str(cur.fetchone()[0])


class Ejecutor:
    """Inserta el plan una fila por vez, con un savepoint por fila."""

    def __init__(self, cur, existentes: dict[str, dict[str, str]]) -> None:
        self.cur = cur
        self.existentes = existentes
        self.resueltos: dict[tuple[str, str], str] = {}
        self.fallidos: dict[tuple[str, str], str] = {}
        self.contador = 0

    def _ref(self, tabla: str, ref: str) -> str:
        if (tabla, ref) in self.fallidos:
            raise ErrorDependencia(
                f"'{ref}' no se insertó en {tabla}: {self.fallidos[(tabla, ref)]}"
            )
        encontrado = self.resueltos.get((tabla, ref)) or self.existentes.get(
            tabla, {}
        ).get(ref)
        if encontrado:
            return encontrado
        if tabla == "actores" and UUID_RE.match(ref):
            return ref
        raise ErrorDependencia(f"'{ref}' no existe en {tabla}")

    def _preparar(self, ins: Insercion) -> dict[str, Any]:
        datos = dict(ins.datos)
        tabla = ins.tabla
        if tabla == "alerta_hechos":
            datos["alerta_id"] = self._ref("alertas_tempranas", datos.pop("alerta_ref"))
        elif tabla == "alertas_actores":
            datos["alerta_id"] = self._ref("alertas_tempranas", datos.pop("alerta_ref"))
            datos["actor_id"] = self._ref("actores", datos.pop("actor_ref"))
        elif tabla == "documento_actores":
            datos["documento_id"] = self._ref("documentos", datos.pop("documento_ref"))
            datos["actor_uid"] = self._ref("actores", datos.pop("actor_ref"))
        elif tabla == "documentos":
            ref = datos.pop("reunion_ref", None)
            if ref:
                datos["reunion_id"] = self._ref("reuniones_dialogo", ref)
        elif tabla == "demandas":
            if "alerta_ref" in datos:
                datos["alerta_id"] = self._ref(
                    "alertas_tempranas", datos.pop("alerta_ref")
                )
            if "documento_ref" in datos:
                datos["documento_origen_id"] = self._ref(
                    "documentos", datos.pop("documento_ref")
                )
        return datos

    def ejecutar(self, ins: Insercion) -> str | None:
        datos = self._preparar(ins)
        telefono = datos.pop("telefono", None) if ins.tabla == "actores" else None

        self.contador += 1
        nombre_sp = sql.Identifier(f"sp_{self.contador:06d}")
        self.cur.execute(sql.SQL("savepoint {}").format(nombre_sp))
        try:
            id_ = _insertar(self.cur, ins.tabla, datos)
            if ins.tabla in SIN_ID and self.cur.rowcount == 0:
                raise YaExiste(f"'{ins.clave}' ya existe en {ins.tabla}")
            if telefono and id_:
                _insertar(
                    self.cur,
                    "actor_datos_personales",
                    {"actor_uid": id_, "telefono_contacto": telefono},
                )
            self.cur.execute(sql.SQL("release savepoint {}").format(nombre_sp))
        except Exception:
            self.cur.execute(sql.SQL("rollback to savepoint {}").format(nombre_sp))
            self.cur.execute(sql.SQL("release savepoint {}").format(nombre_sp))
            raise

        if id_:
            self.resueltos[(ins.tabla, ins.clave)] = id_
        return id_


def aplicar(
    cur, plan: Plan, ctx: Contextos, solo: set[str] | None
) -> list[dict[str, Any]]:
    ejecutor = Ejecutor(cur, ctx.existentes)
    resultados: list[dict[str, Any]] = []

    for ins in plan.inserciones:
        if solo and ins.tabla not in solo:
            resultados.append(
                {
                    "tabla": ins.tabla,
                    "clave": ins.clave,
                    "estado": "OMITIDO",
                    "motivo": "fuera del filtro --solo",
                }
            )
            continue
        try:
            id_ = ejecutor.ejecutar(ins)
        except ErrorDependencia as exc:
            ejecutor.fallidos[(ins.tabla, ins.clave)] = str(exc)
            resultados.append(
                {
                    "tabla": ins.tabla,
                    "clave": ins.clave,
                    "estado": "RECHAZADO",
                    "motivo": str(exc),
                }
            )
        except YaExiste as exc:
            resultados.append(
                {
                    "tabla": ins.tabla,
                    "clave": ins.clave,
                    "estado": "OMITIDO",
                    "motivo": str(exc),
                }
            )
        except psycopg2.Error as exc:
            motivo = f"{exc.pgcode or ''} {exc.pgerror or str(exc)}".strip()
            ejecutor.fallidos[(ins.tabla, ins.clave)] = motivo
            resultados.append(
                {
                    "tabla": ins.tabla,
                    "clave": ins.clave,
                    "estado": "RECHAZADO",
                    "motivo": motivo,
                }
            )
        else:
            resultados.append(
                {
                    "tabla": ins.tabla,
                    "clave": ins.clave,
                    "estado": "INSERTADO",
                    "id": id_,
                }
            )
    return resultados


# --------------------------------------------------------------------------
# Informe
# --------------------------------------------------------------------------


def _tabla_resumen(plan: Plan, resultados: list[dict[str, Any]] | None) -> list[str]:
    lineas = [
        "| tabla | insertar | ya existe | rechazos | escritos | fallos |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for tabla in TABLAS_RESUMEN:
        fila = plan.resumen.get(tabla, {})
        escritos = fallos = 0
        if resultados is not None:
            escritos = sum(
                1
                for r in resultados
                if r["tabla"] == tabla and r["estado"] == "INSERTADO"
            )
            fallos = sum(
                1
                for r in resultados
                if r["tabla"] == tabla and r["estado"] == "RECHAZADO"
            )
        lineas.append(
            f"| {tabla} | {fila.get('insertar', 0)} | {fila.get('omitidos', 0)} | "
            f"{fila.get('rechazos', 0)} | {escritos} | {fallos} |"
        )
    return lineas


def _demandas_omitidas_contenido(plan: Plan) -> int:
    return sum(
        1
        for omision in plan.omitidos
        if omision.tabla == "demandas" and omision.motivo.startswith("ya existe en ")
    )


def _resumen_marcas(marcas: list[dict[str, Any]]) -> str:
    estados: dict[str, int] = {}
    for marca in marcas:
        estados[marca["estado"]] = estados.get(marca["estado"], 0) + 1
    partes = ", ".join(f"{n} {estado}(s)" for estado, n in estados.items())
    return f"Marcas de codigo_legado: {partes}"


def _seccion_marcas(marcas: list[dict[str, Any]]) -> list[str]:
    if not marcas:
        return []
    lineas = ["## Marcas de codigo_legado", ""]
    for marca in marcas:
        lineas.append(
            f"- `{marca['legado']}` → `{marca['codigo_destino']}` "
            f"(similitud {marca['similitud']:.2f}) — {marca['estado']}"
        )
    lineas.append("")
    return lineas


def informe_markdown(
    plan: Plan,
    modo: str,
    resultados: list[dict[str, Any]] | None,
    huella: str,
    marcas: list[dict[str, Any]] | None = None,
) -> str:
    lineas = [f"# Carga histórica · {modo}", ""]
    lineas.append(f"- huella del plan: `{huella}`")
    if plan.alias_usados:
        alias = ", ".join(f"{k}: {v}" for k, v in sorted(plan.alias_usados.items()))
        lineas.append(f"- valores resueltos por alias: {alias}")
    lineas.append("")
    lineas += _tabla_resumen(plan, resultados)
    lineas.append("")

    omitidas = _demandas_omitidas_contenido(plan)
    if omitidas:
        lineas.append(f"- demandas omitidas por contenido: {omitidas}")
        lineas.append("")

    lineas += _seccion_marcas(marcas or [])

    if plan.omitidos:
        lineas += ["## Ya existentes", ""]
        for omision in plan.omitidos:
            lineas.append(
                f"- `{omision.codigo_legado}` ({omision.tabla}): {omision.motivo}"
            )
        lineas.append("")

    if plan.rechazos:
        lineas += ["## Rechazos", ""]
        for rechazo in plan.rechazos:
            codigo = f"`{rechazo.codigo_legado}` " if rechazo.codigo_legado else ""
            lineas.append(f"- {codigo}({rechazo.tabla}): {rechazo.motivo}")
        lineas.append("")

    if plan.advertencias:
        lineas += ["## Advertencias", ""]
        lineas += [f"- {advertencia}" for advertencia in plan.advertencias]
        lineas.append("")

    if resultados:
        fallos = [r for r in resultados if r["estado"] == "RECHAZADO"]
        if fallos:
            lineas += ["## Fallos de escritura", ""]
            for fallo in fallos:
                lineas.append(
                    f"- `{fallo['clave']}` ({fallo['tabla']}): {fallo['motivo']}"
                )
            lineas.append("")

    return "\n".join(lineas)


def resumen_consola(plan: Plan, resultados: list[dict[str, Any]] | None) -> str:
    cabecera = f"{'tabla':<22}{'insertar':>10}{'ya existe':>11}{'rechazos':>10}"
    if resultados is not None:
        cabecera += f"{'escritos':>10}{'fallos':>8}"
    lineas = [cabecera]
    for tabla in TABLAS_RESUMEN:
        fila = plan.resumen.get(tabla, {})
        linea = (
            f"{tabla:<22}{fila.get('insertar', 0):>10}"
            f"{fila.get('omitidos', 0):>11}{fila.get('rechazos', 0):>10}"
        )
        if resultados is not None:
            escritos = sum(
                1
                for r in resultados
                if r["tabla"] == tabla and r["estado"] == "INSERTADO"
            )
            fallos = sum(
                1
                for r in resultados
                if r["tabla"] == tabla and r["estado"] == "RECHAZADO"
            )
            linea += f"{escritos:>10}{fallos:>8}"
        lineas.append(linea)
    return "\n".join(lineas)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def leer_alias(ruta: Path) -> dict[str, dict[str, str]]:
    if not ruta.exists():
        return {}
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    return {
        dimension: {clave(origen): destino for origen, destino in valores.items()}
        for dimension, valores in datos.items()
        if isinstance(valores, dict)
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Carga histórica de alertas desde el libro del sectorista."
    )
    parser.add_argument("--excel", required=True, help="Ruta del libro .xlsx")
    parser.add_argument("--dsn", help="DSN explícito (por defecto, .env)")
    parser.add_argument("--alias", default=str(ALIAS_POR_DEFECTO))
    parser.add_argument("--informe", help="Ruta del informe (.json o .md)")
    parser.add_argument("--solo", help="Tablas a escribir, separadas por comas")
    parser.add_argument(
        "--sin-dedup",
        action="store_true",
        help="No comparar con el contenido ya cargado: inserta todo",
    )
    parser.add_argument("--apply", action="store_true", help="Escribe en la base")
    parser.add_argument(
        "--marcar-duplicados",
        action="store_true",
        help=(
            "Marca el codigo_legado del libro en las filas ya existentes "
            "(fusión) y deduplica sus demandas"
        ),
    )
    parser.add_argument(
        "--ensayo-escritura",
        action="store_true",
        help="Con --confirmar: aplica el plan y revierte la transacción al final",
    )
    parser.add_argument(
        "--confirmar",
        action="store_true",
        help="Confirma la escritura: obligatorio junto con --apply",
    )
    parser.add_argument(
        "--continuar",
        action="store_true",
        help="Con --apply: confirma lo escrito aunque alguna fila falle",
    )
    args = parser.parse_args(argv)

    if args.apply and args.ensayo_escritura:
        print(
            "--apply y --ensayo-escritura son mutuamente excluyentes: elige uno.",
            file=sys.stderr,
        )
        return 2

    if args.apply and not args.confirmar:
        print(
            "Se pidió --apply sin --confirmar: no se abre ninguna conexión de "
            "escritura. Añade --confirmar para cargar de verdad.",
            file=sys.stderr,
        )
        return 2

    if args.ensayo_escritura and not args.confirmar:
        print(
            "Se pidió --ensayo-escritura sin --confirmar: no se abre ninguna "
            "conexión de escritura. Añade --confirmar para cargar de verdad.",
            file=sys.stderr,
        )
        return 2

    if args.apply:
        modo = "aplicación"
    elif args.ensayo_escritura:
        modo = "ensayo de escritura"
    else:
        modo = "ensayo"
    solo = (
        {parte.strip() for parte in args.solo.split(",") if parte.strip()}
        if args.solo
        else None
    )

    try:
        libro = leer_libro(args.excel)
    except ErrorEstructura as exc:
        print(f"El libro no tiene la estructura esperada: {exc}", file=sys.stderr)
        return 1

    alias = leer_alias(Path(args.alias))
    conn = conectar(args.dsn, solo_lectura=not (args.apply or args.ensayo_escritura))
    try:
        cur = conn.cursor()
        ctx = contexto_completo(cur, alias)
        avisos: list[str] = []
        marcas: list[dict[str, Any]] = []
        duplicados_detectados: dict[str, int] = {}
        if not args.sin_dedup:
            ctx.duplicados, avisos = detectar_duplicados(cur, libro, ctx)
            duplicados_detectados = {
                tabla: len(valores) for tabla, valores in ctx.duplicados.items()
            }
            if args.marcar_duplicados:
                marcas, avisos_marcas = marcar_duplicados(
                    cur,
                    ctx,
                    simular=not (args.apply or args.ensayo_escritura),
                )
                avisos.extend(avisos_marcas)
                avisos.extend(deduplicar_demandas(cur, libro, ctx))
        plan = construir_plan(libro.hojas, ctx)
        plan.advertencias.extend(avisos)
        huella = plan.huella()

        print(f"== Carga histórica · {modo} ==")
        if not args.sin_dedup:
            print(
                "Duplicados por contenido: "
                f"{duplicados_detectados.get('alertas_tempranas', 0)} alerta(s), "
                f"{duplicados_detectados.get('documentos', 0)} documento(s)"
            )
        if marcas:
            print(_resumen_marcas(marcas))
        print(
            f"Plan: {len(plan.inserciones)} inserciones, "
            f"{len(plan.omitidos)} ya existentes, "
            f"{len(plan.rechazos)} rechazos, "
            f"{len(plan.advertencias)} advertencias"
        )
        if args.marcar_duplicados:
            print(
                f"Demandas omitidas por contenido: {_demandas_omitidas_contenido(plan)}"
            )
        if plan.alias_usados:
            print(
                "Alias de catálogo usados: "
                + ", ".join(f"{k}={v}" for k, v in sorted(plan.alias_usados.items()))
            )

        resultados: list[dict[str, Any]] | None = None
        if args.apply or args.ensayo_escritura:
            resultados = aplicar(cur, plan, ctx, solo)
            fallos = [r for r in resultados if r["estado"] == "RECHAZADO"]
            if args.ensayo_escritura:
                conn.rollback()
                print(
                    "\nEnsayo de escritura: transacción revertida; no se persistió nada."
                )
            elif fallos and not args.continuar:
                conn.rollback()
                print(
                    f"\n{len(fallos)} fila(s) fallaron: se deshace la carga completa. "
                    "Revisa el informe; usa --continuar para confirmar lo escrito.",
                    file=sys.stderr,
                )
            else:
                conn.commit()
                print("\nCarga confirmada (commit).")
        else:
            conn.rollback()

        print()
        print(resumen_consola(plan, resultados))

        marca = datetime.now().strftime("%Y-%m-%d_%H%M")
        if args.apply:
            sufijo = "apply"
        elif args.ensayo_escritura:
            sufijo = "rollback"
        else:
            sufijo = "dry"
        ruta = (
            Path(args.informe)
            if args.informe
            else INFORMES / f"informe_{marca}_{sufijo}.md"
        )
        if ruta.suffix.lower() == ".json":
            cuerpo = json.dumps(
                {
                    "modo": modo,
                    "libro": str(args.excel),
                    "huella": huella,
                    "resumen": plan.resumen,
                    "inserciones": [asdict(i) for i in plan.inserciones],
                    "omitidos": [asdict(o) for o in plan.omitidos],
                    "rechazos": [asdict(r) for r in plan.rechazos],
                    "advertencias": plan.advertencias,
                    "alias_usados": plan.alias_usados,
                    "marcas": marcas,
                    "resultados": resultados,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        else:
            cuerpo = informe_markdown(plan, modo, resultados, huella, marcas)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(cuerpo, encoding="utf-8")
        print(f"\nInforme: {ruta}")

        if not (args.apply or args.ensayo_escritura):
            print("Ensayo sin escritura: no se modificó la base.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
