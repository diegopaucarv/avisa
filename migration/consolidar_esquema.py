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
    Sección B · post-carga   parches 6-23
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

# El DDL histórico vivió en `backend/`; hoy el respaldo está en
# `backups/backend/`. Se prueban ambos para que el consolidador no dependa
# de dónde esté guardado el archivo fuente.
_DDL_CANDIDATOS = (
    "backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql",
    "backups/backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql",
)
RUTA_DDL = next(
    (ruta for ruta in _DDL_CANDIDATOS if (RAIZ / ruta).is_file()),
    _DDL_CANDIDATOS[0],
)


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
        "Parche 13 · nivel de clasificación en un solo formato",
        "docs/PARCHE_13_CLASIFICACION.sql",
        tolera_errores=False,
        nota=(
            "Convierte `consultation.procesos.nivel_clasificacion` de texto a "
            "`smallint` con clave ajena al catálogo y alinea el nombre "
            "`Público`. Idempotente: repetirlo no tiene efecto."
        ),
    ),
    bloque(
        "B.8",
        "Parche 14 · cierre de brechas del ERS",
        "docs/PARCHE_14_CIERRE_ERS.sql",
        tolera_errores=False,
        nota=(
            "Cuatro brechas entre el esquema y el ERS: un rol de aplicación "
            "que sí respete la seguridad por fila, la alerta dentro del motor "
            "de proceso, los cinco niveles de identificación y el enlace "
            "territorial. Añade el catálogo de bases legales ligado al corpus "
            "del KAG. Rellena datos: una fila de proceso por alerta y el "
            "departamento de cada actor."
        ),
    ),
    bloque(
        "B.9",
        "Parche 15 · el rol manda: nivel y capacidades",
        "docs/PARCHE_15_ROLES_Y_BORRADO.sql",
        tolera_errores=False,
        nota=(
            "Cierra el bug rol→nivel: `core.clasificacion_max()` deja de leer "
            "`app.clasificacion_max` (lo declaraba el cliente) y lo deduce de "
            "`core.roles`. Añade tres capacidades explícitas —crear, editar, "
            "eliminar— y las impone con políticas RLS restrictivas, porque el "
            "nivel no distingue leer de escribir. `avisa_api` pasa a ser el rol "
            "de login que hereda de `avisa_app`, que hasta ahora no tenía ningún "
            "miembro y por tanto nunca aplicaba RLS."
        ),
    ),
    bloque(
        "B.10",
        "Parche 16 · RLS completo en `core` y banco de datos personales",
        "docs/PARCHE_16_RLS_CORE_Y_DC04.sql",
        tolera_errores=False,
        nota=(
            "Pasa de 12 a 44 tablas de `core` con seguridad por fila (32 nuevas, "
            "26 de ellas heredando el nivel de su padre) y crea "
            "`core.banco_datos_tratamiento`, donde se registra el banco de datos "
            "personales que exige el artículo 34 de la Ley 29733. Enlaza "
            "`ref.base_legal_tratamiento` con ese banco. Sin este bloque el "
            "esquema unificado no crearía la tabla y los comentarios y el relleno "
            "del parche 17 fallarían al aplicarlo desde cero."
        ),
    ),
    bloque(
        "B.11",
        "Parche 17 · consulta PIDE-RENIEC y control de costos",
        "docs/PARCHE_17_RENIEC_Y_COSTOS.sql",
        tolera_errores=False,
        nota=(
            "Cierra el hueco que deja el ERS v0.5 al mover PIDE-RENIEC, Gemini "
            "y WhatsApp a diciembre: no había ninguna tabla donde guardar el "
            "resultado de una consulta de requisitorias. Añade el privilegio "
            "nominal (RA-07 pide una persona, no un rol), `core.consulta_reniec` "
            "cifrada y de solo agregar, el rastro automático en la bitácora de "
            "accesos y las columnas de consumo que hacen verificables RNF-13 y "
            "RM-11 a RM-21."
        ),
    ),
    bloque(
        "B.12",
        "Parche 18 · tope de gasto con aviso y RLS del catálogo de identidad",
        "docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql",
        tolera_errores=False,
        nota=(
            "Cierra RNF-13, que el parche 17 dejó a medias: ya había dónde guardar "
            "el costo, pero ningún objeto que fijara un tope, sumara el consumo "
            "del mes ni dijera cuándo avisar. Añade `config.servicio_externo`, "
            "`config.tope_gasto`, las vistas de consumo y aviso y `puede_gastar()`. "
            "Cierra además la otra puerta de la escalada de privilegios: "
            "`core.roles`, `core.usuarios` y `core.usuario_roles` ganan seguridad "
            "por fila y solo el rol `administrador` puede escribirlas."
        ),
    ),
    # Los comentarios van al final a propósito: el archivo se regeneró contra la
    # base ya parcheada, así que comenta tablas que crean los parches 14, 16, 17
    # y 18. Si corriera antes, `COMMENT ON` fallaría al aplicar desde cero.
    bloque(
        "B.13",
        "Parche 12 · comentarios de tablas y columnas (se aplica al final)",
        "docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql",
        tolera_errores=False,
        nota=(
            "2 326 comentarios, sin ninguna otra sentencia. Cubre las tablas y "
            "columnas tal como existen hoy, por eso va después de todos los "
            "parches que crean objetos. Es el bloque que hace que el archivo "
            "pese ~1 MB."
        ),
    ),
    # Va después del parche 12 a propósito: su comprobación cuenta las columnas
    # que aún no tienen descripción, y es el parche 12 quien comenta el modelo
    # entero. Al revés, el archivo abortaría al aplicarse desde cero.
    bloque(
        "B.14",
        "Parche 19 · los 19 comentarios que faltaban",
        "docs/PARCHE_19_COMENTARIOS_FALTANTES.sql",
        tolera_errores=False,
        nota=(
            "El parche 12 comentó las columnas tal como estaban el 2026-11-18; el "
            "parche 17 creó después tres tablas y añadió columnas a "
            "`core.envios_comunicacion`, así que 19 columnas quedaron sin "
            "descripción. Se aplica después del parche 12 para que la comprobación "
            "final mida lo que de verdad queda sin describir."
        ),
    ),
    # Va después del parche 19 y del 12 a propósito: reescribe los comentarios de
    # `core.flujo_definicion` que fija el parche 12, y necesita los pasos DPPA del
    # parche 14 y `core.rol_actual()` del parche 15.
    bloque(
        "B.15",
        "Parche 20 · flujo de alerta en dos niveles",
        "docs/PARCHE_20_FLUJO_ALERTA.sql",
        tolera_errores=False,
        nota=(
            "Modela los dos niveles de aprobación que exige RN-04: el flujo de "
            "alerta pasa a cinco pasos, con validación previa del sectorista y "
            "aprobación definitiva de `direccion_oaipcs`. Crea ese rol, renumera "
            "las 83 instancias del Archivo del paso 4 al 5 y pone RLS en "
            "`core.flujo_definicion` (lectura abierta, escritura sólo "
            "`administrador`)."
        ),
    ),
    # Va después del parche 20 a propósito: normaliza `rol_responsable` sobre
    # los pasos de caso y reporte que definió el parche 10 y deja la restricción
    # y el trigger de validación; necesita el rol `direccion_oaipcs` del parche
    # 20, `core.rol_actual()` del 15 y la vista del parche 14, que aquí se amplía.
    bloque(
        "B.16",
        "Parche 21 · la Dirección y la normalización del flujo",
        "docs/PARCHE_21_DIRECCION_Y_FLUJO.sql",
        tolera_errores=False,
        nota=(
            "Asigna `direccion_oaipcs` a la Directora, que era el único hueco que "
            "dejó abierto el parche 20: sin cuenta, el paso de aprobación no tenía "
            "quién lo ejecutara. Normaliza `rol_responsable` de caso y reporte a "
            "códigos de `core.roles` y lo blinda con una restricción de formato y "
            "un trigger que valida cada token. Cierra además G21 con "
            "`aprobada_por`/`aprobada_en` en la alerta y RLS en los dos catálogos "
            "del flujo que seguían abiertos."
        ),
    ),
    # Va después del parche 21 a propósito: el gate necesita las dos columnas de
    # aprobación que dejó el 21 y el rol con su cuenta vigente de los parches 20
    # y 21. Reescribe además comentarios de columnas que fija el parche 12 (que
    # corre en B.13), así que tampoco puede ir antes.
    bloque(
        "B.17",
        "Parche 22 · visibilidad, G21 ejecutable y suplencia",
        "docs/PARCHE_22_VISIBILIDAD_Y_G21.sql",
        tolera_errores=False,
        nota=(
            "Cierra cinco pendientes de base de los parches 20 y 21. Añade "
            "`core.alertas_tempranas.visibilidad` con sus tres valores, su "
            "restricción y un índice parcial; hace ejecutable G21 con el trigger "
            "`alertas_g21_visibilidad`, que rechaza salir de `interna` sin las dos "
            "aprobaciones humanas; da consumidor a `core.permiso_aprobacion` con "
            "`core.puede_aprobar()` y la vista `core.vw_permiso_aprobacion`; amplía "
            "`core.vw_alerta_estado` a 20 columnas; corrige el desfase de "
            "`paso_actual` en las 83 alertas derivándolo de `core.proceso_instancia`; "
            "y documenta, sin ampliar el catálogo, por qué 9 instancias de reporte "
            "no tienen paso definido."
        ),
    ),
    # Va después del parche 22 a propósito: el gate ampliado necesita la columna
    # `visibilidad` que dejó el 22 y las dos columnas de aprobación del 21.
    # Va también después del parche 7: la fila G21 de `config.guardrail_contract`
    # la siembra el 7 (bloque B.2) —el 6 solo amplía el CHECK, no siembra filas— y
    # el `UPDATE … WHERE guardrail = 'G21'` del 23 no tiene fila que escribir sin
    # ella. La verificación del cierre del 23 lo confirma: aborta con
    # `PARCHE_23_VERIFICA` si G21 no dice `ejecutiva`, y sin fila el valor es NULL.
    # Desde el 2026-11-21 el 7 usa `DO NOTHING`, así que reejecutarlo suelto ya no
    # revierte lo que el 23 dejó en esa fila; el orden sigue siendo la norma.
    bloque(
        "B.18",
        "Parche 23 · destinatarios nombrados, cuatro ojos y escala de gravedad",
        "docs/PARCHE_23_DESTINATARIOS_Y_CUATRO_OJOS.sql",
        tolera_errores=False,
        nota=(
            "Resuelve H-14 poniendo la gravedad en el dato: `core.cat_prioridades_alerta` "
            "gana `es_grave`, verdadero solo en los dos niveles con plazo grave "
            "(`Critica_Inmediata` y `Urgente`). Cierra H-79 con "
            "`core.alertas_tempranas.validada_por` y dos restricciones —la firma y la "
            "fecha de validación van juntas, y quien valida no puede ser quien aprueba—, "
            "y amplía el gate G21 a los cuatro ojos y a los destinatarios. Crea "
            "`core.alerta_destinatario`, la tabla que faltaba para la visibilidad "
            "`sectorial`, y alinea el contrato de G21 en `config.guardrail_contract`, "
            "que se disparaba con un valor que el CHECK no admite. "
            "`core.vw_alerta_estado` pasa de 20 a 22 columnas."
        ),
    ),
    # Va después del parche 23 a propósito: comenta la tabla que ese parche
    # crea, así que antes del 23 `COMMENT ON` fallaría al aplicar desde cero.
    # Y va después del 19 a propósito: es el 19 quien trae la guardia global
    # que hoy aborta con estas siete columnas; describirlas aquí devuelve al 19
    # su reejecutabilidad.
    bloque(
        "B.19",
        "Parche 24 · los siete comentarios del destinatario",
        "docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql",
        tolera_errores=False,
        nota=(
            "El parche 23 describió cuatro de las once columnas de "
            "`core.alerta_destinatario`; las siete restantes eran las únicas del "
            "modelo sin descripción, y hacían disparar la guardia final del parche "
            "19. Este bloque solo agrega esos siete comentarios y comprueba sus "
            "propias columnas, sin replicar el candado global que volvió no "
            "reejecutable al 19."
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
        "--  Sección B · post-carga parches 6-23. NO se puede aplicar sobre una",
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
        "--  QUÉ PRODUCE CADA SECCIÓN (cifras medidas, no estimadas)",
        "--  Solo la sección A, sobre una base vacía: 25 esquemas y 275 tablas",
        "--  físicas (251 lógicas + 24 hijas de partición), 2 314 columnas y 581",
        "--  claves ajenas. Las 4 tablas particionadas cuentan como lógicas; las",
        "--  24 hijas se crean aquí con PARTITION OF. El esquema `audit` todavía",
        "--  no existe: lo crea el parche 9.",
        "--",
        "--  En ese estado los cinco scripts de preparación dejan avisos de",
        "--  error, porque `core.usuarios` y `core.cambio_normativo` aún no",
        "--  existen. Es esperable y no impide el conteo: el orden real es",
        "--  sección A → cargador del legado → sección B.",
        "--",
        "--  Con el legado cargado y la sección B aplicada (el estado de la base",
        "--  `avisa`, sin contar `legacy` ni `public`): 290 tablas físicas (266",
        "--  lógicas + 24 hijas de partición), 2 527 columnas y 616 claves",
        "--  ajenas. Sumando el volcado histórico `legacy` (87 tablas, 807",
        "--  columnas): 377 tablas físicas y 3 334 columnas; las claves ajenas no",
        "--  cambian porque `legacy` no declara ninguna.",
        "--",
        "--  La diferencia entre ambos estados son 15 tablas, 213 columnas y 35",
        "--  claves ajenas: 197 y 29 de los parches 9 a 18, más 2 columnas y 1",
        "--  clave ajena del parche 21, 1 columna del parche 22 y las 13 columnas",
        "--  con 5 claves ajenas del parche 23 (el 19 y el 20 no añaden objetos:",
        "--  el 19 sólo comenta y el 20 sólo renumera pasos, crea un rol y pone",
        "--  cuatro políticas):",
        "--    · parche  9 · `audit.datos_personales_acceso` (8 columnas) y las",
        "--                 4 columnas cifradas de `core.actor_datos_personales`;",
        "--    · parche 10 · `core.flujo_definicion` (10), `core.flujo_estado` (7)",
        "--                 y `core.proceso_instancia` (21), con 8 claves ajenas;",
        "--    · parche 11 · `created_at` y `updated_at` en `kag.nodos`;",
        "--    · parche 12 · ningún objeto: solo `COMMENT ON COLUMN`;",
        "--    · parche 13 · ningún objeto nuevo salvo una clave ajena:",
        "--                 `consultation.procesos.nivel_clasificacion` pasa de",
        "--                 varchar a smallint y queda referenciando",
        "--                 `core.cat_clasificacion(nivel)`;",
        "--    · parche 14 · `core.cat_nivel_identificacion` (3),",
        "--                 `core.actor_alias` (8), `ref.base_legal_tratamiento`",
        "--                 (12) y `ref.base_legal_evidencia` (5); 5 columnas en",
        "--                 `core.actores` y 1 en `core.actor_datos_personales`; 8",
        "--                 claves ajenas; el esquema `ref`, 4 vistas y el rol",
        "--                 `avisa_app`;",
        "--    · parche 15 · `puede_crear`, `puede_editar` y `puede_eliminar` en",
        "--                 `core.roles`: el permiso de borrado deja de ser",
        "--                 implícito;",
        "--    · parche 16 · `core.banco_datos_tratamiento` (18 columnas, 2 claves",
        "--                 ajenas), `ref.base_legal_tratamiento.banco_datos_id` y",
        "--                 la cobertura de RLS de `core`;",
        "--    · parche 17 · `core.cat_privilegio` (5), `core.privilegio_usuario`",
        "--                 (9) y `core.consulta_reniec` (10), con 8 claves ajenas;",
        "--                 6 columnas de consumo en `agent.llm_call` (que se",
        "--                 replican en sus 6 particiones) y 5 en",
        "--                 `core.envios_comunicacion`. `core` queda con 45 tablas",
        "--                 protegidas y 303 políticas.",
        "--    · parche 18 · `config.servicio_externo` (8 columnas) y",
        "--                 `config.tope_gasto` (11), con 1 clave ajena; 2 vistas y",
        "--                 2 funciones de control de gasto; seguridad por fila en",
        "--                 `core.roles`, `core.usuarios` y `core.usuario_roles`.",
        "--    · parche 19 · ningún objeto: los 19 comentarios de columna que",
        "--                 faltaban; deja el modelo con 2 145 de 2 145 columnas",
        "--                 descritas.",
        "--    · parche 20 · ningún objeto nuevo: el rol `direccion_oaipcs`, el paso",
        "--                 `V10-ALERTA-APROB` del flujo de alerta, la renumeración",
        "--                 del paso 4 al 5 en 83 instancias y 4 políticas en",
        "--                 `core.flujo_definicion` (lectura abierta, escritura sólo",
        "--                 `administrador`).",
        "--    · parche 21 · `aprobada_por` (con clave ajena a `core.usuarios`) y",
        "--                 `aprobada_en` en `core.alertas_tempranas`, su índice",
        "--                 parcial y 8 políticas (4 en `core.flujo_estado` y 4 en",
        "--                 `core.permiso_aprobacion`); la vista",
        "--                 `core.vw_alerta_estado` pasa a 19 columnas; 1 restricción",
        "--                 y 1 trigger de validación en `core.flujo_definicion`; 1",
        "--                 asignación de rol, que no crea objetos.",
        "--    · parche 22 · `visibilidad` en `core.alertas_tempranas`, con su",
        "--                 restricción `alertas_visibilidad_valida` y su índice",
        "--                 parcial; el trigger `alertas_g21_visibilidad`, que hace",
        "--                 ejecutable G21; `core.puede_aprobar()` y la vista",
        "--                 `core.vw_permiso_aprobacion` (10 columnas), que dan",
        "--                 consumidor a `core.permiso_aprobacion`; `core.vw_alerta_estado`",
        "--                 pasa a 20 columnas; no añade claves ajenas ni filas.",
        "--    · parche 23 · `core.alerta_destinatario` (11 columnas, vacía),",
        "--                 `validada_por` y `es_grave` en `core.alertas_tempranas`",
        "--                 y `core.cat_prioridades_alerta` respectivamente, sus 2",
        "--                 restricciones de coherencia y de cuatro ojos, 5 claves",
        "--                 ajenas, 1 trigger `trg_audit`, 5 índices y 4 políticas;",
        "--                 `core.vw_alerta_estado` pasa a 22 columnas. La tabla nueva",
        "--                 estrena RLS **forzada** —`ENABLE` y `FORCE`—, como el",
        "--                 resto de `core`: sin `FORCE` el propietario se salta las",
        "--                 cuatro políticas y no sirven de nada.",
        "--    · parche 24 · ningún objeto nuevo: los 7 comentarios de columna que",
        "--                 faltaban en `core.alerta_destinatario` (`id`, `alerta_id`,",
        "--                 `motivo` y las 4 de auditoría). Deja el modelo en 2 161 de",
        "--                 2 161 columnas descritas y devuelve al parche 19 su",
        "--                 reejecutabilidad, porque su candado mide el modelo entero.",
        "--  Por eso la sección A termina en 275 tablas y no en 290: las tablas",
        "--  que faltan no son parte del esquema base, se crean después de cargar",
        "--  el legado. Si la sección A se queda corta en algo distinto, el defecto",
        "--  no está en este archivo: falta una fuente o cambió el DDL.",
        "--",
        "--  El parche 6 crea una instantánea de rollback",
        "--  (`core.patch6_documentos_snapshot`) que él mismo autoriza a borrar",
        "--  tras validar. En la base `avisa` ya está borrada, por eso no aparece",
        "--  en los conteos; al reconstruir desde cero existe hasta que se borre.",
        "--",
        "--  CÓMO REPRODUCIR LOS CONTEOS (sobre la base ya construida)",
        '--  psql -c "SELECT count(*) FROM pg_class c',
        "--    JOIN pg_namespace n ON n.oid=c.relnamespace",
        "--    WHERE c.relkind IN ('r','p') AND n.nspname NOT IN",
        "--    ('pg_catalog','information_schema','public','legacy','staging')\"",
        "--  y lo mismo sobre information_schema.columns y pg_constraint",
        "--  (contype='f'). `public` solo contiene `spatial_ref_sys` de PostGIS.",
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
                "Parches 6-23. Requiere el legado cargado por migration/loader;",
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
