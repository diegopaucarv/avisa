"""Fase 5 — actores, datos personales y membresías.

Tres hojas del legado, tres naturalezas y un orden obligatorio:

* `DIM_Actores` (828) → 828 personas externas (pescadores, dirigentes).
* `DIM_Actores_Estado` (108) → 108 funcionarios de PRODUCE. Los dos censos son
  disjuntos (0 nombres en común), así que no se fusionan (D24): el segundo entra
  con `tipo_actor_id = 1` (Actor del Estado).
* `DIM_ORGANIZACION` (224) → 224 organizaciones.

Total `core.actores`: **1 160**.

Se insertan primero los actores, después `core.organizaciones` (su
`representante_uid` apunta a un actor ya creado), luego la PII y al final las
membresías. La transacción la abre `run.py`, no esta fase.

Correcciones al plan §4.4, todas verificadas contra el dato real:

1. **`codigo_legado` de las organizaciones es `ORG-xxx`, no `Cod_Actor`.** El
   plan propone `Cod_Actor` (c08), pero esa columna identifica al
   **representante**: trae 207 valores distintos para 224 filas y 4 vacíos, y
   además chocaría con el `ACT-xxx` de esa misma persona en una columna UNIQUE
   global. `ID_ORGANIZACION` (c01) sí es único en las 224 filas. El
   representante va a `organizaciones.representante_uid`.
2. **La PII no sale sólo de `DIM_Actores`.** El plan cita 642/508/41, que son
   los datos de esa hoja, no la unión: 747 filas tienen al menos un dato real.
   Sumadas las 100 de `DIM_Actores_Estado` (98 teléfonos, 100 correos, 0 DNI
   porque el DNI es literalmente `'N/D'`) el objetivo son **847**.
3. **`DIM_Actores` repite dos códigos de actor** (`ACT-720` y `ACT-827`, dos
   filas cada uno). `codigo_legado` es UNIQUE, así que el segundo de cada par se
   sufija (`ACT-720-2`), como manda D41. No se descarta ninguna fila: son
   personas distintas con el mismo código.
4. **`valid_from` tiene muy pocas fuentes reales.** Sólo 28 de las 224
   organizaciones traen `Fecha_constitución` (c05) y los bridges de casos
   alcanzan a 25 de los actores que sí resuelven organización. Las membresías que
   no consiguen fecha ni por organización ni por caso se descartan y se
   reportan; nunca se usa `CURRENT_DATE` (D42).

Otras reglas:

* `nivel_gobierno` sólo admite la forma visible del CHECK (`Local`,
  `Sociedad_Civil`, …). `decisions.map_nivel_gobierno` valida y devuelve la
  clave normalizada; aquí se traduce a esa forma y la basura (`Perfil-01`,
  `Sí`) queda NULL (D12).
* `distrito_id` queda NULL siempre: `ID_Ubigeo` es un departamento (`DEP-xx`),
  no un distrito.
* DNI y teléfonos se conservan tal cual (decisión e). No hay fusión por DNI:
  los 45 valores repetidos (100 filas) se cargan sin unir y se encolan como
  `DNI_DUPLICADO` para revisión humana (D43).
* `DIM_Actores.Id_organizacion` (c07) guarda **nombres**, no códigos. Se
  resuelve por código `ORG-xxx` → nombre normalizado → `pg_trgm >= 0.85` → sin
  vínculo y a reporte (D10).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ...decisions import (
    boolean_si_no,
    map_nivel_gobierno,
    map_rol_actor,
    map_tipo_actor,
    norm_key,
    normalize_dni,
    normalize_telefono,
    parse_fecha,
    text,
)
from .. import legacy
from ..context import LoadContext

NUMBER = 5
NAME = "Actores + PII + membresías"

# DIM_Actores
_A_CODIGO = 1
_A_NOMBRE = 2
_A_DNI = 3
_A_TELEFONO = 4
_A_EMAIL = 5
_A_CARGO = 6
_A_ORGANIZACION = 7
_A_ABREVIATURA = 8
_A_TIPO = 9
_A_NIVEL = 10
_A_CATEGORIA = 11
_A_PERFIL = 12
_A_UBIGEO = 13  # DEP-xx: nivel departamento, nunca distrito
_A_FOTO = 14
_A_ACTIVO = 15
_A_DESCRIPCION = 16

# DIM_Actores_Estado (las columnas van corridas respecto de DIM_Actores)
_E_CODIGO = 1
_E_NOMBRE = 2
_E_DNI = 3
_E_TELEFONO = 4
_E_EMAIL = 5
_E_CARGO = 6
_E_TIPO = 10
_E_NIVEL = 11
_E_CATEGORIA = 12
_E_ACTIVO = 15

# DIM_ORGANIZACION
_O_CODIGO = 1
_O_NOMBRE = 2
_O_UBIGEO = 3  # DEP-xx, no se usa
_O_DIRECCION = 4
_O_FECHA = 5
_O_TIPO = 6
_O_SUNARP = 7
_O_REPRESENTANTE = 8
_O_INTEGRANTES = 9
_O_EMBARCACIONES = 10
_O_ARMADORES = 11
_O_FOTO = 12
_O_PERFIL = 13
_O_RUC = 14
_O_ABREVIATURA = 16

# Forma visible que exige el CHECK de core.actores.nivel_gobierno.
_NIVEL_GOBIERNO = {
    "nacional": "Nacional",
    "regional": "Regional",
    "local": "Local",
    "empresa": "Empresa",
    "sociedad_civil": "Sociedad_Civil",
}

_ORIGEN = "AVISA_HISTORICO"
_BASE_LEGAL = "LEGADO_AVISA_2026"
_TIPO_ACTOR_ESTADO = 1
_TIPO_ACTOR_ORGANIZACION = 2
_TIPO_ACTOR_GREMIO = 3
_ROL_NO_DETERMINADO = 7
_UMBRAL_TRGM = 0.85

_AUSENTES = {"n/d", "nd", "-", "sin correo", "sin email", "sin telefono"}


@dataclass
class _Persona:
    """Una fila de los dos censos de personas, ya normalizada."""

    hoja: str
    fila: int
    codigo: str
    nombre: str
    dni: str | None
    telefono_raw: str | None
    email: str | None
    cargo: str | None
    abreviatura: str | None
    tipo_actor_id: int
    nivel_gobierno: str | None
    rol_actor_id: int
    categoria: str | None
    perfil_id: int | None
    foto_url: str | None
    activo: bool
    perfil_descripcion: str | None
    organizacion_ref: str | None
    actor_uid: str | None = None

    @property
    def tiene_pii(self) -> bool:
        return bool(self.dni or self.telefono_raw or self.email)


@dataclass
class _Organizacion:
    """Una fila de `DIM_ORGANIZACION` con su tipo ya resuelto."""

    hoja: str
    fila: int
    codigo: str
    nombre: str
    tipo_organizacion_id: int | None
    tipo_actor_id: int
    abreviatura: str | None
    fecha_constitucion: date | None
    direccion: str | None
    inscripcion_sunarp: str | None
    numero_integrantes: int | None
    n_embarcaciones: int | None
    n_armadores: int | None
    foto_url: str | None
    perfil: str | None
    ruc: str | None
    representante_codigo: str | None
    actor_uid: str | None = None


def _recorta(valor: str | None, limite: int) -> str | None:
    """Recorta al ancho de la columna de v9."""
    if valor is None:
        return None
    return valor[:limite]


def _nivel(valor: str | None) -> str | None:
    """`nivel_gobierno` en la forma que admite el CHECK de v9.

    `decisions.map_nivel_gobierno` valida contra las cinco claves y devuelve la
    clave normalizada; la tabla exige la forma visible. La basura sigue NULL.
    """
    return _NIVEL_GOBIERNO.get(map_nivel_gobierno(valor))


def _entero(valor: str | None) -> int | None:
    """Cuenta del legado ('40', '40.0') -> int. Texto no numérico -> None."""
    if valor is None:
        return None
    limpio = valor.strip()
    if limpio.endswith(".0"):
        limpio = limpio[:-2]
    limpio = limpio.replace(" ", "")
    return int(limpio) if limpio.isdigit() else None


def _fecha(valor: str | None) -> date | None:
    """Fecha ISO del legado -> `datetime.date` (asyncpg no acepta texto)."""
    iso = parse_fecha(valor)
    return date.fromisoformat(iso) if iso else None


def _telefono(valor: str | None) -> str | None:
    """Raw del teléfono; `normalize_telefono` descarta 'N/D' y 'sin telefono'."""
    return _recorta(normalize_telefono(valor)[1], 50)


def _correo(valor: str | None) -> str | None:
    """Correo o None. 'N/D' y equivalentes son ausencia, no un dato."""
    clave = norm_key(valor)
    if clave is None or clave in _AUSENTES:
        return None
    return valor


def _ruc(valor: str | None) -> str | None:
    """RUC -> char(11). El legado lo trae como número: se rellena a la izquierda.

    Sólo 5 organizaciones lo tienen y `ruc` es UNIQUE: si el valor no es
    numérico se deja NULL en vez de inventar un identificador tributario.
    """
    if valor is None:
        return None
    limpio = valor.strip()
    return limpio.zfill(11) if limpio.isdigit() and len(limpio) <= 11 else None


async def _perfiles(ctx: LoadContext) -> dict[str, int]:
    """{código legado del perfil ('Perfil-01') -> id de `cat_perfiles_actor`}."""
    filas = await ctx.conn.fetch(
        "SELECT id, codigo_legado FROM core.cat_perfiles_actor"
    )
    return {
        fila["codigo_legado"]: fila["id"] for fila in filas if fila["codigo_legado"]
    }


async def _tipos_organizacion(ctx: LoadContext) -> dict[str, int]:
    """{nombre o código normalizado -> id} de `cat_tipos_organizacion`.

    `ID_TIPO_ORG` mezcla nombres (`ASOCIACIÓN`) y códigos (`TIPO_ORG_001`), por
    eso el índice carga ambas formas con la misma normalización.
    """
    filas = await ctx.conn.fetch(
        "SELECT id, nombre, codigo_legado FROM core.cat_tipos_organizacion"
    )
    mapa: dict[str, int] = {}
    for fila in filas:
        mapa[norm_key(fila["nombre"])] = fila["id"]
        if fila["codigo_legado"]:
            mapa[norm_key(fila["codigo_legado"])] = fila["id"]
    return mapa


def _leer_personas(ctx: LoadContext, perfiles: dict[str, int]) -> list[_Persona]:
    """`DIM_Actores` (828) + `DIM_Actores_Estado` (108), sin tocar la base."""
    personas: list[_Persona] = []

    hoja = "DIM_Actores"
    actores = legacy.sheet_of(ctx.sheets, hoja)
    for indice in range(actores.filas):
        codigo = text(actores.cell(indice, _A_CODIGO))
        nombre = text(actores.cell(indice, _A_NOMBRE))
        if not codigo or not nombre:
            raise ValueError(f"{hoja} fila {indice + 1}: faltan código o nombre")

        categoria = _recorta(text(actores.cell(indice, _A_CATEGORIA)), 40)
        perfil = text(actores.cell(indice, _A_PERFIL))
        personas.append(
            _Persona(
                hoja=hoja,
                fila=indice + 1,
                codigo=codigo,
                nombre=_recorta(nombre, 255),
                dni=_recorta(normalize_dni(text(actores.cell(indice, _A_DNI))), 12),
                telefono_raw=_telefono(text(actores.cell(indice, _A_TELEFONO))),
                email=_recorta(_correo(text(actores.cell(indice, _A_EMAIL))), 255),
                cargo=_recorta(text(actores.cell(indice, _A_CARGO)), 150),
                abreviatura=_recorta(text(actores.cell(indice, _A_ABREVIATURA)), 150),
                # D45: el default del censo civil es 2 (Sociedad Civil), no 1.
                tipo_actor_id=map_tipo_actor(text(actores.cell(indice, _A_TIPO))),
                nivel_gobierno=_nivel(text(actores.cell(indice, _A_NIVEL))),
                rol_actor_id=map_rol_actor(text(actores.cell(indice, _A_CATEGORIA))),
                categoria=categoria,
                perfil_id=perfiles.get(perfil) if perfil else None,
                foto_url=_recorta(text(actores.cell(indice, _A_FOTO)), 500),
                # La ausencia de estado no es una baja: NULL -> true.
                activo=boolean_si_no(
                    text(actores.cell(indice, _A_ACTIVO)), default_when_null=True
                ),
                perfil_descripcion=text(actores.cell(indice, _A_DESCRIPCION)),
                organizacion_ref=text(actores.cell(indice, _A_ORGANIZACION)),
            )
        )

    hoja = "DIM_Actores_Estado"
    estado = legacy.sheet_of(ctx.sheets, hoja)
    for indice in range(estado.filas):
        codigo = text(estado.cell(indice, _E_CODIGO))
        nombre = text(estado.cell(indice, _E_NOMBRE))
        if not codigo or not nombre:
            raise ValueError(f"{hoja} fila {indice + 1}: faltan código o nombre")

        categoria = _recorta(text(estado.cell(indice, _E_CATEGORIA)), 40)
        personas.append(
            _Persona(
                hoja=hoja,
                fila=indice + 1,
                codigo=codigo,
                nombre=_recorta(nombre, 255),
                # El DNI de este censo vale literalmente 'N/D' en las 108 filas.
                dni=_recorta(normalize_dni(text(estado.cell(indice, _E_DNI))), 12),
                telefono_raw=_telefono(text(estado.cell(indice, _E_TELEFONO))),
                email=_recorta(_correo(text(estado.cell(indice, _E_EMAIL))), 255),
                cargo=_recorta(text(estado.cell(indice, _E_CARGO)), 150),
                abreviatura=None,
                # D24: el censo de funcionarios es Actor del Estado, fijo.
                tipo_actor_id=_TIPO_ACTOR_ESTADO,
                nivel_gobierno=_nivel(text(estado.cell(indice, _E_NIVEL))),
                rol_actor_id=map_rol_actor(text(estado.cell(indice, _E_CATEGORIA))),
                categoria=categoria,
                perfil_id=None,
                foto_url=None,
                activo=boolean_si_no(
                    text(estado.cell(indice, _E_ACTIVO)), default_when_null=True
                ),
                perfil_descripcion=None,
                organizacion_ref=None,
            )
        )

    return personas


def _leer_organizaciones(
    ctx: LoadContext, tipos: dict[str, int]
) -> list[_Organizacion]:
    """`DIM_ORGANIZACION` (224), con el tipo de organización resuelto."""
    hoja = "DIM_ORGANIZACION"
    sheet = legacy.sheet_of(ctx.sheets, hoja)
    organizaciones: list[_Organizacion] = []

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _O_CODIGO))
        nombre = text(sheet.cell(indice, _O_NOMBRE))
        if not codigo or not nombre:
            raise ValueError(f"{hoja} fila {indice + 1}: faltan código o nombre")

        tipo_raw = text(sheet.cell(indice, _O_TIPO))
        # 12 filas no traen tipo: `tipo_organizacion_id` admite NULL y no se
        # inventa un gremio ni una asociación.
        tipo_organizacion_id = tipos.get(norm_key(tipo_raw)) if tipo_raw else None
        es_gremio = (norm_key(tipo_raw) or "").startswith("gremio")

        organizaciones.append(
            _Organizacion(
                hoja=hoja,
                fila=indice + 1,
                codigo=codigo,
                nombre=_recorta(nombre, 255),
                tipo_organizacion_id=tipo_organizacion_id,
                tipo_actor_id=(
                    _TIPO_ACTOR_GREMIO if es_gremio else _TIPO_ACTOR_ORGANIZACION
                ),
                abreviatura=_recorta(text(sheet.cell(indice, _O_ABREVIATURA)), 150),
                fecha_constitucion=_fecha(text(sheet.cell(indice, _O_FECHA))),
                direccion=_recorta(text(sheet.cell(indice, _O_DIRECCION)), 255),
                inscripcion_sunarp=_recorta(text(sheet.cell(indice, _O_SUNARP)), 30),
                numero_integrantes=_entero(text(sheet.cell(indice, _O_INTEGRANTES))),
                n_embarcaciones=_entero(text(sheet.cell(indice, _O_EMBARCACIONES))),
                n_armadores=_entero(text(sheet.cell(indice, _O_ARMADORES))),
                foto_url=_recorta(text(sheet.cell(indice, _O_FOTO)), 500),
                perfil=text(sheet.cell(indice, _O_PERFIL)),
                ruc=_ruc(text(sheet.cell(indice, _O_RUC))),
                representante_codigo=text(sheet.cell(indice, _O_REPRESENTANTE)),
            )
        )

    return organizaciones


async def _insertar_actores(
    ctx: LoadContext,
    personas: list[_Persona],
    organizaciones: list[_Organizacion],
) -> dict[str, str]:
    """Inserta las 1 160 filas de `core.actores` y devuelve {código: actor_uid}."""
    por_codigo: dict[str, str] = {}
    usados: dict[str, int] = {}

    def codigo_unico(codigo: str) -> str:
        """D41: `ACT-720` y `ACT-827` vienen repetidos en `DIM_Actores`."""
        usados[codigo] = usados.get(codigo, 0) + 1
        repeticion = usados[codigo]
        return codigo if repeticion == 1 else f"{codigo}-{repeticion}"

    for persona in personas:
        actor_uid = await ctx.conn.fetchval(
            """
            INSERT INTO core.actores
                (nombre_actual, naturaleza, tipo_actor_id, rol_actor_id,
                 origen_dato, confidence, es_validado_humano,
                 nivel_clasificacion, email_contacto, cargo_actual,
                 nivel_gobierno, categoria, perfil_id, foto_url, activo,
                 perfil_descripcion, abreviatura, codigo_legado)
            VALUES ($1, 'persona', $2, $3, $4, 1.00, true, 2, $5, $6,
                    $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING actor_uid
            """,
            persona.nombre,
            persona.tipo_actor_id,
            persona.rol_actor_id,
            _ORIGEN,
            persona.email,
            persona.cargo,
            persona.nivel_gobierno,
            persona.categoria,
            persona.perfil_id,
            persona.foto_url,
            persona.activo,
            persona.perfil_descripcion,
            persona.abreviatura,
            codigo_unico(persona.codigo),
        )
        persona.actor_uid = actor_uid
        # `distrito_id` queda NULL: `ID_Ubigeo` es un departamento (DEP-xx).
        por_codigo.setdefault(persona.codigo, actor_uid)
        ctx.add("core.actores")

    for organizacion in organizaciones:
        actor_uid = await ctx.conn.fetchval(
            """
            INSERT INTO core.actores
                (nombre_actual, naturaleza, tipo_actor_id, rol_actor_id,
                 origen_dato, confidence, es_validado_humano,
                 nivel_clasificacion, abreviatura, codigo_legado)
            VALUES ($1, 'organizacion', $2, $3, $4, 1.00, true, 2, $5, $6)
            RETURNING actor_uid
            """,
            organizacion.nombre,
            organizacion.tipo_actor_id,
            _ROL_NO_DETERMINADO,
            _ORIGEN,
            organizacion.abreviatura,
            codigo_unico(organizacion.codigo),
        )
        organizacion.actor_uid = actor_uid
        por_codigo.setdefault(organizacion.codigo, actor_uid)
        ctx.add("core.actores")

    return por_codigo


async def _cargar_organizaciones(
    ctx: LoadContext,
    organizaciones: list[_Organizacion],
    por_codigo: dict[str, str],
) -> None:
    """`core.organizaciones`: una fila por actor organización (224)."""
    for organizacion in organizaciones:
        representante = (
            por_codigo.get(organizacion.representante_codigo)
            if organizacion.representante_codigo
            else None
        )
        if representante is None:
            # c08 vacío (4 filas) o un código que no existe: no se inventa el
            # vínculo; la organización se carga igual.
            await ctx.conflicto(
                "ORGANIZACION_SIN_ACTOR",
                hoja=organizacion.hoja,
                fila=organizacion.fila,
                codigo=organizacion.codigo,
                detalle={
                    "razon_social": organizacion.nombre,
                    "representante": organizacion.representante_codigo,
                },
            )

        await ctx.conn.execute(
            """
            INSERT INTO core.organizaciones
                (actor_uid, ruc, razon_social, representante_uid,
                 numero_integrantes, direccion, fecha_constitucion,
                 tipo_organizacion_id, inscripcion_sunarp, n_embarcaciones,
                 n_armadores, foto_url, perfil, abreviatura)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            """,
            organizacion.actor_uid,
            organizacion.ruc,
            organizacion.nombre,
            representante,
            organizacion.numero_integrantes,
            organizacion.direccion,
            organizacion.fecha_constitucion,
            organizacion.tipo_organizacion_id,
            organizacion.inscripcion_sunarp,
            organizacion.n_embarcaciones,
            organizacion.n_armadores,
            organizacion.foto_url,
            organizacion.perfil,
            organizacion.abreviatura,
        )
        ctx.add("core.organizaciones")


def _tokens(nombre: str) -> set[str]:
    """Tokens comparables del nombre, para D43."""
    return {token for token in (norm_key(nombre) or "").split(" ") if token}


def _solapa(a: str, b: str) -> bool:
    """¿Comparten suficiente nombre como para sospechar un duplicado real?"""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / min(len(ta), len(tb)) >= 0.6


async def _datos_personales(ctx: LoadContext, personas: list[_Persona]) -> None:
    """`core.actor_datos_personales` (847) + cola de DNI repetidos (D43)."""
    for persona in personas:
        if persona.dni is None:
            continue
        # No se fusiona nada: el mismo DNI puede ser otra persona. Cada fila
        # implicada se encola con su clasificación tentativa.
        grupo = [otra for otra in personas if otra.dni == persona.dni]
        if len(grupo) < 2:
            continue
        otros = [otra for otra in grupo if otra is not persona]
        clasificacion = (
            "probable_duplicado"
            if any(_solapa(persona.nombre, otra.nombre) for otra in otros)
            else "probable_error_de_digito"
        )
        await ctx.conflicto(
            "DNI_DUPLICADO",
            hoja=persona.hoja,
            fila=persona.fila,
            codigo=persona.codigo,
            detalle={
                "dni": persona.dni,
                "nombre": persona.nombre,
                "codigos": [otra.codigo for otra in grupo],
                "nombres": [otra.nombre for otra in grupo],
                "clasificacion": clasificacion,
            },
        )

    for persona in personas:
        if not persona.tiene_pii:
            continue
        telefono_contacto, telefono_raw = normalize_telefono(persona.telefono_raw)
        await ctx.conn.execute(
            """
            INSERT INTO core.actor_datos_personales
                (actor_uid, dni, email, telefono_raw, telefono_contacto,
                 base_legal, nivel_clasificacion)
            VALUES ($1, $2, $3, $4, $5, $6, 3)
            """,
            persona.actor_uid,
            persona.dni,
            persona.email,
            persona.telefono_raw,
            telefono_contacto,
            _BASE_LEGAL,
        )
        ctx.add("core.actor_datos_personales")


async def _fechas_de_caso(ctx: LoadContext) -> dict[str, date]:
    """{código ACT-xxx -> fecha del caso más antiguo que lo referencia}.

    Los bridges guardan el caso como ordinal de `FACT_Casos` y, en una fila,
    como código largo; se aceptan ambas formas. `Fecha_Inicio` es c06.
    """
    filas = await ctx.conn.fetch(
        """
        SELECT b.c02 AS actor, min(f.c06) AS fecha
          FROM (SELECT c02, c03 FROM legacy.bridge_caso_actor
                UNION
                SELECT c02, c03 FROM legacy.bridge_caso_actor_estado) b
          JOIN legacy.fact_casos f
            ON f.c01 = b.c03
            OR f.fila_n = CASE
                   WHEN b.c03 ~ '^[0-9]+$' THEN b.c03::int
               END
         WHERE b.c02 IS NOT NULL
           AND f.c06 IS NOT NULL
         GROUP BY b.c02
        """
    )
    fechas: dict[str, date] = {}
    for fila in filas:
        fecha = _fecha(fila["fecha"])
        if fecha is not None:
            fechas[fila["actor"]] = fecha
    return fechas


async def _resolver_por_similitud(
    ctx: LoadContext, referencias: list[str]
) -> dict[str, str | None]:
    """`pg_trgm >= 0.85` contra `organizaciones.razon_social` (D10)."""
    if not referencias:
        return {}
    filas = await ctx.conn.fetch(
        """
        SELECT n.ref,
               (SELECT o.actor_uid
                  FROM core.organizaciones o
                  JOIN core.actores a ON a.actor_uid = o.actor_uid
                 WHERE o.razon_social IS NOT NULL
                   AND similarity(o.razon_social, n.ref) >= $2
                 ORDER BY similarity(o.razon_social, n.ref) DESC,
                          a.codigo_legado
                 LIMIT 1) AS actor_uid
          FROM unnest($1::text[]) AS n(ref)
        """,
        referencias,
        _UMBRAL_TRGM,
    )
    return {fila["ref"]: fila["actor_uid"] for fila in filas}


async def _membresias(
    ctx: LoadContext,
    personas: list[_Persona],
    organizaciones: list[_Organizacion],
) -> None:
    """`core.actor_membresia`: persona ↔ organización resuelta + `valid_from`."""
    por_codigo = {o.codigo: o.actor_uid for o in organizaciones}
    por_nombre: dict[str, str] = {}
    fecha_org: dict[str, date | None] = {}
    for organizacion in organizaciones:
        clave = norm_key(organizacion.nombre)
        por_nombre.setdefault(clave, organizacion.actor_uid)
        fecha_org[organizacion.actor_uid] = organizacion.fecha_constitucion

    referencias = sorted({p.organizacion_ref for p in personas if p.organizacion_ref})
    resueltas: dict[str, str | None] = {}
    pendientes: list[str] = []
    for referencia in referencias:
        actor_uid = por_codigo.get(referencia) or por_nombre.get(norm_key(referencia))
        if actor_uid is not None:
            resueltas[referencia] = actor_uid
        else:
            pendientes.append(referencia)
    resueltas.update(await _resolver_por_similitud(ctx, pendientes))

    fechas_caso = await _fechas_de_caso(ctx)

    for persona in personas:
        if not persona.organizacion_ref:
            continue
        organizacion_uid = resueltas.get(persona.organizacion_ref)
        if organizacion_uid is None:
            await ctx.conflicto(
                "MEMBRESIA_SIN_MATCH",
                hoja=persona.hoja,
                fila=persona.fila,
                codigo=persona.codigo,
                detalle={"organizacion": persona.organizacion_ref},
            )
            continue

        # D42/D50: la fecha sale de la organización o del caso más antiguo del
        # actor. Si ninguna consta en el origen, la membresía entra igual con
        # valid_from NULL (inicio desconocido): nunca `CURRENT_DATE`.
        valid_from = fecha_org.get(organizacion_uid) or fechas_caso.get(persona.codigo)

        await ctx.conn.execute(
            """
            INSERT INTO core.actor_membresia
                (persona_uid, organizacion_uid, valid_from)
            VALUES ($1, $2, $3)
            """,
            persona.actor_uid,
            organizacion_uid,
            valid_from,
        )
        ctx.add("core.actor_membresia")


async def run(ctx: LoadContext) -> None:
    perfiles = await _perfiles(ctx)
    tipos_organizacion = await _tipos_organizacion(ctx)

    personas = _leer_personas(ctx, perfiles)
    organizaciones = _leer_organizaciones(ctx, tipos_organizacion)

    por_codigo = await _insertar_actores(ctx, personas, organizaciones)
    await _cargar_organizaciones(ctx, organizaciones, por_codigo)
    await _datos_personales(ctx, personas)
    await _membresias(ctx, personas, organizaciones)
