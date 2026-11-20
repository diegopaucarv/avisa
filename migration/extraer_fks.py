#!/usr/bin/env python3
"""Separa las claves ajenas del esquema unificado en una sección propia.

Por qué existe
--------------
El equipo de OGTI migra el esquema a SQL Server con SSMA, y SSMA importa
mejor un DDL en el que las tablas se crean *sin* claves ajenas y las
relaciones se añaden después: así no depende del orden de creación y puede
decidir, tabla por tabla, qué restricciones aplica y cuáles deja fuera.

Este script lee `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` —que es generado y no
se edita a mano— y escribe dos archivos nuevos:

    docs/sql_server/AVISA_V10_ESQUEMA_SIN_FK.sql
        El mismo esquema, con las claves ajenas quitadas de los CREATE TABLE
        y con los ALTER que solo añadían una clave ajena eliminados.

    docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql
        Todas las claves ajenas como ALTER TABLE ... ADD CONSTRAINT ...,
        agrupadas por tabla hija y con el nombre que PostgreSQL les puso.

Además escribe `docs/sql_server/INFORME_FKS.md` con las cifras medidas y las
claves ajenas que apuntan fuera del alcance del MVP.

Qué se reconoce como clave ajena
--------------------------------
En el archivo unificado aparecen cuatro formas y las cuatro se tratan:

    1. en la columna:        id UUID REFERENCES core.casos(id)
    2. a nivel de tabla:     FOREIGN KEY (a, b) REFERENCES otra(x, y)
    3. con nombre:           CONSTRAINT foo FOREIGN KEY (...) REFERENCES ...
    4. en un ALTER:          ALTER TABLE t ADD [COLUMN] c UUID REFERENCES ...
                             ALTER TABLE t ADD CONSTRAINT f FOREIGN KEY ...
                             ALTER TABLE t ADD COLUMN IF NOT EXISTS c ...
                             (también con varias columnas en un solo ALTER)

Las tres primeras salen de CREATE TABLE; la cuarta se recorta en su sitio:
si el ALTER solo añadía la clave ajena desaparece, y si además añadía una
columna se conserva la columna sin la referencia.

Cómo se lee el SQL
------------------
El archivo se enmascara primero: se sustituyen por espacios los comentarios
(`--`, `/* */`), las cadenas ('...', E'...', "...") y los cuerpos entre
dólares (`$$ ... $$`, `$tag$ ... $tag$`). Sobre la máscara se buscan las
sentencias y las comas de primer nivel, y los recortes se aplican sobre el
texto original. Así una columna llamada `references` o un comentario que
mencione «REFERENCES» no confunden al extractor.

El archivo es idempotente en el sentido de que siempre produce el mismo
resultado a partir de la misma entrada, y no escribe nada fuera de
`docs/sql_server/`. No abre conexión a ninguna base.

Uso:
    python migration/extraer_fks.py
    python migration/extraer_fks.py --entrada _seccion_a.sql --salida-dir /tmp/x
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
UNIFICADO = RAIZ / "docs" / "AVISA_V10_ESQUEMA_UNIFICADO.sql"
CSV_PRIORIDAD = RAIZ / "docs" / "mvp_prioridad_tablas.csv"
DIR_SALIDA = RAIZ / "docs" / "sql_server"

IDENT = r'(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)'
NOMBRE = rf"{IDENT}(?:\s*\.\s*{IDENT})?"

PAT_CREATE = re.compile(
    rf"^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({NOMBRE})",
    re.IGNORECASE,
)
PAT_ALTER = re.compile(
    rf"^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?({NOMBRE})",
    re.IGNORECASE,
)
PAT_ADD_CONSTRAINT_FK = re.compile(
    rf"^\s*ADD\s+CONSTRAINT\s+({IDENT})\s+FOREIGN\s+KEY", re.IGNORECASE
)
PAT_ADD_COLUMNA = re.compile(
    rf"^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?({IDENT})\s", re.IGNORECASE
)
PAT_REFERENCES = re.compile(r"\bREFERENCES\b", re.IGNORECASE)


# ---------------------------------------------------------------------
# Enmascarado
# ---------------------------------------------------------------------
def enmascarar(texto: str) -> str:
    """Devuelve el texto con comentarios y literales convertidos en espacios.

    Conserva la longitud y los saltos de línea, de modo que cualquier índice
    de la máscara sirve sobre el texto original.
    """
    salida = list(texto)
    i, n = 0, len(texto)

    def borrar(desde: int, hasta: int) -> None:
        for k in range(desde, min(hasta, n)):
            if salida[k] != "\n":
                salida[k] = " "

    while i < n:
        c = texto[i]

        if c == "-" and texto.startswith("--", i):
            fin = texto.find("\n", i)
            fin = n if fin < 0 else fin
            borrar(i, fin)
            i = fin
            continue

        if c == "/" and texto.startswith("/*", i):
            fin = texto.find("*/", i + 2)
            fin = n if fin < 0 else fin + 2
            borrar(i, fin)
            i = fin
            continue

        if c in ('"', "'"):
            # E'...' admite \\ como escape; el resto usa '' para la comilla.
            escapa = False
            if c == "'" and i:
                previo = texto[i - 1]
                anterior = texto[i - 2] if i > 1 else " "
                if previo in "Ee" and not (anterior.isalnum() or anterior == "_"):
                    escapa = True
            j = i + 1
            while j < n:
                if escapa and texto[j] == "\\":
                    j += 2
                    continue
                if texto[j] == c:
                    if j + 1 < n and texto[j + 1] == c:
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            borrar(i, j)
            i = j
            continue

        if c == "$":
            m = re.match(r"\$(\w*)\$", texto[i:])
            if m:
                etiqueta = m.group(0)
                fin = texto.find(etiqueta, i + len(etiqueta))
                fin = n if fin < 0 else fin + len(etiqueta)
                borrar(i, fin)
                i = fin
                continue

        i += 1

    return "".join(salida)


# ---------------------------------------------------------------------
# Utilidades sobre la máscara
# ---------------------------------------------------------------------
def _saltar(mask: str, i: int) -> int:
    n = len(mask)
    while i < n and mask[i].isspace():
        i += 1
    return i


def _saltar_meta(texto: str, mask: str, ini: int, fin: int) -> int:
    """Primera posición con SQL real, saltando metaórdenes y líneas vacías.

    psql intercala `\\echo`, `\\set` y compañía entre sentencias, y no llevan
    punto y coma: quedan pegados al principio de la sentencia siguiente. Sin
    este salto, `^CREATE` nunca coincide y la tabla se pierde en silencio.
    """
    pos = ini
    while pos < fin:
        salto = texto.find("\n", pos)
        if salto < 0 or salto > fin:
            salto = fin
        linea = mask[pos:salto]
        if not linea.strip() or linea.lstrip().startswith("\\"):
            pos = salto + 1
            continue
        return pos + (len(linea) - len(linea.lstrip()))
    return fin


def _cerrar(mask: str, i: int) -> int:
    """Índice del paréntesis que cierra el que está en `i`, o -1."""
    prof = 0
    for k in range(i, len(mask)):
        if mask[k] == "(":
            prof += 1
        elif mask[k] == ")":
            prof -= 1
            if prof == 0:
                return k
    return -1


def _cortar(mask: str, ini: int, fin: int) -> list[tuple[int, int, int | None]]:
    """Parte [ini, fin) por comas de primer nivel.

    Devuelve (inicio, final, coma) en coordenadas absolutas; `coma` es el
    índice de la coma que cierra el elemento, o None en el último.
    """
    trozos: list[tuple[int, int, int | None]] = []
    prof = 0
    arranque = ini
    for k in range(ini, fin):
        ch = mask[k]
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        elif ch == "," and prof == 0:
            trozos.append((arranque, k, k))
            arranque = k + 1
    trozos.append((arranque, fin, None))
    return trozos


def _posiciones_alter(mask: str, ini: int, fin: int) -> list[int]:
    """Posiciones de `ALTER TABLE` a profundidad 0 dentro de [ini, fin)."""
    posiciones: list[int] = []
    prof = 0
    k = ini
    while k < fin:
        ch = mask[k]
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        elif prof == 0 and mask.startswith("ALTER", k):
            if k == 0 or not (mask[k - 1].isalnum() or mask[k - 1] == "_"):
                if re.match(r"ALTER\s+TABLE\b", mask[k:], re.IGNORECASE):
                    posiciones.append(k)
                    k += 5
                    continue
        k += 1
    return posiciones


def _recortar(mask: str, ini: int, fin: int) -> tuple[int, int]:
    while ini < fin and mask[ini].isspace():
        ini += 1
    while fin > ini and mask[fin - 1].isspace():
        fin -= 1
    return ini, fin


def _fin_referencia(mask: str, pos: int) -> int:
    """Final de la cláusula REFERENCES que empieza en `pos`."""
    m = re.match(r"REFERENCES\b", mask[pos:], re.IGNORECASE)
    if not m:
        return pos
    i = pos + m.end()

    m = re.match(r"\s*" + NOMBRE, mask[i:], re.IGNORECASE)
    if not m:
        return i
    i += m.end()

    j = _saltar(mask, i)
    if j < len(mask) and mask[j] == "(":
        cierre = _cerrar(mask, j)
        if cierre > 0:
            i = cierre + 1

    # Cláusulas que forman parte de la clave ajena, no de la columna.
    patrones = (
        r"ON\s+(?:DELETE|UPDATE)\s+(?:NO\s+ACTION|RESTRICT|CASCADE|SET\s+NULL|SET\DEFAULT)".replace(
            r"SET\DEFAULT", r"SET\s+DEFAULT"
        ),
        r"MATCH\s+(?:FULL|PARTIAL|SIMPLE)",
        r"(?:NOT\s+)?DEFERRABLE",
        r"INITIALLY\s+(?:DEFERRED|IMMEDIATE)",
    )
    while True:
        j = _saltar(mask, i)
        for patron in patrones:
            m = re.match(patron + r"\b", mask[j:], re.IGNORECASE)
            if m:
                i = j + m.end()
                break
        else:
            break
    return i


def _una_linea(texto: str) -> str:
    """Quita comentarios de fin de línea y colapsa los espacios."""
    limpio = "\n".join(linea.split("--")[0] for linea in texto.split("\n"))
    return re.sub(r"\s+", " ", limpio).strip()


def _nombre_clave(tabla: str, columnas: list[str]) -> str:
    """Nombre al estilo de PostgreSQL: <tabla>_<cols>_fkey, máx. 63 bytes."""
    base = tabla + "_" + "_".join(columnas)
    nombre = base + "_fkey"
    if len(nombre) <= 63:
        return nombre
    return base[: 63 - len("_fkey")] + "_fkey"


def _plano(nombre: str) -> str:
    """core."Casos" -> core.casos, para usar como clave lógica."""
    partes = [p.strip().strip('"').lower() for p in re.split(r"\s*\.\s*", nombre)]
    return ".".join(partes)


def _tabla_simple(nombre: str) -> str:
    return _plano(nombre).split(".")[-1]


# ---------------------------------------------------------------------
# Modelo
# ---------------------------------------------------------------------
@dataclass
class ClaveAjena:
    hijo: str  # core.casos
    columnas: tuple[str, ...]
    padre: str  # core.regiones
    nombre: str
    definicion: str  # "FOREIGN KEY (a) REFERENCES b(c) ON DELETE ..."
    origen: str  # columna | tabla | alter

    @property
    def orden(self) -> tuple[str, str]:
        return (self.hijo, self.nombre)


@dataclass
class Resultado:
    fks: list[ClaveAjena] = field(default_factory=list)
    ediciones: list[tuple[int, int, str]] = field(default_factory=list)
    tablas: set[str] = field(default_factory=set)
    contadores: Counter = field(default_factory=Counter)
    duplicadas: list[ClaveAjena] = field(default_factory=list)
    sin_nombre: list[ClaveAjena] = field(default_factory=list)


# ---------------------------------------------------------------------
# Extracción
# ---------------------------------------------------------------------
def _extraer_de_create(
    texto: str, mask: str, ini_paren: int, fin_paren: int, tabla: str, res: Resultado
) -> list[tuple[int, int, str]]:
    """Devuelve las ediciones que quitan las claves ajenas del cuerpo."""
    ediciones: list[tuple[int, int, str]] = []
    elementos = _cortar(mask, ini_paren + 1, fin_paren)

    for indice, (ini, fin, coma) in enumerate(elementos):
        a, b = _recortar(mask, ini, fin)
        if a >= b:
            continue
        cuerpo = mask[a:b]

        # 1 · CONSTRAINT nombre FOREIGN KEY (...) REFERENCES ...
        m = re.match(
            rf"CONSTRAINT\s+({IDENT})\s+FOREIGN\s+KEY\s*(\([^)]*\))\s*(REFERENCES\b.*)$",
            cuerpo,
            re.IGNORECASE | re.DOTALL,
        )
        if m:
            nombre = m.group(1).strip().strip('"')
            columnas = tuple(
                c.strip().strip('"')
                for c in m.group(2).strip()[1:-1].split(",")
                if c.strip()
            )
            definicion = _una_linea(texto[a + m.start(3) : b])
            padre = _padre(definicion)
            res.fks.append(
                ClaveAjena(
                    hijo=_plano(tabla),
                    columnas=columnas,
                    padre=padre,
                    nombre=nombre,
                    definicion=_una_linea(texto[a + m.start(2) : b]),
                    origen="tabla",
                )
            )
            res.contadores["desde CREATE TABLE · a nivel de tabla (con nombre)"] += 1
            ediciones.append(_quitar_elemento(texto, a, b, coma, elementos, indice))
            continue

        # 2 · FOREIGN KEY (...) REFERENCES ...
        m = re.match(
            r"FOREIGN\s+KEY\s*(\([^)]*\))\s*(REFERENCES\b.*)$",
            cuerpo,
            re.IGNORECASE | re.DOTALL,
        )
        if m:
            columnas = tuple(
                c.strip().strip('"')
                for c in m.group(1).strip()[1:-1].split(",")
                if c.strip()
            )
            nombre = _nombre_clave(_tabla_simple(tabla), list(columnas))
            definicion = _una_linea(texto[a:b])
            res.fks.append(
                ClaveAjena(
                    hijo=_plano(tabla),
                    columnas=columnas,
                    padre=_padre(definicion),
                    nombre=nombre,
                    definicion=definicion,
                    origen="tabla",
                )
            )
            res.contadores["desde CREATE TABLE · a nivel de tabla (sin nombre)"] += 1
            ediciones.append(_quitar_elemento(texto, a, b, coma, elementos, indice))
            continue

        # 3 · REFERENCES dentro de una definición de columna
        m_col = re.match(rf"({IDENT})\s", cuerpo)
        if not m_col:
            continue
        columna = m_col.group(1).strip().strip('"')
        pos_ref = _posicion_referencia(mask, a, b)
        if pos_ref is None:
            continue
        fin_ref = _fin_referencia(mask, pos_ref)
        definicion = "FOREIGN KEY (%s) %s" % (
            columna,
            _una_linea(texto[pos_ref:fin_ref]),
        )
        nombre = _nombre_clave(_tabla_simple(tabla), [columna])
        res.fks.append(
            ClaveAjena(
                hijo=_plano(tabla),
                columnas=(columna,),
                padre=_padre(definicion),
                nombre=nombre,
                definicion=definicion,
                origen="columna",
            )
        )
        res.contadores["desde CREATE TABLE · en la columna"] += 1
        ediciones.append((pos_ref, fin_ref, ""))

    return ediciones


def _posicion_referencia(mask: str, ini: int, fin: int) -> int | None:
    """Posición de REFERENCES a profundidad 0 dentro de [ini, fin)."""
    prof = 0
    for k in range(ini, fin):
        ch = mask[k]
        if ch == "(":
            prof += 1
        elif ch == ")":
            prof -= 1
        elif prof == 0 and mask.startswith("REFERENCES", k):
            if k == 0 or not (mask[k - 1].isalnum() or mask[k - 1] == "_"):
                return k
    return None


def _quitar_elemento(
    texto: str, a: int, b: int, coma: int | None, elementos, indice: int
) -> tuple[int, int, str]:
    """Calcula el tramo a borrar para que no queden comas sueltas."""
    if coma is not None:
        ini, fin = a, coma + 1
    else:
        ini = elementos[indice - 1][2] if indice else a
        ini = ini + 1 if elementos[indice - 1][2] is not None else ini
        fin = b
    # Si el elemento ocupaba su propia línea, se lleva también el salto.
    inicio_linea = texto.rfind("\n", 0, ini) + 1
    fin_linea = texto.find("\n", fin)
    fin_linea = len(texto) if fin_linea < 0 else fin_linea
    if not texto[inicio_linea:ini].strip() and not texto[fin:fin_linea].strip():
        return inicio_linea, fin_linea + 1, ""
    return ini, fin, ""


def _padre(definicion: str) -> str:
    m = re.search(r"REFERENCES\s+(" + NOMBRE + ")", definicion, re.IGNORECASE)
    return _plano(m.group(1)) if m else "?"


def _procesar_alter(
    texto: str, mask: str, ini: int, fin: int, tabla: str, res: Resultado
) -> list[tuple[int, int, str]]:
    """Procesa un ALTER TABLE; devuelve ediciones sobre el texto completo."""
    m = PAT_ALTER.match(mask[ini:fin])
    if not m:
        return []
    resto = ini + m.end()
    acciones = _cortar(mask, resto, fin)
    pierde_todo = True
    ediciones: list[tuple[int, int, str]] = []

    for indice, (a0, b0, coma) in enumerate(acciones):
        a, b = _recortar(mask, a0, b0)
        if a >= b:
            continue
        cuerpo = mask[a:b]

        # ADD CONSTRAINT nombre FOREIGN KEY ...
        m_fk = PAT_ADD_CONSTRAINT_FK.match(cuerpo)
        if m_fk:
            nombre = m_fk.group(1).strip().strip('"')
            m_cols = re.search(r"FOREIGN\s+KEY\s*(\([^)]*\))", cuerpo, re.IGNORECASE)
            columnas = tuple(
                c.strip().strip('"')
                for c in m_cols.group(1).strip()[1:-1].split(",")
                if c.strip()
            )
            definicion = _una_linea(texto[a:b])
            res.fks.append(
                ClaveAjena(
                    hijo=_plano(tabla),
                    columnas=columnas,
                    padre=_padre(definicion),
                    nombre=nombre,
                    definicion=definicion,
                    origen="alter",
                )
            )
            res.contadores["desde ALTER TABLE · ADD CONSTRAINT"] += 1
            ediciones.append(_quitar_elemento(texto, a, b, coma, acciones, indice))
            continue

        # ADD [COLUMN] col tipo ... REFERENCES ...
        m_col = PAT_ADD_COLUMNA.match(cuerpo)
        pos_ref = _posicion_referencia(mask, a, b)
        if m_col and pos_ref is not None:
            columna = m_col.group(1).strip().strip('"')
            fin_ref = _fin_referencia(mask, pos_ref)
            definicion = "FOREIGN KEY (%s) %s" % (
                columna,
                _una_linea(texto[pos_ref:fin_ref]),
            )
            nombre = _nombre_clave(_tabla_simple(tabla), [columna])
            res.fks.append(
                ClaveAjena(
                    hijo=_plano(tabla),
                    columnas=(columna,),
                    padre=_padre(definicion),
                    nombre=nombre,
                    definicion=definicion,
                    origen="alter-columna",
                )
            )
            res.contadores["desde ALTER TABLE · ADD COLUMN con REFERENCES"] += 1
            ediciones.append((pos_ref, fin_ref, ""))
            pierde_todo = False
            continue

        pierde_todo = False

    if pierde_todo and ediciones:
        # Todas las acciones eran claves ajenas: sobra la sentencia entera.
        inicio_linea = texto.rfind("\n", 0, ini) + 1
        fin_linea = texto.find("\n", fin)
        fin_linea = len(texto) if fin_linea < 0 else fin_linea
        return [(inicio_linea, fin_linea + 1, "")]

    return ediciones


def analizar(texto: str) -> tuple[Resultado, str]:
    mask = enmascarar(texto)
    res = Resultado()

    # Sentencias terminadas en punto y coma (los ; dentro de literales o de
    # cuerpos $$ están enmascarados, así que aquí solo quedan los reales).
    ini = 0
    tramos: list[tuple[int, int]] = []
    for i, ch in enumerate(mask):
        if ch == ";":
            tramos.append((ini, i + 1))
            ini = i + 1
    if ini < len(mask):
        tramos.append((ini, len(mask)))

    for ini_s, fin_s in tramos:
        ini_util = _saltar_meta(texto, mask, ini_s, fin_s)
        if ini_util >= fin_s:
            continue

        m_create = PAT_CREATE.match(mask[ini_util:fin_s])
        if m_create:
            tabla = m_create.group(1)
            res.tablas.add(_plano(tabla))
            despues = ini_util + m_create.end()
            j = _saltar(mask, despues)
            if j < fin_s and mask[j] == "(":
                cierre = _cerrar(mask, j)
                if cierre > 0:
                    ediciones = _extraer_de_create(texto, mask, j, cierre, tabla, res)
                    res.ediciones.extend(ediciones)
                    res.contadores["CREATE TABLE revisadas"] += 1
            continue

        m_alter = PAT_ALTER.match(mask[ini_util:fin_s])
        if m_alter:
            res.ediciones.extend(
                _procesar_alter(texto, mask, ini_util, fin_s, m_alter.group(1), res)
            )
            continue

        # Dentro de un bloque DO el DDL no empieza la sentencia: va detrás de
        # `IF NOT EXISTS ... THEN`. Se buscan los ALTER TABLE a profundidad 0
        # para no perderlos.
        posiciones = _posiciones_alter(mask, ini_util, fin_s)
        for indice, pos in enumerate(posiciones):
            fin_tramo = (
                posiciones[indice + 1] if indice + 1 < len(posiciones) else fin_s
            )
            m2 = PAT_ALTER.match(mask[pos:fin_tramo])
            if m2:
                res.ediciones.extend(
                    _procesar_alter(texto, mask, pos, fin_tramo, m2.group(1), res)
                )

    _analizar_bloques_do(texto, mask, res)
    return res, mask


def _analizar_bloques_do(texto: str, mask: str, res: Resultado) -> None:
    """Analiza el SQL que va dentro de bloques `DO $$ ... $$`.

    Varios parches meten sus ALTER TABLE y algún CREATE TABLE dentro de un
    bloque DO para poder comprobar antes si el objeto ya existe. Como la
    máscara tapa el cuerpo entre dólares para no confundir los `;` de dentro,
    sin este paso esas claves ajenas se perderían.
    """
    patron = re.compile(r"\bDO\b\s*\$(\w*)\$", re.IGNORECASE)
    for m in patron.finditer(texto):
        # El delimitador `$$` está borrado en la máscara, así que los bloques
        # se buscan en el texto; se descarta lo que caiga dentro de un
        # comentario o de una cadena, que es donde la máscara ya es espacio.
        if mask[m.start()].isspace():
            continue
        etiqueta = "$" + m.group(1) + "$"
        ini_cuerpo = m.end()
        fin_cuerpo = texto.find(etiqueta, ini_cuerpo)
        if fin_cuerpo < 0:
            continue
        interior = texto[ini_cuerpo:fin_cuerpo]
        if not interior.strip():
            continue

        sub, _ = analizar(interior)
        res.tablas |= sub.tablas
        res.fks.extend(sub.fks)
        res.ediciones.extend(
            (a + ini_cuerpo, b + ini_cuerpo, r) for a, b, r in sub.ediciones
        )
        for clave, valor in sub.contadores.items():
            res.contadores[clave] += valor
        res.duplicadas.extend(sub.duplicadas)
        res.sin_nombre.extend(sub.sin_nombre)
        if sub.fks or sub.tablas:
            res.contadores["bloques DO analizados"] += 1


# ---------------------------------------------------------------------
# Salidas
# ---------------------------------------------------------------------
def aplicar(texto: str, ediciones: list[tuple[int, int, str]]) -> str:
    for ini, fin, reemplazo in sorted(ediciones, key=lambda x: x[0], reverse=True):
        texto = texto[:ini] + reemplazo + texto[fin:]
    return texto


def deduplicar(fks: list[ClaveAjena], res: Resultado) -> list[ClaveAjena]:
    """El DDL corre dos veces: la misma clave ajena aparece duplicada."""
    vistos: dict[tuple, ClaveAjena] = {}
    for fk in fks:
        clave = (fk.hijo, fk.columnas, fk.padre)
        if clave in vistos:
            res.contadores["claves ajenas repetidas por el doble pase"] += 1
            res.duplicadas.append(fk)
            continue
        vistos[clave] = fk

    nombres: dict[tuple[str, str], ClaveAjena] = {}
    for fk in vistos.values():
        clave = (fk.hijo, fk.nombre)
        if clave in nombres:
            res.sin_nombre.append(fk)
            res.contadores["colisiones de nombre resueltas"] += 1
            original = fk.nombre
            sufijo = 2
            while (fk.hijo, f"{original}_{sufijo}") in nombres:
                sufijo += 1
            fk.nombre = f"{original}_{sufijo}"
            nombres[(fk.hijo, fk.nombre)] = fk
        else:
            nombres[clave] = fk

    return sorted(vistos.values(), key=lambda f: f.orden)


def escribir_esquema(texto: str, sin_fk: str, destino: Path, total: int) -> None:
    banner = [
        "-- =====================================================================",
        "--  AVISA · ESQUEMA UNIFICADO · SIN CLAVES AJENAS",
        "-- =====================================================================",
        "--  GENERADO POR migration/extraer_fks.py a partir de",
        "--  docs/AVISA_V10_ESQUEMA_UNIFICADO.sql. NO EDITAR A MANO.",
        "--",
        "--  QUÉ ES",
        "--  El mismo archivo unificado, con las claves ajenas quitadas de los",
        "--  CREATE TABLE y con los ALTER que solo añadían una clave ajena",
        "--  eliminados. Las columnas se conservan todas: se quitó únicamente",
        "--  el tramo REFERENCES ... de cada definición.",
        "--",
        f"--  ESTE ARCHIVO TIENE {total} CLAVES AJENAS MENOS QUE EL ORIGINAL",
        "--  Todas están en docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql, listas",
        "--  para aplicarse después de crear las tablas. Así el orden de",
        "--  creación deja de importar y el equipo de SSMA puede decidir, tabla",
        "--  por tabla, qué restricciones aplica.",
        "--",
        "--  OJO: este archivo sigue siendo el esquema completo (secciones A y",
        "--  B del unificado). La sección B exige el legado ya cargado. Para",
        "--  migrar a SQL Server con SSMA se usa sobre el alcance del MVP, que",
        "--  recorta migration/mssql/00_alcance_mvp.sql.",
        "-- =====================================================================",
        "",
    ]
    destino.write_text("\n".join(banner) + sin_fk, encoding="utf-8", newline="\n")


def escribir_fks(fks: list[ClaveAjena], destino: Path, fuente: str) -> None:
    por_tabla: dict[str, list[ClaveAjena]] = defaultdict(list)
    for fk in fks:
        por_tabla[fk.hijo].append(fk)

    lineas = [
        "-- =====================================================================",
        "--  AVISA · CLAVES AJENAS · sección dedicada",
        "-- =====================================================================",
        "--  GENERADO POR migration/extraer_fks.py a partir de",
        f"--  {fuente}. NO EDITAR A MANO.",
        "--",
        "--  PARA QUÉ",
        "--  El esquema se crea sin claves ajenas",
        "--  (AVISA_V10_ESQUEMA_SIN_FK.sql) y las relaciones se añaden aquí.",
        "--  Así la creación de tablas no depende del orden, y el equipo de SSMA",
        "--  puede quedarse con el archivo completo o comentar los bloques que",
        "--  decida no aplicar en SQL Server.",
        "--",
        "--  CÓMO SE APLICA",
        "--  Después de crear las tablas, con psql:",
        "--",
        "--      psql -U avisa -d avisa -f docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql",
        "--",
        "--  No es idempotente: ADD CONSTRAINT falla si la restricción ya existe.",
        "--  Para volver a aplicarlo, primero se borran las claves ajenas; el",
        "--  bloque final deja la consulta que genera los DROP.",
        "--",
        f"--  {len(fks)} claves ajenas, agrupadas por tabla hija.",
        "-- =====================================================================",
        "",
        "\\set ON_ERROR_STOP on",
        "",
    ]

    for tabla in sorted(por_tabla):
        bloque = sorted(por_tabla[tabla], key=lambda f: f.nombre)
        titulo = f"--  {tabla} · {len(bloque)} clave{'s' if len(bloque) != 1 else ''} ajena{'s' if len(bloque) != 1 else ''}"
        lineas.append("-- " + "-" * 69)
        lineas.append(titulo)
        lineas.append("-- " + "-" * 69)
        for fk in bloque:
            lineas.append(
                f"ALTER TABLE {tabla} ADD CONSTRAINT {fk.nombre} {fk.definicion};"
            )
        lineas.append("")

    lineas += [
        "-- =====================================================================",
        "--  PARA REAPLICAR: borrar antes las claves ajenas",
        "-- =====================================================================",
        "--  Esta consulta genera los DROP de todas las claves ajenas de los",
        "--  esquemas del modelo. Se revisa y se ejecuta su salida:",
        "--",
        "--    SELECT format('ALTER TABLE %I.%I DROP CONSTRAINT %I;',",
        "--                  n.nspname, c.relname, con.conname)",
        "--    FROM pg_constraint con",
        "--    JOIN pg_class c ON c.oid = con.conrelid",
        "--    JOIN pg_namespace n ON n.oid = c.relnamespace",
        "--    WHERE con.contype = 'f'",
        "--      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'legacy')",
        "--    ORDER BY 1;",
        "-- =====================================================================",
        "",
    ]
    destino.write_text("\n".join(lineas), encoding="utf-8", newline="\n")


def escribir_informe(
    res: Resultado,
    fks: list[ClaveAjena],
    destino: Path,
    entrada: Path,
    salida_esquema: Path,
    salida_fks: Path,
) -> None:
    por_esquema = Counter(fk.hijo.split(".")[0] for fk in fks)
    por_origen = Counter(fk.origen for fk in fks)

    capas: dict[str, str] = {}
    if CSV_PRIORIDAD.is_file():
        with CSV_PRIORIDAD.open(encoding="utf-8-sig") as f:
            for fila in csv.DictReader(f):
                capas[f"{fila['esquema']}.{fila['tabla']}"] = fila["capa"]

    en_mvp = {t for t, c in capas.items() if c in ("T0", "T1")}
    cruzan = [fk for fk in fks if fk.hijo in en_mvp and fk.padre not in en_mvp]
    padres_fuera = sorted({fk.padre for fk in cruzan})
    huerfanas = sorted({fk.padre for fk in fks if fk.padre not in res.tablas})
    desconocidas = sorted({fk.padre for fk in fks if fk.padre not in capas})

    lineas = [
        "# Informe de claves ajenas",
        "",
        f"> Generado por `migration/extraer_fks.py` a partir de",
        f"> `{entrada.relative_to(RAIZ).as_posix()}`. Cifras medidas sobre el archivo, no estimadas.",
        "",
        "## Qué se generó",
        "",
        "| Archivo | Contenido |",
        "|---|---|",
        f"| `{salida_esquema.relative_to(RAIZ).as_posix()}` | Esquema completo sin claves ajenas |",
        f"| `{salida_fks.relative_to(RAIZ).as_posix()}` | Las {len(fks)} claves ajenas como `ALTER TABLE … ADD CONSTRAINT` |",
        "",
        "## Cuántas y de dónde salieron",
        "",
        "| Origen en el SQL | Claves ajenas |",
        "|---|---:|",
    ]
    etiquetas = {
        "columna": "`CREATE TABLE` · en la definición de la columna",
        "tabla": "`CREATE TABLE` · a nivel de tabla",
        "alter": "`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`",
        "alter-columna": "`ALTER TABLE … ADD COLUMN … REFERENCES`",
    }
    for clave, texto in etiquetas.items():
        lineas.append(f"| {texto} | {por_origen.get(clave, 0)} |")
    lineas += [
        f"| **Total único** | **{len(fks)}** |",
        "",
        f"El DDL corre dos veces en el archivo unificado, así que "
        f"**{res.contadores.get('claves ajenas repetidas por el doble pase', 0)}** "
        "claves ajenas estaban repetidas y se descartaron.",
        "",
        "## Por esquema",
        "",
        "| Esquema | Claves ajenas |",
        "|---|---:|",
    ]
    for esquema in sorted(por_esquema):
        lineas.append(f"| `{esquema}` | {por_esquema[esquema]} |")

    lineas += [
        "",
        "## Claves ajenas que cruzan la frontera del MVP",
        "",
    ]
    if capas:
        lineas += [
            f"`{len(cruzan)}` claves ajenas salen de una tabla del MVP (capas T0 y T1 de",
            "`docs/mvp_prioridad_tablas.csv`) y apuntan a una tabla que no lo es. Son las",
            f"que obligan a arrastrar **{len(padres_fuera)} tablas padre** al alcance de la migración:",
            "sin ellas la columna quedaría apuntando a una tabla inexistente.",
            "",
            "| Tabla padre | Capa | Claves ajenas que la necesitan |",
            "|---|---|---:|",
        ]
        cuenta = Counter(fk.padre for fk in cruzan)
        for padre in sorted(padres_fuera):
            lineas.append(f"| `{padre}` | {capas.get(padre, '—')} | {cuenta[padre]} |")
    else:
        lineas.append("No se encontró `docs/mvp_prioridad_tablas.csv`.")

    lineas += ["", "## Comprobaciones", ""]
    if huerfanas:
        lineas += [
            f"- **{len(huerfanas)} tablas padre no se crean en este archivo.** No es un error:",
            "  son tablas que ya existen en la base de destino o que quedan fuera del",
            "  alcance. Hay que confirmarlas antes de aplicar el bloque de claves ajenas.",
            "",
            "  " + ", ".join(f"`{p}`" for p in huerfanas[:40]),
            "" if len(huerfanas) <= 40 else f"  … y {len(huerfanas) - 40} más.",
            "",
        ]
    else:
        lineas.append(
            "- Todas las tablas padre existen en el archivo: el bloque de claves "
            "ajenas se puede aplicar tal cual."
        )
    if desconocidas:
        lineas.append(
            f"- {len(desconocidas)} tablas padre no aparecen en el CSV de prioridad "
            "(pueden ser vistas o tablas nuevas)."
        )
    lineas += [
        "- Conteo bruto: "
        f"{res.contadores.get('CREATE TABLE revisadas', 0)} `CREATE TABLE` revisadas "
        f"y {sum(1 for _ in res.ediciones)} ediciones aplicadas al texto.",
        "",
    ]
    destino.write_text("\n".join(lineas), encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------
# Programa
# ---------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Separa las claves ajenas del esquema unificado de AVISA."
    )
    parser.add_argument(
        "--entrada",
        type=Path,
        default=UNIFICADO,
        help=f"SQL de entrada (por defecto: {UNIFICADO.relative_to(RAIZ).as_posix()})",
    )
    parser.add_argument(
        "--salida-dir",
        type=Path,
        default=DIR_SALIDA,
        help=f"carpeta de salida (por defecto: {DIR_SALIDA.relative_to(RAIZ).as_posix()})",
    )
    args = parser.parse_args(argv)

    entrada: Path = args.entrada
    if not entrada.is_absolute():
        entrada = RAIZ / entrada
    if not entrada.is_file():
        raise SystemExit(f"ERROR: falta la entrada {entrada}")

    texto = entrada.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    res, _ = analizar(texto)
    fks = deduplicar(res.fks, res)
    sin_fk = aplicar(texto, res.ediciones)

    salida: Path = args.salida_dir
    if not salida.is_absolute():
        salida = RAIZ / salida
    salida.mkdir(parents=True, exist_ok=True)

    destino_esquema = salida / "AVISA_V10_ESQUEMA_SIN_FK.sql"
    destino_fks = salida / "AVISA_V10_CLAVES_AJENAS.sql"
    destino_informe = salida / "INFORME_FKS.md"

    escribir_esquema(texto, sin_fk, destino_esquema, len(fks))
    escribir_fks(fks, destino_fks, entrada.relative_to(RAIZ).as_posix())
    escribir_informe(res, fks, destino_informe, entrada, destino_esquema, destino_fks)

    print(f"Entrada: {entrada}")
    print(
        f"  CREATE TABLE revisadas ......... {res.contadores.get('CREATE TABLE revisadas', 0)}"
    )
    print(f"  claves ajenas encontradas ...... {len(res.fks)}")
    print(
        f"  repetidas por el doble pase .... {res.contadores.get('claves ajenas repetidas por el doble pase', 0)}"
    )
    print(f"  claves ajenas únicas ........... {len(fks)}")
    print(f"  ediciones al texto ............. {len(res.ediciones)}")
    print(f"  esquema sin claves ajenas ...... {destino_esquema}")
    print(f"  sección de claves ajenas ....... {destino_fks}")
    print(f"  informe ........................ {destino_informe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
