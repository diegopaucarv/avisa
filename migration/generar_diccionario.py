#!/usr/bin/env python3
"""Genera el diccionario de datos unificado: `legacy` y modelo v10.

Lee el catálogo del motor y la curaduría del proyecto, y escribe dos artefactos:

    docs/05_datos/DICCIONARIO_DATOS.md   documento legible (una ficha por tabla)
    docs/05_datos/diccionario_datos.csv  versión máquina (una fila por columna)

Fuentes de cada dato:

    estructura (tablas, columnas, tipos, claves, índices)  catálogo PostgreSQL
    filas                                                   count(*) en vivo
    clasificación I/P/O/INF/X                               BRECHA §12.1–12.6
    propósito de cada tabla                                 curacion_*.py
    descripción de columna                                  comentario de la base,
                                                            curaduría del legado o —

Las particiones no tienen comentarios propios en PostgreSQL: heredan la
descripción de su tabla padre al generar, para no mostrar un hueco donde el
padre sí está documentado.

No inventa descripciones: cuando no hay comentario ni curaduría escribe `—`, que
significa "sin descripción documentada", no "sin significado".

Uso:
    python migration/generar_diccionario.py

Solo lee. No escribe en la base.
"""

from __future__ import annotations

import ast
import csv
import fnmatch
import re
import sys
from datetime import date
from pathlib import Path

import psycopg

RAIZ = Path(__file__).resolve().parents[1]
DOCS = RAIZ / "docs"
DESTINO_MD = DOCS / "05_datos" / "DICCIONARIO_DATOS.md"
DESTINO_CSV = DOCS / "05_datos" / "diccionario_datos.csv"
BRECHA = DOCS / "05_datos" / "BRECHA_CAPA_DATOS_V9.md"
ANEXO_A = DOCS / "05_datos" / "ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md"
REPORTE = RAIZ / "migration" / "reporte_estadistica.py"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from curacion_legacy import COLUMNAS as COLUMNAS_LEGACY  # noqa: E402
from curacion_legacy import PROPOSITO as PROPOSITO_LEGACY  # noqa: E402
from curacion_v10 import PROPOSITO as PROPOSITO_V10  # noqa: E402
from curacion_vistas import PROPOSITO as PROPOSITO_VISTAS  # noqa: E402
from curacion_vistas import QUE_LEE  # noqa: E402
from curacion_vistas import TIPO as TIPO_VISTA

# --------------------------------------------------------------------------- #
# Constantes de la base
# --------------------------------------------------------------------------- #

ESQUEMAS_FUERA = (
    "n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema','public')"
)

CLASES = {
    "I": ("Entrada", "Donde aterriza el dato del mundo."),
    "P": (
        "Proceso",
        "Intermedios de extracción, pauta y síntesis, con su trazabilidad.",
    ),
    "O": ("Salida", "Se deriva de datos ya presentes; reproducible con la misma base."),
    "INF": (
        "Transversal",
        "No es contenido: catálogos, parámetros, geografía, integraciones.",
    ),
    "X": ("Archivo", "No participa del flujo; se conserva por auditoría."),
}

# Propósito de cada esquema, en una línea. Es texto editorial del documento.
ESQUEMA_PROPOSITO = {
    "agent": "Trazas de los agentes de IA: sesiones, pauta, llamadas al modelo, prompts y retroalimentación.",
    "analisis": "Planes de análisis y sus pasos: el puente entre el dato crudo y la pauta que se ejecuta.",
    "analytics": "Solo objetos derivados: instantáneas y vistas de KPIs, tableros y anexos de salida.",
    "audit": "Registro inmutable de accesos y operaciones sobre datos personales.",
    "avisa": "Entrada cruda: mensajes y adjuntos recibidos antes de validarse, más la cola de rechazos.",
    "chat": "Historial de conversación con el asistente, versionado por ramas y confirmaciones.",
    "community": "Módulo de expansión sobre organización comunitaria; hoy solo catálogos.",
    "config": "Parámetros, aplicaciones, librerías, registro de esquemas y transiciones de estado.",
    "consultation": "Módulo de expansión para consultas a actores; sin uso todavía.",
    "core": "El dominio: casos, alertas, demandas, actores, documentos, compromisos y territorio.",
    "ctx": "Contexto sistémico: variables externas, dominios y observaciones que condicionan el análisis.",
    "domain": "Módulo de expansión con artefactos de dominio; sin uso todavía.",
    "economic": "Módulo de expansión económica; sin uso todavía.",
    "forecast": "Módulo de expansión de pronóstico; sin uso todavía.",
    "impact": "Módulo de expansión de evaluación de impacto; sin uso todavía.",
    "ind": "Indicadores, plantillas de salida y sus espacios: la capa que produce cuadros de mando.",
    "kag": "Grafo de conocimiento: nodos, aristas, comunidades e hipótesis; hoy proyecta actores.",
    "lex": "Léxico del dominio: términos y sus variantes para el análisis de lenguaje.",
    "model": "Fichas de los modelos que usa el sistema, con versión, uso y límites.",
    "mype": "Módulo de expansión para mypes; sin uso todavía.",
    "pesca": "Módulo de expansión pesquero; sin uso todavía.",
    "policy": "Reglas de negocio y tipos de regla, con su vigencia.",
    "proteccion": "Módulo de expansión de protección social; sin uso todavía.",
    "qda": "Codificación cualitativa: proyectos, códigos, segmentos y libro de códigos.",
    "staging": "Aterrizaje temporal de importaciones externas antes de validarlas.",
    "territorio": "Módulo de expansión territorial; sin uso todavía.",
}

# §12 del BRECHA declara las tablas de su encabezado antes de la primera lista
# (líneas 845–848: las cuatro tablas que añadieron los parches 9 y 10). Aquí se
# añade `capacitacion_participantes`, que el BRECHA nombra sin esquema dentro de
# la fila de `core.capacitaciones` ("+ participantes").
CLASIFICACION_EXPLICITA = {
    "core.flujo_definicion": ("INF", "§12 (encabezado)"),
    "core.flujo_estado": ("INF", "§12 (encabezado)"),
    "core.proceso_instancia": ("P", "§12 (encabezado)"),
    "audit.datos_personales_acceso": ("INF", "§12 (encabezado)"),
    "core.capacitacion_participantes": ("I", "§12.1 (fila de capacitaciones)"),
    # Las tres siguientes no aparecen en §12: son objetos de soporte que el BRECHA
    # nombra en §1.2 (tablas de la carga) pero no clasifica. Se les da la clase que
    # se deduce de su función y de la tabla a la que acompañan, y se deja constancia.
    "core.cronologia_vinculos": ("I", "criterio: vínculo de `core.caso_cronologia`"),
    "core.entidades": ("INF", "criterio: tabla de inquilino (parámetro)"),
    "core.migracion_conflicto": ("INF", "criterio: soporte de la carga (§1.2)"),
    # Parche 17. Ninguna aparece en §12 del BRECHA.
    "core.consulta_reniec": (
        "I",
        "criterio: dato externo que se registra a mano (RF-D13)",
    ),
    "core.cat_privilegio": ("INF", "criterio: catálogo de autorización (RA-07)"),
    "core.privilegio_usuario": ("INF", "criterio: concesión de autorización (RA-07)"),
    # Parche 18. Ninguna aparece en §12 del BRECHA.
    "config.servicio_externo": (
        "INF",
        "criterio: catálogo de servicios y costos (RNF-13)",
    ),
    "config.tope_gasto": ("INF", "criterio: parámetro de gasto (RNF-13, H-65)"),
    # Parche 23. No aparece en §12 del BRECHA.
    "core.alerta_destinatario": (
        "O",
        "criterio: destinatarios del aviso, junto a `core.suscripcion_notificacion`",
    ),
}

# El BRECHA nombra `_rejected` dentro de la fila de `avisa.raw_ingest`.
ALIAS_CLASIFICACION = {"avisa._rejected": "avisa.raw_ingest_rejected"}

# Regla de cierre: el BRECHA clasifica por grupos y deja sin nombrar algunos
# objetos del mismo grupo (`chat` dice "y 10 más"). Cuando la tabla huérfana
# pertenece a un esquema que el BRECHA ya adscribe a una clase, se le aplica esa
# clase y se deja constancia del origen. Nunca se aplica a `core`, cuyo detalle
# está enumerado uno por uno.
CLASE_POR_ESQUEMA = {
    "agent": ("P", "regla: §12.2 agrupa el esquema"),
    "analisis": ("P", "regla: §12.2 agrupa el esquema"),
    "chat": ("P", "regla: §12.2 agrupa el esquema"),
    "ctx": ("P", "regla: §12.2 agrupa el esquema"),
    "kag": ("P", "regla: §12.2 agrupa el esquema"),
    "qda": ("P", "regla: §12.2 agrupa el esquema"),
    "ind": ("O", "regla: §12.3 agrupa el esquema"),
    "policy": ("INF", "regla: §12.4 gobierno transversal"),
    "community": ("INF", "regla: §12.4 expansión sin uso"),
}

RE_SECCION = re.compile(r"^### 12\.(\d) ")
RE_BACKTICK = re.compile(r"`([^`]+)`")
RE_CALIFICADO = re.compile(r"^([a-z_][a-z0-9_]*)\.(\*|[a-z_][a-z0-9_]*)(\*?)$")
RE_SIMPLE = re.compile(r"^([a-z_][a-z0-9_]*)(\*?)$")
RE_FICHA = re.compile(
    r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([\d\s\u00a0]+?)\s*\|\s*(\d+)\s*\|"
    r"\s*([ABCDX])\s*\|\s*(.*?)\s*\|\s*$"
)


# --------------------------------------------------------------------------- #
# Lectura de fuentes del proyecto
# --------------------------------------------------------------------------- #


def dsn() -> str:
    """DATABASE_URL de `.env`, sin depender de python-dotenv."""
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text(encoding="utf-8").splitlines():
            if linea.startswith("DATABASE_URL="):
                return linea.split("=", 1)[1].strip()
    return "postgresql://avisa:avisa@localhost:55433/avisa"


def mapas_de_portabilidad() -> dict[str, dict]:
    """`DESTINO_V10`, `NOTA_DESTINO` y `CLASE_V10` de `reporte_estadistica.py`.

    Se leen con `ast` en vez de importar el módulo: importarlo cargaría
    matplotlib, que aquí no hace falta.
    """
    arbol = ast.parse(REPORTE.read_text(encoding="utf-8"))
    salida: dict[str, dict] = {}
    for nodo in arbol.body:
        if not isinstance(nodo, ast.Assign):
            continue
        objetivo = nodo.targets[0]
        if isinstance(objetivo, ast.Name) and objetivo.id in {
            "DESTINO_V10",
            "NOTA_DESTINO",
            "CLASE_V10",
        }:
            salida[objetivo.id] = ast.literal_eval(nodo.value)
    return salida


def leer_anexo_a() -> dict[str, dict]:
    """Clase y destino declarados por hoja en el Anexo A."""
    salida = {}
    for linea in ANEXO_A.read_text(encoding="utf-8").splitlines():
        m = RE_FICHA.match(linea)
        if not m:
            continue
        _, hoja, filas, cols, clase, destino = m.groups()
        salida[hoja] = {
            "filas_declaradas": int(re.sub(r"\D", "", filas)),
            "columnas_declaradas": int(cols),
            "clase": clase,
            "destino": destino,
        }
    return salida


def leer_clasificacion(existentes: set[str]) -> dict[str, tuple[str, str]]:
    """Clasificación I/P/O/INF de cada tabla, desde BRECHA §12.

    Devuelve `{esquema.tabla: (clase, origen)}`. Las secciones se resuelven en el
    orden 12.1, 12.3, 12.4, 12.5, 12.2: la primera mención gana, y ese orden
    evita que una mención de pasada (por ejemplo `ind.seleccion` dentro de la
    fila de síntesis) pise la clasificación que el BRECHA le da como salida.
    """
    texto = BRECHA.read_text(encoding="utf-8")
    clase_por_seccion = {"1": "I", "2": "P", "3": "O", "4": "INF", "5": "P"}
    patrones: dict[str, list[tuple[str, str]]] = {k: [] for k in clase_por_seccion}
    seccion: str | None = None
    esquema_actual: str | None = None

    for linea in texto.splitlines():
        m = RE_SECCION.match(linea)
        if m:
            seccion = m.group(1) if m.group(1) in clase_por_seccion else None
            # §12.5 enumera tablas de `core` sin repetir el esquema.
            esquema_actual = "core" if seccion == "5" else None
            continue
        if linea.startswith("### ") or linea.startswith("## "):
            seccion = None
            continue
        if seccion is None:
            continue

        for token in RE_BACKTICK.findall(linea):
            token = token.strip().rstrip(".,;")
            m = RE_CALIFICADO.match(token)
            if m:
                esquema, tabla, comodin = m.groups()
                esquema_actual = esquema
                patron = f"{esquema}.{tabla}{comodin}"
            else:
                m = RE_SIMPLE.match(token)
                if not m or esquema_actual is None:
                    continue
                tabla, comodin = m.groups()
                patron = f"{esquema_actual}.{tabla}{comodin}"
            patrones[seccion].append((patron, f"§12.{seccion}"))

    salida: dict[str, tuple[str, str]] = {}

    def asignar(nombre: str, clase: str, origen: str) -> None:
        salida.setdefault(nombre, (clase, origen))

    for seccion in ["1", "3", "4", "5", "2"]:
        clase = clase_por_seccion[seccion]
        for patron, origen in patrones[seccion]:
            for nombre in expandir(patron, existentes):
                asignar(nombre, clase, origen)

    # §12.6: el sistema anterior completo es archivo.
    for nombre in existentes:
        if nombre.startswith("legacy."):
            asignar(nombre, "X", "§12.6")

    for nombre in existentes:
        regla = CLASE_POR_ESQUEMA.get(nombre.split(".", 1)[0])
        if regla:
            asignar(nombre, *regla)

    for nombre, (clase, origen) in CLASIFICACION_EXPLICITA.items():
        if nombre in existentes:
            salida[nombre] = (clase, origen)

    return salida


def expandir(patron: str, existentes: set[str]) -> list[str]:
    """Nombres reales que designa un patrón del BRECHA.

    Acepta `esquema.tabla`, `esquema.*`, `esquema.prefijo_*` y designaciones
    abreviadas (`agent.run_log_*` incluye a `agent.run_log`).
    """
    patron = ALIAS_CLASIFICACION.get(patron, patron)
    if not patron.endswith("*"):
        return [patron] if patron in existentes else []

    coincidencias = [n for n in existentes if fnmatch.fnmatchcase(n, patron)]
    for recorte in (patron[:-1], patron[:-2] if patron.endswith("_*") else ""):
        if recorte and recorte in existentes:
            coincidencias.append(recorte)
    return coincidencias


# --------------------------------------------------------------------------- #
# Lectura de la base
# --------------------------------------------------------------------------- #


def leer_tablas(conn: psycopg.Connection) -> dict[tuple[str, str], dict]:
    metalectura = f"""
        SELECT n.nspname, c.relname, c.relkind::text, c.relispartition,
               obj_description(c.oid, 'pg_class'),
               (SELECT count(*) FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
               (SELECT count(*) FROM pg_inherits i WHERE i.inhparent = c.oid),
               (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p') AND {ESQUEMAS_FUERA}
         ORDER BY n.nspname, c.relname
    """
    tablas: dict[tuple[str, str], dict] = {}
    for esq, nom, relkind, espart, comentario, ncols, npart, nidx in conn.execute(
        metalectura
    ):
        tablas[(esq, nom)] = {
            "esquema": esq,
            "nombre": nom,
            "particionada": relkind == "p",
            "es_particion": bool(espart),
            "numero_particiones": npart,
            "comentario": (comentario or "").strip(),
            "columnas": [],
            "pk": [],
            "uq": set(),
            "uq_compuestas": [],
            "fk": {},
            "indices": nidx,
            "filas": None,
            "padre": None,
        }
    return tablas


def marcar_particiones(conn: psycopg.Connection, tablas: dict) -> None:
    """Anota la tabla padre de cada partición usando `pg_inherits`.

    Deducir el padre por el nombre falla: las particiones de `ctx.observaciones`
    se llaman `observaciones_2026`, por año, y las de `avisa.raw_ingest` por mes.
    """
    consulta = f"""
        SELECT cn.nspname, c.relname, pn.nspname, p.relname
          FROM pg_inherits i
          JOIN pg_class c ON c.oid = i.inhrelid
          JOIN pg_namespace cn ON cn.oid = c.relnamespace
          JOIN pg_class p ON p.oid = i.inhparent
          JOIN pg_namespace pn ON pn.oid = p.relnamespace
         WHERE c.relispartition
           AND cn.nspname !~ '^pg_'
           AND cn.nspname NOT IN ('information_schema','public')
    """
    for esq, nom, pesq, pnom in conn.execute(consulta):
        tabla = tablas.get((esq, nom))
        if tabla is not None:
            tabla["padre"] = f"{pesq}.{pnom}"


def leer_columnas(conn: psycopg.Connection, tablas: dict) -> None:
    consulta = f"""
        SELECT n.nspname, c.relname, a.attnum, a.attname,
               format_type(a.atttypid, a.atttypmod), a.attnotnull,
               pg_get_expr(d.adbin, d.adrelid),
               col_description(c.oid, a.attnum)
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE a.attnum > 0 AND NOT a.attisdropped
           AND c.relkind IN ('r','p') AND {ESQUEMAS_FUERA}
         ORDER BY n.nspname, c.relname, a.attnum
    """
    for esq, nom, attnum, col, tipo, no_nulo, defecto, comentario in conn.execute(
        consulta
    ):
        tabla = tablas.get((esq, nom))
        if tabla is None:
            continue
        tabla["columnas"].append(
            {
                "ordinal": attnum,
                "nombre": col,
                "tipo": tipo,
                "nulo": not no_nulo,
                "defecto": defecto,
                "comentario": (comentario or "").strip(),
                "heredado": False,
            }
        )


def heredar_descripciones(tablas: dict) -> int:
    """Copia a cada partición la descripción de su tabla padre.

    PostgreSQL no propaga los comentarios de columna a las particiones, así que sin
    esto las particiones quedarían en `—` aunque su tabla padre esté documentada.
    Solo rellena las columnas que no tienen comentario propio y devuelve cuántas
    descripciones se heredaron.
    """
    heredadas = 0
    for tabla in tablas.values():
        padre = tabla["padre"]
        if not padre:
            continue
        origen = tablas.get(tuple(padre.split(".", 1)))
        if origen is None:
            continue
        por_nombre = {c["nombre"]: c["comentario"] for c in origen["columnas"]}
        for columna in tabla["columnas"]:
            if columna["comentario"]:
                continue
            texto = por_nombre.get(columna["nombre"], "")
            if texto:
                columna["comentario"] = texto
                columna["heredado"] = True
                heredadas += 1
    return heredadas


def leer_restricciones(conn: psycopg.Connection, tablas: dict) -> None:
    consulta = f"""
        SELECT n.nspname, c.relname, con.contype::text,
               (SELECT array_agg(att.attname ORDER BY k.ord)
                  FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid AND att.attnum = k.attnum),
               fn.nspname, fc.relname,
               (SELECT array_agg(att.attname ORDER BY k.ord)
                  FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.confrelid AND att.attnum = k.attnum)
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_class fc ON fc.oid = con.confrelid
          LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
         WHERE con.contype IN ('p','u','f') AND {ESQUEMAS_FUERA}
         ORDER BY n.nspname, c.relname
    """
    for esq, nom, contype, cols, fesq, fnom, fcols in conn.execute(consulta):
        tabla = tablas.get((esq, nom))
        if tabla is None or not cols:
            continue
        if contype == "p":
            tabla["pk"] = list(cols)
        elif contype == "u":
            if len(cols) == 1:
                tabla["uq"].add(cols[0])
            else:
                tabla["uq_compuestas"].append(list(cols))
        else:
            for i, col in enumerate(cols):
                destino = f"{fesq}.{fnom}"
                if fcols and i < len(fcols) and fcols[i] != col:
                    destino += f"({fcols[i]})"
                tabla["fk"].setdefault(col, []).append(destino)


def contar_filas(conn: psycopg.Connection, tablas: dict) -> None:
    for tabla in tablas.values():
        identificador = f'"{tabla["esquema"]}"."{tabla["nombre"]}"'
        try:
            tabla["filas"] = conn.execute(
                f"SELECT count(*) FROM {identificador}"
            ).fetchone()[0]
        except psycopg.Error:
            tabla["filas"] = None


def leer_vistas(conn: psycopg.Connection) -> tuple[list[dict], int]:
    consulta = f"""
        SELECT n.nspname, c.relname, c.relkind::text,
               (SELECT count(*) FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('v','m') AND {ESQUEMAS_FUERA}
         ORDER BY n.nspname, c.relname
    """
    vistas = []
    for esq, nom, relkind, ncols in conn.execute(consulta):
        identificador = f'"{esq}"."{nom}"'
        try:
            filas = conn.execute(f"SELECT count(*) FROM {identificador}").fetchone()[0]
        except psycopg.Error:
            filas = None
        vistas.append(
            {
                "esquema": esq,
                "nombre": nom,
                "tipo": "matview" if relkind == "m" else "vista",
                "columnas": ncols,
                "filas": filas,
            }
        )
    total_columnas = sum(v["columnas"] for v in vistas)
    return vistas, total_columnas


# --------------------------------------------------------------------------- #
# Utilidades de formato
# --------------------------------------------------------------------------- #


def num(n: int | None) -> str:
    if n is None:
        return "—"
    return f"{n:,}".replace(",", " ")


def plural(n: int, singular: str, plural_: str) -> str:
    """Concuerda el sustantivo con la cifra: «1 tabla», «255 tablas»."""
    return f"{num(n)} {singular if n == 1 else plural_}"


def celda(texto) -> str:
    return str(texto).replace("|", "\\|").replace("\n", " ").strip()


def codigo(nombre: str) -> str:
    return f"`{nombre}`"


def leer_dependencias(clave: str) -> list[str]:
    valor = QUE_LEE.get(clave)
    if valor is None:
        return []
    if isinstance(valor, str):
        return [valor]
    return list(valor)


# --------------------------------------------------------------------------- #
# Modelo en memoria
# --------------------------------------------------------------------------- #


def construir(conn: psycopg.Connection) -> dict:
    tablas = leer_tablas(conn)
    leer_columnas(conn, tablas)
    leer_restricciones(conn, tablas)
    marcar_particiones(conn, tablas)
    heredadas = heredar_descripciones(tablas)

    existentes_logicas = {
        f"{t['esquema']}.{t['nombre']}"
        for t in tablas.values()
        if not t["es_particion"]
    }
    clasificacion = leer_clasificacion(existentes_logicas)

    contar_filas(conn, tablas)
    vistas, columnas_vistas = leer_vistas(conn)

    # La partición hereda la clase de su tabla padre.
    for tabla in tablas.values():
        clave = f"{tabla['esquema']}.{tabla['nombre']}"
        if clave in clasificacion:
            tabla["clase"], tabla["clase_origen"] = clasificacion[clave]
        elif tabla["padre"] in clasificacion:
            tabla["clase"], tabla["clase_origen"] = clasificacion[tabla["padre"]]
        else:
            tabla["clase"], tabla["clase_origen"] = None, None

    for vista in vistas:
        clave = f"{vista['esquema']}.{vista['nombre']}"
        if clave in clasificacion:
            vista["clase"], vista["clase_origen"] = clasificacion[clave]
        else:
            vista["clase"], vista["clase_origen"] = "O", "regla: vista derivada"

    return {
        "tablas": tablas,
        "heredadas": heredadas,
        "clasificacion": clasificacion,
        "vistas": vistas,
        "columnas_vistas": columnas_vistas,
        "mapas": mapas_de_portabilidad(),
        "anexo_a": leer_anexo_a(),
    }


# --------------------------------------------------------------------------- #
# Render del documento
# --------------------------------------------------------------------------- #


def ficha_v10(tabla: dict, lineas: list[str]) -> None:
    clave = f"{tabla['esquema']}.{tabla['nombre']}"
    lineas.append(f"#### {codigo(clave)}")
    lineas.append("")

    clase = tabla["clase"]
    if clase:
        etiqueta = CLASES[clase][0]
        meta_clase = f"{clase} · {etiqueta} ({tabla['clase_origen']})"
    else:
        meta_clase = "Sin clasificar"

    pk = ", ".join(codigo(c) for c in tabla["pk"]) or "—"
    relaciones = len(tabla["fk"])
    partes = [
        f"**Clasificación:** {meta_clase}",
        f"**Filas:** {num(tabla['filas'])}",
        f"**Columnas:** {len(tabla['columnas'])}",
        f"**Clave primaria:** {pk}",
        f"**Relaciones:** {relaciones}",
        f"**Índices:** {tabla['indices']}",
    ]
    if tabla["particionada"]:
        partes.append(f"**Particionada en:** {tabla['numero_particiones']}")
    lineas.append(" · ".join(partes))
    lineas.append("")

    proposito = (
        PROPOSITO_V10.get(clave) or tabla["comentario"] or "Sin propósito documentado."
    )
    lineas.append(proposito)
    lineas.append("")

    lineas.append("| # | Columna | Tipo | Nulo | Clave | Descripción |")
    lineas.append("| --: | --- | --- | :--: | --- | --- |")
    for col in tabla["columnas"]:
        marcas = []
        if col["nombre"] in tabla["pk"]:
            marcas.append("PK")
        destinos = tabla["fk"].get(col["nombre"])
        if destinos:
            marcas.append("FK → " + ", ".join(destinos))
        if col["nombre"] in tabla["uq"]:
            marcas.append("UQ")
        lineas.append(
            "| {n} | {col} | {tipo} | {nulo} | {clave} | {desc} |".format(
                n=col["ordinal"],
                col=codigo(col["nombre"]),
                tipo=celda(col["tipo"]),
                nulo="sí" if col["nulo"] else "no",
                clave=celda(", ".join(marcas)) or "—",
                desc=celda(col["comentario"]) or "—",
            )
        )
    if tabla["uq_compuestas"]:
        compuestas = "; ".join(
            ", ".join(codigo(c) for c in grupo) for grupo in tabla["uq_compuestas"]
        )
        lineas.append("")
        lineas.append(f"Claves únicas compuestas: {compuestas}.")
    lineas.append("")


def ficha_legacy(
    tabla: dict,
    anexo: dict,
    mapas: dict,
    lineas: list[str],
) -> None:
    nombre = tabla["nombre"]
    lineas.append(f"#### {codigo('legacy.' + nombre)}")
    lineas.append("")

    clase_declarada = anexo.get("clase") or "—"
    clase_final = mapas["CLASE_V10"].get(nombre, clase_declarada)

    if nombre in mapas["DESTINO_V10"]:
        destino = ", ".join(codigo(d) for d in mapas["DESTINO_V10"][nombre])
    elif nombre in mapas["NOTA_DESTINO"]:
        destino = mapas["NOTA_DESTINO"][nombre]
    elif nombre == "_hojas":
        destino = "— (manifiesto de la carga)"
    else:
        destino = anexo.get("destino") or "—"

    lineas.append(
        " · ".join(
            [
                f"**Filas:** {num(tabla['filas'])}",
                f"**Columnas:** {len(tabla['columnas'])}",
                f"**Clase declarada:** {clase_declarada}",
                f"**Clase en v10:** {clase_final}",
            ]
        )
    )
    lineas.append("")
    lineas.append(f"**Destino:** {destino}")
    lineas.append("")

    proposito = PROPOSITO_LEGACY.get(nombre) or "Sin propósito documentado."
    lineas.append(proposito)
    lineas.append("")

    columnas = COLUMNAS_LEGACY.get(nombre)
    if not columnas:
        return

    lineas.append("| # | Columna | Tipo | Nulo | Descripción |")
    lineas.append("| --: | --- | --- | :--: | --- |")
    for col in tabla["columnas"]:
        lineas.append(
            "| {n} | {col} | {tipo} | {nulo} | {desc} |".format(
                n=col["ordinal"],
                col=codigo(col["nombre"]),
                tipo=celda(col["tipo"]),
                nulo="sí" if col["nulo"] else "no",
                desc=celda(columnas.get(col["nombre"], "")) or "—",
            )
        )
    lineas.append("")


def ficha_vista(vista: dict, lineas: list[str]) -> None:
    clave = f"{vista['esquema']}.{vista['nombre']}"
    lineas.append(f"#### {codigo(clave)}")
    lineas.append("")
    lineas.append(
        " · ".join(
            [
                f"**Clasificación:** {vista['clase']} · {CLASES[vista['clase']][0]}",
                f"**Tipo:** {vista['tipo']}",
                f"**Filas:** {num(vista['filas'])}",
                f"**Columnas:** {vista['columnas']}",
            ]
        )
    )
    lineas.append("")
    lineas.append(PROPOSITO_VISTAS.get(clave) or "Sin propósito documentado.")
    lineas.append("")

    lee = leer_dependencias(clave)
    if lee:
        visibles = [codigo(x) for x in lee[:6]]
        resto = len(lee) - 6
        texto = ", ".join(visibles)
        if resto > 0:
            texto += f" y {resto} objetos más"
        lineas.append(f"Lee: {texto}.")
        lineas.append("")


def panorama(datos: dict, lineas: list[str]) -> None:
    tablas = datos["tablas"]
    logicas = {k: v for k, v in tablas.items() if not v["es_particion"]}
    legado = {k: v for k, v in tablas.items() if k[0] == "legacy"}
    modelo = {k: v for k, v in logicas.items() if k[0] != "legacy"}

    lineas.append("## 4. Panorama")
    lineas.append("")
    n_modelo = sum(len(v["columnas"]) for v in modelo.values())
    n_parte = sum(len(v["columnas"]) for v in tablas.values() if v["es_particion"])
    n_legado = sum(len(v["columnas"]) for v in legado.values())

    def miles(n: int) -> str:
        return "{:,}".format(n).replace(",", " ")

    lineas.append(
        "Las cifras de esta sección salen de la base en el momento de generar el "
        "documento. El CSV no agrupa por tabla lógica como este texto: tiene una "
        "fila por columna física, y suman {total} —{m} del modelo sin sus "
        "particiones, {p} de partición (marcadas con es_particion) y {l} del "
        "sistema anterior—.".format(
            total=miles(n_modelo + n_parte + n_legado),
            m=miles(n_modelo),
            p=miles(n_parte),
            l=miles(n_legado),
        )
    )
    lineas.append("")

    lineas.append("### 4.1 Tablas por esquema")
    lineas.append("")
    lineas.append("| Esquema | Qué contiene | Tablas | Columnas | Filas | Clases |")
    lineas.append("| --- | --- | --: | --: | --: | --- |")
    for esquema in sorted({k[0] for k in modelo}):
        grupo = [v for k, v in modelo.items() if k[0] == esquema]
        clases = sorted({v["clase"] for v in grupo if v["clase"]})
        columnas = sum(len(v["columnas"]) for v in grupo)
        filas = sum(v["filas"] or 0 for v in grupo)
        lineas.append(
            f"| {codigo(esquema)} | {celda(ESQUEMA_PROPOSITO.get(esquema, '—'))} "
            f"| {len(grupo)} | {num(columnas)} | {num(filas)} "
            f"| {celda(', '.join(clases)) or '—'} |"
        )
    columnas_modelo = sum(len(v["columnas"]) for v in modelo.values())
    filas_modelo = sum(v["filas"] or 0 for v in modelo.values())
    lineas.append(
        f"| **Total modelo** | {len({k[0] for k in modelo})} esquemas "
        f"| **{len(modelo)}** | **{num(columnas_modelo)}** | **{num(filas_modelo)}** | — |"
    )
    columnas_legado = sum(len(v["columnas"]) for v in legado.values())
    filas_legado = sum(v["filas"] or 0 for v in legado.values())
    lineas.append(
        f"| {codigo('legacy')} | Sistema anterior, conservado como archivo "
        f"| {len(legado)} | {num(columnas_legado)} | {num(filas_legado)} | X |"
    )
    lineas.append("")

    n_particiones = sum(1 for v in tablas.values() if v["es_particion"])
    repartidas = []
    for tabla in sorted(modelo.values(), key=lambda x: (x["esquema"], x["nombre"])):
        if tabla["particionada"]:
            nombre = tabla["esquema"] + "." + tabla["nombre"]
            repartidas.append(f"{codigo(nombre)} ({tabla['numero_particiones']})")
    lineas.append(
        f"El modelo tiene {num(len(modelo) + n_particiones)} tablas físicas: {len(modelo)} "
        f"lógicas y {num(n_particiones)} particiones que reparten cuatro tablas del dominio: "
        f"{', '.join(repartidas)}. Las fichas son de la tabla lógica, porque la partición repite "
        f"su estructura; el CSV sí las incluye fila a fila."
    )
    lineas.append("")
    lineas.append(
        "Las cifras de esta sección se cuentan por tabla y no por línea del inventario del "
        "BRECHA §12: allí se agrupan filas («`core.cat_*` (38 distintas, 41 tablas)», «y 10 "
        "más») y se suman las vistas a la salida. Por eso los totales difieren de los 31 / 78 / "
        "24 / 54 que declara ese capítulo, aunque la clase de cada tabla sea la misma."
    )
    lineas.append("")

    lineas.append("### 4.2 Tablas por clasificación")
    lineas.append("")
    lineas.append("| Clase | Qué significa | Tablas v10 | Columnas | Filas |")
    lineas.append("| --- | --- | --: | --: | --: |")
    for sigla in ["I", "P", "O", "INF", "X"]:
        etiqueta, definicion = CLASES[sigla]
        grupo = [v for v in modelo.values() if v["clase"] == sigla]
        if sigla == "X" and not grupo:
            continue
        lineas.append(
            f"| **{sigla} · {etiqueta}** | {definicion} | {len(grupo)} "
            f"| {num(sum(len(v['columnas']) for v in grupo))} "
            f"| {num(sum(v['filas'] or 0 for v in grupo))} |"
        )
    sin_clase = [v for v in modelo.values() if not v["clase"]]
    if sin_clase:
        lineas.append(
            f"| **Sin clasificar** | No aparece en BRECHA §12 y no es vista derivada "
            f"| {len(sin_clase)} | {num(sum(len(v['columnas']) for v in sin_clase))} "
            f"| {num(sum(v['filas'] or 0 for v in sin_clase))} |"
        )
    lineas.append(
        f"| **X · Archivo** | Sistema anterior completo | {len(legado)} "
        f"| {num(columnas_legado)} | {num(filas_legado)} |"
    )
    lineas.append("")
    if sin_clase:
        nombres = ", ".join(
            codigo(f"{v['esquema']}.{v['nombre']}")
            for v in sorted(sin_clase, key=lambda x: (x["esquema"], x["nombre"]))
        )
        lineas.append(
            f"Tablas sin clasificar: {nombres}. Ninguna aparece en el inventario del "
            "BRECHA §12; las tres son objetos de soporte y su clase se deduce de su "
            "función (ver `CLASIFICACION_EXPLICITA` en el generador)."
        )
        lineas.append("")

    vistas = datos["vistas"]
    lineas.append("### 4.3 Vistas y vistas materializadas")
    lineas.append("")
    lineas.append("Resumen por esquema; las fichas de cada objeto están en §6.")
    lineas.append("")
    lineas.append("| Esquema | Objetos | Vistas | Matviews | Columnas | Filas |")
    lineas.append("| --- | --: | --: | --: | --: | --: |")
    for esquema in sorted({v["esquema"] for v in vistas}):
        grupo = [v for v in vistas if v["esquema"] == esquema]
        matviews = sum(1 for v in grupo if v["tipo"] == "matview")
        lineas.append(
            f"| {codigo(esquema)} | {len(grupo)} | {len(grupo) - matviews} | {matviews} "
            f"| {num(sum(v['columnas'] for v in grupo))} "
            f"| {num(sum(v['filas'] or 0 for v in grupo))} |"
        )
    lineas.append(
        f"| **Total** | **{len(vistas)}** "
        f"| **{sum(1 for v in vistas if v['tipo'] == 'vista')}** "
        f"| **{sum(1 for v in vistas if v['tipo'] == 'matview')}** "
        f"| **{num(datos['columnas_vistas'])}** "
        f"| **{num(sum(v['filas'] or 0 for v in vistas))}** |"
    )
    lineas.append("")


def seccion_vistas(datos: dict, lineas: list[str]) -> None:
    vistas = datos["vistas"]
    lineas.append("## 6. Vistas y vistas materializadas")
    lineas.append("")
    lineas.append(
        "Los objetos derivados no guardan datos propios: se calculan a partir de las "
        "tablas anteriores. Una **vista** se recalcula en cada consulta; una "
        "**matview** es una instantánea que hay que refrescar a mano. Se documentan "
        "con su propósito y los objetos que leen, sin repetir sus columnas, que el "
        "motor entrega desde el catálogo."
    )
    lineas.append("")
    for esquema in sorted({v["esquema"] for v in vistas}):
        grupo = sorted(
            (v for v in vistas if v["esquema"] == esquema), key=lambda v: v["nombre"]
        )
        lineas.append(
            f"### 6.{sorted({v['esquema'] for v in vistas}).index(esquema) + 1} {codigo(esquema)}"
        )
        lineas.append("")
        lineas.append(
            f"{plural(len(grupo), 'objeto', 'objetos')} · "
            f"{plural(sum(v['columnas'] for v in grupo), 'columna', 'columnas')} "
            f"· {plural(sum(v['filas'] or 0 for v in grupo), 'fila', 'filas')}."
        )
        lineas.append("")
        for vista in grupo:
            ficha_vista(vista, lineas)


def seccion_legado(datos: dict, lineas: list[str]) -> None:
    tablas = datos["tablas"]
    mapas = datos["mapas"]
    anexo = datos["anexo_a"]
    legado = sorted(
        (v for k, v in tablas.items() if k[0] == "legacy"), key=lambda v: v["nombre"]
    )

    lineas.append("## 7. Sistema anterior (`legacy`)")
    lineas.append("")
    lineas.append(
        "Las 86 hojas del libro original se cargaron como tablas con columnas "
        "posicionales: `c01`, `c02`, … en el orden en que estaban en la hoja. Por "
        "eso el nombre de la columna no dice nada y el significado se documenta "
        "aquí solo para las 12 tablas que la migración lee directamente. Para las "
        "demás, el mapa columna a columna está en el análisis de portabilidad [2]."
    )
    lineas.append("")
    lineas.append(
        "La clasificación de todas ellas es **X · Archivo**: no participan del "
        "flujo, se conservan porque son la única fuente reproducible de la carga [1]."
    )
    lineas.append("")

    for tabla in legado:
        ficha_legacy(tabla, anexo.get(tabla["nombre"], {}), mapas, lineas)


def seccion_correspondencia(datos: dict, lineas: list[str]) -> None:
    tablas = datos["tablas"]
    mapas = datos["mapas"]
    anexo = datos["anexo_a"]

    lineas.append("## 8. Correspondencia del sistema anterior con v10")
    lineas.append("")
    lineas.append(
        "Cada fila dice en qué tabla del modelo terminó el contenido de una hoja. "
        "La columna «Clase declarada» es la del análisis de portabilidad [2], escrita "
        "contra v9; la columna «Clase en v10» aplica las reclasificaciones que fijó "
        "la migración [3]. Cuando discrepan, manda la segunda."
    )
    lineas.append("")
    lineas.append(
        "Los destinos se citan como los declara el Anexo A de [2]; cuando llevan una "
        "anotación entre paréntesis, esa anotación advierte de una pérdida o de una "
        "decisión pendiente y forma parte de la ficha."
    )
    lineas.append("")
    lineas.append(
        "| Tabla del sistema anterior | Filas | Clase declarada | Clase en v10 | Destino en v10 |"
    )
    lineas.append("| --- | --: | :--: | :--: | --- |")

    legado = sorted(
        (v for k, v in tablas.items() if k[0] == "legacy"), key=lambda v: v["nombre"]
    )
    for tabla in legado:
        nombre = tabla["nombre"]
        ficha = anexo.get(nombre, {})
        declarada = ficha.get("clase") or "—"
        final = mapas["CLASE_V10"].get(nombre, declarada)
        if nombre in mapas["DESTINO_V10"]:
            destino = ", ".join(codigo(d) for d in mapas["DESTINO_V10"][nombre])
        elif nombre in mapas["NOTA_DESTINO"]:
            destino = mapas["NOTA_DESTINO"][nombre]
        elif nombre == "_hojas":
            destino = "— (manifiesto de la carga)"
        else:
            destino = ficha.get("destino") or "—"
        lineas.append(
            f"| {codigo('legacy.' + nombre)} | {num(tabla['filas'])} "
            f"| {declarada} | {final} | {celda(destino)} |"
        )
    lineas.append("")


def seccion_indice(datos: dict, lineas: list[str]) -> None:
    tablas = datos["tablas"]
    nombres = sorted(
        (
            (v["nombre"], v["esquema"])
            for k, v in tablas.items()
            if not v["es_particion"]
        ),
    )
    vistas = sorted((v["nombre"], v["esquema"]) for v in datos["vistas"])

    lineas.append("## 9. Índice alfabético")
    lineas.append("")
    lineas.append(
        "Ordenado por nombre de objeto, para encontrar una tabla cuando se conoce "
        "el nombre pero no el esquema. Las tablas muestran su esquema delante."
    )
    lineas.append("")

    actual = None
    for nombre, esquema in nombres:
        inicial = nombre[0].upper() if nombre[0].isalpha() else "Símbolos"
        if inicial != actual:
            if actual is not None:
                lineas.append("")
            lineas.append(f"**{inicial}**")
            lineas.append("")
            actual = inicial
        lineas.append(f"- {codigo(f'{esquema}.{nombre}')}")

    if vistas:
        lineas.append("")
        lineas.append("**Vistas**")
        lineas.append("")
        for nombre, esquema in vistas:
            lineas.append(f"- {codigo(f'{esquema}.{nombre}')}")
    lineas.append("")


def referencia(n: int, texto: str) -> str:
    return f"{n}. {texto}"


def generar_markdown(datos: dict) -> str:
    tablas = datos["tablas"]
    logicas = {k: v for k, v in tablas.items() if not v["es_particion"]}
    modelo = {k: v for k, v in logicas.items() if k[0] != "legacy"}
    legado = {k: v for k, v in logicas.items() if k[0] == "legacy"}

    columnas_modelo = sum(len(v["columnas"]) for v in modelo.values())
    columnas_legado = sum(len(v["columnas"]) for v in legado.values())
    filas_modelo = sum(v["filas"] or 0 for v in modelo.values())
    filas_legado = sum(v["filas"] or 0 for v in legado.values())
    total_columnas = columnas_modelo + columnas_legado
    particiones = sum(1 for v in tablas.values() if v["es_particion"])
    columnas_particiones = sum(
        len(v["columnas"]) for v in tablas.values() if v["es_particion"]
    )
    total_columnas = columnas_modelo + columnas_particiones + columnas_legado

    con_comentario = sum(
        1
        for grupo in (modelo, legado)
        for v in grupo.values()
        for c in v["columnas"]
        if c["comentario"]
    )
    curadas = sum(
        len(COLUMNAS_LEGACY.get(v["nombre"], {}))
        for v in legado.values()
        if v["nombre"] in COLUMNAS_LEGACY
    )

    lineas: list[str] = []
    lineas.append("# Diccionario de datos — AVISA / SIPRECS")
    lineas.append("")
    lineas.append(
        f"Generado el {date.today().isoformat()} desde la base viva con "
        f"`migration/generar_diccionario.py` [9]. No se edita a mano: se regenera."
    )
    lineas.append("")

    # ---- 1 ----------------------------------------------------------------
    lineas.append("## 1. Qué es este documento")
    lineas.append("")
    lineas.append(
        "Es el diccionario único del sistema. Describe, con el mismo formato, las "
        "dos capas que hoy conviven en la base: el **sistema anterior** "
        f"({len(legado)} tablas con columnas posicionales) y el **modelo v10** "
        f"({len(modelo)} tablas lógicas en {len({k[0] for k in modelo}) + 1} esquemas, "
        f"de los cuales uno solo contiene vistas, más {len(datos['vistas'])} objetos derivados)."
    )
    lineas.append("")
    lineas.append(
        "Para cada tabla dice qué guarda, cuántas filas y columnas tiene, cuáles son "
        "sus claves y relaciones, y qué significa cada columna. Para el sistema "
        "anterior añade el destino que tiene en v10, de modo que un mismo documento "
        "sirve para leer el pasado y el presente."
    )
    lineas.append("")
    lineas.append(
        "Es el entregable 1.1 del plan del producto mínimo [6]: el inventario que "
        "cualquier lectura posterior del sistema debe consultar antes de escribir código."
    )
    lineas.append("")
    lineas.append("Tres cosas que este documento **no** es:")
    lineas.append("")
    lineas.append(
        "- No es el documento de cambios entre versiones. Ese es el documento padre "
        "[4], que explica qué se conserva y qué cambia, con su estadística comparada."
    )
    lineas.append(
        "- No es el diseño del modelo. Ese es `AVISA_PRODUCE_v10.md` [5]; aquí solo se "
        "describe lo que existe hoy en la base."
    )
    lineas.append(
        "- No repite el mapa columna a columna del sistema anterior. Ese detalle vive "
        "en el análisis de portabilidad, §3 [2], y aquí solo se resume."
    )
    lineas.append("")

    lineas.append("### Cifras de esta edición")
    lineas.append("")
    lineas.append("| Dimensión | Sistema anterior | Modelo v10 |")
    lineas.append("| --- | --: | --: |")
    lineas.append(f"| Tablas lógicas | {len(legado)} | {len(modelo)} |")
    lineas.append(f"| Particiones de tabla | 0 | {num(particiones)} |")
    lineas.append(
        f"| Tablas físicas | {len(legado)} | {num(len(modelo) + particiones)} |"
    )
    lineas.append(
        f"| Columnas (sin particiones) | {num(columnas_legado)} | {num(columnas_modelo)} |"
    )
    lineas.append(
        f"| Columnas (con particiones) | {num(columnas_legado)} | {num(columnas_modelo + columnas_particiones)} |"
    )
    lineas.append(f"| Filas | {num(filas_legado)} | {num(filas_modelo)} |")
    lineas.append(
        f"| Objetos derivados (vistas y matviews) | 0 | {len(datos['vistas'])} |"
    )
    lineas.append("")
    lineas.append(
        f"El total de columnas que recorre este diccionario es {num(total_columnas)}: "
        f"{num(columnas_modelo + columnas_particiones)} del modelo v10 contando sus "
        f"particiones, más {num(columnas_legado)} del sistema anterior. De ellas, "
        f"{num(con_comentario)} tienen comentario en la propia base y {num(curadas)} "
        f"tienen significado documentado por curaduría; el resto son columnas de "
        f"partición que heredan la descripción de su tabla padre, o celdas del "
        f"sistema anterior que aparecen con `—`."
    )
    lineas.append("")

    # ---- 2 ----------------------------------------------------------------
    lineas.append("## 2. Cómo se generó y cómo se regenera")
    lineas.append("")
    lineas.append("```")
    lineas.append("python migration/generar_diccionario.py")
    lineas.append("```")
    lineas.append("")
    lineas.append(
        "El script lee la base, escribe `docs/05_datos/DICCIONARIO_DATOS.md` y "
        "`docs/05_datos/diccionario_datos.csv`, y no modifica nada en la base. Necesita la "
        "base local levantada; cómo hacerlo y con qué credenciales está en el "
        "manual de entorno [8]."
    )
    lineas.append("")
    lineas.append("De dónde sale cada dato:")
    lineas.append("")
    lineas.append(
        "- **Estructura**: tablas, columnas, tipos, nulabilidad, valores por defecto, "
        "claves primarias, ajenas, únicas e índices salen del catálogo del motor "
        "(`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`)."
    )
    lineas.append(
        "- **Filas**: se cuentan con `count(*)` al generar. No se usan estimaciones, "
        "porque la base las tenía desactualizadas."
    )
    lineas.append(
        "- **Clasificación**: entrada, proceso, salida o transversal sale de "
        "BRECHA §12.1–12.6 [1]; las tablas que no aparecen allí se marcan como sin "
        "clasificar, y las vistas se marcan como salida por una regla explícita."
    )

    tablas_doc = datos["tablas"]
    modelo_doc = [
        t
        for t in tablas_doc.values()
        if not t["es_particion"] and t["esquema"] != "legacy"
    ]
    con_proposito = sum(
        1
        for t in modelo_doc
        if PROPOSITO_V10.get(f"{t['esquema']}.{t['nombre']}") or t["comentario"]
    )
    con_comentario_propio = sum(
        1
        for t in tablas_doc.values()
        if t["esquema"] != "legacy"
        for c in t["columnas"]
        if c["comentario"] and not c["heredado"]
    )
    heredadas = datos["heredadas"]
    sin_descripcion = sum(
        1
        for (_esq, nom), t in tablas_doc.items()
        for c in t["columnas"]
        if not c["comentario"] and c["nombre"] not in COLUMNAS_LEGACY.get(nom, {})
    )

    lineas.append(
        f"- **Propósito**: {num(con_proposito)} de las {len(modelo_doc)} tablas del "
        "modelo v10 tienen comentario de tabla en la base: casi todos los escribe el "
        "parche de comentarios [12], y las seis tablas que llegaron con los parches "
        "[14], [17] y [18] traen el suyo; las del sistema anterior y las vistas "
        "vienen de tres "
        "módulos de curaduría escritos a partir de las columnas y las claves de cada "
        "tabla [10]."
    )
    lineas.append(
        f"- **Descripciones de columna**: {num(con_comentario_propio)} columnas del "
        "modelo v10 llevan comentario propio en la base (los pone el parche [12], salvo "
        "los de las tablas que llegaron con los parches [14] a [19] y los de las dos "
        "columnas de aprobación que añade el [21]). Las particiones heredan "
        f"la descripción de su tabla padre ({num(heredadas)} columnas), porque "
        "PostgreSQL no propaga los comentarios a las particiones. Del sistema "
        "anterior se documentan las columnas que la migración consume de forma "
        f"directa; las otras {num(sin_descripcion)} celdas quedan en `—`."
    )
    lineas.append("")
    lineas.append(
        "**Regla de honestidad**: ningún texto se deduce del nombre de la columna. "
        "`—` significa «sin descripción documentada», no «sin significado». Se "
        "prefiere un hueco visible a una glosa inventada."
    )
    lineas.append("")
    lineas.append(
        "El CSV es la versión para máquina: una fila por columna, con la misma "
        "información y sin texto de relleno. Es lo que se importa a un catálogo o se "
        "cruza con otro inventario. Trae además la columna `origen_descripcion` "
        "(comentario_bd, heredado_padre, curaduria o sin_descripcion), que dice de "
        "dónde sale cada descripción."
    )
    lineas.append("")

    # ---- 3 ----------------------------------------------------------------
    lineas.append("## 3. Cómo leer una ficha")
    lineas.append("")
    lineas.append(
        "Cada tabla tiene un encabezado con su nombre completo y una línea de "
        "metadatos: clasificación, filas, columnas, clave primaria, número de "
        "relaciones e índices. Debajo, una frase con el propósito, y una tabla con "
        "las columnas. Las vistas y matviews (§6) tienen ficha más corta: propósito, "
        "filas y objetos que leen."
    )
    lineas.append("")
    lineas.append("### Clasificación")
    lineas.append("")
    lineas.append("| Clase | Nombre | Qué agrupa |")
    lineas.append("| --- | --- | --- |")
    for sigla in ["I", "P", "O", "INF", "X"]:
        etiqueta, definicion = CLASES[sigla]
        lineas.append(f"| **{sigla}** | {etiqueta} | {definicion} |")
    lineas.append("")
    lineas.append(
        "En la ficha aparece la sigla, el nombre y la sección del BRECHA de donde "
        "sale, por ejemplo `I · Entrada (§12.1)`. Cuando la tabla no está en esa "
        "clasificación dice «Sin clasificar»."
    )
    lineas.append("")

    lineas.append("### Columna «Clave»")
    lineas.append("")
    lineas.append(
        "`PK` es la clave primaria; `FK → esquema.tabla` es una clave ajena y "
        "`FK → esquema.tabla(columna)` indica que el nombre de la columna de destino "
        "es distinto; `UQ` es una restricción de unicidad. Una columna puede acumular "
        "varias marcas."
    )
    lineas.append("")
    lineas.append(
        "Las claves únicas compuestas no caben en una celda y se anotan al pie de la "
        "tabla de columnas."
    )
    lineas.append("")
    lineas.append("### Otras convenciones")
    lineas.append("")
    lineas.append(
        "- `Nulo`: `sí` cuando la columna admite nulos; `no` cuando está declarada "
        "como obligatoria."
    )
    lineas.append("- `—`: dato no disponible o no documentado. Nunca es un cero.")
    lineas.append(
        "- `Particionada en N`: la tabla física se reparte en N particiones; las "
        "particiones no tienen ficha propia para no repetir la misma estructura."
    )
    lineas.append(
        "- El esquema `public` no aparece: contiene tres objetos de la extensión "
        "PostGIS, ajenos al dominio."
    )
    lineas.append(
        "- «Clase declarada» y «Clase en v10» solo existen en el sistema anterior: "
        "la primera es la clasificación histórica y la segunda la que quedó vigente "
        "tras la migración."
    )
    lineas.append(
        "- Las columnas que terminan en `_cifrado` o `_hmac` guardan un dato personal "
        "protegido: la primera el valor cifrado y la segunda una huella que permite "
        "buscarlo y detectar duplicados sin descifrarlo. El esquema de protección se "
        "describe en el parche de seguridad de nivel alto [7]."
    )
    lineas.append("")

    # ---- 4 ----------------------------------------------------------------
    panorama(datos, lineas)

    # ---- 5 ----------------------------------------------------------------
    lineas.append("## 5. Modelo v10")
    lineas.append("")
    lineas.append(
        "Las tablas lógicas del modelo, agrupadas por esquema. Dentro de cada "
        "esquema van en orden alfabético."
    )
    lineas.append("")
    esquemas = sorted({k[0] for k in modelo})
    for i, esquema in enumerate(esquemas, 1):
        grupo = sorted(
            (v for k, v in modelo.items() if k[0] == esquema), key=lambda v: v["nombre"]
        )
        lineas.append(f"### 5.{i} {codigo(esquema)}")
        lineas.append("")
        lineas.append(ESQUEMA_PROPOSITO.get(esquema, "Sin propósito documentado."))
        lineas.append("")
        lineas.append(
            f"{plural(len(grupo), 'tabla', 'tablas')} · "
            f"{plural(sum(len(v['columnas']) for v in grupo), 'columna', 'columnas')} "
            f"· {plural(sum(v['filas'] or 0 for v in grupo), 'fila', 'filas')}."
        )
        lineas.append("")
        for tabla in grupo:
            ficha_v10(tabla, lineas)

    # ---- 6, 7 y 8 ----------------------------------------------------------
    seccion_vistas(datos, lineas)
    seccion_legado(datos, lineas)
    seccion_correspondencia(datos, lineas)

    # ---- 9 ----------------------------------------------------------------
    seccion_indice(datos, lineas)

    # ---- 9 ----------------------------------------------------------------
    lineas.append("## 10. Referencias")
    lineas.append("")
    lineas.append(
        "Cada referencia dice qué documento es y qué parte de este diccionario "
        "sostiene."
    )
    lineas.append("")
    lineas.append(
        referencia(
            1,
            "`docs/05_datos/BRECHA_CAPA_DATOS_V9.md` — diagnóstico de la base viva. Su §12.1–12.6 "
            "es el origen de la clasificación entrada / proceso / salida / transversal / archivo.",
        )
    )
    lineas.append(
        referencia(
            2,
            "`docs/05_datos/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` — análisis de portabilidad. "
            "Su Anexo A declara clase y destino de las 87 tablas del sistema anterior, y su §3 "
            "es el mapa columna a columna.",
        )
    )
    lineas.append(
        referencia(
            3,
            "`docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md` — decisiones de migración D1–D51. Su "
            "Anexo A.2 fija las reclasificaciones que quedaron vigentes en v10.",
        )
    )
    lineas.append(
        referencia(
            4,
            "`docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` — documento padre: qué se "
            "conserva y qué cambia entre el sistema anterior y v10, con la estadística comparada.",
        )
    )
    lineas.append(
        referencia(
            5,
            "`docs/02_arquitectura/AVISA_PRODUCE_v10.md` — arquitectura objetivo del modelo v10.",
        )
    )
    lineas.append(
        referencia(
            6,
            "`docs/03_ejecucion/mvp.md` — plan de ejecución del producto mínimo; su §1.1 pide este "
            "diccionario como entregable.",
        )
    )
    lineas.append(
        referencia(
            7,
            "`docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql` — cifrado AES-256 de los datos "
            "personales y registro de auditoría; explica las columnas `*_cifrado` y `*_hmac`.",
        )
    )
    lineas.append(
        referencia(
            8,
            "`docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md` — cómo levantar la base y qué credenciales usa.",
        )
    )
    lineas.append(
        referencia(
            9,
            "`migration/generar_diccionario.py` — el generador de este documento y del CSV.",
        )
    )
    lineas.append(
        referencia(
            10,
            "`migration/curacion_v10.py`, `migration/curacion_vistas.py` y "
            "`migration/curacion_legacy.py` — la curaduría de propósitos y de significados de columna.",
        )
    )
    lineas.append(
        referencia(
            11,
            "`docs/PARCHE_11_GRAFO_KAG.sql` — nodos y aristas del grafo KAG: de dónde "
            "salen las filas de `kag.nodos` y `kag.aristas` y qué las mantiene al día.",
        )
    )
    lineas.append(
        referencia(
            12,
            "`docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`, generado por "
            "`migration/generar_comentarios_sql.py` desde `migration/curacion_v10_columnas.py` "
            "— de ahí salen los propósitos de tabla y las descripciones de columna que la base "
            "tiene escritas.",
        )
    )
    lineas.append("")

    return "\n".join(lineas) + "\n"


# --------------------------------------------------------------------------- #
# CSV
# --------------------------------------------------------------------------- #

CABECERA_CSV = [
    "esquema",
    "tabla",
    "es_particion",
    "clasificacion",
    "columna",
    "ordinal",
    "tipo",
    "nulo",
    "default",
    "es_pk",
    "es_unico",
    "fk_destino",
    "descripcion",
    "origen_descripcion",
]


def generar_csv(datos: dict) -> list[list]:
    filas: list[list] = []
    for (esquema, nombre), tabla in sorted(datos["tablas"].items()):
        clase = tabla["clase"] or ""
        curaduria = COLUMNAS_LEGACY.get(nombre, {})
        for col in tabla["columnas"]:
            if col["comentario"]:
                descripcion = col["comentario"]
                origen = "heredado_padre" if col.get("heredado") else "comentario_bd"
            elif col["nombre"] in curaduria:
                descripcion = curaduria[col["nombre"]]
                origen = "curaduria"
            else:
                descripcion = ""
                origen = "sin_descripcion"
            filas.append(
                [
                    esquema,
                    nombre,
                    "1" if tabla["es_particion"] else "0",
                    clase,
                    col["nombre"],
                    col["ordinal"],
                    col["tipo"],
                    "sí" if col["nulo"] else "no",
                    col["defecto"] or "",
                    "1" if col["nombre"] in tabla["pk"] else "0",
                    "1" if col["nombre"] in tabla["uq"] else "0",
                    ";".join(tabla["fk"].get(col["nombre"], [])),
                    descripcion,
                    origen,
                ]
            )
    return filas


# --------------------------------------------------------------------------- #
# Principal
# --------------------------------------------------------------------------- #


def main() -> None:
    with psycopg.connect(dsn()) as conn:
        datos = construir(conn)

    markdown = generar_markdown(datos)
    with open(DESTINO_MD, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(markdown)

    filas = generar_csv(datos)
    with open(DESTINO_CSV, "w", encoding="utf-8-sig", newline="") as fh:
        escritor = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        escritor.writerow(CABECERA_CSV)
        escritor.writerows(filas)

    tablas = datos["tablas"]
    logicas = [v for v in tablas.values() if not v["es_particion"]]
    modelo = [v for v in logicas if v["esquema"] != "legacy"]
    legado = [v for v in logicas if v["esquema"] == "legacy"]
    sin_clase = [v for v in logicas if not v["clase"]]

    print(
        f"Markdown   {DESTINO_MD.relative_to(RAIZ)}  {len(markdown.splitlines())} líneas"
    )
    print(f"CSV        {DESTINO_CSV.relative_to(RAIZ)}  {len(filas)} filas")
    print(
        f"Tablas     {len(legado)} legacy + {len(logicas) - len(legado)} v10 (lógicas)"
    )
    print(f"Vistas     {len(datos['vistas'])}")
    print(f"Sin clasificar: {len(sin_clase)}")
    for tabla in sin_clase:
        print(f"  · {tabla['esquema']}.{tabla['nombre']}")


if __name__ == "__main__":
    main()
