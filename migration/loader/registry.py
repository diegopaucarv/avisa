"""Registro de fases del cargador, en el orden no negociable del plan.

El orden es el de `docs/PLAN_PORTE_LEGADO_V9.md` §3: cada fase sólo depende de
las anteriores (geografía antes de casos, casos antes de alertas, etc.).
"""

from __future__ import annotations

# (número, módulo dentro de .phases, etiqueta)
PHASES: tuple[tuple[int, str, str], ...] = (
    (0, "p00_staging", "Staging legacy.*"),
    (1, "p01_geografia", "Geografía 25/70/698"),
    (2, "p02_catalogos", "Catálogos"),
    (3, "p03_entidades", "Entidades + unidades orgánicas"),
    (4, "p04_usuarios", "Usuarios + roles + territorio"),
    (5, "p05_actores", "Actores + PII + membresías"),
    (6, "p06_casos", "Casos + territorios"),
    (7, "p07_cronologia_documentos", "Cronología + documentos"),
    # Alertas va ANTES de demandas: `core.demandas.alerta_id` tiene FK real a
    # `core.alertas_tempranas(id)` y 222 de las 325 demandas llevan alerta. Con
    # el orden inverso (que era el del plan §3) la fase 8 aborta por FK. Los
    # vínculos alerta↔hecho (`cronologia_vinculos`) también necesitan alertas,
    # así que se completan en esta fase.
    (8, "p08_alertas", "Alertas + especies + vínculos"),
    (9, "p09_demandas", "Demandas + evidencias"),
    (10, "p10_compromisos", "Compromisos + hitos"),
    (11, "p11_mesas_capacitaciones", "Mesas + capacitaciones + locales"),
    (12, "p12_envios", "Envíos + suscripciones"),
    (13, "p13_log_accesos", "Log de accesos"),
)

BY_NUMBER = {number: (module, label) for number, module, label in PHASES}
