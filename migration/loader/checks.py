"""Validaciones de cierre de la carga del legado (plan §7).

`python -m migration.loader.run --verify` entra aquí. Todas las cifras fueron
medidas contra la carga real en PostgreSQL 16; cuando el plan §7 decía otra cosa,
manda lo verificado (y la corrección quedó anotada en `docs/`).

Se ejecuta dentro de `db.session`, así que `app.rol_codigo='administrador'` y
`app.user_id` ya están fijados: las tablas con FORCE ROW LEVEL SECURITY son
visibles y un `SELECT` que devolviera 0 filas aquí sería un fallo real.

Devuelve 0 si todo pasa y 1 si alguna comprobación falla. No modifica nada.
"""

from __future__ import annotations

import asyncpg

# (etiqueta, SQL que devuelve un escalar, valor esperado)
# El valor esperado puede ser un rango (mínimo, máximo) cuando el número depende
# del momento de la comprobación: el cargador escribe 34 filas en
# `core.usuario_roles`, el parche 16 añade 1 (el rol de administrador y oficial
# de datos personales) y el parche 21 añade otra (el rol `direccion_oaipcs` a la
# Directora). Verificar antes o después de esos parches es legítimo.
CONTEO: tuple[tuple[str, str, int | tuple[int, int]], ...] = (
    ("regiones", "SELECT count(*) FROM core.regiones", 25),
    ("provincias", "SELECT count(*) FROM core.provincias", 70),
    ("distritos", "SELECT count(*) FROM core.distritos", 698),
    ("cat_especies", "SELECT count(*) FROM core.cat_especies", 39),
    ("entidades", "SELECT count(*) FROM core.entidades", 23),
    ("cat_unidades_organicas", "SELECT count(*) FROM core.cat_unidades_organicas", 66),
    ("usuarios (31 + admin)", "SELECT count(*) FROM core.usuarios", 32),
    ("usuario_roles", "SELECT count(*) FROM core.usuario_roles", (34, 36)),
    ("usuario_territorio", "SELECT count(*) FROM core.usuario_territorio", 25),
    ("actores", "SELECT count(*) FROM core.actores", 1160),
    ("actor_datos_personales", "SELECT count(*) FROM core.actor_datos_personales", 847),
    ("organizaciones", "SELECT count(*) FROM core.organizaciones", 224),
    ("actor_membresia", "SELECT count(*) FROM core.actor_membresia", 292),
    ("casos", "SELECT count(*) FROM core.casos", 35),
    ("caso_regiones", "SELECT count(*) FROM core.caso_regiones", 81),
    ("caso_distritos", "SELECT count(*) FROM core.caso_distritos", 23),
    ("casos_actores", "SELECT count(*) FROM core.casos_actores", 60),
    (
        "caso_estado_historial (trigger)",
        "SELECT count(*) FROM core.caso_estado_historial",
        35,
    ),
    ("caso_cronologia", "SELECT count(*) FROM core.caso_cronologia", 80),
    ("documentos", "SELECT count(*) FROM core.documentos", 153),
    ("alertas_tempranas", "SELECT count(*) FROM core.alertas_tempranas", 83),
    ("alertas_actores", "SELECT count(*) FROM core.alertas_actores", 161),
    ("alerta_especies", "SELECT count(*) FROM core.alerta_especies", 30),
    ("demandas", "SELECT count(*) FROM core.demandas", 325),
    ("demandas_evidencias", "SELECT count(*) FROM core.demandas_evidencias", 77),
    ("demandas_actores", "SELECT count(*) FROM core.demandas_actores", 98),
    ("compromisos", "SELECT count(*) FROM core.compromisos", 8),
    ("hitos_compromiso", "SELECT count(*) FROM core.hitos_compromiso", 12),
    ("mesas_dialogo", "SELECT count(*) FROM core.mesas_dialogo", 21),
    ("mesa_miembros", "SELECT count(*) FROM core.mesa_miembros", 62),
    ("locales", "SELECT count(*) FROM core.locales", 27),
    ("capacitaciones", "SELECT count(*) FROM core.capacitaciones", 1),
    (
        "capacitacion_participantes",
        "SELECT count(*) FROM core.capacitacion_participantes",
        9,
    ),
    ("envios_comunicacion", "SELECT count(*) FROM core.envios_comunicacion", 17),
    (
        "suscripcion_notificacion",
        "SELECT count(*) FROM core.suscripcion_notificacion",
        4,
    ),
    ("log_accesos", "SELECT count(*) FROM core.log_accesos", 857),
    ("cronologia_vinculos", "SELECT count(*) FROM core.cronologia_vinculos", 5),
    # 498 de la carga original + 46 de la detección nueva `BRIDGE_CLAVE_DUPLICADA`
    # (22 claves de `BRIDGE_Alerta_Demandas` repetidas, 46 filas afectadas).
    ("migracion_conflicto", "SELECT count(*) FROM core.migracion_conflicto", 544),
)

# Comprobaciones estructurales: el SQL debe devolver 0 para pasar.
INTEGRIDAD: tuple[tuple[str, str], ...] = (
    (
        "actores.codigo_legado sin duplicados",
        "SELECT count(*) FROM (SELECT codigo_legado FROM core.actores "
        "WHERE codigo_legado IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d",
    ),
    (
        "alertas.codigo_alerta sin duplicados",
        "SELECT count(*) FROM (SELECT codigo_alerta FROM core.alertas_tempranas "
        "GROUP BY 1 HAVING count(*) > 1) d",
    ),
    (
        "casos.codigo_caso sin duplicados",
        "SELECT count(*) FROM (SELECT codigo_caso FROM core.casos "
        "GROUP BY 1 HAVING count(*) > 1) d",
    ),
    (
        "documentos.codigo sin duplicados",
        "SELECT count(*) FROM (SELECT codigo FROM core.documentos "
        "WHERE codigo IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d",
    ),
    (
        "ningún caso con unidad responsable nula",
        "SELECT count(*) FROM core.casos WHERE unidad_responsable_id IS NULL",
    ),
    (
        "ningún caso con subsector nulo",
        "SELECT count(*) FROM core.casos WHERE subsector_id IS NULL",
    ),
    (
        "ninguna alerta con fecha_reporte nula",
        "SELECT count(*) FROM core.alertas_tempranas WHERE fecha_reporte IS NULL",
    ),
    (
        "ninguna demanda con codigo_legado nulo",
        "SELECT count(*) FROM core.demandas WHERE codigo_legado IS NULL",
    ),
    (
        "ningún documento con tipo nulo",
        "SELECT count(*) FROM core.documentos WHERE tipo_id IS NULL",
    ),
    (
        "ningún hito con compromiso inexistente",
        "SELECT count(*) FROM core.hitos_compromiso h WHERE NOT EXISTS "
        "(SELECT 1 FROM core.compromisos c WHERE c.id = h.compromiso_id)",
    ),
    (
        "ninguna alerta con caso inexistente",
        "SELECT count(*) FROM core.alertas_tempranas a WHERE a.caso_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM core.casos c WHERE c.id = a.caso_id)",
    ),
    (
        # Una demanda sin caso declarado NO contradice a su alerta: sólo es una
        # demanda sin caso (D1 revisada). La contradicción existe cuando la
        # demanda tiene un caso propio distinto del de su alerta.
        "ninguna demanda con caso distinto al de su alerta",
        "SELECT count(*) FROM core.demandas d "
        "JOIN core.alertas_tempranas a ON a.id = d.alerta_id "
        "WHERE d.caso_id IS NOT NULL AND a.caso_id IS NOT NULL "
        "AND d.caso_id IS DISTINCT FROM a.caso_id",
    ),
)

# Cifras que reflejan decisiones concretas y no deben moverse sin revisarlas.
DESGLOSE: tuple[tuple[str, str, int], ...] = (
    (
        "actores persona",
        "SELECT count(*) FROM core.actores WHERE naturaleza = 'persona'",
        936,
    ),
    (
        "actores organización",
        "SELECT count(*) FROM core.actores WHERE naturaleza = 'organizacion'",
        224,
    ),
    (
        "actores organización con región",
        "SELECT count(*) FROM core.actores "
        "WHERE naturaleza = 'organizacion' AND region_id IS NOT NULL",
        119,
    ),
    (
        "actores organización sin región (sin ubigeo o DEP-20)",
        "SELECT count(*) FROM core.actores "
        "WHERE naturaleza = 'organizacion' AND region_id IS NULL",
        105,
    ),
    (
        "casos con nivel de conflicto NULL (decisión b)",
        "SELECT count(*) FROM core.casos WHERE nivel_conflicto_id IS NULL",
        1,
    ),
    (
        "alertas con prioridad NULL (D47)",
        "SELECT count(*) FROM core.alertas_tempranas WHERE prioridad_id IS NULL",
        2,
    ),
    (
        "membresías con valid_from NULL (D50)",
        "SELECT count(*) FROM core.actor_membresia WHERE valid_from IS NULL",
        254,
    ),
    (
        "alertas sin caso (D1)",
        "SELECT count(*) FROM core.alertas_tempranas WHERE caso_id IS NULL",
        33,
    ),
    (
        "casos sin actor",
        "SELECT count(*) FROM core.casos c WHERE NOT EXISTS "
        "(SELECT 1 FROM core.casos_actores ca WHERE ca.caso_id = c.id)",
        11,
    ),
    (
        "demandas con alerta",
        "SELECT count(*) FROM core.demandas WHERE alerta_id IS NOT NULL",
        222,
    ),
    # Demandas (D1 revisada 2026-11-24). Estas cifras describen una CARGA LIMPIA
    # desde cero con el importador corregido, que sólo vincula el caso declarado
    # en `DIM_Demandas.ID_Caso` (99 de 325). Una base REPARADA con la migración
    # 54 —que sólo desvincula las 16 mal asignadas— da 202 con caso / 123 sin
    # caso: la diferencia (103) son las demandas que `migration/37` vinculó por
    # herencia desde su alerta y que siguen pendientes de decisión humana.
    (
        "demandas con caso",
        "SELECT count(*) FROM core.demandas WHERE caso_id IS NOT NULL",
        99,
    ),
    (
        "demandas sin caso pero con alerta",
        "SELECT count(*) FROM core.demandas "
        "WHERE caso_id IS NULL AND alerta_id IS NOT NULL",
        200,
    ),
    (
        "demandas sin caso ni alerta",
        "SELECT count(*) FROM core.demandas "
        "WHERE caso_id IS NULL AND alerta_id IS NULL",
        26,
    ),
    (
        "demandas con documento de origen (RR)",
        "SELECT count(*) FROM core.demandas WHERE documento_origen_id IS NOT NULL",
        5,
    ),
    (
        "demandas con código padre legado (CS/TEMA)",
        "SELECT count(*) FROM core.demandas WHERE codigo_padre_legado IS NOT NULL",
        7,
    ),
    (
        "compromisos en En_proceso (nunca Cumplido)",
        "SELECT count(*) FROM core.compromisos WHERE estado_id = 2",
        8,
    ),
    (
        "log_accesos de cuentas de prueba sin usuario (D39)",
        "SELECT count(*) FROM core.log_accesos "
        "WHERE usuario_id IS NULL AND dni IN ('11111111', '1234567')",
        25,
    ),
)


async def _escalar(conn: asyncpg.Connection, sql: str) -> int:
    valor = await conn.fetchval(sql)
    return int(valor or 0)


async def run(conn: asyncpg.Connection) -> int:
    fallos = 0

    print("=== verificación de la carga =======================================")
    for etiqueta, sql, esperado in CONTEO:
        obtenido = await _escalar(conn, sql)
        if isinstance(esperado, tuple):
            conforme = esperado[0] <= obtenido <= esperado[1]
            detalle = f"{esperado[0]}–{esperado[1]}"
        else:
            conforme = obtenido == esperado
            detalle = str(esperado)
        if conforme:
            print(f"  ok   {etiqueta:<34} {obtenido:>7}")
        else:
            fallos += 1
            print(f"  FALLA {etiqueta:<34} {obtenido:>7} (esperado {detalle})")

    print()
    print("--- integridad ------------------------------------------------------")
    for etiqueta, sql in INTEGRIDAD:
        obtenido = await _escalar(conn, sql)
        if obtenido == 0:
            print(f"  ok   {etiqueta}")
        else:
            fallos += 1
            print(f"  FALLA {etiqueta}: {obtenido} fila(s)")

    print()
    print("--- desglose por decisión ------------------------------------------")
    for etiqueta, sql, esperado in DESGLOSE:
        obtenido = await _escalar(conn, sql)
        if obtenido == esperado:
            print(f"  ok   {etiqueta:<52} {obtenido:>7}")
        else:
            fallos += 1
            print(f"  FALLA {etiqueta:<52} {obtenido:>7} (esperado {esperado})")

    print()
    if fallos:
        print(
            f"=== {fallos} comprobación(es) fallaron ================================="
        )
        return 1
    print("=== todas las comprobaciones pasaron ==============================")
    return 0
