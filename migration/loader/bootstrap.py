"""Usuario de auditoría que el cargador necesita antes de escribir.

`core.set_audit()` copia `app.user_id` en `created_by` / `updated_by`, y esas
columnas tienen FK real a `core.usuarios(id)`. Si la sesión declara un uuid
inexistente, el primer INSERT de cualquier tabla auditada falla con
`violates foreign key constraint`.

Por eso el cargador crea (o reutiliza) este usuario antes de la fase 0. Es el
único registro que el cargador se inventa, y está marcado como tal: no tiene
email ni DNI, y su `codigo_legado` lo identifica como usuario de migración.
"""

from __future__ import annotations

import asyncpg

ADMIN_ID = "00000000-0000-0000-0000-000000000001"
ADMIN_NOMBRE = "Carga legado AVISA 2026"
ADMIN_CODIGO = "LEGADO_AVISA_2026"

# Unidad orgánica de la OAIPCS: la crea el parche 3 durante el initdb.
OAIPCS_SIGLAS = "OAIPCS"


async def ensure_admin_user(conn: asyncpg.Connection, admin_id: str = ADMIN_ID) -> str:
    """Idempotente. Devuelve el uuid que debe usarse en `app.user_id`."""
    await conn.execute(
        """
        INSERT INTO core.usuarios (id, nombre, email, unidad_id, activo, cargo, codigo_legado)
        VALUES (
            $1::uuid,
            $2,
            NULL,
            (SELECT id FROM core.cat_unidades_organicas WHERE siglas = $3 ORDER BY id LIMIT 1),
            TRUE,
            'Cargador de migración',
            $4
        )
        ON CONFLICT (id) DO NOTHING
        """,
        admin_id,
        ADMIN_NOMBRE,
        OAIPCS_SIGLAS,
        ADMIN_CODIGO,
    )
    return admin_id
