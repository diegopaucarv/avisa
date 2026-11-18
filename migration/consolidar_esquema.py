#!/usr/bin/env python3
"""Consolida las fuentes del esquema AVISA v10 en un único archivo SQL.

Hoy el esquema se arma encadenando archivos con `\\i` desde
`docker/postgres/initdb/10_apply_v9.sql`. Eso ata el esquema a rutas del
contenedor (`/opt/avisa/sql/...`) y hace que "el esquema" no sea un objeto
verificable por sí mismo. Este script incrusta el contenido de las fuentes, en
el mismo orden y con los mismos delimitadores de error, y escribe:

    docs/AVISA_V10_ESQUEMA_UNIFICADO.sql

Estructura del archivo generado:

    Sección A · esquema      extensiones + DDL (dos pases) + parches 1-5
                             aplicable sobre una base vacía.
    Sección B · post-carga   parches 6-12
                             exige el legado ya cargado.

El script solo lee el repositorio. No abre conexión a ninguna base.

Comprobaciones que hace antes de escribir (aborta si fallan):

  - que existan todas las fuentes;
  - que ninguna fuente incluya rutas del contenedor (`\\i`, `\\ir`, `\\include`
    o la cadena `/opt/avisa/sql`), porque el archivo debe ser autosuficiente.

Uso:
    python migration/consolidar_esquema.py
    python migration/consolidar_esquema.py --seccion A --salida /tmp/seccion_a.sql

`--seccion` sirve para verificar la sección A aislada sobre una base desechable,
sin tener que recortar el archivo a mano.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "docs" / "AVISA_V10_ESQUEMA_UNIFICADO.sql"

RUTA_EXTENSIONES = "docker/postgres/initdb/00_extensions.sql"
RUTA_DDL = "backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql"


@dataclass(frozen=True)
class Bloque:
    """Un tramo del esquema, con su fuente y su política de errores."""

    etiqueta: str  # "A.2"
    titulo: str
    fuente: str
    tolera_errores: bool
    nota: str = ""


def bloque(
    etiqueta: str,
    titulo: str,
    fuente: str,
    tolera_errores: bool,
    nota: str = "",
) -> Bloque:
    return Bloque(etiqueta, titulo, fuente, tolera_errores, nota)


SECCION_A = (
    bloque(
        "A.1",
        "Extensiones",
        RUTA_EXTENSIONES,
        tolera_errores=False,
        nota=(
            "Se instalan antes que nada: sin `postgis` cada CREATE TABLE con una "
            "columna GEOGRAPHY falla y, como el DDL tolera errores, la tabla "
            "queda sin crear en silencio."
        ),
    ),
    bloque(
        "A.2",
        "DDL v9 · pasada 1 de 2",
        RUTA_DDL,
        tolera_errores=True,
        nota=(
            "`core.cambio_normativo` declara una FK a `core.usuarios` antes de "
            "que esa tabla exista, y un seed de `cat_variables` viola su propia "
            "FK. Son defectos conocidos de la fuente y el motivo del doble pase."
        ),
    ),
    bloque(
        "A.3",
        "DDL v9 · pasada 2 de 2",
        RUTA_DDL,
        tolera_errores=True,
        nota="Resuelve lo que en la pasada 1 dependía de objetos creados después.",
    ),
    bloque(
        "A.3.1",
        "Parche 1 · catálogos y columnas de legado",
        "docs/PREPARACION_V9_CARGA_LEGADO.sql",
        tolera_errores=False,
    ),
    bloque(
        "A.3.2",
        "Parche 2 · huecos detectados columna a columna",
        "docs/PREPARACION_V9_CARGA_LEGADO_2.sql",
        tolera_errores=False,
    ),
    bloque(
        "A.3.3",
        "Parche 3 · cierre de bloqueos D43-D49",
        "docs/PREPARACION_V9_CARGA_LEGADO_3.sql",
        tolera_errores=False,
    ),
    bloque(
        "A.3.4",
        "Parche 4 · membresías sin fecha (D50)",
        "docs/PREPARACION_V9_CARGA_LEGADO_4.sql",
        tolera_errores=False,
    ),
    bloque(
        "A.3.5",
        "Parche 5 · seeds de cierre (etapas PIP, schemas, plantillas ind)",
        "docs/PREPARACION_V9_CARGA_LEGADO_5.sql",
        tolera_errores=False,
    ),
)

SECCION_B = (
    bloque(
        "B.1",
        "Parche 6 · cierre de cumplimiento",
        "docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql",
        tolera_errores=False,
    ),
    bloque(
        "B.2",
        "Parche 7 · guardrails G19-G25",
        "docs/PARCHE_7_GUARDRAILS_G19_G25.sql",
        tolera_errores=False,
    ),
    bloque(
        "B.3",
        "Parche 8 · ICD y tope Q40",
        "docs/PARCHE_8_ICD_TOPE_Q40.sql",
        tolera_errores=False,
    ),
    bloque(
        "B.4",
        "Parche 9 · seguridad de nivel alto",
        "docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql",
        tolera_errores=False,
        nota=(
            "Exige `-v crypto_key=<clave>`. Sin esa variable el archivo ABORTA "
            "con salida 3 a propósito: ver el bloque 0 del parche."
        ),
    ),
    bloque(
        "B.5",
        "Parche 10 · flujo de proceso (D17)",
        "docs/PARCHE_10_FLUJO_PROCESO_D17.sql",
        tolera_errores=False,
    ),
    bloque(
        "B.6",
        "Parche 11 · grafo KAG",
        "docs/PARCHE_11_GRAFO_KAG.sql",
        tolera_errores=False,
    ),
    bloque(
        "B.7",
        "Parche 12 · comentarios de tablas y columnas",
        "docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql",
        tolera_errores=False,
        nota=(
            "No se recorta: cubre 255 tablas lógicas y 2 007 columnas. Es el "
            "bloque que hace que el archivo pese ~760 KB."
        ),
    ),
)

# Ancla para detectar un include de psql (`\i`, `\ir`, `\include`, `\include_relative`).
PATRON_INCLUDE = re.compile(r"^\\i(nclude|nclude_relative|r)?\s", re.IGNORECASE)
RUTA_CONTENEDOR = "/opt/avisa/sql"


@dataclass
class Tramo:
    """Resultado de leer una fuente."""

    fuente: str
    lineas: list[str] = field(default_factory=list)


def leer_fuente(fuente: str) -> Tramo:
    """Devuelve las líneas de una fuente, ya normalizadas a LF."""
    ruta = RAIZ / fuente
    if not ruta.is_file():
        raise SystemExit(f"ERROR: falta la fuente {fuente}")

    texto = ruta.read_text(encoding="utf-8-sig")
    if "\r\n" in texto:
        texto = texto.replace("\r\n", "\n")
    lineas = texto.split("\n")
    # Un único salto final: `split` deja la cadena vacía del remate.
    while lineas and lineas[-1] == "":
        lineas.pop()

    for numero, linea in enumerate(lineas, 1):
        if PATRON_INCLUDE.match(linea.lstrip()):
            raise SystemExit(
                f"ERROR: {fuente}:{numero} tiene un include de psql y el archivo "
                "unificado debe ser autosuficiente:\n    " + linea.strip()
            )
        if RUTA_CONTENEDOR in linea:
            raise SystemExit(
                f"ERROR: {fuente}:{numero} apunta a una ruta del contenedor "
                f"({RUTA_CONTENEDOR}); no se puede incrustar como está."
            )

    return Tramo(fuente=fuente, lineas=lineas)


def encabezado(solo: str | None) -> list[str]:
    """Cabecera del archivo: qué es, cómo se ejecuta y qué se puede esperar."""
    lineas = [
        "-- =====================================================================",
        "--  AVISA · ESQUEMA UNIFICADO v10",
        "-- =====================================================================",
        "--  GENERADO POR migration/consolidar_esquema.py. NO EDITAR A MANO:",
        "--  cualquier cambio se pierde en la siguiente consolidación.",
        "--",
        "--  QUÉ ES",
        "--  Un solo archivo con todo el esquema del modelo v10, armado con el",
        "--  contenido literal de sus fuentes. Sustituye a la cadena de \\i que",
        "--  hacía docker/postgres/initdb/10_apply_v9.sql sobre rutas del",
        "--  contenedor: aquí no queda ningún include externo.",
        "--",
        "--  CÓMO SE EJECUTA",
        "--  Con psql, no con otro cliente: usa meta-órdenes (\\set, \\echo) y la",
        "--  variable crypto_key del parche 9.",
        "--",
        "--      psql -U avisa -d avisa -f docs/AVISA_V10_ESQUEMA_UNIFICADO.sql",
        "--",
        "--  desde el repositorio, o copiando el archivo al contenedor:",
        "--",
        "--      docker exec -i avisa-db psql -U avisa -d avisa \\",
        "--          -v crypto_key=<clave> -f /tmp/AVISA_V10_ESQUEMA_UNIFICADO.sql",
        "--",
        "--  DOS SECCIONES",
        "--  Sección A · esquema    extensiones + DDL v9 (dos pases) + parches 1-5.",
        "--                          Autosuficiente: se puede aplicar sobre una",
        "--                          base VACÍA, sin instalar extensiones aparte.",
        "--  Sección B · post-carga parches 6-12. NO se puede aplicar sobre una",
        "--                          base vacía: exige el legado ya cargado por",
        "--                          migration/loader (filas en core.*, ind.*,",
        "--                          kag.*). Sobre una base recién creada falla en",
        "--                          el primer parche que consulta datos.",
        "--",
        "--  DELIMITADORES DE ERROR (se conservan tal cual)",
        "--  El DDL corre con ON_ERROR_STOP desactivado porque no es ejecutable en",
        "--  una sola pasada: core.cambio_normativo declara una FK a core.usuarios",
        "--  antes de que la tabla exista, y un seed de cat_variables viola su",
        "--  propia FK. Por eso se aplica DOS veces y esos errores son esperados.",
        "--  Los parches, en cambio, corren con ON_ERROR_STOP activo: abortan al",
        "--  primer fallo. Es preferible fallar ruidosamente a quedar con un",
        "--  esquema a medias que parezca correcto.",
        "--",
        "--  PARCHE 9 Y LA CLAVE",
        "--  El parche 9 cifra datos personales y necesita la clave de sesión:",
        "--",
        "--      psql ... -v crypto_key=<clave de 32 bytes> -f ...",
        "--",
        "--  Sin -v crypto_key el archivo aborta con salida 3 (ON_ERROR_STOP) y",
        "--  un mensaje explícito. Es a propósito: sin clave no hay cifrado, y",
        "--  seguir adelante dejaría datos en claro creyéndolos protegidos.",
        "--",
        "--  IDEMPOTENCIA",
        "--  Los parches usan IF NOT EXISTS / OR REPLACE / upserts y se pueden",
        "--  repetir; COMMENT ON reemplaza el comentario anterior, de modo que el",
        "--  parche 12 también es idempotente. Repetir la sección A sobre una base",
        "--  ya construida no la duplica.",
        "--",
        "--  QUÉ PRODUCE CADA SECCIÓN (medido sobre una base desechable)",
        "--  Solo la sección A, sobre una base vacía: 25 esquemas, 275 tablas",
        "--  físicas (251 lógicas + 24 particiones), 2 314 columnas y 581 claves",
        "--  ajenas. Las 24 particiones ya nacen aquí: el DDL base declara 6 con",
        "--  PARTITION OF y el resto las crea con bucles DO que ejecutan CREATE",
        "--  TABLE ... PARTITION OF. El esquema `audit` todavía no existe: lo crea",
        "--  el parche 9.",
        "--",
        "--  Con la sección B aplicada sobre el legado ya cargado: 26 esquemas,",
        "--  279 tablas físicas (255 lógicas + 24 particiones), 2 366 columnas y",
        "--  589 claves ajenas.",
        "--",
        "--  La diferencia entre ambos estados son 4 tablas y 52 columnas, todas",
        "--  de los parches 9, 10 y 11:",
        "--    · parche  9 · la tabla `audit.datos_personales_acceso` y",
        "--                 4 columnas cifradas en `core.actor_datos_personales`;",
        "--    · parche 10 · las tablas `core.flujo_definicion`, `core.flujo_estado`",
        "--                 y `core.proceso_instancia` (46 columnas y 8 claves ajenas);",
        "--    · parche 11 · las columnas `created_at` y `updated_at` de `kag.nodos`.",
        "--  Por eso la sección A termina en 275 tablas y no en 279: las cuatro",
        "--  tablas que faltan no son parte del esquema base, se crean después de",
        "--  cargar el legado. Si la sección A se queda corta en algo distinto, el",
        "--  defecto no está en este archivo: falta una fuente o cambió el DDL.",
        "-- =====================================================================",
        "",
    ]
    if solo is not None:
        lineas += [
            "-- ---------------------------------------------------------------------",
            "--  RECORTE PARCIAL: este archivo contiene SOLO la sección " + solo + ".",
            "--  Se generó con --seccion " + solo + " para verificar ese tramo",
            "--  aislado. El esquema completo es la salida sin --seccion.",
            "-- =====================================================================",
            "",
        ]
    return lineas


def banner(numero: str, titulo: str, descripcion: list[str]) -> list[str]:
    lineas = [
        "-- =====================================================================",
        f"--  SECCIÓN {numero} · {titulo.upper()}",
        "-- =====================================================================",
    ]
    lineas += ["--  " + texto for texto in descripcion]
    lineas.append("")
    return lineas


def cabecera_bloque(tramo: Bloque, total_lineas: int) -> list[str]:
    lineas = [
        "-- ---------------------------------------------------------------------",
        f"--  BLOQUE {tramo.etiqueta} · {tramo.titulo}",
        f"--  Fuente: {tramo.fuente} ({total_lineas} líneas)",
        f"--  Errores: "
        + (
            "se toleran (ON_ERROR_STOP off)"
            if tramo.tolera_errores
            else "abortan la ejecución (ON_ERROR_STOP on)"
        ),
    ]
    if tramo.nota:
        for parrafo in _envolver("   ", tramo.nota):
            lineas.append("--" + parrafo)
    lineas.append(
        "-- ---------------------------------------------------------------------"
    )
    return lineas


def _envolver(sangria: str, texto: str, ancho: int = 72) -> list[str]:
    """Reparte un texto en líneas de comentario sin partir palabras."""
    palabras = texto.split()
    lineas: list[str] = []
    actual = sangria
    for palabra in palabras:
        if len(actual) + len(palabra) + 1 > ancho and actual.strip():
            lineas.append(actual.rstrip())
            actual = sangria + " " + palabra
        else:
            actual = actual + " " + palabra
    if actual.strip():
        lineas.append(actual.rstrip())
    return lineas


def componer(secciones: list[str], solo: str | None) -> tuple[list[str], list[dict]]:
    """Arma el texto del archivo y devuelve también el detalle por bloque."""
    salida = encabezado(solo)
    detalle: list[dict] = []

    perfil = {
        "A": (
            "A",
            "Esquema (aplicable sobre base vacía)",
            [
                "Extensiones + DDL v9 en dos pases + parches 1-5.",
                "Autosuficiente: no requiere aplicar 00_extensions.sql aparte.",
            ],
            SECCION_A,
        ),
        "B": (
            "B",
            "Post-carga (exige el legado cargado)",
            [
                "Parches 6-12. Requiere el legado cargado por migration/loader;",
                "sobre una base vacía aborta en el primer parche que lee datos.",
            ],
            SECCION_B,
        ),
    }

    for clave in secciones:
        numero, titulo, descripcion, tramos = perfil[clave]
        salida += banner(numero, titulo, descripcion)

        estado: bool | None = None
        for tramo in tramos:
            lectura = leer_fuente(tramo.fuente)

            if tramo.tolera_errores != estado:
                if tramo.tolera_errores:
                    salida += [
                        "-- Delimitador: desde aquí se TOLERAN errores (defectos",
                        "-- conocidos de la fuente, ver cabecera).",
                        "\\set ON_ERROR_STOP off",
                        "",
                    ]
                else:
                    salida += [
                        "-- Delimitador: desde aquí un error ABORTA el script.",
                        "\\set ON_ERROR_STOP on",
                        "",
                    ]
                estado = tramo.tolera_errores

            salida += cabecera_bloque(tramo, len(lectura.lineas))
            salida += lectura.lineas
            salida.append("")

            detalle.append(
                {
                    "etiqueta": tramo.etiqueta,
                    "fuente": tramo.fuente,
                    "lineas": len(lectura.lineas),
                }
            )

    return salida, detalle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Consolida el esquema v10 de AVISA en un único SQL."
    )
    parser.add_argument(
        "--seccion",
        choices=("todo", "A", "B"),
        default="todo",
        help="qué secciones emitir (por defecto: el archivo completo)",
    )
    parser.add_argument(
        "--salida",
        type=Path,
        default=None,
        help=f"archivo de destino (por defecto: {DESTINO.relative_to(RAIZ)})",
    )
    args = parser.parse_args(argv)

    destino = args.salida or DESTINO
    secciones = {"todo": ["A", "B"], "A": ["A"], "B": ["B"]}[args.seccion]
    solo = None if args.seccion == "todo" else args.seccion

    lineas, detalle = componer(secciones, solo)
    texto = "\n".join(lineas).rstrip("\n") + "\n"

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(texto, encoding="utf-8", newline="\n")

    numero_lineas = texto.count("\n")
    bytes_escritos = len(texto.encode("utf-8"))
    fuentes = sorted({fila["fuente"] for fila in detalle})

    print(f"Escrito: {destino}")
    print(f"  secciones ......... {' + '.join(secciones)}")
    print(f"  bloques ........... {len(detalle)}")
    print(f"  fuentes ........... {len(fuentes)}")
    print(f"  líneas ............ {numero_lineas:,}".replace(",", " "))
    print(f"  bytes ............. {bytes_escritos:,}".replace(",", " "))
    print(f"  KB ................ {bytes_escritos / 1024:.1f}")
    print("  aporte por bloque:")
    for fila in detalle:
        print(f"    {fila['etiqueta']:<6} {fila['lineas']:>5} líneas  {fila['fuente']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
