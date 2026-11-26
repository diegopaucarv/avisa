#!/usr/bin/env python
"""Preflight de SÓLO LECTURA para la recarga de la matriz 2026.

Qué mide y qué NO hace
----------------------
* Se conecta con ``set_session(readonly=True, autocommit=True)``.
* No ejecuta INSERT/UPDATE/DELETE ni DDL. No borra nada: sólo cuenta lo que
  un borrado *haría* y lo que lo *bloquearía*.
* Compara los nombres de caso del insumo ``salida/matriz_2026.json`` contra
  ``core.casos`` por nombre normalizado exacto y, aparte, por similitud.
* Recorre ``pg_constraint`` con ``confdeltype='c'`` para calcular la cascada
  real (incluye cascadas de segundo nivel, p. ej. caso -> compromiso -> hito).
* Lista las FK que cuelgan del dominio y marca las que NO son cascada.
* Evalúa el modelo actual frente a los datos del Excel (4 compromisos con 3
  demandas, 2 compromisos en 2 casos, 32/37 casos sin demandas, 11 compromisos
  sin hitos) y deja el DDL mínimo **en texto**, sin ejecutarlo.

Salida
------
``scripts/matriz/salida/preflight_bd.json`` y un resumen por pantalla.

Uso
---
    python scripts/matriz/analizar_bd_matriz.py
    python scripts/matriz/analizar_bd_matriz.py --nombres otra/ruta.json
    python scripts/matriz/analizar_bd_matriz.py --no-escribir   # sólo pantalla

Si ``matriz_2026.json`` no existe, el script NO falla: deja el preflight por
nombre preparado y sin ejecutar, y mide igualmente el mapa de FK, los conteos,
la evaluación del modelo y un caso demostrativo (el de más dependencias).
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import os
import re
import sys
import unicodedata
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from psycopg2 import sql

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
RUTA_ENV = REPO / ".env"
RUTA_NOMBRES = HERE / "salida" / "matriz_2026.json"
RUTA_SALIDA = HERE / "salida" / "preflight_bd.json"

TABLAS_DOMINIO = (
    "core.casos",
    "core.demandas",
    "core.compromisos",
    "core.hitos_compromiso",
)

ACCIONES = {
    "c": "CASCADE",
    "a": "NO ACTION",
    "r": "RESTRICT",
    "n": "SET NULL",
    "d": "SET DEFAULT",
}

CAMPOS_NOMBRE = (
    "nombre_caso",
    "nombre_caso_excel",
    "nombre_oficial_metadatos",
    "nombre",
    "Nombre_Caso",
    "titulo",
    "caso",
)

CAMPOS_CODIGO = ("codigo_caso", "Codigo_Caso", "codigo", "codigo_legado")

SUPUESTOS_EXCEL = {
    "casos": 37,
    "demandas": 23,
    "compromisos": 56,
    "textos_compromiso": 54,
    "hitos": 111,
    "compromisos_con_3_demandas": 4,
    "demandas_por_compromiso_m_n": 3,
    "compromisos_en_2_casos": 2,
    "casos_por_compromiso_m_n": 2,
    "casos_sin_demandas": 32,
    "compromisos_sin_hitos": 11,
    "fuente": (
        "Datos verificados del Excel entregados en el encargo. No se miden en "
        "esta base: la matriz 2026 todavía no está cargada."
    ),
}


# ---------------------------------------------------------------------------
# Utilidades de texto y JSON
# ---------------------------------------------------------------------------


def normalizar(texto: Any) -> str:
    """Normaliza para comparar nombres: sin tildes, minúsculas, sin puntuación."""
    if texto is None:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.casefold()
    s = re.sub(r"[^0-9a-z]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def similitud(a: str, b: str) -> float:
    """Mezcla ratio de secuencia y Jaccard de tokens; devuelve 0..1."""
    if not a or not b:
        return 0.0
    seq = difflib.SequenceMatcher(None, a, b).ratio()
    ta = set(a.split())
    tb = set(b.split())
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    return round(max(seq, jac), 4)


def _json_val(valor: Any) -> Any:
    if isinstance(valor, uuid.UUID):
        return str(valor)
    if isinstance(valor, (dt.datetime, dt.date)):
        return valor.isoformat()
    return valor


def _iso(valor: Any) -> Any:
    if isinstance(valor, (dt.datetime, dt.date)):
        return valor.isoformat()
    return valor


def _clave(valor: Any) -> Any:
    if isinstance(valor, uuid.UUID):
        return str(valor)
    if isinstance(valor, (dt.datetime, dt.date)):
        return valor.isoformat()
    return str(valor) if valor is not None else None


def _cargar_json(ruta: Path) -> Any:
    return json.loads(ruta.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Lectura tolerante del insumo de nombres
# ---------------------------------------------------------------------------


def _nombre_de_entrada(entrada: Any) -> tuple[str, str, list[dict], str | None] | None:
    """Devuelve (nombre_principal, campo, alias, codigo) o None."""
    if isinstance(entrada, str):
        valor = entrada.strip()
        if valor:
            return valor, "texto", [{"campo": "texto", "valor": valor}], None
        return None
    if not isinstance(entrada, dict):
        return None

    # Algunos exportes anidan el caso en {"caso": {...}}.
    anidado = entrada.get("caso")
    if isinstance(anidado, dict):
        r = _nombre_de_entrada(anidado)
        if r:
            return r

    alias: list[tuple[str, str]] = []
    for campo in CAMPOS_NOMBRE:
        valor = entrada.get(campo)
        if isinstance(valor, str) and valor.strip():
            alias.append((campo, valor.strip()))

    if not alias:
        return None

    codigo = None
    for campo in CAMPOS_CODIGO:
        valor = entrada.get(campo)
        if isinstance(valor, str) and valor.strip():
            codigo = valor.strip()
            break

    vistos: set[str] = set()
    alias_unicos: list[dict] = []
    for campo, valor in alias:
        if valor in vistos:
            continue
        vistos.add(valor)
        alias_unicos.append({"campo": campo, "valor": valor})

    nombre = alias_unicos[0]["valor"]
    campo_principal = alias_unicos[0]["campo"]
    return nombre, campo_principal, alias_unicos, codigo


def _extraer_entradas(datos: Any) -> list[Any]:
    if isinstance(datos, list):
        return datos
    if not isinstance(datos, dict):
        return []

    if any(isinstance(datos.get(c), str) for c in CAMPOS_NOMBRE):
        return [datos]

    for clave in (
        "casos",
        "casos_2026",
        "matriz",
        "data",
        "filas",
        "items",
        "registros",
        "entradas",
    ):
        valor = datos.get(clave)
        if isinstance(valor, list):
            return valor

    # Búsqueda acotada: primera lista de diccionarios que parezca de casos.
    for valor in datos.values():
        if isinstance(valor, list) and valor:
            if any(
                isinstance(x, dict)
                and any(isinstance(x.get(c), str) for c in CAMPOS_NOMBRE)
                for x in valor
            ):
                return valor
        if isinstance(valor, dict):
            r = _extraer_entradas(valor)
            if r:
                return r
    return []


def cargar_nombres(ruta: Path) -> dict:
    info: dict[str, Any] = {
        "ruta": str(ruta),
        "existe": ruta.exists(),
        "total_entradas": 0,
        "entradas_sin_nombre": 0,
        "nombres": [],
        "motivo": None,
        "error": None,
    }
    if not info["existe"]:
        info["motivo"] = (
            "No existe el insumo; el preflight por nombre queda preparado y "
            "sin ejecutar. El resto de mediciones sí se ejecuta."
        )
        return info

    try:
        datos = _cargar_json(ruta)
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"{type(exc).__name__}: {exc}"
        info["motivo"] = "El insumo existe pero no se pudo leer como JSON."
        return info

    entradas = _extraer_entradas(datos)
    info["total_entradas"] = len(entradas)

    for entrada in entradas:
        r = _nombre_de_entrada(entrada)
        if r is None:
            info["entradas_sin_nombre"] += 1
            continue
        nombre, campo, alias, codigo = r
        info["nombres"].append(
            {
                "nombre": nombre,
                "campo": campo,
                "alias": alias,
                "codigo": codigo,
            }
        )

    if not info["nombres"]:
        info["motivo"] = (
            "El JSON existe pero no se reconoció ningún nombre de caso "
            "(se aceptan nombre_caso, nombre_caso_excel, nombre_oficial_metadatos, "
            "nombre, Nombre_Caso, titulo o caso)."
        )
    return info


# ---------------------------------------------------------------------------
# Conexión e introspección
# ---------------------------------------------------------------------------


def conectar() -> Any:
    load_dotenv(RUTA_ENV)
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("No hay NEON_OWNER_URL ni DATABASE_URL en el entorno/.env")
    conn = psycopg2.connect(url)
    # La única garantía de escritura: la sesión es de sólo lectura.
    conn.set_session(readonly=True, autocommit=True)
    return conn


def cargar_fks(cur: Any) -> list[dict]:
    cur.execute(
        """
        select c.conname,
               pn.nspname || '.' || pc.relname as tabla_padre,
               cn.nspname || '.' || cc.relname as tabla_hija,
               c.confdeltype as accion,
               (select array_agg(a.attname order by k.ord)
                  from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a
                    on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols_hija,
               (select array_agg(a.attname order by k.ord)
                  from unnest(c.confkey) with ordinality k(attnum, ord)
                  join pg_attribute a
                    on a.attrelid = c.confrelid and a.attnum = k.attnum) as cols_padre
          from pg_constraint c
          join pg_class pc on pc.oid = c.confrelid
          join pg_namespace pn on pn.oid = pc.relnamespace
          join pg_class cc on cc.oid = c.conrelid
          join pg_namespace cn on cn.oid = cc.relnamespace
         where c.contype = 'f'
         order by tabla_padre, tabla_hija, c.conname
        """
    )
    fks: list[dict] = []
    for r in cur.fetchall():
        fks.append(
            {
                "conname": r["conname"],
                "parent": r["tabla_padre"],
                "child": r["tabla_hija"],
                "action": r["accion"],
                "child_cols": list(r["cols_hija"] or []),
                "parent_cols": list(r["cols_padre"] or []),
            }
        )
    return fks


def cargar_pks(cur: Any, fks: list[dict]) -> tuple[dict, dict]:
    tablas = sorted({fk["parent"] for fk in fks} | {fk["child"] for fk in fks})
    cur.execute(
        """
        select n.nspname || '.' || c.relname as tabla,
               a.attname as columna,
               format_type(a.atttypid, a.atttypmod) as tipo,
               k.ord
          from pg_index i
          join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          join unnest(i.indkey) with ordinality k(attnum, ord) on true
          join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
         where i.indisprimary
           and n.nspname || '.' || c.relname = any(%s)
         order by tabla, k.ord
        """,
        (tablas,),
    )
    pks: dict[str, list[str]] = defaultdict(list)
    tipos: dict[str, list[str]] = defaultdict(list)
    for r in cur.fetchall():
        pks[r["tabla"]].append(r["columna"])
        tipos[r["tabla"]].append(r["tipo"])
    return dict(pks), dict(tipos)


def _tabla_sql(tabla: str) -> sql.Composed:
    schema, nombre = tabla.split(".", 1)
    return sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(nombre))


def _adapt(valor: Any, tipo: str) -> Any:
    if valor is None:
        return None
    # Se comparan las PK por texto (::text): evita depender del adaptador de
    # uuid de psycopg2 y funciona igual para uuid, enteros y texto.
    return str(valor)


def _identidad(fila: dict, tabla: str, pks: dict) -> tuple:
    columnas = pks.get(tabla)
    if columnas:
        return tuple(_clave(fila.get(c)) for c in columnas)
    return (str(fila.get("__ctid")),)


def _id_publico(fila: dict, tabla: str, pks: dict) -> Any:
    columnas = pks.get(tabla)
    if not columnas:
        return fila.get("__ctid")
    valores = {c: _json_val(fila.get(c)) for c in columnas}
    if len(valores) == 1:
        return next(iter(valores.values()))
    return valores


def _hijos_de_lote(
    cur: Any,
    fk: dict,
    idents_padre: list[tuple],
    pks: dict,
    pk_types: dict,
) -> list[tuple[dict, tuple, tuple]]:
    """Hijos que referencian a los padres indicados.

    Devuelve [(fila_hija, identidad_padre, identidad_hija), ...].
    """
    if not idents_padre:
        return []

    padre = fk["parent"]
    hijo = fk["child"]
    pk_cols = pks[padre]
    pk_tipos = pk_types[padre]

    select_parts = [
        sql.SQL("p.{c} as {a}").format(
            c=sql.Identifier(c), a=sql.Identifier(f"__parent_{i}")
        )
        for i, c in enumerate(pk_cols)
    ]
    select_parts.append(sql.SQL("c.*"))
    select_parts.append(sql.SQL("c.ctid::text as __ctid"))

    on_parts = [
        sql.SQL("c.{ch} = p.{pa}").format(ch=sql.Identifier(ch), pa=sql.Identifier(pa))
        for ch, pa in zip(fk["child_cols"], fk["parent_cols"])
    ]

    params: list[Any] = []
    if len(pk_cols) == 1:
        placeholders = sql.SQL(", ").join([sql.Placeholder()] * len(idents_padre))
        condicion = sql.SQL("p.{c}::text in ({ph})").format(
            c=sql.Identifier(pk_cols[0]), ph=placeholders
        )
        for ident in idents_padre:
            params.append(_adapt(ident[0], pk_tipos[0]))
    else:
        grupos = []
        for ident in idents_padre:
            grupos.append(
                sql.SQL("(")
                + sql.SQL(", ").join([sql.Placeholder()] * len(pk_cols))
                + sql.SQL(")")
            )
            for valor, tipo in zip(ident, pk_tipos):
                params.append(_adapt(valor, tipo))
        cols_texto = sql.SQL(", ").join(
            sql.SQL("p.{}::text").format(sql.Identifier(c)) for c in pk_cols
        )
        condicion = sql.SQL("({cols}) in ({grupos})").format(
            cols=cols_texto,
            grupos=sql.SQL(", ").join(grupos),
        )

    consulta = sql.SQL(
        "select {sel} from {hijo} c join {padre} p on {on} where {cond}"
    ).format(
        sel=sql.SQL(", ").join(select_parts),
        hijo=_tabla_sql(hijo),
        padre=_tabla_sql(padre),
        on=sql.SQL(" and ").join(on_parts),
        cond=condicion,
    )
    cur.execute(consulta, params)

    salida: list[tuple[dict, tuple, tuple]] = []
    for r in cur.fetchall():
        fila = dict(r)
        ident_padre = tuple(
            _clave(fila.get(f"__parent_{i}")) for i in range(len(pk_cols))
        )
        ident_hija = _identidad(fila, hijo, pks)
        salida.append((fila, ident_padre, ident_hija))
    return salida


# ---------------------------------------------------------------------------
# Casos de la base
# ---------------------------------------------------------------------------


def cargar_casos_bd(cur: Any) -> list[dict]:
    cur.execute(
        """
        select c.id::text as id,
               c.codigo_caso,
               c.nombre_caso,
               c.estado_id,
               e.codigo as estado,
               c.estado_actualizacion,
               c.anulado_en,
               c.motivo_anulacion
          from core.casos c
          left join core.cat_estados_caso e on e.id = c.estado_id
         order by c.codigo_caso nulls last, c.nombre_caso
        """
    )
    casos: list[dict] = []
    for r in cur.fetchall():
        c = dict(r)
        c["anulado"] = c["anulado_en"] is not None
        c["anulado_en"] = _iso(c["anulado_en"])
        casos.append(c)
    return casos


def _caso_publico(caso: dict) -> dict:
    return {
        "id": str(caso["id"]),
        "codigo_caso": caso.get("codigo_caso"),
        "nombre_caso": caso.get("nombre_caso"),
        "estado_id": caso.get("estado_id"),
        "estado": caso.get("estado"),
        "estado_actualizacion": caso.get("estado_actualizacion"),
        "anulado": bool(caso.get("anulado")),
        "anulado_en": _iso(caso.get("anulado_en")),
        "motivo_anulacion": caso.get("motivo_anulacion"),
    }


# ---------------------------------------------------------------------------
# Conteos actuales
# ---------------------------------------------------------------------------


def contar_tablas(cur: Any) -> dict:
    conteos: dict[str, Any] = {}
    for tabla in TABLAS_DOMINIO:
        schema, nombre = tabla.split(".", 1)
        cur.execute(sql.SQL("select count(*) from {}").format(_tabla_sql(tabla)))
        total = int(cur.fetchone()["count"])
        cur.execute(
            sql.SQL(
                "select count(*) filter (where anulado_en is null) as vigentes, "
                "count(*) filter (where anulado_en is not null) as anulados "
                "from {}"
            ).format(_tabla_sql(tabla))
        )
        r = cur.fetchone()
        conteos[tabla] = {
            "total": total,
            "vigentes": int(r["vigentes"]),
            "anulados": int(r["anulados"]),
        }

    cur.execute(
        """
        select coalesce(e.codigo, '(sin estado)') as estado, count(*) as n
          from core.casos c
          left join core.cat_estados_caso e on e.id = c.estado_id
         group by 1
         order by 2 desc, 1
        """
    )
    conteos["core.casos"]["por_estado"] = [
        {"estado": r["estado"], "casos": int(r["n"])} for r in cur.fetchall()
    ]

    cur.execute(
        """
        select codigo_caso, nombre_caso, motivo_anulacion, anulado_en
          from core.casos
         where anulado_en is not null
         order by anulado_en desc
        """
    )
    conteos["core.casos"]["anulados_detalle"] = [
        {
            "codigo_caso": r["codigo_caso"],
            "nombre_caso": r["nombre_caso"],
            "motivo_anulacion": r["motivo_anulacion"],
            "anulado_en": _iso(r["anulado_en"]),
        }
        for r in cur.fetchall()
    ]

    conteos["resumen"] = {
        "casos": conteos["core.casos"]["total"],
        "casos_anulados": conteos["core.casos"]["anulados"],
        "demandas": conteos["core.demandas"]["total"],
        "demandas_anuladas": conteos["core.demandas"]["anulados"],
        "compromisos": conteos["core.compromisos"]["total"],
        "compromisos_anulados": conteos["core.compromisos"]["anulados"],
        "hitos": conteos["core.hitos_compromiso"]["total"],
        "hitos_anulados": conteos["core.hitos_compromiso"]["anulados"],
        "nota": (
            "Conteos actuales antes de la recarga 2026. No equivalen a los "
            "37/23/56/111 del Excel."
        ),
    }
    return conteos


# ---------------------------------------------------------------------------
# Emparejamiento por nombre
# ---------------------------------------------------------------------------


def normalizar_codigo(valor: Any) -> str:
    if valor is None:
        return ""
    return re.sub(r"\s+", "", str(valor)).upper()


def emparejar(
    casos_bd: list[dict],
    nombres: list[dict],
    umbral: float,
    incluir_codigo: bool = False,
) -> dict:
    por_normalizado: dict[str, list[dict]] = defaultdict(list)
    por_codigo: dict[str, dict] = {}
    for caso in casos_bd:
        por_normalizado[normalizar(caso.get("nombre_caso"))].append(caso)
        codigo = normalizar_codigo(caso.get("codigo_caso"))
        if codigo:
            por_codigo[codigo] = caso

    exactas: list[dict] = []
    similares: list[dict] = []
    por_codigo_coincidencias: list[dict] = []
    sin_coincidencia: list[str] = []
    emparejamientos: list[dict] = []
    casos_nombre: set[str] = set()
    casos_codigo: set[str] = set()

    for entrada in nombres:
        alias_norm: list[tuple[str, str, str]] = []
        vistos: set[str] = set()
        for a in entrada["alias"]:
            n = normalizar(a["valor"])
            if n and n not in vistos:
                vistos.add(n)
                alias_norm.append((n, a["campo"], a["valor"]))

        exactos: list[dict] = []
        ids_exactos: set[str] = set()
        for n, campo, valor in alias_norm:
            for caso in por_normalizado.get(n, []):
                if caso["id"] in ids_exactos:
                    continue
                ids_exactos.add(caso["id"])
                exactos.append(
                    {
                        "caso": _caso_publico(caso),
                        "nombre_usado": valor,
                        "campo": campo,
                        "score": 1.0,
                    }
                )

        candidatos: list[dict] = []
        for caso in casos_bd:
            if caso["id"] in ids_exactos:
                continue
            normal_bd = normalizar(caso.get("nombre_caso"))
            mejor = 0.0
            mejor_alias = None
            mejor_campo = None
            for n, campo, valor in alias_norm:
                s = similitud(n, normal_bd)
                if s > mejor:
                    mejor = s
                    mejor_alias = valor
                    mejor_campo = campo
            if mejor >= umbral:
                candidatos.append(
                    {
                        "caso": _caso_publico(caso),
                        "score": mejor,
                        "nombre_usado": mejor_alias,
                        "campo": mejor_campo,
                    }
                )

        candidatos.sort(key=lambda x: (-x["score"], x["caso"].get("codigo_caso") or ""))

        codigo_json = entrada.get("codigo")
        codigo_norm = normalizar_codigo(codigo_json)
        coincidencias_codigo: list[dict] = []
        if codigo_norm and codigo_norm in por_codigo:
            caso_codigo = por_codigo[codigo_norm]
            coincidencias_codigo.append(
                {
                    "caso": _caso_publico(caso_codigo),
                    "codigo_usado": codigo_json,
                    "score": 1.0,
                }
            )
            casos_codigo.add(caso_codigo["id"])

        for item in exactos:
            exactas.append({"nombre_json": entrada["nombre"], **item})
            casos_nombre.add(item["caso"]["id"])
        for item in candidatos[:8]:
            similares.append({"nombre_json": entrada["nombre"], **item})
            casos_nombre.add(item["caso"]["id"])
        for item in coincidencias_codigo:
            por_codigo_coincidencias.append({"nombre_json": entrada["nombre"], **item})

        if not exactos and not candidatos and not coincidencias_codigo:
            sin_coincidencia.append(entrada["nombre"])

        emparejamientos.append(
            {
                "nombre_json": entrada["nombre"],
                "campo": entrada["campo"],
                "codigo_json": codigo_json,
                "alias": [a["valor"] for a in entrada["alias"]],
                "exactos": exactos,
                "similares": candidatos[:8],
                "por_codigo": coincidencias_codigo,
                "sin_coincidencia": (
                    not exactos and not candidatos and not coincidencias_codigo
                ),
            }
        )

    casos_solo_codigo = casos_codigo - casos_nombre
    casos_para_cascada = set(casos_nombre)
    if incluir_codigo:
        casos_para_cascada |= casos_codigo

    advertencia = None
    if casos_solo_codigo and not incluir_codigo:
        advertencia = (
            f"{len(casos_solo_codigo)} caso(s) coinciden por código pero no por "
            "nombre. NO se sumaron a los totales por nombre; use "
            "--incluir-codigo si desea medirlos también."
        )

    return {
        "umbral_similitud": umbral,
        "incluir_codigo": incluir_codigo,
        "nombres_evaluados": len(nombres),
        "coincidencias_exactas": exactas,
        "coincidencias_similares": similares,
        "coincidencias_por_codigo": por_codigo_coincidencias,
        "sin_coincidencia": sin_coincidencia,
        "casos_por_codigo": sorted(casos_codigo),
        "casos_solo_por_codigo": sorted(casos_solo_codigo),
        "casos_para_cascada": sorted(casos_para_cascada),
        "advertencia": advertencia,
        "emparejamientos": emparejamientos,
        "resumen": {
            "nombres": len(nombres),
            "con_exacta": sum(1 for e in emparejamientos if e["exactos"]),
            "con_similar": sum(
                1 for e in emparejamientos if e["similares"] and not e["exactos"]
            ),
            "con_codigo": sum(1 for e in emparejamientos if e["por_codigo"]),
            "sin_coincidencia": len(sin_coincidencia),
            "casos_bd_distintos": len(casos_para_cascada),
            "casos_por_codigo": len(casos_codigo),
            "casos_solo_por_codigo": len(casos_solo_codigo),
        },
    }


def cargar_mapa_excel(cur: Any) -> dict:
    """Mapeo vigente Excel -> caso. Es el vínculo que usa el importador."""
    cur.execute("select to_regclass('core.mapa_matriz_excel') is not null as ok")
    fila = cur.fetchone()
    if not fila or not fila["ok"]:
        return {
            "existe": False,
            "filas": 0,
            "codigos": 0,
            "casos": 0,
            "detalle": [],
            "nota": "No existe core.mapa_matriz_excel en esta base.",
        }

    cur.execute(
        """
        select m.bloque_fila,
               m.codigo_excel,
               m.caso_id::text as caso_id,
               c.codigo_caso,
               c.nombre_caso,
               e.codigo as estado,
               c.anulado_en,
               c.motivo_anulacion
          from core.mapa_matriz_excel m
          join core.casos c on c.id = m.caso_id
          left join core.cat_estados_caso e on e.id = c.estado_id
         order by m.bloque_fila
        """
    )
    detalle = []
    for r in cur.fetchall():
        item = dict(r)
        item["anulado"] = item["anulado_en"] is not None
        item["anulado_en"] = _iso(item["anulado_en"])
        detalle.append(item)

    codigos = {
        normalizar_codigo(x["codigo_excel"]) for x in detalle if x.get("codigo_excel")
    }
    casos = {x["caso_id"] for x in detalle if x.get("caso_id")}
    return {
        "existe": True,
        "filas": len(detalle),
        "codigos": len(codigos),
        "casos": len(casos),
        "detalle": detalle,
        "nota": (
            "core.mapa_matriz_excel es el vínculo que usa el importador; "
            "el código del Excel no tiene por qué coincidir con core.casos.codigo_caso."
        ),
    }


# ---------------------------------------------------------------------------
# Cascada real (sólo conteo, sin borrar)
# ---------------------------------------------------------------------------


def calcular_cascada(
    cur: Any,
    root_ids: list[str],
    fks: list[dict],
    pks: dict,
    pk_types: dict,
    max_iter: int = 10_000,
) -> tuple[dict, dict, dict]:
    root_ids = [str(x) for x in root_ids]
    visitados: dict[tuple[str, tuple], dict] = {}
    roots_por_fila: dict[tuple[str, tuple], set[str]] = {}
    cola: deque[tuple[str, tuple]] = deque()
    en_cola: set[tuple[str, tuple]] = set()

    def agregar(tabla: str, fila: dict, ident: tuple, roots: set[str]) -> None:
        clave = (tabla, ident)
        if clave not in visitados:
            visitados[clave] = fila
            roots_por_fila[clave] = set(roots)
            if clave not in en_cola:
                cola.append(clave)
                en_cola.add(clave)
            return
        antes = len(roots_por_fila[clave])
        roots_por_fila[clave] |= set(roots)
        if len(roots_por_fila[clave]) != antes and clave not in en_cola:
            cola.append(clave)
            en_cola.add(clave)

    if root_ids:
        cur.execute(
            sql.SQL("select * from {} where id::text = any(%s)").format(
                _tabla_sql("core.casos")
            ),
            (root_ids,),
        )
        for r in cur.fetchall():
            fila = dict(r)
            agregar(
                "core.casos",
                fila,
                _identidad(fila, "core.casos", pks),
                {str(fila["id"])},
            )

    fks_por_padre: dict[str, list[dict]] = defaultdict(list)
    for fk in fks:
        if fk["action"] == "c":
            fks_por_padre[fk["parent"]].append(fk)

    iteraciones = 0
    while cola and iteraciones < max_iter:
        iteraciones += 1
        lote: dict[str, list[tuple]] = defaultdict(list)
        while cola:
            tabla, ident = cola.popleft()
            en_cola.discard((tabla, ident))
            lote[tabla].append(ident)

        for tabla, idents in lote.items():
            idents = list(dict.fromkeys(idents))
            for fk in fks_por_padre.get(tabla, []):
                for fila_hija, ident_padre, ident_hija in _hijos_de_lote(
                    cur, fk, idents, pks, pk_types
                ):
                    roots = roots_por_fila.get((tabla, ident_padre))
                    if roots:
                        agregar(fk["child"], fila_hija, ident_hija, roots)

    por_tabla: dict[str, int] = defaultdict(int)
    por_caso: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for clave in visitados:
        tabla = clave[0]
        por_tabla[tabla] += 1
        for root in roots_por_fila[clave]:
            por_caso[root][tabla] += 1

    filas_raiz = sum(1 for (tabla, _) in visitados if tabla == "core.casos")
    total_cascada = sum(v for t, v in por_tabla.items() if t != "core.casos")

    resultado = {
        "raices": root_ids,
        "por_tabla": dict(sorted(por_tabla.items())),
        "por_caso": {k: dict(sorted(v.items())) for k, v in sorted(por_caso.items())},
        "filas_raiz": filas_raiz,
        "total_filas_cascada": total_cascada,
        "total_incluyendo_raices": sum(por_tabla.values()),
        "iteraciones": iteraciones,
        "tope_iteraciones_alcanzado": iteraciones >= max_iter,
    }
    return resultado, visitados, roots_por_fila


def calcular_bloqueos(
    cur: Any,
    visitados: dict[tuple[str, tuple], dict],
    roots_por_fila: dict[tuple[str, tuple], set[str]],
    fks: list[dict],
    pks: dict,
    pk_types: dict,
) -> dict:
    """Filas que NO se borrarían y bloquearían (o alterarían) el DELETE."""
    padres_por_tabla: dict[str, set[tuple]] = defaultdict(set)
    for tabla, ident in visitados:
        padres_por_tabla[tabla].add(ident)

    detalle: list[dict] = []
    por_caso_tabla: dict[str, dict[str, set[tuple]]] = defaultdict(
        lambda: defaultdict(set)
    )
    por_caso_constraint: dict[str, dict[str, set[tuple]]] = defaultdict(
        lambda: defaultdict(set)
    )
    bloqueantes: set[tuple[str, tuple]] = set()
    set_null: set[tuple[str, tuple]] = set()

    for fk in fks:
        if fk["action"] == "c":
            continue
        idents_padre = sorted(padres_por_tabla.get(fk["parent"], set()))
        if not idents_padre:
            continue

        hijos = _hijos_de_lote(cur, fk, idents_padre, pks, pk_types)
        vistos: set[tuple[str, tuple]] = set()
        registros: list[dict] = []
        clave_constraint = f"{fk['conname']}@{fk['child']}"
        for fila_hija, ident_padre, ident_hija in hijos:
            clave_hija = (fk["child"], ident_hija)
            roots = roots_por_fila.get((fk["parent"], ident_padre), set())

            # Si la fila hija también se borra en cascada, no bloquea ni se
            # cuenta como bloqueo.
            if clave_hija in visitados:
                continue

            # La fila hija puede referenciar a dos padres con raíces distintas:
            # se contabiliza en ambas, aunque el ejemplo se guarde una sola vez.
            for root in roots:
                por_caso_tabla[root][fk["child"]].add(ident_hija)
                por_caso_constraint[root][clave_constraint].add(ident_hija)

            if clave_hija in vistos:
                continue
            vistos.add(clave_hija)

            registros.append(
                {
                    "id": _id_publico(fila_hija, fk["child"], pks),
                    "casos_raiz": sorted(roots),
                }
            )

            if fk["action"] in ("a", "r"):
                bloqueantes.add(clave_hija)
            elif fk["action"] == "n":
                set_null.add(clave_hija)

        if not registros:
            continue

        efecto = (
            "bloquea"
            if fk["action"] in ("a", "r")
            else ("set_null" if fk["action"] == "n" else "set_default")
        )
        detalle.append(
            {
                "constraint": fk["conname"],
                "tabla_padre": fk["parent"],
                "tabla_hija": fk["child"],
                "columna_hija": ", ".join(fk["child_cols"]),
                "accion": ACCIONES.get(fk["action"], fk["action"]),
                "efecto": efecto,
                "bloquea": fk["action"] in ("a", "r"),
                "filas": len(registros),
                "ejemplo": registros[:5],
            }
        )

    detalle.sort(key=lambda x: (not x["bloquea"], x["tabla_hija"], x["constraint"]))

    resumen_tabla: dict[str, dict] = {}
    for tabla in sorted({t for t, _ in bloqueantes} | {t for t, _ in set_null}):
        n_bloq = sum(1 for t, _ in bloqueantes if t == tabla)
        n_null = sum(1 for t, _ in set_null if t == tabla)
        resumen_tabla[tabla] = {
            "filas_bloqueantes": n_bloq,
            "filas_set_null": n_null,
            "bloquea": n_bloq > 0,
        }

    return {
        "detalle": detalle,
        "por_caso_tabla": {
            root: {t: len(ids) for t, ids in sorted(tablas.items())}
            for root, tablas in sorted(por_caso_tabla.items())
        },
        "por_caso_constraint": {
            root: {c: len(ids) for c, ids in sorted(constraints.items())}
            for root, constraints in sorted(por_caso_constraint.items())
        },
        "resumen_por_tabla": resumen_tabla,
        "total_filas_bloqueantes": len(bloqueantes),
        "total_filas_set_null": len(set_null),
        "nota": (
            "filas_bloqueantes cuenta filas que NO se borrarían y que, con "
            "NO ACTION o RESTRICT, harían fallar el DELETE. set_null no bloquea, "
            "pero modifica esas filas."
        ),
    }


def elegir_caso_demostrativo(cur: Any) -> str | None:
    """Caso con más dependencias, para mostrar el costo de un borrado."""
    cur.execute(
        """
        select c.id::text
          from core.casos c
         where c.anulado_en is null
         order by (
             coalesce((select count(*) from core.demandas d
                        where d.caso_id = c.id), 0)
           + coalesce((select count(*) from core.compromisos co
                        where co.caso_id = c.id), 0) * 3
           + coalesce((select count(*) from core.documentos doc
                        where doc.caso_id = c.id), 0)
           + coalesce((select count(*) from core.reuniones_dialogo r
                        where r.caso_id = c.id), 0)
           + coalesce((select count(*) from core.caso_nudo_critico n
                        where n.caso_id = c.id), 0)
         ) desc, c.codigo_caso
         limit 1
        """
    )
    fila = cur.fetchone()
    if fila:
        return str(fila["id"])
    cur.execute("select id::text from core.casos order by codigo_caso limit 1")
    fila = cur.fetchone()
    return str(fila["id"]) if fila else None


def construir_ejemplo(
    caso: dict,
    cascada: dict,
    bloqueos: dict,
    *,
    demostrativo: bool,
    motivo: str | None,
) -> dict:
    cid = caso["id"]
    cascada_caso = cascada["por_caso"].get(cid, {})
    detalle_bloqueos = []
    for item in bloqueos["detalle"]:
        clave_constraint = f"{item['constraint']}@{item['tabla_hija']}"
        filas = bloqueos["por_caso_constraint"].get(cid, {}).get(clave_constraint, 0)
        if filas:
            detalle_bloqueos.append(
                {
                    "constraint": item["constraint"],
                    "tabla_hija": item["tabla_hija"],
                    "accion": item["accion"],
                    "bloquea": item["bloquea"],
                    "filas": filas,
                }
            )

    return {
        "demostrativo": demostrativo,
        "motivo": motivo,
        "caso": _caso_publico(caso),
        "cascada_por_tabla": cascada_caso,
        "filas_cascada": sum(v for t, v in cascada_caso.items() if t != "core.casos"),
        "filas_incluyendo_caso": sum(cascada_caso.values()),
        "bloqueos_por_tabla": bloqueos["por_caso_tabla"].get(cid, {}),
        "bloqueos_detalle": detalle_bloqueos,
    }


# ---------------------------------------------------------------------------
# Mapa de FK del dominio
# ---------------------------------------------------------------------------


def construir_mapa_fk(fks: list[dict]) -> dict:
    mapa: dict[str, dict] = {
        tabla: {"cascada": [], "no_cascada": []} for tabla in TABLAS_DOMINIO
    }
    for fk in fks:
        if fk["parent"] not in mapa:
            continue
        item = {
            "constraint": fk["conname"],
            "tabla_hija": fk["child"],
            "columna_hija": ", ".join(fk["child_cols"]),
            "columna_padre": ", ".join(fk["parent_cols"]),
            "accion": ACCIONES.get(fk["action"], fk["action"]),
        }
        if fk["action"] == "c":
            mapa[fk["parent"]]["cascada"].append(item)
        else:
            item["bloquea"] = fk["action"] in ("a", "r")
            item["efecto"] = (
                "bloquea"
                if fk["action"] in ("a", "r")
                else ("set_null" if fk["action"] == "n" else "set_default")
            )
            mapa[fk["parent"]]["no_cascada"].append(item)

    for tabla in mapa:
        mapa[tabla]["cascada"].sort(key=lambda x: (x["tabla_hija"], x["constraint"]))
        mapa[tabla]["no_cascada"].sort(key=lambda x: (x["tabla_hija"], x["constraint"]))

    total_cascada = sum(len(v["cascada"]) for v in mapa.values())
    total_no_cascada = sum(len(v["no_cascada"]) for v in mapa.values())
    bloqueantes = sorted(
        {
            item["tabla_hija"]
            for v in mapa.values()
            for item in v["no_cascada"]
            if item["bloquea"]
        }
    )
    return {
        "por_padre": mapa,
        "resumen": {
            "fks_dominio": total_cascada + total_no_cascada,
            "cascada": total_cascada,
            "no_cascada": total_no_cascada,
            "tablas_bloqueantes": bloqueantes,
            "nota": (
                "La cascada del mapa es directa. El preflight recorre también "
                "las cascadas de segundo nivel (p. ej. caso -> compromiso -> hito)."
            ),
        },
    }


# ---------------------------------------------------------------------------
# Evidencia y evaluación del modelo
# ---------------------------------------------------------------------------


def medir_modelo(cur: Any) -> dict:
    def uno(consulta: str, params: tuple = ()) -> Any:
        cur.execute(consulta, params)
        fila = cur.fetchone()
        return next(iter(fila.values())) if fila else None

    columnas = {}
    cur.execute(
        """
        select table_name, column_name, is_nullable, data_type
          from information_schema.columns
         where table_schema = 'core'
           and table_name in ('casos', 'demandas', 'compromisos', 'hitos_compromiso')
           and column_name in ('caso_id', 'demanda_id', 'compromiso_id',
                               'codigo_compromiso', 'codigo_hito')
         order by table_name, column_name
        """
    )
    for r in cur.fetchall():
        columnas[f"core.{r['table_name']}.{r['column_name']}"] = {
            "tipo": r["data_type"],
            "nullable": r["is_nullable"] == "YES",
        }

    indices = []
    cur.execute(
        """
        select tablename, indexname, indexdef
          from pg_indexes
         where schemaname = 'core'
           and tablename in ('casos', 'demandas', 'compromisos', 'hitos_compromiso')
           and indexdef ilike '%unique%'
         order by tablename, indexname
        """
    )
    for r in cur.fetchall():
        indices.append(
            {
                "tabla": f"core.{r['tablename']}",
                "indice": r["indexname"],
                "definicion": r["indexdef"],
            }
        )

    fks_clave = {}
    for nombre in (
        "compromisos_caso_id_fkey",
        "compromisos_demanda_id_fkey",
        "hitos_compromiso_compromiso_id_fkey",
    ):
        cur.execute(
            """
            select c.confdeltype
              from pg_constraint c
             where c.conname = %s
             limit 1
            """,
            (nombre,),
        )
        r = cur.fetchone()
        fks_clave[nombre] = ACCIONES.get(r["confdeltype"]) if r else None

    vigentes_compromisos = int(
        uno("select count(*) from core.compromisos where anulado_en is null") or 0
    )
    con_demanda = int(
        uno(
            "select count(*) from core.compromisos "
            "where anulado_en is null and demanda_id is not null"
        )
        or 0
    )
    vigentes_demandas = int(
        uno("select count(*) from core.demandas where anulado_en is null") or 0
    )
    demandas_sin_caso = int(
        uno(
            "select count(*) from core.demandas "
            "where anulado_en is null and caso_id is null"
        )
        or 0
    )
    vigentes_casos = int(
        uno("select count(*) from core.casos where anulado_en is null") or 0
    )
    casos_sin_demandas = int(
        uno(
            """
            select count(*) from core.casos c
             where c.anulado_en is null
               and not exists (
                   select 1 from core.demandas d
                    where d.caso_id = c.id and d.anulado_en is null
               )
            """
        )
        or 0
    )
    compromisos_sin_hitos = int(
        uno(
            """
            select count(*) from core.compromisos c
             where c.anulado_en is null
               and not exists (
                   select 1 from core.hitos_compromiso h
                    where h.compromiso_id = c.id and h.anulado_en is null
               )
            """
        )
        or 0
    )
    vigentes_hitos = int(
        uno("select count(*) from core.hitos_compromiso where anulado_en is null") or 0
    )
    demanda_cruzada = int(
        uno(
            """
            select count(*) from core.compromisos c
              join core.demandas d on d.id = c.demanda_id
             where c.anulado_en is null
               and d.anulado_en is null
               and c.caso_id <> d.caso_id
            """
        )
        or 0
    )
    textos_repetidos = int(
        uno(
            """
            select count(*) from (
                select lower(btrim(accion_compromiso)) as texto
                  from core.compromisos
                 where anulado_en is null
                 group by 1
                having count(distinct caso_id) > 1
            ) s
            """
        )
        or 0
    )

    return {
        "columnas": columnas,
        "indices_unicos": indices,
        "fk_clave": fks_clave,
        "medido_en_bd": {
            "compromisos_vigentes": vigentes_compromisos,
            "compromisos_con_demanda": con_demanda,
            "compromisos_sin_demanda": vigentes_compromisos - con_demanda,
            "compromisos_sin_hitos": compromisos_sin_hitos,
            "compromisos_que_apuntan_a_demanda_de_otro_caso": demanda_cruzada,
            "textos_de_compromiso_repetidos_en_varios_casos": textos_repetidos,
            "demandas_vigentes": vigentes_demandas,
            "demandas_vigentes_sin_caso": demandas_sin_caso,
            "casos_vigentes": vigentes_casos,
            "casos_vigentes_sin_demandas": casos_sin_demandas,
            "hitos_vigentes": vigentes_hitos,
        },
    }


DDL_DEMANDAS = """\
-- 1) Puente compromiso <-> demanda (m:n real).
--    NO EJECUTAR: este script sólo lo propone.
--    LIMITACIÓN: compromisos.demanda_id sigue siendo NO ACTION. Mientras esté
--    poblado, borrar esa demanda seguirá bloqueado. Para los compromisos con
--    varias demandas, el importe debe dejar demanda_id NULL y usar el puente.
create table core.compromiso_demandas (
    compromiso_id uuid        not null
        references core.compromisos(id) on delete cascade,
    demanda_id    uuid        not null
        references core.demandas(id) on delete cascade,
    es_principal  boolean     not null default false,
    orden         smallint    not null default 1,
    created_at    timestamptz not null default now(),
    primary key (compromiso_id, demanda_id)
);

create unique index uq_compromiso_demandas_principal
    on core.compromiso_demandas (compromiso_id)
    where es_principal;

create index ix_compromiso_demandas_demanda
    on core.compromiso_demandas (demanda_id);

comment on table core.compromiso_demandas is
    'Vínculo m:n entre compromisos y demandas. compromisos.demanda_id queda como demanda principal por compatibilidad.';

-- 2) Relleno desde la columna única existente (hoy 0 filas con demanda_id).
insert into core.compromiso_demandas (compromiso_id, demanda_id, es_principal)
select id, demanda_id, true
  from core.compromisos
 where demanda_id is not null
on conflict (compromiso_id, demanda_id) do nothing;
"""

DDL_CASOS = """\
-- 3) Puente compromiso <-> caso, sólo si el mismo compromiso pertenece a
--    varios casos y debe conservar un solo código y un solo juego de hitos.
--    NO EJECUTAR: este script sólo lo propone.
--    LIMITACIÓN: este DDL NO relaja compromisos.caso_id (NOT NULL, ON DELETE
--    CASCADE). Si se borra el caso principal, el compromiso se borra para
--    todos los casos. Para compartición real hace falta una fase 2: caso_id
--    nullable + FK ON DELETE RESTRICT/SET NULL, o tratar el puente como
--    fuente de verdad y actualizar las consultas.
create table core.compromiso_casos (
    compromiso_id uuid        not null
        references core.compromisos(id) on delete cascade,
    caso_id       uuid        not null
        references core.casos(id) on delete cascade,
    es_principal  boolean     not null default false,
    created_at    timestamptz not null default now(),
    primary key (compromiso_id, caso_id)
);

create unique index uq_compromiso_casos_principal
    on core.compromiso_casos (compromiso_id)
    where es_principal;

create index ix_compromiso_casos_caso
    on core.compromiso_casos (caso_id);

comment on table core.compromiso_casos is
    'Vínculo m:n entre compromisos y casos. compromisos.caso_id queda como caso principal; el puente añade casos adicionales.';

-- 4) Relleno desde caso_id (NOT NULL en el esquema actual).
insert into core.compromiso_casos (compromiso_id, caso_id, es_principal)
select id, caso_id, true
  from core.compromisos
on conflict (compromiso_id, caso_id) do nothing;
"""


def evaluar_modelo(evidencia: dict) -> dict:
    sup = SUPUESTOS_EXCEL
    comp = sup["compromisos"]
    multi_d = sup["compromisos_con_3_demandas"]
    d_por = sup["demandas_por_compromiso_m_n"]
    multi_c = sup["compromisos_en_2_casos"]
    c_por = sup["casos_por_compromiso_m_n"]

    vinculos_demanda = (comp - multi_d) * 1 + multi_d * d_por
    filas_duplicando_demanda = vinculos_demanda
    delta_demanda = multi_d * (d_por - 1)

    vinculos_caso = (comp - multi_c) * 1 + multi_c * c_por
    filas_duplicando_caso = vinculos_caso
    delta_caso = multi_c * (c_por - 1)

    return {
        "supuestos_excel": sup,
        "evidencia_esquema": {
            "compromisos.caso_id": "NOT NULL (una fila = un caso)",
            "compromisos.demanda_id": "uuid NULL (una sola demanda por fila)",
            "demandas.caso_id": "uuid NULL (una demanda puede no tener caso)",
            "hitos_compromiso": (
                "sólo compromiso_id; no existe caso_id ni demanda_id en el hito"
            ),
            "codigo_compromiso": (
                "UNIQUE global y CHECK '_COMP[0-9]{3}$'; el importador lo "
                "deriva de codigo_caso"
            ),
            "codigo_hito": "UNIQUE global; también lo deriva el importador",
            "fk_compromisos_demanda": "NO ACTION",
            "fk_hitos_compromiso": "CASCADE desde compromisos",
            "columnas_medidas": evidencia["columnas"],
            "indices_unicos": evidencia["indices_unicos"],
            "fk_clave": evidencia["fk_clave"],
        },
        "medido_en_bd": evidencia["medido_en_bd"],
        "puente_demandas": {
            "necesario": True,
            "motivo": (
                "4 compromisos x 3 demandas = 12 vínculos. "
                "compromisos.demanda_id admite un único uuid, así que sin puente "
                "se pierden 8 vínculos o se duplican 8 filas."
            ),
            "si_se_usa_puente": {
                "filas_compromiso": comp,
                "vinculos_en_puente": vinculos_demanda,
                "codigos_compromiso": comp,
                "hitos": sup["hitos"],
                "efecto_hitos": (
                    "los hitos siguen colgando de un único compromiso; no se "
                    "duplican y conservan su codigo_hito"
                ),
            },
            "si_se_duplica_por_demanda": {
                "filas_compromiso": filas_duplicando_demanda,
                "delta_filas": delta_demanda,
                "codigos_compromiso": filas_duplicando_demanda,
                "efecto_hitos": (
                    "los hitos del compromiso se duplican por cada demanda "
                    "(o se asignan a una sola copia y las otras pierden "
                    "seguimiento); el total de 111 hitos deja de ser 111"
                ),
                "problemas": [
                    "codigo_compromiso es UNIQUE global: cada copia necesita un código nuevo",
                    "codigo_hito es UNIQUE global: los hitos copiados también necesitan código nuevo",
                    "Anexo 14 (una fila por hito) mostraría filas repetidas",
                    "los KPIs de compromisos e hitos se inflan",
                    "caso_nudo_critico y las integraciones apuntan a un id: ¿a qué copia?",
                ],
            },
            "recomendacion": (
                "Crear core.compromiso_demandas y conservar "
                "compromisos.demanda_id como demanda principal mientras la API "
                "y la interfaz migran a una lista."
            ),
            "advertencia_compatibilidad": (
                "El puente por sí solo no elimina el bloqueo de "
                "compromisos_demanda_id_fkey (NO ACTION). Mientras demanda_id "
                "esté poblado, borrar esa demanda sigue bloqueado; el importe "
                "debe dejarlo NULL en los compromisos multi-demanda y usar el "
                "puente."
            ),
            "ddl": DDL_DEMANDAS,
        },
        "puente_casos": {
            "necesario": "condicional",
            "motivo": (
                "2 compromisos aparecen en 2 casos. Si son el mismo compromiso "
                "(mismo texto y mismos hitos), hace falta puente para no "
                "duplicar identidad ni seguimiento. Si son compromisos "
                "independientes que casualmente comparten redacción, el modelo "
                "actual ya los duplica por caso y eso es semánticamente válido."
            ),
            "evidencia": (
                "compromisos.caso_id es NOT NULL y el importador es idempotente "
                "por (caso_id, normalizar(accion)): el mismo texto en dos casos "
                "produce dos filas. Los 56 compromisos vs 54 textos son "
                "compatibles con 2 textos repetidos."
            ),
            "si_se_usa_puente": {
                "filas_compromiso": comp,
                "vinculos_en_puente": vinculos_caso,
                "codigos_compromiso": comp,
                "hitos": sup["hitos"],
                "efecto_hitos": ("un solo juego de hitos compartido por los dos casos"),
            },
            "si_se_duplica_por_caso": {
                "filas_compromiso": filas_duplicando_caso,
                "delta_filas": delta_caso,
                "codigos_compromiso": filas_duplicando_caso,
                "efecto_hitos": (
                    "si se copian los hitos, se duplican; si no se copian, "
                    "uno de los casos queda sin seguimiento"
                ),
                "problemas": [
                    "el mismo commitment se cuenta dos veces en los KPIs",
                    "los códigos de compromiso e hito cambian por caso",
                    "Anexo 14 y la matriz por caso lo muestran dos veces",
                ],
            },
            "recomendacion": (
                "Usar core.compromiso_casos sólo si los dos compromisos son el "
                "mismo compromiso. Si son independientes, mantener la duplicación "
                "por caso y aceptar el doble conteo, o deduplicar por texto antes "
                "de cargar."
            ),
            "advertencia_compatibilidad": (
                "Con compromisos.caso_id NOT NULL y ON DELETE CASCADE, el puente "
                "NO basta para compartir de verdad: si se borra el caso "
                "principal, el compromiso se borra para todos los casos. Las "
                "opciones reales son (a) duplicar la fila por caso —modelo "
                "actual— o (b) una fase 2 que haga caso_id nullable y cambie la "
                "FK a RESTRICT/SET NULL, con cambios en las consultas."
            ),
            "ddl": DDL_CASOS,
        },
        "calculos": {
            "compromisos": comp,
            "textos_compromiso": sup["textos_compromiso"],
            "vinculos_demanda_si_puente": vinculos_demanda,
            "filas_compromiso_si_duplicar_demanda": filas_duplicando_demanda,
            "delta_filas_duplicar_demanda": delta_demanda,
            "vinculos_caso_si_puente": vinculos_caso,
            "filas_compromiso_si_duplicar_caso": filas_duplicando_caso,
            "delta_filas_duplicar_caso": delta_caso,
            "filas_compromiso_si_duplicar_ambos_sin_solape": (
                comp + delta_demanda + delta_caso
            ),
            "hitos_si_puente": sup["hitos"],
            "hitos_si_duplicar_demanda": (
                "111 + 2 * (hitos de los 4 compromisos m:n); "
                "no se puede dar un total exacto sin el detalle de hitos del Excel"
            ),
            "hitos_si_duplicar_caso": (
                "111 + 1 * (hitos de los 2 compromisos compartidos); "
                "no se puede dar un total exacto sin el detalle de hitos del Excel"
            ),
            "nota_solape": (
                "Si los 4 compromisos m:n y los 2 compartidos entre casos se "
                "solapan, el delta combinado es menor que 8 + 2."
            ),
        },
        "casos_sin_demandas": {
            "excel": f"{sup['casos_sin_demandas']} de {sup['casos']}",
            "medido_bd": (
                f"{evidencia['medido_en_bd']['casos_vigentes_sin_demandas']} "
                f"de {evidencia['medido_en_bd']['casos_vigentes']} casos vigentes"
            ),
            "lectura": (
                "No se resuelve con un puente: demandas.caso_id ya es 1:N. "
                "Es un problema de cobertura (casos sin demandas), no de "
                "cardinalidad. La matriz debe tolerar filas de demanda vacías."
            ),
        },
        "compromisos_sin_hitos": {
            "excel": f"{sup['compromisos_sin_hitos']} de {sup['compromisos']}",
            "medido_bd": (
                f"{evidencia['medido_en_bd']['compromisos_sin_hitos']} "
                f"de {evidencia['medido_en_bd']['compromisos_vigentes']} "
                "compromisos vigentes"
            ),
            "lectura": (
                "No requiere puente. Los exportes deben usar LEFT JOIN con "
                "hitos para no perder compromisos sin seguimiento."
            ),
        },
        "ddl_propuesto": [
            {
                "orden": 1,
                "objeto": "core.compromiso_demandas",
                "ejecutado": False,
                "sql": DDL_DEMANDAS,
                "nota": (
                    "Puente m:n. Mantiene compromisos.demanda_id como demanda "
                    "principal; no lo elimina."
                ),
            },
            {
                "orden": 2,
                "objeto": "core.compromiso_casos",
                "ejecutado": False,
                "sql": DDL_CASOS,
                "nota": (
                    "Puente m:n condicional. Mantiene compromisos.caso_id como "
                    "caso principal; no relaja el NOT NULL."
                ),
            },
        ],
        "exportes_vistas_afectados": [
            {
                "objeto": "analytics.vw_anexo_14_seguimiento_compromisos",
                "tipo": "vista",
                "impacto": (
                    "Usa core.compromisos.caso_id y LEFT JOIN hitos. Un "
                    "compromiso compartido aparece sólo bajo el caso principal; "
                    "si se duplica, aparece repetido y duplica filas de hitos."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "analytics.mv_compromisos_inter_ministeriales",
                "tipo": "vista materializada",
                "impacto": (
                    "JOIN core.compromisos.caso_id. Duplicar compromisos por "
                    "caso duplica la fila de integración externa."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "analytics.mv_dashboard_alta_direccion",
                "tipo": "vista materializada",
                "impacto": (
                    "Cuenta hitos vencidos vía compromisos.caso_id. Duplicar "
                    "hitos o compromisos infla el KPI de vencidos."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "analytics.vw_anexo_15_matriz_conflictividad",
                "tipo": "vista",
                "impacto": (
                    "Es de nivel caso y no usa demandas ni compromisos; sin "
                    "impacto directo mientras no se dupliquen casos."
                ),
                "requiere_cambio": False,
            },
            {
                "objeto": "lib/db/repos/cases.ts · matrizDemandasIntervenciones",
                "tipo": "consulta de API",
                "impacto": (
                    "Agrupa por core.compromisos.demanda_id. El puente exige "
                    "un JOIN con compromiso_demandas y decidir si un compromiso "
                    "con 3 demandas cuenta en las 3; duplicar infla totales y "
                    "sumas."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "lib/db/repos/commitments.ts",
                "tipo": "consulta de API",
                "impacto": (
                    "COMMITMENT_COLUMNS expone un único demanda_id y hace "
                    "LEFT JOIN core.demandas por esa columna. El puente exige "
                    "agregar una lista o mantener la demanda principal."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "app/api/v1/export/anexo-14/route.ts",
                "tipo": "exporte",
                "impacto": (
                    "Consume la vista de Anexo 14; hereda su impacto (filas "
                    "repetidas si se duplican compromisos/hitos)."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "app/api/v1/cases/[code]/matriz/route.ts",
                "tipo": "exporte/API",
                "impacto": (
                    "Consume matrizDemandasIntervenciones; hereda el impacto "
                    "del agrupamiento por demanda_id."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "angular · compromiso-panel.component.ts",
                "tipo": "interfaz",
                "impacto": (
                    "El formulario tiene un select único de demanda. El puente "
                    "exige multiselección o principal + lista."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "angular · caso-detalle.page.ts",
                "tipo": "interfaz",
                "impacto": (
                    "compromisosPorDemanda asume un demandaId por compromiso; "
                    "el puente exige recorrer una lista."
                ),
                "requiere_cambio": True,
            },
            {
                "objeto": "angular · nudos-matriz.mapeo.ts",
                "tipo": "interfaz",
                "impacto": (
                    "La matriz por demanda asume un vínculo único; el puente "
                    "multiplica los vínculos y hay que decidir la semántica."
                ),
                "requiere_cambio": True,
            },
        ],
        "hallazgos": [
            (
                "compromisos.demanda_id es un único uuid: no puede representar "
                "3 demandas por compromiso. El puente es la única forma de "
                "conservar 56 compromisos y 111 hitos sin duplicar."
            ),
            (
                "compromisos.caso_id es NOT NULL y codigo_compromiso es UNIQUE "
                "global: duplicar por caso obliga a inventar códigos nuevos y "
                "rompe la identidad estable del compromiso."
            ),
            (
                "hitos_compromiso sólo cuelga de compromiso_id; si se duplica "
                "el compromiso, los hitos se duplican o se pierden para una copia."
            ),
            (
                "compromisos_demanda_id_fkey es NO ACTION. Al recargar demandas "
                "hay que desvincular primero los compromisos que las referencien. "
                f"Hoy hay {evidencia['medido_en_bd']['compromisos_que_apuntan_a_demanda_de_otro_caso']} "
                "compromisos que apuntan a una demanda de otro caso."
            ),
            (
                f"Hoy {evidencia['medido_en_bd']['compromisos_con_demanda']} de "
                f"{evidencia['medido_en_bd']['compromisos_vigentes']} compromisos "
                "vigentes tienen demanda_id: la columna está sin uso y el puente "
                "no migra datos existentes."
            ),
            (
                f"{sup['casos_sin_demandas']} de {sup['casos']} casos sin demandas "
                "no se arregla con un puente: es cobertura, no cardinalidad."
            ),
            (
                f"{sup['compromisos_sin_hitos']} de {sup['compromisos']} "
                "compromisos sin hitos no requieren puente; requieren LEFT JOIN "
                "en los exportes."
            ),
            (
                "El nombre no es una llave segura para borrar: core.mapa_matriz_excel "
                "es el vínculo que usa el importador y el código del Excel no "
                "coincide necesariamente con core.casos.codigo_caso. No borrar "
                "sólo por nombre; usar el mapa o una lista explícita."
            ),
        ],
    }


# ---------------------------------------------------------------------------
# Resumen por pantalla
# ---------------------------------------------------------------------------


def imprimir_resumen(salida: dict, ruta_salida: Path | None) -> None:
    meta = salida["meta"]
    base = salida["base"]
    print("=" * 78)
    print("PREFLIGHT MATRIZ 2026 · SÓLO LECTURA · NO SE BORRÓ NI SE ESCRIBIÓ NADA")
    print("=" * 78)
    print(f"Base: {base['database']} · rol: {base['rol']}")
    print(f"PostgreSQL: {base['version']}")
    print(f"Generado: {meta['generado_en']}")
    print()

    insumo = salida["preflight_borrado_por_nombre"]["insumo"]
    print("Insumo de nombres")
    print(f"  ruta: {insumo['ruta']}")
    print(
        f"  existe: {insumo['existe']} · nombres reconocidos: {len(insumo['nombres'])}"
    )
    if insumo.get("motivo"):
        print(f"  aviso: {insumo['motivo']}")
    if insumo.get("error"):
        print(f"  error: {insumo['error']}")
    print()

    print("Conteos actuales")
    for tabla in TABLAS_DOMINIO:
        c = salida["conteos_actuales"][tabla]
        print(
            f"  {tabla:<26} total={c['total']:<5} "
            f"vigentes={c['vigentes']:<5} anulados={c['anulados']}"
        )
    print(
        f"  casos anulados: {salida['conteos_actuales']['resumen']['casos_anulados']}"
    )
    print()

    resumen_fk = salida["mapa_fk_dominio"]["resumen"]
    print("Mapa de FK del dominio")
    print(
        f"  FK directas: {resumen_fk['fks_dominio']} · "
        f"cascada: {resumen_fk['cascada']} · "
        f"no cascada: {resumen_fk['no_cascada']}"
    )
    for padre in TABLAS_DOMINIO:
        datos = salida["mapa_fk_dominio"]["por_padre"][padre]
        print(
            f"  {padre:<26} cascada={len(datos['cascada']):<3} "
            f"no_cascada={len(datos['no_cascada'])}"
        )
    print(
        f"  tablas que bloquean: {', '.join(resumen_fk['tablas_bloqueantes']) or 'ninguna'}"
    )
    print()

    pre = salida["preflight_borrado_por_nombre"]
    print("Preflight de borrado por nombre")
    if pre["ejecutado"]:
        r = pre["emparejamiento"]["resumen"]
        print(
            f"  nombres={r['nombres']} · con exacta={r['con_exacta']} · "
            f"con similar={r['con_similar']} · con código={r['con_codigo']} · "
            f"sin coincidencia={r['sin_coincidencia']} · "
            f"casos distintos={r['casos_bd_distintos']}"
        )
        if pre.get("casos_solo_por_codigo"):
            print(
                f"  casos sólo por código (no sumados): "
                f"{len(pre['casos_solo_por_codigo'])}"
            )
        for aviso in pre.get("advertencias") or []:
            print(f"  advertencia: {aviso}")
        print(
            f"  filas en cascada (sin raíces): {pre['total_filas_cascada']} · "
            f"incluyendo casos: {pre['total_incluyendo_casos']}"
        )
        if pre.get("caso_ejemplo"):
            ej = pre["caso_ejemplo"]
            print(
                f"  caso de ejemplo: {ej['caso']['codigo_caso']} · "
                f"{ej['filas_cascada']} filas en cascada · "
                f"{len(ej['bloqueos_detalle'])} constraint(s) con bloqueo"
            )
    else:
        print("  NO ejecutado (falta o no se pudo leer el insumo).")
    mapa_excel = pre.get("mapa_matriz_excel") or {}
    if mapa_excel.get("existe"):
        print(
            f"  mapa_matriz_excel: filas={mapa_excel['filas']} · "
            f"códigos={mapa_excel['codigos']} · casos={mapa_excel['casos']} · "
            f"coincidencias con JSON={len(mapa_excel.get('coincidencias_json') or [])} · "
            f"sólo por mapa={len(mapa_excel.get('casos_solo_por_mapa') or [])}"
        )
    demo = pre.get("caso_ejemplo_demostrativo")
    if demo:
        print(
            f"  caso demostrativo: {demo['caso']['codigo_caso']} · "
            f"{demo['filas_cascada']} filas en cascada · "
            f"{len(demo['bloqueos_detalle'])} constraint(s) con bloqueo"
        )
        for b in demo["bloqueos_detalle"]:
            print(
                f"    bloqueo: {b['tabla_hija']} ({b['accion']}) "
                f"filas={b['filas']} bloquea={b['bloquea']}"
            )
    print()

    ev = salida["evaluacion_modelo"]
    print("Evaluación del modelo para la matriz")
    for h in ev["hallazgos"]:
        print(f"  - {h}")
    print()
    print("DDL propuesto (TEXTO, NO EJECUTADO)")
    print(ev["puente_demandas"]["ddl"])
    print(ev["puente_casos"]["ddl"])
    print("Objetos afectados:")
    for o in ev["exportes_vistas_afectados"]:
        marca = "requiere cambio" if o["requiere_cambio"] else "sin cambio directo"
        print(f"  - {o['objeto']} ({o['tipo']}): {marca}")
    print()
    if ruta_salida is not None:
        print(f"JSON escrito en: {ruta_salida}")
    else:
        print("Modo --no-escribir: no se escribió JSON.")
    print("=" * 78)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def construir_salida(
    cur: Any,
    nombres_info: dict,
    umbral: float,
    incluir_codigo: bool = False,
) -> dict:
    fks = cargar_fks(cur)
    pks, pk_types = cargar_pks(cur, fks)
    casos_bd = cargar_casos_bd(cur)
    conteos = contar_tablas(cur)
    mapa_fk = construir_mapa_fk(fks)
    evidencia = medir_modelo(cur)
    mapa_excel = cargar_mapa_excel(cur)

    casos_por_id = {c["id"]: c for c in casos_bd}

    nombres = nombres_info.get("nombres") or []
    emp = None
    if nombres:
        emp = emparejar(casos_bd, nombres, umbral, incluir_codigo=incluir_codigo)
        ids_cascada = emp["casos_para_cascada"]
    else:
        ids_cascada = []

    # Cruce auxiliar con el mapeo que usa el importador. No altera los totales
    # por nombre: sólo avisa si el mapa identifica casos que el nombre no ve.
    mapa_excel["coincidencias_json"] = []
    mapa_excel["casos_mapeados"] = []
    mapa_excel["casos_solo_por_mapa"] = []
    if nombres and mapa_excel.get("existe"):
        por_codigo_mapa = {
            normalizar_codigo(x["codigo_excel"]): x
            for x in mapa_excel["detalle"]
            if x.get("codigo_excel")
        }
        vistos: set[str] = set()
        for n in nombres:
            codigo = normalizar_codigo(n.get("codigo"))
            if not codigo or codigo not in por_codigo_mapa:
                continue
            x = por_codigo_mapa[codigo]
            if x["caso_id"] in vistos:
                continue
            vistos.add(x["caso_id"])
            mapa_excel["coincidencias_json"].append(
                {
                    "nombre_json": n["nombre"],
                    "codigo_json": n.get("codigo"),
                    "bloque_fila": x["bloque_fila"],
                    "codigo_excel": x["codigo_excel"],
                    "caso": _caso_publico(casos_por_id[x["caso_id"]]),
                }
            )
        mapa_excel["casos_mapeados"] = sorted(vistos)
        mapa_excel["casos_solo_por_mapa"] = sorted(vistos - set(ids_cascada))

    preflight: dict[str, Any] = {
        "insumo": nombres_info,
        "ejecutado": bool(ids_cascada),
        "motivo_no_ejecutado": (
            None
            if ids_cascada
            else (
                (
                    "El insumo tiene nombres pero ninguno coincidió "
                    "(exacto o similar) con core.casos."
                )
                if nombres
                else (
                    nombres_info.get("motivo")
                    or "El insumo no aportó nombres de caso para emparejar."
                )
            )
        ),
        "umbral_similitud": umbral,
        "emparejamiento": emp,
        "mapa_matriz_excel": mapa_excel,
        "casos_emparejados": [],
        "casos_solo_por_codigo": (
            [
                _caso_publico(casos_por_id[cid])
                for cid in (emp or {}).get("casos_solo_por_codigo", [])
                if cid in casos_por_id
            ]
            if emp
            else []
        ),
        "advertencias": [],
        "cascada_por_tabla": {},
        "total_filas_cascada": 0,
        "total_incluyendo_casos": 0,
        "caso_ejemplo": None,
        "caso_ejemplo_demostrativo": None,
        "bloqueos": {
            "detalle": [],
            "resumen_por_tabla": {},
            "total_filas_bloqueantes": 0,
            "total_filas_set_null": 0,
        },
    }

    if mapa_excel.get("casos_solo_por_mapa"):
        preflight["advertencias"].append(
            f"{len(mapa_excel['casos_solo_por_mapa'])} caso(s) de la matriz se "
            "identifican por core.mapa_matriz_excel pero NO por nombre ni por "
            "codigo_caso. NO se sumaron a los totales por nombre; revise el mapa "
            "antes de borrar."
        )

    if ids_cascada:
        cascada, visitados, roots_por_fila = calcular_cascada(
            cur, ids_cascada, fks, pks, pk_types
        )
        bloqueos = calcular_bloqueos(cur, visitados, roots_por_fila, fks, pks, pk_types)

        preflight["cascada_por_tabla"] = cascada["por_tabla"]
        preflight["total_filas_cascada"] = cascada["total_filas_cascada"]
        preflight["total_incluyendo_casos"] = cascada["total_incluyendo_raices"]
        preflight["bloqueos"] = bloqueos
        if emp.get("advertencia"):
            preflight["advertencias"].append(emp["advertencia"])

        emparejados = []
        for cid in ids_cascada:
            caso = casos_por_id.get(cid)
            if not caso:
                continue
            origenes: set[str] = set()
            nombres_json: set[str] = set()
            codigos_json: set[str] = set()
            score: float | None = None
            for e in emp["emparejamientos"]:
                for x in e["exactos"]:
                    if x["caso"]["id"] == cid:
                        origenes.add("exacto")
                        nombres_json.add(e["nombre_json"])
                        score = 1.0 if score is None else max(score, 1.0)
                for x in e["similares"]:
                    if x["caso"]["id"] == cid:
                        origenes.add("similar")
                        nombres_json.add(e["nombre_json"])
                        score = x["score"] if score is None else max(score, x["score"])
                for x in e["por_codigo"]:
                    if x["caso"]["id"] == cid:
                        origenes.add("codigo")
                        if x.get("codigo_usado"):
                            codigos_json.add(x["codigo_usado"])
                        score = 1.0 if score is None else max(score, 1.0)
            cascada_caso = cascada["por_caso"].get(cid, {})
            emparejados.append(
                {
                    "caso": _caso_publico(caso),
                    "origenes": sorted(origenes),
                    "nombres_json": sorted(nombres_json),
                    "codigos_json": sorted(codigos_json),
                    "mejor_score": score,
                    "cascada_por_tabla": cascada_caso,
                    "filas_cascada": sum(
                        v for t, v in cascada_caso.items() if t != "core.casos"
                    ),
                    "filas_incluyendo_caso": sum(cascada_caso.values()),
                    "bloqueos_por_tabla": bloqueos["por_caso_tabla"].get(cid, {}),
                }
            )
        emparejados.sort(
            key=lambda x: (-x["filas_cascada"], x["caso"]["codigo_caso"] or "")
        )
        preflight["casos_emparejados"] = emparejados
        if emparejados:
            mejor = emparejados[0]
            caso = casos_por_id.get(mejor["caso"]["id"])
            if caso:
                preflight["caso_ejemplo"] = construir_ejemplo(
                    caso,
                    cascada,
                    bloqueos,
                    demostrativo=False,
                    motivo="Caso emparejado con más filas en cascada.",
                )
    else:
        demo_id = elegir_caso_demostrativo(cur)
        if demo_id and demo_id in casos_por_id:
            caso = casos_por_id[demo_id]
            cascada_demo, visitados, roots_por_fila = calcular_cascada(
                cur, [demo_id], fks, pks, pk_types
            )
            bloqueos_demo = calcular_bloqueos(
                cur, visitados, roots_por_fila, fks, pks, pk_types
            )
            preflight["bloqueos"] = bloqueos_demo
            preflight["caso_ejemplo_demostrativo"] = construir_ejemplo(
                caso,
                cascada_demo,
                bloqueos_demo,
                demostrativo=True,
                motivo=(
                    "No hay insumo de nombres. Se mide el caso con más "
                    "dependencias para mostrar el costo real de un borrado."
                ),
            )

    return {
        "meta": {
            "script": "scripts/matriz/analizar_bd_matriz.py",
            "generado_en": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "solo_lectura": True,
            "autocommit": True,
            "escritura_en_bd": False,
            "ddl_ejecutado": False,
            "borrado_ejecutado": False,
            "insumo_nombres": {
                "ruta": nombres_info["ruta"],
                "existe": nombres_info["existe"],
            },
        },
        "base": _info_base(cur),
        "conteos_actuales": conteos,
        "preflight_borrado_por_nombre": preflight,
        "mapa_fk_dominio": mapa_fk,
        "evaluacion_modelo": evaluar_modelo(evidencia),
    }


def _info_base(cur: Any) -> dict:
    cur.execute(
        "select current_user as rol, current_database() as base, "
        "current_setting('server_version') as version"
    )
    r = cur.fetchone()
    cur.execute(
        "select coalesce(rolbypassrls, false) as bypass "
        "from pg_roles where rolname = current_user"
    )
    r2 = cur.fetchone()
    return {
        "rol": r["rol"],
        "database": r["base"],
        "version": f"PostgreSQL {r['version']}",
        "rls_bypass": bool(r2["bypass"]) if r2 else False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Preflight de sólo lectura para la matriz 2026."
    )
    parser.add_argument(
        "--nombres",
        default=str(RUTA_NOMBRES),
        help="JSON con nombres de caso (por defecto salida/matriz_2026.json).",
    )
    parser.add_argument(
        "--salida",
        default=str(RUTA_SALIDA),
        help="Ruta del JSON de salida (por defecto salida/preflight_bd.json).",
    )
    parser.add_argument(
        "--umbral",
        type=float,
        default=0.72,
        help="Umbral de similitud para candidatos (0..1). Por defecto 0.72.",
    )
    parser.add_argument(
        "--incluir-codigo",
        action="store_true",
        help=(
            "Sumar a la cascada los casos que coinciden por codigo_caso aunque "
            "el nombre no coincida. Por defecto sólo se reportan aparte."
        ),
    )
    parser.add_argument(
        "--no-escribir",
        action="store_true",
        help="No escribe el JSON; sólo muestra el resumen.",
    )
    args = parser.parse_args(argv)

    nombres_info = cargar_nombres(Path(args.nombres))

    conn = None
    try:
        conn = conectar()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        salida = construir_salida(cur, nombres_info, args.umbral, args.incluir_codigo)
    except Exception as exc:  # noqa: BLE001
        if conn is not None:
            conn.close()
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    conn.close()

    ruta_salida: Path | None = None
    if not args.no_escribir:
        ruta_salida = Path(args.salida)
        ruta_salida.parent.mkdir(parents=True, exist_ok=True)
        ruta_salida.write_text(
            json.dumps(salida, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )

    imprimir_resumen(salida, ruta_salida)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
