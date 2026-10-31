"""Fase 4 — usuarios del legado, sus roles y su territorio.

Tres hojas alimentan una sola tabla `core.usuarios`:

* `DIM_Sectoristas` (15, `SEC-xx`) → rol `sectorista`.
* `DIM_Punto_Focal` (17, `PF-xxx`) → rol `consulta_lectura`.
* `DIM_Autoridades` (2, `AUT-xxx`) → rol `alta_direccion`.

Son 34 filas pero **31 personas**: tres filas repiten a un sectorista y se
fusionan en una sola cuenta que conserva el código `SEC-xx` y la unión de roles.

* `SEC-11` ≡ `AUT-001` (mismo nombre y mismo DNI 41907320).
* `SEC-01` ≡ `PF-017` (mismo nombre normalizado; sólo la fila de punto focal
  viene sin DNI, así que la cuenta conserva el DNI del sectorista).
* `SEC-15` ≡ `PF-016` (`Javier Alegre Paredes` es subconjunto de los tokens de
  `Javier Juan Alegre Paredes`).

Los tres códigos absorbidos no aparecen en ninguna tabla posterior del legado
(`LOG_Envios`, `DIM_Hitos`, `DIM_Acciones_Hitos`), así que `codigo_legado` se
queda con el `SEC-xx` sin dejar referencias huérfanas. Cada fusión se registra
como `PERSONA_HOMONIMA` con `fusion_confirmada`.

Contraseñas (D11): las hojas traen `clave_*` en texto plano. **No se copian**.
Se escribe un `clave_hash` inservible (`'!' || uuid`) para que ninguna clave
heredada pueda autenticar y el primer acceso obligue a restablecerla.

Territorio: `BRIDGE_Sectorista_Departamento` (27) → `core.usuario_territorio`.
El `DEP-xx` del legado no se corta como cadena —después de `DEP-16` los códigos
están corridos: `DEP-26` es Tumbes (INEI 24) y `DEP-27` Ucayali (INEI 25)—. El
mapa se arma con el ubigeo de `DIM_Provincias` y se une contra `core.regiones`.
Dos filas no suman: `DEP-20 "Más de Uno"` no tiene provincias y no es una región
(D28), así que queda como `TERRITORIO_NO_RESUELTO`; y `SEC-02` cubre `DEP-15` y
`DEP-16`, que D28 fusiona en la región 15, de modo que ese vínculo se inserta una
sola vez. Resultado: **25 pares únicos**, no 27.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ...decisions import norm_key, normalize_dni, text
from .. import legacy
from ..context import LoadContext

NUMBER = 4
NAME = "Usuarios + roles + territorio"


@dataclass(frozen=True)
class _Columnas:
    """Posiciones 1-based de las columnas que sí se leen de una hoja de personas.

    `c04` (`clave_Sectorista`, `clave_PF`, `clave_Autoridades`) queda fuera a
    propósito: es la clave en texto plano y no se migra (D11).
    """

    codigo: int
    nombre: int
    dni: int
    cargo: int
    email: int
    telefono: int
    foto: int
    estado: int


# DIM_Sectoristas
_SEC = _Columnas(
    codigo=1, nombre=2, dni=3, cargo=6, email=10, telefono=11, foto=12, estado=13
)
# DIM_Punto_Focal
_PF = _Columnas(
    codigo=1, nombre=2, dni=3, cargo=5, email=9, telefono=10, foto=11, estado=12
)
# DIM_Autoridades: ¡ojo! `Fotografia` (c10) va antes que `Telefono` (c11).
_AUT = _Columnas(
    codigo=1, nombre=2, dni=3, cargo=5, email=9, telefono=11, foto=10, estado=12
)

# Unidad OAIPCS sembrada por el parche 3 (D26). El plan §4.4 no exige resolver
# los códigos `AR-xxx` de los puntos focales/ autoridades en esta fase.
_UNIDAD_OAIPCS = 1

# BRIDGE_Sectorista_Departamento
_BR_USUARIO = 2
_BR_DEPARTAMENTO = 3

_ROL_POR_ORIGEN = {
    "sectorista": "sectorista",
    "punto_focal": "consulta_lectura",
    "autoridad": "alta_direccion",
}

# Orden de lectura: primero los sectoristas, para que las filas de punto focal y
# de autoridades se fusionen sobre una cuenta `SEC-xx` ya existente.
_FUENTES: tuple[tuple[str, str, _Columnas], ...] = (
    ("DIM_Sectoristas", "sectorista", _SEC),
    ("DIM_Punto_Focal", "punto_focal", _PF),
    ("DIM_Autoridades", "autoridad", _AUT),
)

_CAMPOS_COMPLETABLES = ("dni", "email", "telefono", "cargo", "foto_url")


@dataclass
class _Persona:
    """Una persona ya fusionada, con todos sus códigos de origen y sus roles."""

    codigos: list[str]
    nombre: str
    dni: str | None
    email: str | None
    telefono: str | None
    cargo: str | None
    foto_url: str | None
    activo: bool
    roles: set[str] = field(default_factory=set)

    @property
    def codigo_legado(self) -> str:
        """Código que sobrevive a la fusión: el `SEC-xx` si lo hay."""
        for codigo in self.codigos:
            if codigo.startswith("SEC-"):
                return codigo
        return self.codigos[0]


def _norm(valor: str | None) -> str:
    """Nombre comparable: minúsculas, sin acentos y con espacios colapsados."""
    return norm_key(valor) or ""


def _tokens(nombre: str) -> set[str]:
    """Conjunto de tokens comparables de un nombre."""
    return {token for token in _norm(nombre).split(" ") if token}


def _coincidencia(personas: list[_Persona], nueva: _Persona) -> _Persona | None:
    """Persona ya cargada que corresponde a `nueva`, o None.

    Reglas, en este orden: nombre normalizado exacto → DNI igual → contención de
    tokens. La contención exige al menos dos tokens en el nombre corto; con uno
    solo, cualquier `Rosa` absorbería a cualquier `Rosa …`.
    """
    objetivo = _norm(nueva.nombre)
    for previa in personas:
        if _norm(previa.nombre) == objetivo:
            return previa

    if nueva.dni:
        for previa in personas:
            if previa.dni == nueva.dni:
                return previa

    tokens_nueva = _tokens(nueva.nombre)
    for previa in personas:
        tokens_previa = _tokens(previa.nombre)
        if min(len(tokens_nueva), len(tokens_previa)) < 2:
            continue
        if tokens_nueva <= tokens_previa or tokens_previa <= tokens_nueva:
            return previa
    return None


def _absorber(previa: _Persona, nueva: _Persona) -> None:
    """Fusiona `nueva` en `previa`: manda la primera fila y sólo rellena vacíos."""
    previa.codigos.extend(nueva.codigos)
    previa.roles |= nueva.roles
    for campo in _CAMPOS_COMPLETABLES:
        if getattr(previa, campo) is None:
            setattr(previa, campo, getattr(nueva, campo))


def _leer_persona(
    sheet: legacy.Sheet,
    indice: int,
    hoja: str,
    origen: str,
    cols: _Columnas,
) -> _Persona:
    """Una fila de la hoja convertida en persona, sin tocar la base."""
    codigo = text(sheet.cell(indice, cols.codigo))
    nombre = text(sheet.cell(indice, cols.nombre))
    if not codigo or not nombre:
        raise ValueError(f"{hoja} fila {indice + 1}: faltan código o nombre")

    estado = text(sheet.cell(indice, cols.estado))
    return _Persona(
        codigos=[codigo],
        nombre=nombre,
        dni=normalize_dni(text(sheet.cell(indice, cols.dni))),
        email=text(sheet.cell(indice, cols.email)),
        telefono=text(sheet.cell(indice, cols.telefono)),
        cargo=text(sheet.cell(indice, cols.cargo)),
        foto_url=text(sheet.cell(indice, cols.foto)),
        # `Activo` es el único estado que deja la cuenta habilitada; la ausencia
        # de estado no es una baja.
        activo=estado is None or norm_key(estado) == "activo",
        roles={_ROL_POR_ORIGEN[origen]},
    )


async def _personas(ctx: LoadContext) -> list[_Persona]:
    """Lee las tres hojas y devuelve las 31 personas ya fusionadas."""
    personas: list[_Persona] = []
    for hoja, origen, cols in _FUENTES:
        sheet = legacy.sheet_of(ctx.sheets, hoja)
        for indice in range(sheet.filas):
            nueva = _leer_persona(sheet, indice, hoja, origen, cols)
            previa = _coincidencia(personas, nueva)
            if previa is None:
                personas.append(nueva)
                continue

            codigos = [previa.codigo_legado, nueva.codigos[0]]
            _absorber(previa, nueva)
            await ctx.conflicto(
                "PERSONA_HOMONIMA",
                hoja=hoja,
                fila=indice + 1,
                codigo=nueva.codigos[0],
                detalle={"fusion_confirmada": True, "codigos": codigos},
            )
    return personas


async def _usuarios(ctx: LoadContext, personas: list[_Persona]) -> dict[str, str]:
    """Inserta las personas en `core.usuarios` y devuelve {código: id}."""
    ids: dict[str, str] = {}
    for persona in personas:
        # D11: la clave del legado está en texto plano y NO se migra. Se deja un
        # hash inservible (`'!'` + uuid) para que ninguna contraseña heredada
        # pueda validar y el primer ingreso obligue a restablecerla. No hay
        # bandera de "cambiar contraseña": el valor inhabilitado es la señal.
        usuario_id = await ctx.conn.fetchval(
            """
            INSERT INTO core.usuarios
                (nombre, dni, email, telefono, cargo, foto_url, activo,
                 unidad_id, codigo_legado, clave_hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                    '!' || replace(gen_random_uuid()::text, '-', ''))
            RETURNING id
            """,
            persona.nombre,
            persona.dni,
            persona.email,
            persona.telefono,
            persona.cargo,
            persona.foto_url,
            persona.activo,
            _UNIDAD_OAIPCS,
            persona.codigo_legado,
        )
        for alias in persona.codigos:
            ids[alias] = usuario_id
        ctx.add("core.usuarios")
    return ids


async def _roles(
    ctx: LoadContext, personas: list[_Persona], ids: dict[str, str]
) -> None:
    """Asigna a cada persona la unión de roles de sus filas de origen."""
    filas = await ctx.conn.fetch("SELECT id, codigo FROM core.roles")
    por_codigo = {fila["codigo"]: fila["id"] for fila in filas}

    faltan = {rol for persona in personas for rol in persona.roles} - set(por_codigo)
    if faltan:
        raise ValueError(
            f"core.roles no tiene los códigos {sorted(faltan)}; "
            f"disponibles: {sorted(por_codigo)}"
        )

    for persona in personas:
        for rol in sorted(persona.roles):
            await ctx.conn.execute(
                """
                INSERT INTO core.usuario_roles (usuario_id, rol_id)
                VALUES ($1, $2)
                """,
                ids[persona.codigo_legado],
                por_codigo[rol],
            )
            ctx.add("core.usuario_roles")


async def _territorio(ctx: LoadContext, ids: dict[str, str]) -> None:
    """`BRIDGE_Sectorista_Departamento` (27) → `core.usuario_territorio`."""
    hoja = "BRIDGE_Sectorista_Departamento"
    sheet = legacy.sheet_of(ctx.sheets, hoja)

    # El `DEP-xx` no se corta como cadena: después de `DEP-16` los códigos están
    # corridos. El mapa sale de las provincias: c04 = ID_Ubigeo (DEP-xx) y
    # c02 = Cod_INEI, cuyo dos primeros dígitos son el ubigeo departamental.
    provincias = await ctx.conn.fetch(
        """
        SELECT DISTINCT c04 AS dep,
               left(lpad(c02, 4, '0'), 2) AS ubigeo
          FROM legacy.dim_provincias
         WHERE c04 IS NOT NULL
           AND c02 IS NOT NULL
        """
    )
    ubigeo_por_dep = {fila["dep"]: fila["ubigeo"] for fila in provincias}

    regiones = await ctx.conn.fetch("SELECT id, ubigeo FROM core.regiones")
    region_por_ubigeo = {fila["ubigeo"].strip(): fila["id"] for fila in regiones}

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _BR_USUARIO))
        departamento = text(sheet.cell(indice, _BR_DEPARTAMENTO))
        if not codigo or not departamento:
            raise ValueError(
                f"{hoja} fila {indice + 1}: faltan sectorista o departamento"
            )

        usuario_id = ids.get(codigo)
        if usuario_id is None:
            raise ValueError(
                f"{hoja} fila {indice + 1}: el sectorista {codigo!r} no se cargó"
            )

        ubigeo = ubigeo_por_dep.get(departamento)
        region_id = region_por_ubigeo.get(ubigeo) if ubigeo else None
        if region_id is None:
            # No se inventa la región: se deja la duda para revisión manual.
            await ctx.conflicto(
                "TERRITORIO_NO_RESUELTO",
                hoja=hoja,
                fila=indice + 1,
                codigo=departamento,
                detalle={"sectorista": codigo, "departamento": departamento},
            )
            continue

        # D28 fusionó DEP-15 y DEP-16 en la región INEI 15, y SEC-02 cubre
        # ambas, así que el vínculo (SEC-02, región 15) llega repetido. La tabla
        # es un conjunto de coberturas, no una copia de las filas del bridge:
        # se inserta una sola vez y sólo se cuenta lo realmente escrito.
        insertado = await ctx.conn.fetchval(
            """
            INSERT INTO core.usuario_territorio (usuario_id, region_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            RETURNING 1
            """,
            usuario_id,
            region_id,
        )
        if insertado:
            ctx.add("core.usuario_territorio")


async def run(ctx: LoadContext) -> None:
    personas = await _personas(ctx)
    ids = await _usuarios(ctx, personas)
    await _roles(ctx, personas, ids)
    await _territorio(ctx, ids)
