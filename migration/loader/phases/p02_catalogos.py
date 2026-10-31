"""Fase 2 — catálogos.

Los catálogos de v9 ya vienen sembrados por los parches 1–3. Esta fase no los
crea: los **vincula con el legado** rellenando `codigo_legado` (y, donde la
columna existe, `id_area_legado`). Además carga las 34 especies nuevas de
`DIM_Recurso_Pesca` (D25) y documenta el defecto de descripciones cruzadas de
`DIM_Tipo_Tematica` (D15).

Dos catálogos del origen **no se tocan**:

* `DIM_Tipo_Caso` → `core.cat_niveles_conflicto` está protegida por
  `core.bloquear_escritura_directa()`: ningún INSERT ni UPDATE. Sólo sirve como
  tabla de mapeo (`decisions.NIVEL_CONFLICTO`) para fases posteriores.
* `DIM_Riesgos` → `core.cat_niveles_riesgo` **no tiene** columna `codigo_legado`
  (su identidad es `codigo` + `orden`): no hay nada que rellenar.

Regla de emparejamiento: **el código manda**. Si la fila de v9 todavía no
tuviera `codigo_legado`, se cae al nombre normalizado (`norm_key`), que es único
en todos los catálogos afectados. El nombre de v9 nunca se sobrescribe: allí
viven correcciones editoriales (por ejemplo `Ordenamiento` frente al
`Ordenanamiento` del origen).
"""

from __future__ import annotations

from ...decisions import ESPECIES_SEED, norm_key, reconcile_especies, text
from .. import legacy
from ..context import LoadContext

NUMBER = 2
NAME = "Catálogos"

# Posición de las columnas en los catálogos del origen (1-based).
_CODIGO = 1
_NOMBRE = 2

# Hojas cuyo código se copia a `codigo_legado` sin más transformación.
_BACKFILL: tuple[tuple[str, str], ...] = (
    ("DIM_Tipo_Actor", "cat_tipos_actor"),
    ("DIM_Rol_Actor", "cat_roles_funcionales"),
    ("DIM_Nivel_Alertas", "cat_niveles_alerta"),
    ("DIM_Tipo_Cambio", "cat_tipos_cambio_caso"),
    ("DIM_Perfil", "cat_perfiles_actor"),
    ("DIM_Intervencion", "cat_ciclos_intervencion"),
    # El origen nombra esta hoja en mayúsculas: DIM_TIPO_ORG.
    ("DIM_TIPO_ORG", "cat_tipos_organizacion"),
)

_NOTA_TEMA_03 = (
    "DEFECTO DE ORIGEN: la hoja DIM_Tipo_Tematica trae en TEMA-03 la descripción "
    "que corresponde a TEMA-04 (distribución de beneficios). Se conserva el texto "
    "bruto en descripcion_legado y se deja descripcion vacía para que OAIPCS la "
    "redacte (D15)."
)

_NOTA_TEMA_04 = (
    "DEFECTO DE ORIGEN: la hoja DIM_Tipo_Tematica trae en TEMA-04 un texto copiado "
    "de DIM_Tipo_Caso TC-04. La descripción que sí le corresponde es la que la "
    "hoja puso en TEMA-03: se reasigna aquí (no se inventa) y el texto bruto de "
    "esta fila queda en descripcion_legado."
)


def _indexar(filas) -> tuple[dict[str, int], dict[str, int]]:
    """(`por_codigo`, `por_nombre`) de las filas de v9.

    El índice por nombre sólo incluye filas todavía sin `codigo_legado`: así un
    nombre parecido no puede robarle el código a otra fila ya vinculada.
    """
    por_codigo: dict[str, int] = {}
    por_nombre: dict[str, int] = {}
    for fila in filas:
        codigo = (fila["codigo_legado"] or "").strip().upper()
        if codigo:
            por_codigo[codigo] = fila["id"]
        else:
            por_nombre[norm_key(fila["nombre"])] = fila["id"]
    return por_codigo, por_nombre


def _destino(
    por_codigo: dict[str, int],
    por_nombre: dict[str, int],
    tabla: str,
    hoja: str,
    codigo: str,
    nombre: str | None,
) -> int:
    """Fila de `core.<tabla>` que corresponde a una fila del legado."""
    destino = por_codigo.get(codigo.upper())
    if destino is None and nombre is not None:
        destino = por_nombre.get(norm_key(nombre))
    if destino is None:
        raise ValueError(
            f"no encuentro en core.{tabla} la fila del legado {hoja} "
            f"{codigo!r} ({nombre!r})"
        )
    return destino


async def _vincular_por_codigo(ctx: LoadContext, hoja: str, tabla: str) -> None:
    """Rellena `codigo_legado` de un catálogo ya sembrado en v9."""
    sheet = legacy.sheet_of(ctx.sheets, hoja)
    por_codigo, por_nombre = _indexar(
        await ctx.conn.fetch(f"SELECT id, codigo_legado, nombre FROM core.{tabla}")
    )

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _CODIGO))
        if codigo is None:
            continue
        nombre = text(sheet.cell(indice, _NOMBRE))
        destino = _destino(por_codigo, por_nombre, tabla, hoja, codigo, nombre)
        await ctx.conn.execute(
            f"UPDATE core.{tabla} SET codigo_legado = $1 WHERE id = $2",
            codigo,
            destino,
        )
        ctx.add(f"core.{tabla}")


async def _tematicas(ctx: LoadContext) -> None:
    """Rellena `codigo_legado` y arregla, sin inventar, TEMA-03 / TEMA-04 (D15)."""
    hoja = "DIM_Tipo_Tematica"
    sheet = legacy.sheet_of(ctx.sheets, hoja)
    por_codigo, por_nombre = _indexar(
        await ctx.conn.fetch("SELECT id, codigo_legado, nombre FROM core.cat_tematicas")
    )

    # Texto bruto por código, tal cual viene de la hoja.
    crudo: dict[str, str | None] = {}
    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _CODIGO))
        if codigo:
            crudo[codigo] = text(sheet.cell(indice, 3))

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _CODIGO))
        if codigo is None:
            continue
        nombre = text(sheet.cell(indice, _NOMBRE))
        destino = _destino(
            por_codigo, por_nombre, "cat_tematicas", hoja, codigo, nombre
        )

        if codigo == "TEMA-03":
            # El bruto es la descripción de TEMA-04: se guarda y `descripcion`
            # queda NULL hasta que OAIPCS redacte la real.
            await ctx.conn.execute(
                """
                UPDATE core.cat_tematicas
                   SET codigo_legado = $1,
                       descripcion = NULL,
                       descripcion_legado = $2,
                       nota_calidad = $3
                 WHERE id = $4
                """,
                codigo,
                crudo.get(codigo),
                _NOTA_TEMA_03,
                destino,
            )
        elif codigo == "TEMA-04":
            # La descripción correcta es la que la hoja puso en TEMA-03.
            await ctx.conn.execute(
                """
                UPDATE core.cat_tematicas
                   SET codigo_legado = $1,
                       descripcion = $2,
                       descripcion_legado = $3,
                       nota_calidad = $4
                 WHERE id = $5
                """,
                codigo,
                crudo.get("TEMA-03"),
                crudo.get(codigo),
                _NOTA_TEMA_04,
                destino,
            )
        else:
            await ctx.conn.execute(
                "UPDATE core.cat_tematicas SET codigo_legado = $1 WHERE id = $2",
                codigo,
                destino,
            )
        ctx.add("core.cat_tematicas")


async def _subsectores(ctx: LoadContext) -> None:
    """`DIM_Tipo_Sector` → `cat_subsectores` (código + `id_area_legado`)."""
    hoja = "DIM_Tipo_Sector"
    sheet = legacy.sheet_of(ctx.sheets, hoja)
    por_codigo, por_nombre = _indexar(
        await ctx.conn.fetch(
            "SELECT id, codigo_legado, nombre FROM core.cat_subsectores"
        )
    )

    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, _CODIGO))
        if codigo is None:
            continue
        # `text()` ya recorta el espacio final de "Mype e Industria ".
        nombre = text(sheet.cell(indice, _NOMBRE))
        area = text(sheet.cell(indice, 3))
        destino = _destino(
            por_codigo, por_nombre, "cat_subsectores", hoja, codigo, nombre
        )
        await ctx.conn.execute(
            """
            UPDATE core.cat_subsectores
               SET codigo_legado = $1, id_area_legado = $2, nombre = $3
             WHERE id = $4
            """,
            codigo,
            area,
            nombre,
            destino,
        )
        ctx.add("core.cat_subsectores")


async def _especies(ctx: LoadContext) -> None:
    """`DIM_Recurso_Pesca` → `cat_especies`: 3 reutilizadas y 34 nuevas (D25).

    `reconcile_especies` resuelve por nombre científico exacto y luego por
    nombre común. `nombre_comun` es UNIQUE en v9, así que "Tiburón martillo"
    (RECU-009, `Sphyrna zygaena`) se enlaza a la semilla `Sphyrna lewini` y la
    divergencia taxonómica se conserva en `nombre_cientifico_legado`, con
    conflicto para revisión humana.
    """
    hoja = "DIM_Recurso_Pesca"
    sheet = legacy.sheet_of(ctx.sheets, hoja)

    filas: list[tuple[str | None, ...]] = []
    numero_fila: dict[str, int] = {}
    for indice in range(sheet.filas):
        codigo = text(sheet.cell(indice, 1))
        filas.append(
            (
                codigo,
                text(sheet.cell(indice, 2)),
                text(sheet.cell(indice, 3)),
                text(sheet.cell(indice, 4)),
                text(sheet.cell(indice, 5)),
                text(sheet.cell(indice, 6)),
            )
        )
        if codigo:
            numero_fila[codigo] = indice + 1

    resultado = reconcile_especies(filas, ESPECIES_SEED)
    cientifico_semilla = {
        especie_id: cientifico for especie_id, _, cientifico in ESPECIES_SEED
    }
    conflictos = {c["codigo_legado"]: c for c in resultado["conflictos"]}

    # Especies que ya existen en v9: sólo se les asigna el código legado.
    for codigo, especie_id in resultado["mapping"].items():
        if especie_id not in cientifico_semilla:
            continue
        conflicto = conflictos.get(codigo)
        if conflicto is not None:
            await ctx.conn.execute(
                """
                UPDATE core.cat_especies
                   SET codigo_legado = $1, nombre_cientifico_legado = $2
                 WHERE id = $3
                """,
                codigo,
                conflicto["nombre_cientifico_legado"],
                especie_id,
            )
            await ctx.conflicto(
                "ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE",
                hoja=hoja,
                fila=numero_fila.get(codigo),
                codigo=codigo,
                detalle={
                    "especie_id": especie_id,
                    "nombre_comun": conflicto["nombre_comun"],
                    "nombre_cientifico_legado": conflicto["nombre_cientifico_legado"],
                    "nombre_cientifico_v9": cientifico_semilla.get(especie_id),
                },
            )
        else:
            await ctx.conn.execute(
                "UPDATE core.cat_especies SET codigo_legado = $1 WHERE id = $2",
                codigo,
                especie_id,
            )
        ctx.add("core.cat_especies")

    # Especies nuevas: ids explícitos 16–49 (la tabla no tiene secuencia).
    for nueva in resultado["nuevas"]:
        await ctx.conn.execute(
            """
            INSERT INTO core.cat_especies
                (id, nombre_comun, nombre_cientifico, familia,
                 grupo_biologico, ambito, codigo_legado)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            nueva["id"],
            nueva["nombre_comun"],
            nueva["nombre_cientifico"],
            nueva["familia"],
            nueva["grupo_biologico"],
            nueva["ambito"],
            nueva["codigo_legado"],
        )
        ctx.add("core.cat_especies")


async def run(ctx: LoadContext) -> None:
    await _tematicas(ctx)
    await _subsectores(ctx)
    for hoja, tabla in _BACKFILL:
        await _vincular_por_codigo(ctx, hoja, tabla)
    await _especies(ctx)
