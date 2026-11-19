"""Capa de conexión a PostgreSQL (asyncpg).

Un solo lugar donde vive el DSN y la receta de sesión obligatoria: la usan el
cargador del legado (`migration/loader/`) y, más adelante, la API.

La receta no es opcional. Once tablas de `core` tienen FORCE ROW LEVEL SECURITY
y el DUEÑO de la tabla tampoco escapa de las políticas:

    sin app.rol_codigo válido,      core.clasificacion_max() devuelve 0 y no
                                    se ve ninguna fila (ni se puede escribir)
    sin app.user_id,                created_by/updated_by violan su FK

El rol —no el nivel— es lo que se comunica: desde el parche 15 el nivel y las
capacidades (crear, editar, eliminar) se deducen de `core.roles` a partir del
código de rol. Declarar un nivel suelto ya no tiene efecto.

`set_config(..., true)` equivale a `SET LOCAL`: el valor dura la transacción y
no se filtra a la conexión del pool.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import asyncpg

# Raíz del repositorio (backend/db.py -> backend -> repo).
REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_ROL_CODIGO = "administrador"
DEFAULT_STAFF_BYPASS = True


def _read_dotenv(path: Path) -> dict[str, str]:
    """Lector mínimo de .env: KEY=VALUE, sin comillas ni interpolación."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def resolve_dsn(explicit: str | None = None) -> str:
    """DSN por precedencia: argumento > entorno > .env > error explícito."""
    if explicit:
        return explicit
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = _read_dotenv(REPO_ROOT / ".env")
    if env.get("DATABASE_URL"):
        return env["DATABASE_URL"]

    # Último recurso: componer desde las variables del contenedor.
    user = env.get("POSTGRES_USER") or os.environ.get("POSTGRES_USER")
    password = env.get("POSTGRES_PASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    port = env.get("POSTGRES_PORT") or os.environ.get("POSTGRES_PORT") or "55433"
    db = env.get("POSTGRES_DB") or os.environ.get("POSTGRES_DB") or "avisa"
    if user and password:
        return f"postgresql://{user}:{password}@localhost:{port}/{db}"

    raise RuntimeError(
        "No hay DSN. Definí DATABASE_URL, o POSTGRES_USER/POSTGRES_PASSWORD "
        "en .env (ver .env.example)."
    )


async def connect(dsn: str | None = None, **kwargs) -> asyncpg.Connection:
    """Conexión suelta. Quien la abra es responsable de cerrarla."""
    return await asyncpg.connect(resolve_dsn(dsn), **kwargs)


@asynccontextmanager
async def session(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    rol_codigo: str = DEFAULT_ROL_CODIGO,
    staff_bypass: bool = DEFAULT_STAFF_BYPASS,
    savepoint: bool = True,
) -> AsyncIterator[asyncpg.Connection]:
    """Transacción con el contexto de seguridad ya fijado.

    `user_id` DEBE existir en core.usuarios: el trigger core.set_audit() copia
    ese uuid en created_by/updated_by y ambas columnas tienen FK real.

    `rol_codigo` DEBE existir en core.roles. De esa fila salen el nivel de
    clasificación y las capacidades de escritura y borrado; la base ya no
    acepta un nivel declarado por el cliente (parche 15). En la API, este
    valor viene de los claims del token, nunca del cuerpo de la petición.

    Con `savepoint=True` (por defecto) se abre una transacción anidada, de modo
    que esto se puede usar dentro de una transacción mayor sin cerrarla.
    """
    tx = conn.transaction()
    await tx.start()
    try:
        await conn.execute(
            "select set_config('app.rol_codigo', $1, true)",
            str(rol_codigo),
        )
        await conn.execute("select set_config('app.user_id', $1, true)", str(user_id))
        await conn.execute(
            "select set_config('app.staff_bypass_subject_rls', $1, true)",
            "true" if staff_bypass else "false",
        )
        yield conn
    except BaseException:
        await tx.rollback()
        raise
    else:
        await tx.commit()
