#!/usr/bin/env python
"""Importador de la «matriz de conflictos» 2026 hacia el esquema `core`.

Lee únicamente los JSON ya validados:

* `scripts/matriz/salida/casos.json`          (parse_matriz.py)
* `scripts/matriz/salida/hojas_auxiliares.json` (matriz_hojas_aux.py)

No vuelve a leer el XLSX ni reimplementa el parser.

Principios
----------
1. **Neon es de sólo lectura.** `--dry-run` (el modo por defecto) abre la
   conexión con `readonly=True, autocommit=True` y no escribe nada. `--apply`
   exige además `--confirmar`; sin él aborta antes de abrir una transacción.
2. **El dato ausente se declara, no se estima.** Cuando un valor no permite
   una resolución inequívoca se deja NULL, se conserva el texto crudo (si hay
   columna para ello) y se emite una advertencia o un rechazo con motivo.
3. **El caso se resuelve SIEMPRE por `core.mapa_matriz_excel`**, nunca por
   `codigo_caso`: hay dos códigos del Excel que colisionan por casualidad y
   apuntan a casos distintos.

Notas de realidad de los insumos (corte 2026-11-24)
--------------------------------------------------
* Los `bloques_reporte` y los `nudos` usan la numeración de la hoja «Reporte de
  avance», que **no** coincide con la numeración de la hoja principal
  (`casos.json.fila_inicio`). El número de fila de un nudo no identifica por sí
  solo un hito. Por eso:
    - el caso se resuelve con `bloques_reporte.fila_inicio` → `numero_excel` →
      `casos.orden`;
    - el compromiso se resuelve por la **posición** de la fila dentro del
      bloque, sobre una secuencia formada por cada hito y, cuando una acción no
      tiene hitos, por la propia acción. Es la única correspondencia estable
      que conservan los JSON. Cada vínculo por posición se declara en el
      informe y queda como decisión pendiente de verificación.
* `casos.descripcion_riesgo`, `narrativa_cronologica`, `sectorista_raw`,
  `prioridad`, `fecha_registro`, `alcance_geografico_raw`, `subsector_raw`,
  `problematica_resumen`, `riesgo_descripcion`, `validacion_hito_raw`,
  `medios_verificacion_raw`, `documentos_raw` y `reuniones.documentos` no se
  importan en esta versión (no están en las reglas del encargo). Se declaran
  como «datos sin destino» en el informe.
* `core.caso_nudo_critico` se carga con **una fila por celda no vacía** de la
  matriz: `descripcion` y `seguimiento` pueden faltar por separado
  (`descripcion` es NULLABLE desde `migration/43_nudos_criticos_fieles.sql`,
  con un CHECK de que al menos uno de los dos tenga texto). Ya **no hay índices
  únicos por semana**: varios nudos del mismo compromiso y semana coexisten. La
  identidad es `origen_ref = MATRIZ-N{fila:04d}-C{col_nudo:02d}`; el contenido
  literal idéntico se colapsa con motivo `repetido_identico`.
* `core.cat_tematicas` NO se toca. El vocabulario del equipo se guarda como
  texto libre en `casos.tematica_equipo` / `compromisos.tematica_equipo`.
  `demandas.tematica_id` sólo se rellena cuando el texto normalizado coincide
  exactamente con un `nombre` del catálogo.

Uso
---
    python scripts/matriz/importar_matriz.py [--dry-run|--apply] [--confirmar]
        [--actualizar-riesgo] [--incluir-anulados] [--mapa-reuniones RUTA.json]
        [--solo SECCION] [--salida RUTA.json]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Rutas y constantes
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

RUTA_CASOS = os.path.join(HERE, "salida", "casos.json")
RUTA_AUXILIARES = os.path.join(HERE, "salida", "hojas_auxiliares.json")
RUTA_INFORME = os.path.join(HERE, "salida", "informe_importacion.json")
RUTA_ENV = os.path.join(REPO, ".env")

FUENTE_MAPA = "MATRIZ_OAIPCS_2026"

SECCIONES = (
    "casos",
    "demandas",
    "compromisos",
    "hitos",
    "nudos",
    "alertas",
    "reuniones",
)

BLOQUES_SIN_DESTINO = (20, 43, 49)
BLOQUE_DUPLICADO = 128
CASOS_SIN_BLOQUE_CONOCIDOS = ("CS-PA-INF-2022-01", "CS-PA-ITE-2026-02")

ESTADOS_ACTUALIZACION = ("Actualizado", "En proceso", "Pendiente", "No aplica")

# Equivalencia textual -> id, según migration/41_matriz_equipo.sql.
ESTADOS_HITO_TEXTO = {
    "cumplido": 4,
    "desestimado": 5,
    "no cumplido": 6,
}
ESTADO_HITO_POR_DEFECTO = 1  # Registrado

TZ_LIMA = dt.timezone(dt.timedelta(hours=-5))
MAX_TEXTO_FECHA = 120
MAX_TEXTO_RESPONSABLE = 200
MAX_TEXTO_PUNTO_FOCAL = 200
MAX_TEMATICA_EQUIPO = 120
MAX_LINK = 500
MAX_REGION_TEXTO = 80

LOG = logging.getLogger("importar_matriz")


# ---------------------------------------------------------------------------
# Utilidades de texto
# ---------------------------------------------------------------------------
def normalizar(texto: object) -> str:
    """Normaliza para comparar: sin tildes, minúsculas, espacios colapsados."""
    if texto is None:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def normalizar_siglas(texto: object) -> str:
    """Normaliza siglas: mayúsculas, sin tildes y sin espacios ni guiones."""
    s = normalizar(texto).upper()
    return re.sub(r"[\s\-]+", "", s)


def limpiar(texto: object) -> str | None:
    """Devuelve el texto sin espacios sobrantes; None si queda vacío."""
    if texto is None:
        return None
    s = re.sub(r"\s+", " ", str(texto)).strip()
    return s or None


def texto_crudo(valor: object) -> str | None:
    """Representa un valor crudo para columnas `*_texto`, sin inventar nada."""
    if valor is None:
        return None
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    if isinstance(valor, (dt.date, dt.datetime)):
        return valor.isoformat()
    s = re.sub(r"\s+", " ", str(valor)).strip()
    return s or None


def truncar(texto: str | None, limite: int) -> str | None:
    if texto is None:
        return None
    return texto[:limite]


def es_error_excel(valor: object) -> bool:
    """True si el valor es vacío o un error de Excel (#REF!, #N/A, etc.)."""
    if valor is None:
        return True
    s = str(valor).strip()
    return not s or s.startswith("#")


def parsear_fecha(iso: object) -> dt.date | None:
    if not iso:
        return None
    try:
        return dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None


def mapear_nivel_riesgo(texto: object) -> tuple[int | None, str | None]:
    """Equivalencia textual -> id de `core.cat_niveles_riesgo`.

    contenga «bajo» → 1; «intermedio» o «moderado» → 2;
    «inminente» o «alto» → 3; «crítico» o «critico» → 4.
    """
    n = normalizar(texto)
    if not n:
        return None, None
    if re.search(r"\bcritico\b", n):
        return 4, None
    if re.search(r"\b(inminente|alto)\b", n):
        return 3, None
    if re.search(r"\b(intermedio|moderado)\b", n):
        return 2, None
    if re.search(r"\bbajo\b", n):
        return 1, None
    return None, f"sin equivalencia para el nivel de riesgo: {texto!r}"


def mapear_estado_hito(texto: object) -> tuple[int, str | None]:
    """Estado textual del hito -> id. Vacío -> 1 (Registrado) con advertencia."""
    n = normalizar(texto)
    if not n:
        return ESTADO_HITO_POR_DEFECTO, "estado de hito vacío; se usa Registrado (1)"
    if n in ESTADOS_HITO_TEXTO:
        return ESTADOS_HITO_TEXTO[n], None
    return (
        ESTADO_HITO_POR_DEFECTO,
        f"estado de hito sin equivalencia ({texto!r}); se usa Registrado (1)",
    )


# ---------------------------------------------------------------------------
# Resolución de textos -> ids (funciones públicas)
# ---------------------------------------------------------------------------
def resolver_usuario(
    nombre: str | None, usuarios: Sequence[dict[str, Any]]
) -> tuple[str | None, str | None]:
    """Resuelve un nombre del Excel contra `core.usuarios.nombre`.

    Regla: mismo primer nombre y coincidencia de al menos un apellido (token
    posterior). Se prefiere la coincidencia exacta; en empate se prefiere el
    usuario activo. Si no hay resolución inequívoca devuelve `(None, texto)`.
    """
    original = limpiar(nombre)
    if not original:
        return None, None

    q = normalizar(original)
    qt = q.split()
    if len(qt) < 2:
        return None, original

    exactos = [u for u in usuarios if normalizar(u.get("nombre")) == q]
    if len(exactos) == 1:
        return str(exactos[0]["id"]), None
    if len(exactos) > 1:
        activos = [u for u in exactos if u.get("activo")]
        if len(activos) == 1:
            return str(activos[0]["id"]), None
        return None, original

    primero = qt[0]
    resto = set(qt[1:])
    candidatos: list[tuple[int, dict[str, Any]]] = []
    for u in usuarios:
        ut = normalizar(u.get("nombre")).split()
        if len(ut) < 2 or ut[0] != primero:
            continue
        solape = len(resto & set(ut[1:]))
        if solape >= 1:
            candidatos.append((solape, u))

    if not candidatos:
        return None, original

    mejor = max(o for o, _ in candidatos)
    finalistas = [u for o, u in candidatos if o == mejor]
    if len(finalistas) == 1:
        return str(finalistas[0]["id"]), None

    activos = [u for u in finalistas if u.get("activo")]
    if len(activos) == 1:
        return str(activos[0]["id"]), None
    return None, original


def resolver_unidad(
    texto: str | None,
    unidades: Sequence[dict[str, Any]],
    unidad_caso: int | None = None,
) -> tuple[int | None, str | None]:
    """Resuelve «DIPFORPA / DGPA» contra `core.cat_unidades_organicas`.

    Parte por `/`, `,`, ` y ` y `-`. Compara primero siglas exactas y luego
    `nombre_completo`. Devuelve el primer token que resuelve. Si ninguno
    resuelve usa la unidad del caso y lo declara.
    """
    original = limpiar(texto)
    if not original:
        if unidad_caso is not None:
            return unidad_caso, "unidad vacía; se usó la del caso"
        return None, "unidad vacía"

    por_siglas: dict[str, int] = {}
    por_nombre: dict[str, int] = {}
    for u in unidades:
        por_siglas.setdefault(normalizar_siglas(u.get("siglas")), int(u["id"]))
        por_nombre.setdefault(normalizar(u.get("nombre_completo")), int(u["id"]))

    # 1) el texto completo
    siglas = normalizar_siglas(original)
    if siglas in por_siglas:
        return por_siglas[siglas], None
    nombre = normalizar(original)
    if nombre in por_nombre:
        return por_nombre[nombre], None

    # 2) tokens separados por «/», «,», « y » o «-»
    tokens = re.split(r"\s*[/,]\s*|\s+-\s*|\s*-\s*|\s+y\s+", original, flags=re.I)
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        siglas = normalizar_siglas(token)
        if siglas in por_siglas:
            return por_siglas[siglas], None
        nombre = normalizar(token)
        if nombre in por_nombre:
            return por_nombre[nombre], None

    if unidad_caso is not None:
        return unidad_caso, "unidad no resuelta, se usó la del caso"
    return None, "unidad no resuelta"


def resolver_distrito(
    region: str | None,
    provincia: str | None,
    distrito: str | None,
    distritos: Sequence[dict[str, Any]],
) -> tuple[int | None, str | None]:
    """Resuelve (región, provincia, distrito) -> `core.distritos.id`.

    Se exige coincidencia única. Si no la hay devuelve `(None, motivo)`: no se
    inventa un distrito. Orden de intentos: los tres campos, provincia+distrito
    y sólo distrito.
    """
    nd = normalizar(distrito)
    if not nd:
        return None, None
    nr = normalizar(region)
    np_ = normalizar(provincia)

    def _filtrar(con_region: bool, con_provincia: bool) -> list[dict[str, Any]]:
        out = [d for d in distritos if d["distrito_norm"] == nd]
        if con_provincia and np_:
            out = [d for d in out if d["provincia_norm"] == np_]
        if con_region and nr:
            out = [d for d in out if d["region_norm"] == nr]
        return out

    intentos = [
        (True, True),
        (False, True),
        (False, False),
    ]
    if not (nr and np_):
        intentos = [(bool(nr), bool(np_)), (False, False)]
    for con_region, con_provincia in intentos:
        cands = _filtrar(con_region, con_provincia)
        if len(cands) == 1:
            return int(cands[0]["id"]), None
        if len(cands) > 1:
            return None, "distrito no resuelto de forma única"
    return None, "distrito sin coincidencia"


# ---------------------------------------------------------------------------
# Modelo de datos del plan
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Opciones:
    modo: str = "dry-run"
    confirmar: bool = False
    actualizar_riesgo: bool = False
    incluir_anulados: bool = False
    mapa_reuniones: str | None = None
    solo: str | None = None
    salida: str = RUTA_INFORME


@dataclass
class Insumos:
    casos: list[dict[str, Any]]
    auxiliares: dict[str, Any]
    meta: dict[str, Any]
    ruta_casos: str
    ruta_auxiliares: str


@dataclass
class MapaFila:
    bloque_fila: int
    codigo_excel: str | None
    caso_id: str
    confianza: str
    nota: str | None


@dataclass
class CasoBD:
    id: str
    codigo_caso: str
    nombre_caso: str
    unidad_responsable_id: int | None
    nivel_riesgo_id: int | None
    prioridad_id: int | None
    estado_id: int | None
    fecha_inicio: dt.date | None
    anulado_en: dt.datetime | None
    punto_focal_usuario_id: str | None
    nivel_riesgo_inicial_id: int | None = None
    estado_actualizacion: str | None = None
    tematica_equipo: str | None = None
    link_analisis_caso: str | None = None
    resumen_ejecutivo: str | None = None


@dataclass
class CompromisoBD:
    id: str
    codigo_compromiso: str
    caso_id: str
    accion_compromiso: str
    normalizado: str


@dataclass
class HitoBD:
    id: str
    compromiso_id: str
    codigo_hito: str
    descripcion_hito: str
    normalizado: str


@dataclass
class DemandaBD:
    id: str
    caso_id: str
    descripcion_demanda: str
    normalizado: str


@dataclass
class AlertaBD:
    id: str
    codigo_alerta: str


@dataclass
class ReunionBD:
    id: str
    codigo_legado: str


@dataclass
class Contexto:
    url: str
    mapa_disponible: bool
    mapa: dict[int, MapaFila]
    tablas: set[str]
    columnas: dict[str, set[str]]
    nulabilidad: dict[str, dict[str, str]]
    casos: dict[str, CasoBD]
    casos_por_codigo: dict[str, CasoBD]
    usuarios: list[dict[str, Any]]
    unidades: list[dict[str, Any]]
    distritos: list[dict[str, Any]]
    tematicas_norm: dict[str, int]
    demandas: dict[str, dict[str, DemandaBD]]
    compromisos: dict[str, dict[str, CompromisoBD]]
    hitos: dict[str, dict[str, HitoBD]]
    alertas: dict[str, AlertaBD]
    reuniones: dict[str, ReunionBD]
    nudos: set[str]  # origen_ref ya presentes en core.caso_nudo_critico
    nudos_disponible: bool
    migracion_41: bool
    migracion_42: bool
    mapa_origen: str = "bd"


@dataclass
class Advertencias:
    """Agrupa advertencias homogéneas para no inflar el informe."""

    _grupos: dict[str, dict[str, Any]] = field(default_factory=dict)

    def add(
        self, codigo: str, detalle: str | None = None, fila: int | None = None
    ) -> None:
        grupo = self._grupos.setdefault(
            codigo,
            {"codigo": codigo, "detalle": detalle, "ocurrencias": 0, "filas": []},
        )
        grupo["ocurrencias"] += 1
        if detalle and not grupo.get("detalle"):
            grupo["detalle"] = detalle
        if fila is not None and len(grupo["filas"]) < 25:
            grupo["filas"].append(fila)

    def lista(self) -> list[dict[str, Any]]:
        return list(self._grupos.values())

    def __len__(self) -> int:
        return sum(g["ocurrencias"] for g in self._grupos.values())


@dataclass
class ItemPlan:
    entidad: str
    accion: str  # insert | update | omit | reject
    clave: str
    fila: int | None = None
    motivo: str | None = None
    datos: dict[str, Any] = field(default_factory=dict)
    detalle: dict[str, Any] = field(default_factory=dict)
    existente_id: str | None = None
    ref: str | None = None


@dataclass
class SeccionPlan:
    nombre: str
    items: list[ItemPlan] = field(default_factory=list)
    advertencias: Advertencias = field(default_factory=Advertencias)
    notas: list[str] = field(default_factory=list)

    def add(self, item: ItemPlan) -> ItemPlan:
        self.items.append(item)
        return item

    def contar(self) -> dict[str, int]:
        c = Counter(i.accion for i in self.items)
        return {
            "insertados": c.get("insert", 0),
            "actualizados": c.get("update", 0),
            "omitidos": c.get("omit", 0),
            "rechazados": c.get("reject", 0),
        }


@dataclass
class ResolucionCaso:
    caso_json: dict[str, Any]
    bloque: int
    estado: str  # operable | sin_destino | duplicado | anulado | sin_mapeo | caso_inexistente
    motivo: str | None
    caso_bd: CasoBD | None


@dataclass
class RefCompromiso:
    codigo: str
    caso_id: str
    existente_id: str | None
    estado: str  # existente | planificado | rechazado
    motivo: str | None = None


@dataclass
class Plan:
    secciones: dict[str, SeccionPlan] = field(default_factory=dict)
    resoluciones: dict[int, ResolucionCaso] = field(default_factory=dict)
    refs_accion: dict[tuple[int, int], RefCompromiso] = field(default_factory=dict)
    secuencias_nudo: dict[int, list[RefCompromiso]] = field(default_factory=dict)
    ids_compromiso: dict[str, str] = field(default_factory=dict)
    decisiones: list[dict[str, Any]] = field(default_factory=list)
    datos_sin_destino: dict[str, Any] = field(default_factory=dict)
    bloqueantes: list[dict[str, Any]] = field(default_factory=list)
    fatal: list[str] = field(default_factory=list)
    resumen_nudos: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)

    def seccion(self, nombre: str) -> SeccionPlan:
        if nombre not in self.secciones:
            self.secciones[nombre] = SeccionPlan(nombre)
        return self.secciones[nombre]

    def bloquear(self, codigo: str, detalle: str, **extra: Any) -> None:
        self.bloqueantes.append({"codigo": codigo, "detalle": detalle, **extra})


# ---------------------------------------------------------------------------
# Carga de insumos y contexto
# ---------------------------------------------------------------------------
def _leer_json(ruta: str) -> Any:
    with open(ruta, encoding="utf-8") as fh:
        return json.load(fh)


def cargar_insumos(
    ruta_casos: str = RUTA_CASOS, ruta_auxiliares: str = RUTA_AUXILIARES
) -> Insumos:
    """Carga los dos JSON ya validados. No lee el XLSX."""
    for ruta in (ruta_casos, ruta_auxiliares):
        if not os.path.exists(ruta):
            raise FileNotFoundError(f"No existe el insumo: {ruta}")
    datos = _leer_json(ruta_casos)
    aux = _leer_json(ruta_auxiliares)
    return Insumos(
        casos=list(datos.get("casos") or []),
        auxiliares=aux,
        meta=dict(datos.get("meta") or {}),
        ruta_casos=ruta_casos,
        ruta_auxiliares=ruta_auxiliares,
    )


def _url_bd() -> str:
    load_dotenv(RUTA_ENV)
    url = os.environ.get("NEON_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("No hay NEON_OWNER_URL ni DATABASE_URL en el entorno/.env")
    return url


def conectar(url: str, solo_lectura: bool = True) -> Any:
    """Abre la conexión. En sólo lectura usa `readonly=True, autocommit=True`."""
    conn = psycopg2.connect(url)
    if solo_lectura:
        conn.set_session(readonly=True, autocommit=True)
    return conn


def _tabla_existe(cur: Any, tabla: str) -> bool:
    cur.execute("select to_regclass(%s) is not null as ok", (f"core.{tabla}",))
    return bool(cur.fetchone()["ok"])


def _info_columnas(cur: Any, tabla: str) -> tuple[set[str], dict[str, str]]:
    cur.execute(
        """select column_name, is_nullable
           from information_schema.columns
           where table_schema = 'core' and table_name = %s""",
        (tabla,),
    )
    filas = cur.fetchall()
    return (
        {r["column_name"] for r in filas},
        {r["column_name"]: r["is_nullable"] for r in filas},
    )


def cargar_contexto(conn: Any, *, exigir_mapa: bool = False) -> Contexto:
    """Lee catálogos, casos y filas existentes (siempre en sólo lectura).

    No aborta si falta la tabla de mapeo: el llamador decide. `exigir_mapa`
    se conserva en la firma para usos programáticos.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    tablas = {
        "mapa_matriz_excel",
        "casos",
        "compromisos",
        "hitos_compromiso",
        "demandas",
        "alertas_tempranas",
        "reuniones_dialogo",
        "caso_nudo_critico",
        "usuarios",
        "cat_unidades_organicas",
        "cat_tematicas",
    }
    existentes = {t for t in tablas if _tabla_existe(cur, t)}

    columnas: dict[str, set[str]] = {}
    nulabilidad: dict[str, dict[str, str]] = {}
    for tabla in (
        "casos",
        "compromisos",
        "hitos_compromiso",
        "demandas",
        "alertas_tempranas",
        "reuniones_dialogo",
        "caso_nudo_critico",
    ):
        if tabla in existentes:
            columnas[tabla], nulabilidad[tabla] = _info_columnas(cur, tabla)
        else:
            columnas[tabla], nulabilidad[tabla] = set(), {}

    mapa: dict[int, MapaFila] = {}
    mapa_disponible = "mapa_matriz_excel" in existentes
    if mapa_disponible:
        cur.execute(
            """select bloque_fila, codigo_excel, caso_id::text, confianza, nota
               from core.mapa_matriz_excel
               where fuente = %s
               order by bloque_fila""",
            (FUENTE_MAPA,),
        )
        for r in cur.fetchall():
            mapa[int(r["bloque_fila"])] = MapaFila(
                bloque_fila=int(r["bloque_fila"]),
                codigo_excel=r["codigo_excel"],
                caso_id=r["caso_id"],
                confianza=r["confianza"],
                nota=r["nota"],
            )

    # Casos (con las columnas que existan)
    base_casos = [
        "id",
        "codigo_caso",
        "nombre_caso",
        "unidad_responsable_id",
        "nivel_riesgo_id",
        "prioridad_id",
        "estado_id",
        "fecha_inicio",
        "anulado_en",
        "punto_focal_usuario_id",
    ]
    extra_casos = [
        "nivel_riesgo_inicial_id",
        "estado_actualizacion",
        "tematica_equipo",
        "link_analisis_caso",
        "resumen_ejecutivo",
    ]
    sel = [c for c in base_casos + extra_casos if c in columnas["casos"]]
    cur.execute(f"select {', '.join(sel)} from core.casos")
    casos: dict[str, CasoBD] = {}
    casos_por_codigo: dict[str, CasoBD] = {}
    for r in cur.fetchall():
        c = CasoBD(
            id=str(r["id"]),
            codigo_caso=r["codigo_caso"],
            nombre_caso=r["nombre_caso"],
            unidad_responsable_id=r.get("unidad_responsable_id"),
            nivel_riesgo_id=r.get("nivel_riesgo_id"),
            prioridad_id=r.get("prioridad_id"),
            estado_id=r.get("estado_id"),
            fecha_inicio=r.get("fecha_inicio"),
            anulado_en=r.get("anulado_en"),
            punto_focal_usuario_id=(
                str(r["punto_focal_usuario_id"])
                if r.get("punto_focal_usuario_id")
                else None
            ),
            nivel_riesgo_inicial_id=r.get("nivel_riesgo_inicial_id"),
            estado_actualizacion=r.get("estado_actualizacion"),
            tematica_equipo=r.get("tematica_equipo"),
            link_analisis_caso=r.get("link_analisis_caso"),
            resumen_ejecutivo=r.get("resumen_ejecutivo"),
        )
        casos[c.id] = c
        casos_por_codigo[c.codigo_caso] = c

    # Usuarios, unidades, temáticas
    cur.execute("select id::text, nombre, activo from core.usuarios order by nombre")
    usuarios = [dict(r) for r in cur.fetchall()]

    cur.execute(
        "select id, siglas, nombre_completo from core.cat_unidades_organicas order by id"
    )
    unidades = [dict(r) for r in cur.fetchall()]

    cur.execute("select id, nombre from core.cat_tematicas order by id")
    tematicas_norm = {normalizar(r["nombre"]): int(r["id"]) for r in cur.fetchall()}

    # Distritos con región y provincia
    cur.execute(
        """select d.id, d.nombre as distrito, p.nombre as provincia, r.nombre as region
           from core.distritos d
           join core.provincias p on p.id = d.provincia_id
           join core.regiones r on r.id = p.region_id"""
    )
    distritos = [
        {
            "id": r["id"],
            "distrito_norm": normalizar(r["distrito"]),
            "provincia_norm": normalizar(r["provincia"]),
            "region_norm": normalizar(r["region"]),
        }
        for r in cur.fetchall()
    ]

    # Filas existentes para idempotencia
    demandas: dict[str, dict[str, DemandaBD]] = defaultdict(dict)
    if "demandas" in existentes:
        cur.execute(
            """select id::text, caso_id::text, descripcion_demanda
               from core.demandas
               where anulado_en is null and caso_id is not null"""
        )
        for r in cur.fetchall():
            d = DemandaBD(
                id=r["id"],
                caso_id=r["caso_id"],
                descripcion_demanda=r["descripcion_demanda"] or "",
                normalizado=normalizar(r["descripcion_demanda"]),
            )
            demandas[d.caso_id][d.normalizado] = d

    compromisos: dict[str, dict[str, CompromisoBD]] = defaultdict(dict)
    if "compromisos" in existentes:
        cur.execute(
            """select id::text, codigo_compromiso, caso_id::text, accion_compromiso
               from core.compromisos
               where anulado_en is null"""
        )
        for r in cur.fetchall():
            c = CompromisoBD(
                id=r["id"],
                codigo_compromiso=r["codigo_compromiso"],
                caso_id=r["caso_id"],
                accion_compromiso=r["accion_compromiso"] or "",
                normalizado=normalizar(r["accion_compromiso"]),
            )
            compromisos[c.caso_id][c.normalizado] = c

    hitos: dict[str, dict[str, HitoBD]] = defaultdict(dict)
    if "hitos_compromiso" in existentes:
        cur.execute(
            """select id::text, compromiso_id::text, codigo_hito, descripcion_hito
               from core.hitos_compromiso
               where anulado_en is null and compromiso_id is not null"""
        )
        for r in cur.fetchall():
            h = HitoBD(
                id=r["id"],
                compromiso_id=r["compromiso_id"],
                codigo_hito=r["codigo_hito"],
                descripcion_hito=r["descripcion_hito"] or "",
                normalizado=normalizar(r["descripcion_hito"]),
            )
            hitos[h.compromiso_id][h.normalizado] = h

    alertas: dict[str, AlertaBD] = {}
    if "alertas_tempranas" in existentes:
        cur.execute("""select id::text, codigo_alerta from core.alertas_tempranas""")
        for r in cur.fetchall():
            alertas[r["codigo_alerta"]] = AlertaBD(
                id=r["id"], codigo_alerta=r["codigo_alerta"]
            )

    reuniones: dict[str, ReunionBD] = {}
    if (
        "reuniones_dialogo" in existentes
        and "codigo_legado" in columnas["reuniones_dialogo"]
    ):
        cur.execute(
            """select id::text, codigo_legado from core.reuniones_dialogo
               where codigo_legado is not null"""
        )
        for r in cur.fetchall():
            reuniones[r["codigo_legado"]] = ReunionBD(
                id=r["id"], codigo_legado=r["codigo_legado"]
            )

    # La identidad de un nudo es su celda de origen (migration/43). Sin la
    # columna `origen_ref` no se puede decidir insert vs update, así que se
    # declara `nudos_disponible = False` y --apply queda bloqueado.
    nudos: set[str] = set()
    nudos_disponible = (
        "caso_nudo_critico" in existentes
        and "origen_ref" in columnas["caso_nudo_critico"]
    )
    if nudos_disponible:
        cur.execute(
            """select origen_ref from core.caso_nudo_critico
               where origen_ref is not null"""
        )
        for r in cur.fetchall():
            nudos.add(r["origen_ref"])

    cur.close()

    migracion_41 = (
        mapa_disponible
        and "caso_nudo_critico" in existentes
        and {
            "estado_actualizacion",
            "nivel_riesgo_inicial_id",
            "tematica_equipo",
            "link_analisis_caso",
        }
        <= columnas["casos"]
        and {"punto_focal_usuario_id", "punto_focal_texto", "tematica_equipo"}
        <= columnas["compromisos"]
        and {
            "responsable_usuario_id",
            "responsable_texto",
            "fecha_vencimiento_texto",
            "fecha_real_texto",
        }
        <= columnas["hitos_compromiso"]
    )
    migracion_42 = (
        "reuniones_dialogo" in existentes
        and "codigo_legado" in columnas["reuniones_dialogo"]
        and nulabilidad["reuniones_dialogo"].get("caso_id") == "YES"
        and nulabilidad["reuniones_dialogo"].get("convocante_unidad_id") == "YES"
    )

    if exigir_mapa and not mapa_disponible:
        raise RuntimeError("Falta ejecutar migration/41_matriz_equipo.sql")

    return Contexto(
        url="",
        mapa_disponible=mapa_disponible,
        mapa=mapa,
        tablas=existentes,
        columnas=columnas,
        nulabilidad=nulabilidad,
        casos=casos,
        casos_por_codigo=casos_por_codigo,
        usuarios=usuarios,
        unidades=unidades,
        distritos=distritos,
        tematicas_norm=tematicas_norm,
        demandas=demandas,
        compromisos=compromisos,
        hitos=hitos,
        alertas=alertas,
        reuniones=reuniones,
        nudos=nudos,
        nudos_disponible=nudos_disponible,
        migracion_41=migracion_41,
        migracion_42=migracion_42,
    )


# ---------------------------------------------------------------------------
# Construcción del plan: casos
# ---------------------------------------------------------------------------
def _actualizar_caso(
    caso_json: dict[str, Any],
    caso_bd: CasoBD,
    ctx: Contexto,
    opciones: Opciones,
    adv: Advertencias,
    plan: Plan,
) -> dict[str, Any]:
    """Calcula los campos a actualizar y devuelve sólo los que cambian."""
    ra = caso_json.get("reporte_avance") or {}
    deseados: dict[str, Any] = {}

    def poner(columna: str, valor: Any, etiqueta: str) -> None:
        # Si la columna aún no existe la migración 41 está pendiente y el plan se
        # bloquea a nivel global (_verificar_bloqueantes). Aquí se planifica el
        # valor deseado igualmente para que el informe sea auditable.
        if valor is None:
            return
        _ = etiqueta
        deseados[columna] = valor

    # Estado de actualización (columna H del Excel: no es una fecha)
    estado = limpiar(caso_json.get("timestamp_estado"))
    if estado in ESTADOS_ACTUALIZACION:
        poner("estado_actualizacion", estado, "estado_actualizacion")
    elif estado:
        adv.add(
            "estado_actualizacion_no_permitido",
            f"valor no permitido: {estado!r}",
            caso_json.get("fila_inicio"),
        )
    else:
        adv.add(
            "estado_actualizacion_vacio",
            "casos.estado_actualizacion: timestamp vacío, no se toca.",
            caso_json.get("fila_inicio"),
        )

    # Riesgo inicial
    nivel, error = mapear_nivel_riesgo(ra.get("riesgo_inicial_raw"))
    if nivel is not None:
        poner("nivel_riesgo_inicial_id", nivel, "nivel_riesgo_inicial_id")
    elif error:
        adv.add("riesgo_inicial_sin_equivalencia", error, caso_json.get("fila_inicio"))

    # Riesgo actual: sólo con --actualizar-riesgo
    if opciones.actualizar_riesgo:
        nivel_actual, error_actual = mapear_nivel_riesgo(ra.get("riesgo_actual_raw"))
        if nivel_actual is not None:
            if "nivel_riesgo_id" not in ctx.columnas["casos"]:
                plan.bloquear(
                    "migracion_requerida_41",
                    "Falta core.casos.nivel_riesgo_id",
                )
            else:
                deseados["nivel_riesgo_id"] = nivel_actual
        elif error_actual:
            adv.add(
                "riesgo_actual_sin_equivalencia",
                error_actual,
                caso_json.get("fila_inicio"),
            )

    # Enlace al análisis de caso (Canva)
    url = limpiar((caso_json.get("analisis_canva") or {}).get("url"))
    if url:
        poner("link_analisis_caso", truncar(url, MAX_LINK), "link_analisis_caso")

    # Temática del equipo (texto libre)
    tematica = limpiar(ra.get("tematica_raw"))
    if tematica:
        poner(
            "tematica_equipo", truncar(tematica, MAX_TEMATICA_EQUIPO), "tematica_equipo"
        )

    # Resumen ejecutivo: sólo si no es error de Excel
    resumen = caso_json_resumen(ra)
    if not es_error_excel(resumen):
        poner("resumen_ejecutivo", limpiar(resumen), "resumen_ejecutivo")
    elif resumen is not None and str(resumen).strip():
        adv.add(
            "resumen_ejecutivo_error_excel",
            "resumen_ejecutivo con error de Excel; no se carga.",
            caso_json.get("fila_inicio"),
        )

    actual = {
        "estado_actualizacion": caso_bd.estado_actualizacion,
        "nivel_riesgo_inicial_id": caso_bd.nivel_riesgo_inicial_id,
        "nivel_riesgo_id": caso_bd.nivel_riesgo_id,
        "tematica_equipo": caso_bd.tematica_equipo,
        "link_analisis_caso": caso_bd.link_analisis_caso,
        "resumen_ejecutivo": caso_bd.resumen_ejecutivo,
    }
    return {k: v for k, v in deseados.items() if actual.get(k) != v}


def caso_json_resumen(reporte_avance: dict[str, Any]) -> Any:
    """El resumen puede venir en claves distintas según la versión del parser."""
    for clave in ("resumen_ejecutivo", "resumen_ejecutivo_raw"):
        if clave in reporte_avance:
            return reporte_avance.get(clave)
    return None


def _plan_casos(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
) -> dict[int, ResolucionCaso]:
    seccion = plan.seccion("casos")
    resoluciones: dict[int, ResolucionCaso] = {}

    for caso_json in insumos.casos:
        bloque = int(caso_json["fila_inicio"])
        m = ctx.mapa.get(bloque)

        if bloque == BLOQUE_DUPLICADO or (
            m is not None and "DUPLICADO" in (m.nota or "").upper()
        ):
            estado, motivo, caso_bd = "duplicado", "duplicado_bloque_128", None
        elif m is None:
            if bloque in BLOQUES_SIN_DESTINO:
                estado, motivo, caso_bd = "sin_destino", "sin_destino", None
            else:
                estado, motivo, caso_bd = "sin_mapeo", "sin_mapeo", None
        elif m.caso_id not in ctx.casos:
            estado, motivo, caso_bd = "caso_inexistente", "caso_inexistente", None
        else:
            candidato = ctx.casos[m.caso_id]
            if candidato.anulado_en is not None and not opciones.incluir_anulados:
                estado, motivo, caso_bd = "anulado", "caso_anulado", candidato
            else:
                estado, motivo, caso_bd = "operable", None, candidato

        resoluciones[bloque] = ResolucionCaso(
            caso_json=caso_json,
            bloque=bloque,
            estado=estado,
            motivo=motivo,
            caso_bd=caso_bd,
        )

        if estado == "operable" and caso_bd is not None:
            cambios = _actualizar_caso(
                caso_json, caso_bd, ctx, opciones, seccion.advertencias, plan
            )
            if cambios:
                porcentaje = 100 * len(cambios) / max(len(cambios), 1)
                seccion.add(
                    ItemPlan(
                        entidad="caso",
                        accion="update",
                        clave=caso_bd.codigo_caso,
                        fila=bloque,
                        datos=cambios,
                        detalle={"caso_id": caso_bd.id},
                        existente_id=caso_bd.id,
                    )
                )
                _ = porcentaje
            else:
                seccion.add(
                    ItemPlan(
                        entidad="caso",
                        accion="omit",
                        clave=caso_bd.codigo_caso,
                        fila=bloque,
                        motivo="sin_cambios",
                        existente_id=caso_bd.id,
                    )
                )
        elif estado in ("duplicado", "sin_destino", "anulado"):
            seccion.add(
                ItemPlan(
                    entidad="caso",
                    accion="omit",
                    clave=caso_json.get("codigo_caso") or f"bloque_{bloque}",
                    fila=bloque,
                    motivo=motivo,
                    detalle={
                        "nombre": caso_json.get("nombre_caso_excel"),
                        "numero_excel": caso_json.get("numero_excel"),
                        "caso_id": caso_bd.id if caso_bd is not None else None,
                    },
                )
            )
        else:
            # sin_mapeo / caso_inexistente: no hay destino en la base
            seccion.add(
                ItemPlan(
                    entidad="caso",
                    accion="omit",
                    clave=caso_json.get("codigo_caso") or f"bloque_{bloque}",
                    fila=bloque,
                    motivo=motivo or estado,
                    detalle={
                        "numero_excel": caso_json.get("numero_excel"),
                        "nombre": caso_json.get("nombre_caso_excel"),
                    },
                )
            )

    return resoluciones


# ---------------------------------------------------------------------------
# Construcción del plan: demandas
# ---------------------------------------------------------------------------
def _resolver_tematica(
    tematica: dict[str, Any] | None, ctx: Contexto
) -> tuple[int | None, str | None]:
    """`tematica_id` sólo con coincidencia exacta normalizada contra el catálogo.

    El `id` que trae el JSON pertenece al vocabulario del Excel y puede no
    coincidir con `core.cat_tematicas`; se ignora y se compara el texto. El
    vocabulario del equipo se guarda aparte como texto libre (`*_equipo`).
    """
    if not tematica:
        return None, None
    raw = limpiar(tematica.get("raw"))
    if not raw:
        return None, None
    return ctx.tematicas_norm.get(normalizar(raw)), raw


def _plan_demandas(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
    resoluciones: dict[int, ResolucionCaso],
) -> None:
    """Planifica `core.demandas` (idempotencia: caso + texto normalizado)."""
    seccion = plan.seccion("demandas")

    for bloque, res in resoluciones.items():
        if res.estado != "operable" or res.caso_bd is None:
            continue
        caso_id = res.caso_bd.id
        existentes = ctx.demandas.get(caso_id, {})

        for demanda in res.caso_json.get("demandas") or []:
            fila = demanda.get("fila")
            descripcion = limpiar(demanda.get("texto"))
            if not descripcion:
                seccion.add(
                    ItemPlan(
                        entidad="demanda",
                        accion="reject",
                        clave=f"demanda_fila_{fila}",
                        fila=fila,
                        motivo="sin_descripcion",
                        detalle={"caso_id": caso_id},
                    )
                )
                continue

            normalizado = normalizar(descripcion)
            previa = existentes.get(normalizado)
            if previa is not None:
                seccion.add(
                    ItemPlan(
                        entidad="demanda",
                        accion="omit",
                        clave=descripcion[:80],
                        fila=fila,
                        motivo="ya_existe",
                        detalle={"caso_id": caso_id},
                        existente_id=previa.id,
                    )
                )
                continue

            tematica_id, tematica_raw = _resolver_tematica(demanda.get("tematica"), ctx)
            if tematica_raw and tematica_id is None:
                seccion.advertencias.add(
                    "demanda_tematica_sin_equivalencia",
                    "Temática de demanda sin coincidencia exacta en cat_tematicas: "
                    f"se deja NULL (texto: {tematica_raw!r}).",
                    fila,
                )

            seccion.add(
                ItemPlan(
                    entidad="demanda",
                    accion="insert",
                    clave=descripcion[:80],
                    fila=fila,
                    ref=caso_id,
                    datos={
                        "caso_id": caso_id,
                        "descripcion_demanda": descripcion,
                        "tematica_id": tematica_id,
                        "origen_dato": "importacion",
                    },
                )
            )


# ---------------------------------------------------------------------------
# Construcción del plan: compromisos
# ---------------------------------------------------------------------------
def _siguiente_numero(codigos: Iterable[str | None], patron: str) -> int:
    """Siguiente número libre para un código con sufijo tipo `_XXX{n:03d}`."""
    rx = re.compile(patron)
    mayor = 0
    for codigo in codigos:
        if not codigo:
            continue
        m = rx.search(codigo)
        if not m:
            continue
        try:
            mayor = max(mayor, int(m.group(1)))
        except (TypeError, ValueError):
            continue
    return mayor + 1


def _fecha_inicio_compromiso(
    caso_json: dict[str, Any], caso_bd: CasoBD
) -> tuple[dt.date | None, str | None]:
    """`compromisos.fecha_inicio` es NOT NULL y el Excel no la trae.

    Orden: (1) `casos.fecha_inicio`; (2) la menor `fecha_planificada` ISO de
    sus hitos; (3) nada. No se inventa una fecha.
    """
    if caso_bd.fecha_inicio is not None:
        return caso_bd.fecha_inicio, None

    fechas: list[dt.date] = []
    for accion in caso_json.get("acciones") or []:
        for hito in accion.get("hitos") or []:
            planificada = hito.get("fecha_planificada") or {}
            if planificada.get("estado") != "fecha":
                continue
            fecha = parsear_fecha(planificada.get("iso"))
            if fecha is not None:
                fechas.append(fecha)

    if fechas:
        return min(fechas), None
    return None, "sin_fecha_inicio"


def _plan_compromisos(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
    resoluciones: dict[int, ResolucionCaso],
) -> None:
    """Planifica `core.compromisos` y deja las referencias para hitos y nudos.

    Idempotencia: `(caso_id, normalizar(accion))`. Los compromisos nuevos usan
    `codigo_compromiso = f"{codigo_caso}_COMP{n:03d}"` con `n` siguiente libre.
    """
    seccion = plan.seccion("compromisos")

    for bloque, res in resoluciones.items():
        if res.estado != "operable" or res.caso_bd is None:
            continue
        caso = res.caso_bd
        existentes = ctx.compromisos.get(caso.id, {})
        contador = _siguiente_numero(
            (c.codigo_compromiso for c in existentes.values()), r"_COMP(\d+)$"
        )
        tematica = limpiar(
            (res.caso_json.get("reporte_avance") or {}).get("tematica_raw")
        )
        secuencia: list[RefCompromiso] = []

        for indice, accion in enumerate(res.caso_json.get("acciones") or []):
            fila = accion.get("fila")
            n_hitos = len(accion.get("hitos") or [])
            texto = limpiar(accion.get("accion"))

            if not texto:
                ref = RefCompromiso(
                    codigo="",
                    caso_id=caso.id,
                    existente_id=None,
                    estado="rechazado",
                    motivo="sin_accion",
                )
                plan.refs_accion[(bloque, indice)] = ref
                secuencia.extend([ref] * max(1, n_hitos))
                seccion.add(
                    ItemPlan(
                        entidad="compromiso",
                        accion="reject",
                        clave=f"accion_fila_{fila}",
                        fila=fila,
                        motivo="sin_accion",
                        detalle={"caso_id": caso.id},
                    )
                )
                continue

            normalizado = normalizar(texto)
            previo = existentes.get(normalizado)
            if previo is not None:
                ref = RefCompromiso(
                    codigo=previo.codigo_compromiso,
                    caso_id=caso.id,
                    existente_id=previo.id,
                    estado="existente",
                )
                plan.refs_accion[(bloque, indice)] = ref
                plan.ids_compromiso[previo.codigo_compromiso] = previo.id
                secuencia.extend([ref] * max(1, n_hitos))
                seccion.add(
                    ItemPlan(
                        entidad="compromiso",
                        accion="omit",
                        clave=previo.codigo_compromiso,
                        fila=fila,
                        motivo="ya_existe",
                        detalle={"caso_id": caso.id},
                        existente_id=previo.id,
                    )
                )
                continue

            fecha_inicio, motivo_fecha = _fecha_inicio_compromiso(res.caso_json, caso)
            codigo = f"{caso.codigo_caso}_COMP{contador:03d}"
            if fecha_inicio is None:
                ref = RefCompromiso(
                    codigo=codigo,
                    caso_id=caso.id,
                    existente_id=None,
                    estado="rechazado",
                    motivo=motivo_fecha or "sin_fecha_inicio",
                )
                plan.refs_accion[(bloque, indice)] = ref
                secuencia.extend([ref] * max(1, n_hitos))
                seccion.add(
                    ItemPlan(
                        entidad="compromiso",
                        accion="reject",
                        clave=f"{caso.codigo_caso}|{texto[:60]}",
                        fila=fila,
                        motivo=motivo_fecha or "sin_fecha_inicio",
                        detalle={
                            "caso_id": caso.id,
                            "detalle": "Sin fecha_inicio en el caso ni fecha_planificada ISO "
                            "en sus hitos.",
                        },
                    )
                )
                seccion.advertencias.add(
                    "compromiso_sin_fecha_inicio",
                    "Compromisos rechazados por no tener fecha de inicio demostrable.",
                    fila,
                )
                continue

            contador += 1
            unidad_id, aviso_unidad = resolver_unidad(
                accion.get("area_responsable_raw"),
                ctx.unidades,
                caso.unidad_responsable_id,
            )
            if (
                aviso_unidad
                and unidad_id is not None
                and caso.unidad_responsable_id is not None
            ):
                if aviso_unidad == "unidad no resuelta, se usó la del caso":
                    seccion.advertencias.add(
                        "unidad_no_resuelta",
                        "Unidad no resuelta: se usó la del caso.",
                        fila,
                    )

            focal_id, focal_texto = resolver_usuario(
                accion.get("punto_focal_raw"), ctx.usuarios
            )
            if focal_texto:
                seccion.advertencias.add(
                    "usuario_no_resuelto",
                    "Nombres de usuario sin coincidencia en core.usuarios: se guarda el texto.",
                    fila,
                )

            ref = RefCompromiso(
                codigo=codigo,
                caso_id=caso.id,
                existente_id=None,
                estado="planificado",
            )
            plan.refs_accion[(bloque, indice)] = ref
            plan.ids_compromiso[codigo] = ""
            secuencia.extend([ref] * max(1, n_hitos))
            seccion.add(
                ItemPlan(
                    entidad="compromiso",
                    accion="insert",
                    clave=codigo,
                    fila=fila,
                    ref=caso.id,
                    datos={
                        "codigo_compromiso": codigo,
                        "caso_id": caso.id,
                        "unidad_responsable_id": unidad_id,
                        "fecha_inicio": fecha_inicio,
                        "accion_compromiso": texto,
                        "tipo_compromiso": "Actividad",
                        "estado_id": 1,
                        "demanda_id": None,
                        "punto_focal_usuario_id": focal_id,
                        "punto_focal_texto": truncar(
                            focal_texto, MAX_TEXTO_PUNTO_FOCAL
                        ),
                        "tematica_equipo": truncar(tematica, MAX_TEMATICA_EQUIPO),
                        "origen_dato": "importacion",
                    },
                )
            )

        plan.secuencias_nudo[bloque] = secuencia


# ---------------------------------------------------------------------------
# Construcción del plan: hitos
# ---------------------------------------------------------------------------
def _plan_hitos(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
    resoluciones: dict[int, ResolucionCaso],
) -> None:
    """Planifica `core.hitos_compromiso`.

    Idempotencia por `(compromiso_id, normalizar(descripcion_hito))`, **no** por
    `codigo_hito`: los hitos ya existentes usan códigos derivados
    (`..._COMP001_H001`) mientras el Excel dice «Hito 1».
    """
    seccion = plan.seccion("hitos")

    for bloque, res in resoluciones.items():
        if res.estado != "operable" or res.caso_bd is None:
            continue
        caso = res.caso_bd

        for indice, accion in enumerate(res.caso_json.get("acciones") or []):
            hitos = accion.get("hitos") or []
            if not hitos:
                continue
            ref = plan.refs_accion.get((bloque, indice))
            if ref is None:
                continue

            if ref.estado == "rechazado":
                for hito in hitos:
                    seccion.add(
                        ItemPlan(
                            entidad="hito",
                            accion="omit",
                            clave=f"hito_fila_{hito.get('fila')}",
                            fila=hito.get("fila"),
                            motivo="compromiso_rechazado",
                            detalle={"caso_id": caso.id, "compromiso": ref.codigo},
                        )
                    )
                seccion.advertencias.add(
                    "hito_compromiso_rechazado",
                    "Hitos cuya acción padre fue rechazada.",
                    hitos[0].get("fila"),
                )
                continue

            existentes = ctx.hitos.get(ref.existente_id, {}) if ref.existente_id else {}
            contador = _siguiente_numero(
                (h.codigo_hito for h in existentes.values()), r"_H(\d+)$"
            )

            for hito in hitos:
                fila = hito.get("fila")
                descripcion = limpiar(hito.get("descripcion_hito"))
                if not descripcion:
                    seccion.add(
                        ItemPlan(
                            entidad="hito",
                            accion="reject",
                            clave=f"hito_fila_{fila}",
                            fila=fila,
                            motivo="sin_descripcion",
                            detalle={"caso_id": caso.id, "compromiso": ref.codigo},
                        )
                    )
                    continue

                normalizado = normalizar(descripcion)
                previo = existentes.get(normalizado)
                if previo is not None:
                    seccion.add(
                        ItemPlan(
                            entidad="hito",
                            accion="omit",
                            clave=descripcion[:80],
                            fila=fila,
                            motivo="ya_existe",
                            detalle={"caso_id": caso.id, "compromiso": ref.codigo},
                            existente_id=previo.id,
                        )
                    )
                    continue

                estado_raw = (hito.get("estado") or {}).get("raw")
                estado_id, aviso_estado = mapear_estado_hito(estado_raw)
                if aviso_estado:
                    if limpiar(estado_raw) is None:
                        seccion.advertencias.add(
                            "hito_estado_vacio",
                            "Hitos sin estado: se registran como 1 (Registrado).",
                            fila,
                        )
                    else:
                        seccion.advertencias.add(
                            "hito_estado_sin_equivalencia",
                            f"Estado de hito sin equivalencia: {estado_raw!r}",
                            fila,
                        )

                planificada = hito.get("fecha_planificada") or {}
                if planificada.get("estado") == "fecha":
                    fecha_vencimiento = parsear_fecha(planificada.get("iso"))
                    fecha_vencimiento_texto = None
                else:
                    fecha_vencimiento = None
                    fecha_vencimiento_texto = truncar(
                        texto_crudo(planificada.get("raw")), MAX_TEXTO_FECHA
                    )
                    if fecha_vencimiento_texto:
                        seccion.advertencias.add(
                            "fecha_planificada_no_tipada",
                            "Fechas planificadas no ISO: se guarda el texto y queda "
                            "NULL la fecha.",
                            fila,
                        )

                real = hito.get("fecha_real") or {}
                if real.get("estado") == "fecha":
                    fecha_real = parsear_fecha(real.get("iso"))
                    fecha_real_texto = None
                else:
                    fecha_real = None
                    fecha_real_texto = truncar(
                        texto_crudo(real.get("raw")), MAX_TEXTO_FECHA
                    )
                    if fecha_real_texto:
                        seccion.advertencias.add(
                            "fecha_real_no_tipada",
                            "Fechas reales no ISO: se guarda el texto y queda NULL "
                            "la fecha.",
                            fila,
                        )

                responsable_id, responsable_texto = resolver_usuario(
                    hito.get("responsable_raw"), ctx.usuarios
                )
                if responsable_texto:
                    seccion.advertencias.add(
                        "usuario_no_resuelto",
                        "Nombres de usuario sin coincidencia en core.usuarios: se "
                        "guarda el texto.",
                        fila,
                    )

                codigo_hito = f"{ref.codigo}_H{contador:03d}"
                contador += 1
                seccion.add(
                    ItemPlan(
                        entidad="hito",
                        accion="insert",
                        clave=codigo_hito,
                        fila=fila,
                        ref=ref.codigo,
                        datos={
                            "compromiso_id": ref.existente_id,
                            "compromiso_ref": ref.codigo
                            if ref.existente_id is None
                            else None,
                            "codigo_hito": codigo_hito,
                            "descripcion_hito": descripcion,
                            "estado_id": estado_id,
                            "fecha_vencimiento": fecha_vencimiento,
                            "fecha_vencimiento_texto": fecha_vencimiento_texto,
                            "fecha_real": fecha_real,
                            "fecha_real_texto": fecha_real_texto,
                            "responsable_usuario_id": responsable_id,
                            "responsable_texto": truncar(
                                responsable_texto, MAX_TEXTO_RESPONSABLE
                            ),
                            "origen_dato": "importacion",
                        },
                    )
                )


# ---------------------------------------------------------------------------
# Construcción del plan: nudos críticos
# ---------------------------------------------------------------------------
def _a_entero(valor: Any) -> int | None:
    """Entero tolerante (filas y columnas del Excel pueden venir como texto)."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    try:
        return int(str(valor).strip())
    except (TypeError, ValueError):
        return None


def _origen_ref_nudo(nudo: dict[str, Any], fila: int) -> str:
    """Identidad de la celda de origen: `MATRIZ-N{fila:04d}-C{col_nudo:02d}`.

    La pareja `(fila, col_nudo)` es única en las 184 celdas del insumo, así que
    sirve como clave de idempotencia de `core.caso_nudo_critico`.
    """
    columna = _a_entero(nudo.get("col_nudo")) or 0
    return f"MATRIZ-N{fila:04d}-C{columna:02d}"


def _indice_casos_por_numero(
    insumos: Insumos,
) -> dict[int, dict[str, Any]]:
    """N° de reporte -> caso de la hoja principal, descartando el bloque 128."""
    indice: dict[int, dict[str, Any]] = {}
    for caso_json in insumos.casos:
        if _a_entero(caso_json.get("fila_inicio")) == BLOQUE_DUPLICADO:
            continue
        numero = _a_entero(caso_json.get("numero_excel"))
        if numero is None:
            continue
        indice.setdefault(numero, caso_json)
    return indice


def _ref_de_fila(
    caso_json: dict[str, Any], bloque: int, fila: int, plan: Plan
) -> RefCompromiso | None:
    """Compromiso cuyo hito ocupa exactamente esa fila (o acción sin hitos)."""
    for indice, accion in enumerate(caso_json.get("acciones") or []):
        hitos = accion.get("hitos") or []
        if any(_a_entero(h.get("fila")) == fila for h in hitos):
            return plan.refs_accion.get((bloque, indice))
        if not hitos and _a_entero(accion.get("fila")) == fila:
            return plan.refs_accion.get((bloque, indice))
    return None


def _plan_nudos(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
    resoluciones: dict[int, ResolucionCaso],
) -> None:
    """Planifica `core.caso_nudo_critico` (una fila por celda no vacía).

    * El caso se resuelve por `numero_excel` de la hoja «Reporte de avance»,
      excluyendo el bloque duplicado 128; `bloque_inicio` del nudo SÓLO se usa
      para el respaldo posicional y como trazabilidad.
    * `descripcion` (el nudo) y `seguimiento` pueden faltar por separado; sólo
      se rechaza la celda vacía.
    * Identidad: `origen_ref`; el contenido literal idéntico se colapsa.
    """
    seccion = plan.seccion("nudos")
    por_numero = _indice_casos_por_numero(insumos)
    planificadas: dict[tuple[Any, ...], str] = {}

    for nudo in insumos.auxiliares.get("nudos") or []:
        fila = _a_entero(nudo.get("fila"))
        numero = _a_entero(nudo.get("numero_excel"))
        descripcion = limpiar(nudo.get("nudo"))
        seguimiento = limpiar(nudo.get("seguimiento"))
        etiqueta = f"nudo_fila_{fila}"

        if descripcion is None and seguimiento is None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="reject",
                    clave=etiqueta,
                    fila=fila,
                    motivo="sin_contenido",
                    detalle={"detalle": "Celda sin nudo y sin seguimiento."},
                )
            )
            seccion.advertencias.add(
                "nudo_sin_contenido",
                "Celdas de la matriz vacías: no hay nada que cargar.",
                fila,
            )
            continue

        if fila is None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="reject",
                    clave=etiqueta,
                    fila=None,
                    motivo="sin_fila",
                    detalle={"detalle": "Celda sin fila numérica."},
                )
            )
            continue

        if numero is None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="reject",
                    clave=etiqueta,
                    fila=fila,
                    motivo="sin_numero_excel",
                    detalle={
                        "detalle": "Sin numero_excel no se puede resolver el caso."
                    },
                )
            )
            seccion.advertencias.add("nudo_sin_numero", "Nudos sin numero_excel.", fila)
            continue

        caso_json = por_numero.get(numero)
        if caso_json is None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="reject",
                    clave=etiqueta,
                    fila=fila,
                    motivo="numero_sin_caso",
                    detalle={"detalle": f"N° {numero} no existe en casos.json."},
                )
            )
            continue

        bloque = _a_entero(caso_json.get("fila_inicio"))
        res = resoluciones.get(bloque) if bloque is not None else None
        if res is None or res.estado != "operable":
            motivo = (
                "caso_sin_destino"
                if bloque in BLOQUES_SIN_DESTINO
                else (res.motivo if res is not None else "caso_no_resuelto")
            )
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="omit",
                    clave=etiqueta,
                    fila=fila,
                    motivo=motivo,
                    detalle={"numero_excel": numero, "bloque": bloque},
                )
            )
            if bloque in BLOQUES_SIN_DESTINO:
                seccion.advertencias.add(
                    "nudo_caso_sin_destino",
                    "Nudos de casos sin destino: se omiten.",
                    fila,
                )
            else:
                seccion.advertencias.add(
                    "nudo_caso_no_operable",
                    "Nudos de casos anulados, duplicados o sin mapeo: se omiten.",
                    fila,
                )
            continue

        assert res.caso_bd is not None
        caso_id = res.caso_bd.id

        ref = _ref_de_fila(caso_json, bloque, fila, plan)
        if ref is None:
            bloque_reporte = _a_entero(nudo.get("bloque_inicio"))
            secuencia = plan.secuencias_nudo.get(bloque) or []
            if bloque_reporte is not None:
                indice = fila - bloque_reporte
                if 0 <= indice < len(secuencia):
                    ref = secuencia[indice]
                    seccion.advertencias.add(
                        "nudo_vinculo_posicional",
                        "Nudos vinculados por posición en el bloque del reporte (la "
                        "fila del nudo no coincide con la del hito).",
                        fila,
                    )

        if ref is None:
            seccion.advertencias.add(
                "nudo_sin_compromiso",
                "Nudos sin vínculo a una acción: se guardan con compromiso_id NULL.",
                fila,
            )
        elif ref.estado == "rechazado":
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="omit",
                    clave=etiqueta,
                    fila=fila,
                    motivo="compromiso_rechazado",
                    detalle={"compromiso": ref.codigo},
                )
            )
            seccion.advertencias.add(
                "nudo_compromiso_rechazado",
                "Nudos cuya acción de origen fue rechazada.",
                fila,
            )
            continue

        semana_desde = parsear_fecha(nudo.get("semana_desde"))
        if semana_desde is None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="reject",
                    clave=etiqueta,
                    fila=fila,
                    motivo="semana_no_parseada",
                    detalle={
                        "semana_desde": nudo.get("semana_desde"),
                        "semana_hasta": nudo.get("semana_hasta"),
                    },
                )
            )
            seccion.advertencias.add(
                "nudo_semana_no_parseada", "Nudos sin semana_desde ISO.", fila
            )
            continue

        origen_ref = _origen_ref_nudo(nudo, fila)
        if origen_ref in ctx.nudos:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="omit",
                    clave=origen_ref,
                    fila=fila,
                    motivo="ya_existe",
                    detalle={"origen_ref": origen_ref},
                )
            )
            continue

        # Dedupe por contenido literal idéntico dentro de la corrida.
        clave_contenido = (
            caso_id,
            ref.codigo if ref is not None else None,
            semana_desde,
            normalizar(descripcion),
            normalizar(seguimiento),
        )
        previa = planificadas.get(clave_contenido)
        if previa is not None:
            seccion.add(
                ItemPlan(
                    entidad="nudo",
                    accion="omit",
                    clave=etiqueta,
                    fila=fila,
                    motivo="repetido_identico",
                    detalle={"origen_ref": previa, "duplicado_de": previa},
                )
            )
            seccion.advertencias.add(
                "nudo_repetido_identico",
                "Celdas con contenido idéntico (caso, compromiso, semana, nudo y "
                "seguimiento): se cargan una sola vez.",
                fila,
            )
            continue

        planificadas[clave_contenido] = origen_ref
        existente_id = ref.existente_id if ref is not None else None
        seccion.add(
            ItemPlan(
                entidad="nudo",
                accion="insert",
                clave=origen_ref,
                fila=fila,
                ref=origen_ref,
                datos={
                    "caso_id": caso_id,
                    "compromiso_id": existente_id,
                    "compromiso_ref": ref.codigo
                    if ref is not None and existente_id is None
                    else None,
                    "semana_desde": semana_desde,
                    "semana_hasta": parsear_fecha(nudo.get("semana_hasta")),
                    "descripcion": descripcion,
                    "seguimiento": seguimiento,
                    "origen_ref": origen_ref,
                    "origen_dato": "importacion",
                },
            )
        )


# ---------------------------------------------------------------------------
# Construcción del plan: alertas tempranas
# ---------------------------------------------------------------------------
def _plan_alertas(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
) -> None:
    """Planifica `core.alertas_tempranas` (idempotencia: `codigo_alerta`).

    La hoja no trae caso: `caso_id` queda NULL y se registra como decisión
    pendiente. `nivel_alerta_id` tampoco tiene equivalencia 1:1.
    """
    seccion = plan.seccion("alertas")
    vistos: set[str] = set()

    for alerta in insumos.auxiliares.get("alertas") or []:
        fila = _a_entero(alerta.get("fila"))
        codigo_reporte = limpiar(alerta.get("codigo_reporte"))
        if codigo_reporte:
            codigo = codigo_reporte
        else:
            codigo = f"MATRIZ-A{fila:04d}" if fila is not None else "MATRIZ-A0000"
            seccion.advertencias.add(
                "alerta_codigo_generado",
                "Alertas sin codigo_reporte: se genera MATRIZ-A{fila:04d}.",
                fila,
            )

        if codigo in ctx.alertas or codigo in vistos:
            existente = ctx.alertas.get(codigo)
            seccion.add(
                ItemPlan(
                    entidad="alerta",
                    accion="omit",
                    clave=codigo,
                    fila=fila,
                    motivo="ya_existe",
                    detalle={"codigo_alerta": codigo},
                    existente_id=existente.id if existente is not None else None,
                )
            )
            continue

        fecha_reporte = parsear_fecha(alerta.get("fecha_iso"))
        if fecha_reporte is None:
            seccion.add(
                ItemPlan(
                    entidad="alerta",
                    accion="reject",
                    clave=codigo,
                    fila=fila,
                    motivo="sin_fecha",
                    detalle={"fecha_texto": alerta.get("fecha_texto")},
                )
            )
            continue

        sectorista_id, sectorista_texto = resolver_usuario(
            alerta.get("responsable_raw"), ctx.usuarios
        )
        if sectorista_texto:
            seccion.advertencias.add(
                "usuario_no_resuelto",
                "Nombres de usuario sin coincidencia en core.usuarios: se guarda el texto.",
                fila,
            )

        distrito_id, aviso_distrito = resolver_distrito(
            alerta.get("region"),
            alerta.get("provincia"),
            alerta.get("distrito"),
            ctx.distritos,
        )
        if aviso_distrito:
            seccion.advertencias.add(
                "distrito_no_resuelto",
                "Distritos de alerta sin coincidencia única: se deja NULL.",
                fila,
            )

        vistos.add(codigo)
        seccion.add(
            ItemPlan(
                entidad="alerta",
                accion="insert",
                clave=codigo,
                fila=fila,
                datos={
                    "codigo_alerta": codigo,
                    "codigo_legado": codigo_reporte,
                    "caso_id": None,
                    "fecha_reporte": fecha_reporte,
                    "titulo": limpiar(alerta.get("titulo")),
                    "situacion_actual": limpiar(alerta.get("resumen_ejecutivo")),
                    "hechos_recientes": limpiar(alerta.get("contenido")),
                    "acciones_oaipcs": limpiar(
                        alerta.get("conclusiones_recomendaciones")
                    ),
                    "fuente_tipo": limpiar(alerta.get("tipo")),
                    "fuente_descripcion": limpiar(alerta.get("tipo_alerta_raw")),
                    "sectorista_usuario_id": sectorista_id,
                    "distrito_id": distrito_id,
                    "nivel_alerta_id": None,
                    "origen_dato": "importacion",
                },
            )
        )


# ---------------------------------------------------------------------------
# Construcción del plan: reuniones de diálogo
# ---------------------------------------------------------------------------
def _plan_reuniones(
    insumos: Insumos,
    ctx: Contexto,
    opciones: Opciones,
    plan: Plan,
) -> None:
    """Planifica `core.reuniones_dialogo` (idempotencia: `codigo_legado`).

    `tipo_id` queda NULL: Programado/No Programado no es el catálogo de tipos.
    `tipo_raw` se usa sólo para `programada`. La columna «Documentos» es texto,
    no un archivo: se declara como dato sin destino.
    """
    seccion = plan.seccion("reuniones")
    mapa_casos: dict[int, str] = {}
    if opciones.mapa_reuniones:
        crudo = _leer_json(opciones.mapa_reuniones)
        for clave, valor in crudo.items():
            fila_mapa = _a_entero(clave)
            if fila_mapa is not None and limpiar(valor):
                mapa_casos[fila_mapa] = str(valor).strip()

    for reunion in insumos.auxiliares.get("reuniones") or []:
        fila = _a_entero(reunion.get("fila"))
        codigo_legado = f"MATRIZ-RR{fila:04d}" if fila is not None else "MATRIZ-RR0000"

        if codigo_legado in ctx.reuniones:
            existente = ctx.reuniones[codigo_legado]
            seccion.add(
                ItemPlan(
                    entidad="reunion",
                    accion="omit",
                    clave=codigo_legado,
                    fila=fila,
                    motivo="ya_existe",
                    detalle={"codigo_legado": codigo_legado},
                    existente_id=existente.id,
                )
            )
            continue

        estado_fecha = (reunion.get("fecha_estado") or "").strip().lower()
        fecha = parsear_fecha(reunion.get("fecha_iso"))
        if estado_fecha == "rango" or (
            fecha is None and estado_fecha not in ("fecha", "")
        ):
            motivo = "fecha_rango" if estado_fecha == "rango" else "sin_fecha"
            seccion.add(
                ItemPlan(
                    entidad="reunion",
                    accion="reject",
                    clave=codigo_legado,
                    fila=fila,
                    motivo=motivo,
                    detalle={
                        "fecha_texto": reunion.get("fecha_texto"),
                        "fecha_estado": estado_fecha,
                    },
                )
            )
            seccion.advertencias.add(
                "reunion_fecha_no_puntual",
                "Reuniones con fecha en rango o ausente: no se estima una fecha.",
                fila,
            )
            continue
        if fecha is None:
            seccion.add(
                ItemPlan(
                    entidad="reunion",
                    accion="reject",
                    clave=codigo_legado,
                    fila=fila,
                    motivo="sin_fecha",
                    detalle={"fecha_texto": reunion.get("fecha_texto")},
                )
            )
            seccion.advertencias.add(
                "reunion_fecha_no_puntual",
                "Reuniones con fecha en rango o ausente: no se estima una fecha.",
                fila,
            )
            continue

        tipo_raw = limpiar(reunion.get("tipo_raw"))
        if tipo_raw is None:
            programada = True
            seccion.advertencias.add(
                "reunion_tipo_vacio",
                "Reuniones sin tipo: se asume programada=True (default de la columna).",
                fila,
            )
        else:
            programada = normalizar(tipo_raw) == "programado"

        responsable_id, responsable_texto = resolver_usuario(
            reunion.get("responsable_raw"), ctx.usuarios
        )
        if responsable_texto:
            seccion.advertencias.add(
                "usuario_no_resuelto",
                "Nombres de usuario sin coincidencia en core.usuarios: se guarda el texto.",
                fila,
            )

        codigo_caso_mapa = mapa_casos.get(fila) if fila is not None else None
        caso_mapa = (
            ctx.casos_por_codigo.get(codigo_caso_mapa) if codigo_caso_mapa else None
        )

        seccion.add(
            ItemPlan(
                entidad="reunion",
                accion="insert",
                clave=codigo_legado,
                fila=fila,
                datos={
                    "codigo_legado": codigo_legado,
                    "caso_id": caso_mapa.id if caso_mapa is not None else None,
                    "fecha": dt.datetime.combine(fecha, dt.time(0, 0), tzinfo=TZ_LIMA),
                    "programada": programada,
                    "tipo_id": None,
                    "responsable_usuario_id": responsable_id,
                    "region_texto": truncar(
                        limpiar(reunion.get("departamento")), MAX_REGION_TEXTO
                    ),
                    "lugar": limpiar(reunion.get("lugar")),
                    "titulo": limpiar(reunion.get("titulo")),
                    "origen_dato": "importacion",
                },
            )
        )


# ---------------------------------------------------------------------------
# Mapa de bloques: semilla de migration/41 y bloqueantes
# ---------------------------------------------------------------------------
# Copia literal del VALUES de migration/41_matriz_equipo.sql. Se usa sólo para
# poder auditar el plan mientras `core.mapa_matriz_excel` no exista; nunca
# sustituye a la tabla real en un --apply.
SEMILLA_MAPA: tuple[tuple[int, str | None, str, str, str], ...] = (
    (
        3,
        "CS-PA-REG-2024-01",
        "CS-PA-OAT-2024-02",
        "alta",
        "Cabo Blanco / red de cortina.",
    ),
    (
        16,
        "CS-PA-INF-2025-02",
        "CS-PA-INF-2024-01",
        "alta",
        "CODIGO CRUZADO: clausura DPA Los Órganos (Piura).",
    ),
    (
        21,
        "CS-PA-REG-2025-04",
        "CS-PA-INF-2012-01",
        "alta",
        "Reubicación de embarcaciones del Callao.",
    ),
    (
        22,
        "CS-PA-INF-2025-05",
        "CS-PA-INF-2024-02",
        "alta",
        "CODIGO CRUZADO: disputa de la IPA Chorrillos.",
    ),
    (
        25,
        "CS-PA-REG-2020-06",
        "CS-PA-ITE-2026-04",
        "alta",
        "Erizo rojo Marcona / Lomas.",
    ),
    (27, "CS-PA-REG-2025-07", "CS-PA-NOR-2025-01", "media", "Ley 31749 y DS 002-2025."),
    (31, "CS-PA-REG-2024-08", "CS-PA-OAT-2026-01", "alta", "Calamar gigante (pota)."),
    (37, "CS-PA-REG-2026-09", "CS-PA-ITE-2026-01", "alta", "Dragado Bahía del Callao."),
    (38, "CS-PA-REG-2025-10", "CS-PA-GOB-2026-01", "alta", "Tumbes, cinco millas."),
    (39, "CS-PA-REG-2021-11", "CS-PA-DBE-2025-01", "alta", "Maricultura Sechura."),
    (
        42,
        "CS-PA-SOC-2016-12",
        "CS-PA-GOB-2026-02",
        "media",
        "Formalización pesquera Piura/Lambayeque.",
    ),
    (
        47,
        "CS-PA-SOC-2023-14",
        "CS-PA-OAT-2024-01",
        "alta",
        "ANADARKO lotes Z-61/62/63.",
    ),
    (
        48,
        "CS-PA-REG-2022-15",
        "CS-PA-OAT-2026-03",
        "alta",
        "Tiburón y permisos CITES. El bloque 128 repite este caso.",
    ),
    (
        50,
        "CS-PA-REG-2019-17",
        "CS-PA-INF-2025-02",
        "alta",
        "CODIGO CRUZADO: bloque de Chimbote (Áncash).",
    ),
    (
        54,
        "CS-PA-INF-2023-18",
        "CS-PA-ITE-2022-01",
        "alta",
        "Derrame Repsol / La Pampilla.",
    ),
    (
        60,
        "CS-PA-SOC-2022-19",
        "CS-MI-INF-2025-01",
        "alta",
        "AAMEC / Parque Industrial de Ancón.",
    ),
    (
        64,
        "CS-MI-REG-2019-20",
        "CS-MI-ITE-2026-02",
        "alta",
        "Compras MYPErú. Caso anulado en la base: se omite.",
    ),
    (74, "CS-MI-REG-2019-21", "CS-PA-INF-2025-04", "alta", "DPA Huacho."),
    (79, "CS-MI-REG-2020-22", "CS-PA-INF-2017-01", "alta", "DPA Supe."),
    (
        85,
        "CS-PA-REG-2019-23",
        "CS-PA-INF-2025-05",
        "alta",
        "DPA San Juan de Marcona (Ica).",
    ),
    (88, "CS-PA-REG-2019-24", "CS-PA-OAT-2026-02", "alta", "Cuotas de bonito."),
    (
        93,
        "CS-PA-REG-2019-25",
        "CS-PA-OAT-2024-03",
        "alta",
        "Cuotas de jurel y caballa.",
    ),
    (95, "CS-PA-INF-2017-26", "CS-PA-INF-2025-03", "alta", "DPA Faro Matarani."),
    (100, "CS-PA-SOC-2019-27", "CS-PA-INF-2025-06", "alta", "DPA Atico."),
    (106, "CS-PA-SOC-2019-28", "CS-PA-INF-2025-01", "alta", "DPA La Punchana."),
    (110, "CS-PA-INF-2017-29", "CS-MI-ITE-2025-01", "alta", "Gran Mercado de Belén."),
    (
        113,
        "CS-MI-REG-2025-30",
        "CS-PA-INF-2026-01",
        "alta",
        "DPA San José (Lambayeque).",
    ),
    (114, "CS-PA-REG-2020-31", "CS-MI-ITE-2025-02", "alta", "Baterías ETNA (plomo)."),
    (118, None, "CS-PA-OAT-2026-04", "alta", "Anchoveta / pesca juvenil."),
    (122, None, "CS-MI-ITE-2026-01", "alta", "CALCESUR (planta de cal)."),
    (124, None, "CS-PA-INF-2026-02", "alta", "DPA Ilo."),
    (127, None, "CS-MI-ITE-2026-03", "alta", "Aceros Americanos / Chilca."),
    (
        128,
        None,
        "CS-PA-OAT-2026-03",
        "media",
        "DUPLICADO del bloque 48 (N° 15 repetido). Se descarta.",
    ),
    (132, None, "CS-PA-ITE-2026-03", "alta", "Truchas de Pariahuanca."),
)

# Columnas que deben aportar las migraciones 41/42 (orden del informe).
REQUERIDOS_MIGRACIONES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("mapa_matriz_excel", ()),
    ("caso_nudo_critico", ()),
    (
        "casos",
        (
            "estado_actualizacion",
            "nivel_riesgo_inicial_id",
            "tematica_equipo",
            "link_analisis_caso",
        ),
    ),
    (
        "compromisos",
        (
            "demanda_id",
            "punto_focal_usuario_id",
            "punto_focal_texto",
            "tematica_equipo",
        ),
    ),
    (
        "hitos_compromiso",
        (
            "responsable_usuario_id",
            "responsable_texto",
            "fecha_vencimiento_texto",
            "fecha_real_texto",
        ),
    ),
    (
        "reuniones_dialogo",
        (
            "codigo_legado",
            "region_texto",
            "asistencia_registrada",
            "acta_am",
            "relatoria_registrada",
            "publicacion_registrada",
        ),
    ),
)


def _preparar_mapa(ctx: Contexto) -> None:
    """Usa `core.mapa_matriz_excel` o, si no existe, la semilla de migration/41."""
    if ctx.mapa_disponible:
        ctx.mapa_origen = "bd"
        return
    mapa: dict[int, MapaFila] = {}
    for bloque, codigo_excel, caso_codigo, confianza, nota in SEMILLA_MAPA:
        caso = ctx.casos_por_codigo.get(caso_codigo)
        if caso is None:
            continue
        mapa[bloque] = MapaFila(
            bloque_fila=bloque,
            codigo_excel=codigo_excel,
            caso_id=caso.id,
            confianza=confianza,
            nota=nota,
        )
    ctx.mapa = mapa
    ctx.mapa_origen = "semilla_41"


def _verificar_bloqueantes(ctx: Contexto, plan: Plan) -> None:
    """Registra lo que impide un --apply (el plan se calcula igual)."""
    if not ctx.mapa_disponible:
        plan.bloquear(
            "migracion_41",
            "Falta ejecutar migration/41_matriz_equipo.sql: core.mapa_matriz_excel "
            "no existe. El plan del --dry-run usa la SEMILLA de la migración (34 "
            "bloques) y NO es aplicable.",
        )

    faltan: list[str] = []
    for tabla, columnas in REQUERIDOS_MIGRACIONES:
        if tabla not in ctx.tablas:
            faltan.append(f"core.{tabla} (tabla ausente)")
            continue
        for columna in columnas:
            if columna not in ctx.columnas.get(tabla, set()):
                faltan.append(f"core.{tabla}.{columna}")
    if faltan:
        plan.bloquear(
            "esquema_incompleto",
            "Esquema incompleto para --apply: faltan " + ", ".join(faltan) + ".",
        )

    # migration/43: nudos fieles a la matriz (descripcion NULLable + origen_ref).
    if "caso_nudo_critico" in ctx.tablas:
        if "origen_ref" not in ctx.columnas.get("caso_nudo_critico", set()):
            plan.bloquear(
                "migracion_43",
                "core.caso_nudo_critico.origen_ref ausente: falta ejecutar "
                "migration/43_nudos_criticos_fieles.sql.",
            )
        elif ctx.nulabilidad.get("caso_nudo_critico", {}).get("descripcion") != "YES":
            plan.bloquear(
                "migracion_43",
                "core.caso_nudo_critico.descripcion sigue siendo NOT NULL: falta "
                "ejecutar migration/43_nudos_criticos_fieles.sql.",
            )


def construir_plan(insumos: Insumos, ctx: Contexto, opciones: Opciones) -> Plan:
    """Calcula el plan completo. No escribe en la base."""
    plan = Plan()
    _preparar_mapa(ctx)

    resoluciones = _plan_casos(insumos, ctx, opciones, plan)
    plan.resoluciones = resoluciones
    _plan_demandas(insumos, ctx, opciones, plan, resoluciones)
    _plan_compromisos(insumos, ctx, opciones, plan, resoluciones)
    _plan_hitos(insumos, ctx, opciones, plan, resoluciones)
    _plan_nudos(insumos, ctx, opciones, plan, resoluciones)
    _plan_alertas(insumos, ctx, opciones, plan)
    _plan_reuniones(insumos, ctx, opciones, plan)

    _verificar_bloqueantes(ctx, plan)
    _decisiones(plan, insumos, ctx, opciones)
    _datos_sin_destino(plan, insumos, ctx)

    plan.meta = {
        "modo": opciones.modo,
        "fuente": FUENTE_MAPA,
        "mapa_origen": ctx.mapa_origen,
        "mapa_bloques": len(ctx.mapa),
        "casos_json": len(insumos.casos),
        "operables": sum(1 for r in resoluciones.values() if r.estado == "operable"),
        "estados": dict(Counter(r.estado for r in resoluciones.values())),
        "insumos": {
            "casos": insumos.ruta_casos,
            "auxiliares": insumos.ruta_auxiliares,
        },
    }
    return plan


# ---------------------------------------------------------------------------
# Decisiones pendientes y datos sin destino
# ---------------------------------------------------------------------------
def _decisiones(
    plan: Plan, insumos: Insumos, ctx: Contexto, opciones: Opciones
) -> None:
    """Registra las decisiones que este importador no puede tomar solo."""
    decisiones: list[dict[str, Any]] = []
    alertas_insert = sum(
        1 for i in plan.seccion("alertas").items if i.accion == "insert"
    )
    reuniones_insert = [
        i for i in plan.seccion("reuniones").items if i.accion == "insert"
    ]
    reuniones_sin_caso = sum(
        1 for i in reuniones_insert if i.datos.get("caso_id") is None
    )
    nudos_repetidos = sum(
        1 for i in plan.seccion("nudos").items if i.motivo == "repetido_identico"
    )
    nudos_posicionales = next(
        (
            g["ocurrencias"]
            for g in plan.seccion("nudos").advertencias.lista()
            if g["codigo"] == "nudo_vinculo_posicional"
        ),
        0,
    )
    demandas_sin_tematica = sum(
        1
        for i in plan.seccion("demandas").items
        if i.accion == "insert" and i.datos.get("tematica_id") is None
    )
    demandas_rechazadas_tematica = sum(
        1 for i in plan.seccion("demandas").items if i.motivo == "sin_tematica"
    )

    decisiones.append(
        {
            "id": "D01",
            "titulo": "Alertas sin caso",
            "detalle": (
                f"{alertas_insert} alertas se importan con caso_id NULL: la hoja de "
                "alertas no trae caso y no hay vínculo verificable en el Excel."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D02",
            "titulo": "Reuniones sin caso",
            "detalle": (
                f"{reuniones_sin_caso} de {len(reuniones_insert)} reuniones quedan con "
                "caso_id NULL. Con --mapa-reuniones {fila: codigo_caso} se pueden vincular."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D03",
            "titulo": "Nivel de alerta sin equivalencia",
            "detalle": (
                "nivel_alerta_id queda NULL: REACTIVA/PREVENTIVA no es 1:1 con los niveles "
                "del catálogo de riesgos (Bajo/Intermedio/Inminente/Crítico)."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D04",
            "titulo": "Tipo de reunión sin equivalencia",
            "detalle": (
                "tipo_id queda NULL: la hoja sólo distingue Programado/No Programado, que no "
                "es el catálogo cat_tipos_reunion (Asistencia_Tecnica, "
                "Reunion_Preparatoria, Reunion_Ordinaria_Plenaria, Otra)."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D05",
            "titulo": "Bloques sin destino",
            "detalle": (
                "Los bloques 20, 43 y 49 no tienen destino en la base (N° de reporte 20, "
                "13 y 16). Se reportan como sin_destino y no crean casos."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D06",
            "titulo": "Bloque 128 duplicado",
            "detalle": (
                "El bloque 128 repite el N° 15 del bloque 48 (mismo enlace Canva). Se omite "
                "siempre, también con --incluir-anulados."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D07",
            "titulo": "Caso anulado (bloque 64)",
            "detalle": (
                "El bloque 64 mapea a CS-MI-ITE-2026-02, con anulado_en no nulo: se omite "
                "salvo --incluir-anulados."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D08",
            "titulo": "Casos sin bloque en el Excel",
            "detalle": (
                "CS-PA-INF-2022-01 y CS-PA-ITE-2026-02 existen en core.casos y no tienen "
                "bloque en la matriz: no se tocan."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D09",
            "titulo": "Documentos de reunión sin destino",
            "detalle": (
                "La columna Documentos de reuniones es una etiqueta de texto, no un archivo: "
                "no se carga en core.documentos ni en otra tabla."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D10",
            "titulo": "Vínculo nudo -> compromiso por posición",
            "detalle": (
                "El nudo se vincula al compromiso cuyo hito tiene la misma fila; si la "
                "acción no tiene hitos, a la acción con esa fila. Cuando esa coincidencia "
                "falla se aplica el respaldo posicional dentro del bloque del reporte "
                f"({nudos_posicionales} nudos). Es un vínculo por posición, no una clave del "
                "Excel: debe revisarse."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D11",
            "titulo": "Temáticas fuera del catálogo",
            "detalle": (
                f"{demandas_sin_tematica} demandas quedan con tematica_id NULL"
                + (
                    f" y {demandas_rechazadas_tematica} se rechazan por NOT NULL"
                    if demandas_rechazadas_tematica
                    else ""
                )
                + ". El vocabulario del equipo (Recursos y Regulación, Socio-Ambiental, "
                "Ordenamiento...) se guarda como texto libre en los campos *_equipo; "
                "cat_tematicas no se modifica."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D12",
            "titulo": "Tipo de compromiso fijado",
            "detalle": (
                "Los 8 compromisos existentes usan tipo_compromiso='Actividad'; se usa el "
                "mismo valor para todas las acciones importadas."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D13",
            "titulo": "Demandas sin vínculo a compromiso",
            "detalle": (
                "compromisos.demanda_id queda NULL: el Excel no relaciona cada acción con "
                "una demanda concreta."
            ),
        }
    )
    if plan.bloqueantes:
        decisiones.append(
            {
                "id": "D14",
                "titulo": "Migraciones 41/42 pendientes",
                "detalle": (
                    "El esquema actual no tiene todo lo que el plan necesita; ver "
                    "bloqueantes_apply. Mientras no se apliquen las migraciones, el plan "
                    "es auditable pero no aplicable."
                ),
            }
        )
    decisiones.append(
        {
            "id": "D15",
            "titulo": "Siglas del catálogo de unidades",
            "detalle": (
                "El Excel usa DIPFORPA y el catálogo tiene DPFORPA (id 24): el texto no "
                "coincide y el resolver salta al siguiente token (p. ej. DGPA, id 37). No "
                "se corrige el catálogo; se advierte con unidad_no_resuelta."
            ),
        }
    )
    decisiones.append(
        {
            "id": "D16",
            "titulo": "Identidad de nudos por celda (origen_ref)",
            "detalle": (
                "Cada nudo se importa con origen_ref = MATRIZ-N{fila}-C{col}, que identifica "
                "la celda de la matriz: en re-ejecución decide insert vs update. "
                f"{nudos_repetidos} celdas con contenido idéntico se colapsan en una "
                "(repetido_identico), respaldadas por uq_caso_nudo_critico_dedupe."
            ),
        }
    )

    plan.decisiones = decisiones


def _no_vacio(valor: Any) -> bool:
    """Valor presente y que no sea un error de Excel."""
    if valor is None:
        return False
    s = str(valor).strip()
    return bool(s) and not s.startswith("#")


def _contar_no_vacios(valores: Iterable[Any]) -> int:
    return sum(1 for valor in valores if _no_vacio(valor))


def _datos_sin_destino(plan: Plan, insumos: Insumos, ctx: Contexto) -> None:
    """Inventario de campos del Excel que no tienen columna destino."""
    acciones = [a for caso in insumos.casos for a in (caso.get("acciones") or [])]
    reportes = [caso.get("reporte_avance") or {} for caso in insumos.casos]
    reuniones = insumos.auxiliares.get("reuniones") or []
    bloques = insumos.auxiliares.get("bloques_reporte") or []

    datos = [
        {
            "campo": "acciones[].medios_verificacion_raw",
            "ocurrencias": _contar_no_vacios(
                a.get("medios_verificacion_raw") for a in acciones
            ),
            "nota": "Es una instrucción ('Acción 1: Adjuntar'), no un adjunto ni una URI.",
        },
        {
            "campo": "acciones[].documentos_raw",
            "ocurrencias": _contar_no_vacios(a.get("documentos_raw") for a in acciones),
            "nota": "Etiqueta de columna del Excel; no identifica archivos.",
        },
        {
            "campo": "acciones[].valores_extra_en_span",
            "ocurrencias": _contar_no_vacios(
                a.get("valores_extra_en_span") for a in acciones
            ),
            "nota": "Celdas combinadas con más de un valor: no hay columna para el residuo.",
        },
        {
            "campo": "casos[].narrativa_cronologica",
            "ocurrencias": _contar_no_vacios(
                c.get("narrativa_cronologica") for c in insumos.casos
            ),
            "nota": "Texto largo sin columna en core.casos.",
        },
        {
            "campo": "casos[].descripcion_riesgo",
            "ocurrencias": _contar_no_vacios(
                c.get("descripcion_riesgo") for c in insumos.casos
            ),
            "nota": "core.casos no tiene descripcion_riesgo; sólo alertas_tempranas.",
        },
        {
            "campo": "casos[].actores_estado_raw / actores_sociedad_raw",
            "ocurrencias": sum(
                int(_no_vacio(c.get("actores_estado_raw")))
                + int(_no_vacio(c.get("actores_sociedad_raw")))
                for c in insumos.casos
            ),
            "nota": "Texto libre de actores; core.actores no tiene columna equivalente.",
        },
        {
            "campo": "casos[].prioridad",
            "ocurrencias": _contar_no_vacios(
                (c.get("prioridad") or {}).get("raw") for c in insumos.casos
            ),
            "nota": "Columna D del Excel (Urgente/Moderado/Bajo); no se actualiza "
            "core.casos.prioridad_id.",
        },
        {
            "campo": "casos[].nombre_oficial_metadatos",
            "ocurrencias": _contar_no_vacios(
                c.get("nombre_oficial_metadatos") for c in insumos.casos
            ),
            "nota": "Nombre de otra hoja; no se sobrescribe casos.nombre.",
        },
        {
            "campo": "reporte_avance (alcance, subsector, validación, problemática)",
            "ocurrencias": sum(
                _contar_no_vacios(
                    [
                        r.get("alcance_geografico_raw"),
                        r.get("subsector_raw"),
                        r.get("validacion_hito_raw"),
                        r.get("problematica_resumen"),
                    ]
                )
                for r in reportes
            ),
            "nota": "No hay columnas de destino en core.casos; subsector sólo aplica a "
            "otras tablas.",
        },
        {
            "campo": "reuniones[].documentos",
            "ocurrencias": _contar_no_vacios(r.get("documentos") for r in reuniones),
            "nota": "Etiqueta de texto: no se crea documento.",
        },
        {
            "campo": "reuniones[].asistencia / am / relatoria / publicacion",
            "ocurrencias": sum(
                _contar_no_vacios(
                    [
                        r.get("asistencia"),
                        r.get("am"),
                        r.get("relatoria"),
                        r.get("publicacion"),
                    ]
                )
                for r in reuniones
            ),
            "nota": "Columnas de migration/42 con semántica no confirmada (texto vs "
            "booleano): no se cargan para no adivinar.",
        },
        {
            "campo": "bloques_reporte[].resumen_ejecutivo",
            "ocurrencias": _contar_no_vacios(
                b.get("resumen_ejecutivo") for b in bloques
            ),
            "nota": "La mayoría son nulos o #REF!; sólo se carga el texto válido de "
            "casos.json.",
        },
    ]

    plan.datos_sin_destino = {"campos": datos}


def _motivos(seccion: SeccionPlan) -> dict[str, dict[str, int]]:
    omitidos: Counter[str] = Counter()
    rechazados: Counter[str] = Counter()
    for item in seccion.items:
        motivo = item.motivo or item.accion
        if item.accion == "omit":
            omitidos[motivo] += 1
        elif item.accion == "reject":
            rechazados[motivo] += 1
    return {
        "omitidos": dict(omitidos),
        "rechazados": dict(rechazados),
    }


def _detalle_texto(detalle: Any) -> str:
    if not isinstance(detalle, dict):
        return str(detalle) if detalle else ""
    if detalle.get("detalle"):
        return str(detalle["detalle"])
    partes = [f"{k}: {v}" for k, v in detalle.items() if v not in (None, "")]
    return "; ".join(partes)


def _secciones_informe(
    plan: Plan, opciones: Opciones
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    secciones: dict[str, dict[str, Any]] = {}
    total = {
        "insertados": 0,
        "actualizados": 0,
        "omitidos": 0,
        "rechazados": 0,
        "total": 0,
    }
    for nombre in SECCIONES:
        if opciones.solo and nombre != opciones.solo:
            continue
        seccion = plan.seccion(nombre)
        cifras = seccion.contar()
        cifras["total"] = len(seccion.items)
        for clave in ("insertados", "actualizados", "omitidos", "rechazados", "total"):
            total[clave] += cifras[clave]
        secciones[nombre] = {
            "cifras": cifras,
            "motivos": _motivos(seccion),
            "rechazos": [
                {
                    "clave": item.clave,
                    "fila": item.fila,
                    "motivo": item.motivo or item.accion,
                    "detalle": _detalle_texto(item.detalle),
                }
                for item in seccion.items
                if item.accion == "reject"
            ],
            "advertencias": seccion.advertencias.lista(),
        }
    return secciones, total


def construir_informe(
    plan: Plan, insumos: Insumos, ctx: Contexto, opciones: Opciones
) -> dict[str, Any]:
    """Arma el informe completo (JSON y Markdown) del plan."""
    secciones, total = _secciones_informe(plan, opciones)
    coherente = not plan.fatal
    codigo_salida = 0 if coherente else 1
    if opciones.modo == "apply" and plan.bloqueantes:
        codigo_salida = 1

    return {
        "meta": {
            **plan.meta,
            "modo": opciones.modo,
            "config": {
                "actualizar_riesgo": opciones.actualizar_riesgo,
                "incluir_anulados": opciones.incluir_anulados,
                "mapa_reuniones": opciones.mapa_reuniones,
                "solo": opciones.solo,
            },
            "conteos_insumos": plan.meta.get("insumos"),
        },
        "secciones": secciones,
        "total": total,
        "decisiones_pendientes": plan.decisiones,
        "datos_sin_destino": plan.datos_sin_destino.get("campos", []),
        "bloqueantes_apply": plan.bloqueantes,
        "coherente": coherente,
        "codigo_salida": codigo_salida,
        "fatal": plan.fatal,
    }


def escribir_informe(informe: dict[str, Any], ruta: str) -> None:
    """Escribe el informe JSON en disco."""
    carpeta = os.path.dirname(os.path.abspath(ruta))
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(informe, fh, ensure_ascii=False, indent=2, default=str)
        fh.write("\n")


# ---------------------------------------------------------------------------
# Impresión del informe en Markdown
# ---------------------------------------------------------------------------
def _advertencias_globales(informe: dict[str, Any]) -> list[dict[str, Any]]:
    """Une las advertencias de todas las secciones, ordenadas por ocurrencias."""
    grupos: dict[str, dict[str, Any]] = {}
    for datos in informe["secciones"].values():
        for grupo in datos.get("advertencias") or []:
            codigo = grupo["codigo"]
            actual = grupos.get(codigo)
            if actual is None:
                grupos[codigo] = {
                    "codigo": codigo,
                    "detalle": grupo.get("detalle"),
                    "ocurrencias": grupo["ocurrencias"],
                    "filas": list(grupo.get("filas") or []),
                }
            else:
                actual["ocurrencias"] += grupo["ocurrencias"]
                if grupo.get("detalle") and not actual.get("detalle"):
                    actual["detalle"] = grupo["detalle"]
                for fila in grupo.get("filas") or []:
                    if len(actual["filas"]) < 25:
                        actual["filas"].append(fila)
    return sorted(grupos.values(), key=lambda g: (-g["ocurrencias"], g["codigo"]))


def imprimir_markdown(
    informe: dict[str, Any], ruta_informe: str, duracion: float
) -> str:
    """Devuelve el Markdown resumido y lo imprime."""
    meta = informe["meta"]
    lineas: list[str] = ["# Importación MATRIZ OAIPCS 2026 -> core.*", ""]
    lineas.append(f"- Modo: **{meta['modo']}** ({duracion:.2f} s)")
    lineas.append(
        f"- Fuente del mapa: `{meta['fuente']}` desde **{meta['mapa_origen']}**"
    )
    estados = dict(sorted((meta.get("estados") or {}).items()))
    lineas.append(
        f"- Casos operables: {meta.get('operables', 0)} (bloques por estado: {estados})"
    )
    lineas.append("")

    lineas.append("## Cifras por sección")
    lineas.append("")
    lineas.append(
        "| sección | insertados | actualizados | omitidos | rechazados | total |"
    )
    lineas.append("| --- | ---: | ---: | ---: | ---: | ---: |")
    for nombre, datos in informe["secciones"].items():
        c = datos["cifras"]
        lineas.append(
            f"| {nombre} | {c['insertados']} | {c['actualizados']} | "
            f"{c['omitidos']} | {c['rechazados']} | {c['total']} |"
        )
    total = informe["total"]
    lineas.append(
        f"| **total** | **{total['insertados']}** | **{total['actualizados']}** | "
        f"**{total['omitidos']}** | **{total['rechazados']}** | |"
    )
    lineas.append("")

    lineas.append("## Motivos de omisión y rechazo")
    lineas.append("")
    for nombre, datos in informe["secciones"].items():
        motivos = datos["motivos"]
        if not motivos["omitidos"] and not motivos["rechazados"]:
            continue
        lineas.append(f"- **{nombre}**")
        if motivos["omitidos"]:
            lineas.append(f"  - omitidos: {motivos['omitidos']}")
        if motivos["rechazados"]:
            lineas.append(f"  - rechazados: {motivos['rechazados']}")
    lineas.append("")

    lineas.append("## Detalle de rechazos (primeros 25)")
    lineas.append("")
    lineas.append("| sección | clave | fila | motivo | detalle |")
    lineas.append("| --- | --- | ---: | --- | --- |")
    mostrados = 0
    for nombre, datos in informe["secciones"].items():
        if mostrados >= 25:
            break
        for rechazo in datos["rechazos"]:
            if mostrados >= 25:
                break
            fila = "" if rechazo.get("fila") is None else rechazo["fila"]
            lineas.append(
                f"| {nombre} | {rechazo.get('clave', '')} | {fila} | "
                f"{rechazo.get('motivo', '')} | {rechazo.get('detalle', '')} |"
            )
            mostrados += 1
    lineas.append("")

    lineas.append("## Decisiones pendientes")
    lineas.append("")
    for decision in informe["decisiones_pendientes"]:
        lineas.append(
            f"- **{decision['id']}** — {decision['titulo']}: {decision['detalle']}"
        )
    lineas.append("")

    lineas.append("## Datos sin destino")
    lineas.append("")
    for dato in informe["datos_sin_destino"]:
        lineas.append(f"- `{dato['campo']}` ({dato['ocurrencias']}): {dato['nota']}")
    lineas.append("")

    if informe["bloqueantes_apply"]:
        lineas.append("## Bloqueantes para --apply")
        lineas.append("")
        for bloqueante in informe["bloqueantes_apply"]:
            lineas.append(f"- {bloqueante['detalle']}")
        lineas.append("")

    advertencias = _advertencias_globales(informe)
    if advertencias:
        lineas.append("## Advertencias")
        lineas.append("")
        for grupo in advertencias:
            filas = grupo.get("filas") or []
            sufijo = f" filas={filas}" if filas else ""
            lineas.append(
                f"- `{grupo['codigo']}` x{grupo['ocurrencias']}: "
                f"{grupo.get('detalle') or ''}{sufijo}"
            )
        lineas.append("")

    lineas.append(
        f"Coherente: **{informe['coherente']}** — código de salida sugerido: "
        f"**{informe['codigo_salida']}**"
    )
    lineas.append(f"Informe JSON: {ruta_informe}")

    texto = "\n".join(lineas)
    print(texto)
    return texto


# ---------------------------------------------------------------------------
# Escritura en la base (sólo con --apply --confirmar)
# ---------------------------------------------------------------------------
TABLA_POR_SECCION = {
    "casos": "casos",
    "demandas": "demandas",
    "compromisos": "compromisos",
    "hitos": "hitos_compromiso",
    "nudos": "caso_nudo_critico",
    "alertas": "alertas_tempranas",
    "reuniones": "reuniones_dialogo",
}


def _insertar(cur: Any, ctx: Contexto, tabla: str, datos: dict[str, Any]) -> str | None:
    """INSERT dinámico limitado a columnas existentes. Devuelve el id."""
    disponibles = ctx.columnas.get(tabla, set())
    columnas = [c for c in datos if c in disponibles]
    if not columnas:
        raise RuntimeError(f"No hay columnas insertables para core.{tabla}")
    marcas = ", ".join(["%s"] * len(columnas))
    sql = (
        f"insert into core.{tabla} ({', '.join(columnas)}) "
        f"values ({marcas}) returning id::text"
    )
    cur.execute(sql, [datos[c] for c in columnas])
    fila = cur.fetchone()
    return None if fila is None else fila[0]


def _actualizar(
    cur: Any, ctx: Contexto, tabla: str, registro_id: str, datos: dict[str, Any]
) -> None:
    """UPDATE dinámico de las columnas existentes."""
    disponibles = ctx.columnas.get(tabla, set())
    columnas = [c for c in datos if c in disponibles]
    if not columnas:
        return
    asignaciones = ", ".join(f"{c} = %s" for c in columnas)
    sql = f"update core.{tabla} set {asignaciones} where id = %s"
    cur.execute(sql, [datos[c] for c in columnas] + [registro_id])


def ejecutar_plan(
    conn: Any, plan: Plan, ctx: Contexto, opciones: Opciones
) -> dict[str, int]:
    """Aplica el plan en una sola transacción (el llamador hace commit/rollback)."""
    if plan.bloqueantes:
        raise RuntimeError(
            "No se puede aplicar: " + "; ".join(b["detalle"] for b in plan.bloqueantes)
        )
    if plan.fatal:
        raise RuntimeError("Plan con errores fatales: " + "; ".join(plan.fatal))

    ids_compromisos: dict[str, str] = {
        codigo: valor for codigo, valor in plan.ids_compromiso.items() if valor
    }
    contadores = Counter()
    cur = conn.cursor()
    try:
        for nombre in SECCIONES:
            tabla = TABLA_POR_SECCION[nombre]
            for item in plan.seccion(nombre).items:
                if item.accion == "update":
                    if item.existente_id:
                        _actualizar(cur, ctx, tabla, item.existente_id, item.datos)
                        contadores[f"{nombre}_actualizados"] += 1
                    continue
                if item.accion != "insert":
                    continue

                datos = dict(item.datos)
                ref = datos.pop("compromiso_ref", None)
                if nombre in ("hitos", "nudos") and datos.get("compromiso_id") is None:
                    if ref:
                        datos["compromiso_id"] = ids_compromisos.get(ref)

                nuevo_id = _insertar(cur, ctx, tabla, datos)
                contadores[f"{nombre}_insertados"] += 1
                if nombre == "compromisos":
                    codigo = datos.get("codigo_compromiso")
                    if codigo and nuevo_id:
                        ids_compromisos[codigo] = nuevo_id
    finally:
        cur.close()
    return dict(contadores)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Importa la matriz OAIPCS 2026 hacia el esquema core (sólo lectura por defecto).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "--dry-run es el modo por defecto: lee la base en modo readonly y no "
            "escribe nada. --apply exige además --confirmar."
        ),
    )
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="planifica sin escribir (defecto)",
    )
    grupo.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="escribe en una transacción única",
    )
    parser.add_argument(
        "--confirmar",
        action="store_true",
        default=False,
        help="obligatorio con --apply",
    )
    parser.add_argument(
        "--actualizar-riesgo",
        action="store_true",
        default=False,
        help="actualiza casos.nivel_riesgo_id con el riesgo actual",
    )
    parser.add_argument(
        "--incluir-anulados",
        action="store_true",
        default=False,
        help="incluye el caso anulado del bloque 64",
    )
    parser.add_argument(
        "--mapa-reuniones",
        default=None,
        metavar="RUTA.json",
        help="JSON {fila: codigo_caso} para vincular reuniones",
    )
    parser.add_argument(
        "--solo",
        default=None,
        choices=list(SECCIONES),
        metavar="SECCION",
        help="limita el informe a una sección (" + ", ".join(SECCIONES) + ")",
    )
    parser.add_argument(
        "--salida",
        default=RUTA_INFORME,
        metavar="RUTA.json",
        help="ruta del informe JSON",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    parser = construir_parser()
    args = parser.parse_args(argv)

    modo = "apply" if args.apply else "dry-run"
    if modo == "apply" and not args.confirmar:
        print(
            "ERROR: --apply exige --confirmar. Se aborta sin abrir transacción.",
            file=sys.stderr,
        )
        return 2

    opciones = Opciones(
        modo=modo,
        confirmar=bool(args.confirmar),
        actualizar_riesgo=bool(args.actualizar_riesgo),
        incluir_anulados=bool(args.incluir_anulados),
        mapa_reuniones=args.mapa_reuniones,
        solo=args.solo,
        salida=args.salida,
    )
    inicio = time.perf_counter()

    insumos = cargar_insumos()
    url = _url_bd()

    conn = conectar(url, solo_lectura=True)
    try:
        ctx = cargar_contexto(conn)
    finally:
        conn.close()

    plan = construir_plan(insumos, ctx, opciones)
    informe = construir_informe(plan, insumos, ctx, opciones)
    escribir_informe(informe, opciones.salida)
    duracion = time.perf_counter() - inicio
    imprimir_markdown(informe, opciones.salida, duracion)

    if modo == "apply" and informe["codigo_salida"] == 0:
        conn_escritura = conectar(url, solo_lectura=False)
        conn_escritura.autocommit = False
        try:
            ejecutar_plan(conn_escritura, plan, ctx, opciones)
            if opciones.confirmar:
                conn_escritura.commit()
            else:
                conn_escritura.rollback()
        except Exception:
            conn_escritura.rollback()
            raise
        finally:
            conn_escritura.close()

    return informe["codigo_salida"]


if __name__ == "__main__":
    sys.exit(main())
