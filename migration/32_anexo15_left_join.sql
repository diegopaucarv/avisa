-- =============================================================================
-- 32 · Anexo 15: la matriz deja de esconder casos por un NULL
--
-- Hallazgo 12 del catálogo de frontend (docs/07_frontend/frontend.md).
--
-- Problema: `analytics.vw_anexo_15_matriz_conflictividad` unía con INNER JOIN
-- el distrito, el subsector, la temática, la unidad responsable, el nivel de
-- conflicto y el nivel de riesgo. Un caso sin uno de esos campos no salía con
-- la columna vacía: desaparecía de la matriz. Con 34 casos vigentes la vista
-- devolvía 21 filas para `avisa_app` (22 como propietario, que además ve el
-- caso anulado), así que el anexo omitía 13 expedientes sin declararlo.
--
-- Decisión (aprobada 2026-11-22): cambiar los INNER JOIN por LEFT JOIN y
-- publicar `NULL` en las columnas sin dato. La interfaz lo pinta como «—»; no
-- se rellena ningún hueco con un valor verosímil.
--
-- No cambia columnas, ni orden, ni permisos, ni `security_invoker`. Es
-- reversible con el bloque final.
-- =============================================================================

create or replace view analytics.vw_anexo_15_matriz_conflictividad as
 SELECT c.codigo_caso,
    g.region,
    al.codigo AS alcance,
    s.nombre AS subsector,
    tm.nombre AS tematica,
    uo.siglas AS responsable,
    nc.nombre AS nivel_conflicto,
    nr.codigo AS nivel_riesgo,
    c.descripcion_riesgo,
    pa.codigo AS prioridad_atencion,
    c.nombre_caso,
    ( SELECT string_agg(
               (to_char(k.fecha_evento::timestamp with time zone, 'DD.MM.YYYY'::text) || ' '::text)
               || k.descripcion_hecho,
               E'\n'::text
               ORDER BY k.fecha_evento DESC) AS string_agg
           FROM core.caso_cronologia k
          WHERE k.caso_id = c.id) AS narracion_cronologica,
    ( SELECT string_agg(a.codigo_alerta::text, ', '::text) AS string_agg
           FROM core.alertas_tempranas a
          WHERE a.caso_id = c.id) AS alertas_vinculadas,
    ( SELECT string_agg(ac.nombre_actual::text, '; '::text) AS string_agg
           FROM core.casos_actores ca
             JOIN core.actores ac ON ac.actor_uid = ca.actor_id
          WHERE ca.caso_id = c.id) AS actores_involucrados,
    pf.nombre AS punto_focal
   FROM core.casos c
     LEFT JOIN core.usuarios pf ON pf.id = c.punto_focal_usuario_id
     LEFT JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
     LEFT JOIN core.cat_subsectores s ON s.id = c.subsector_id
     LEFT JOIN core.cat_tematicas tm ON tm.id = c.tematica_id
     LEFT JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
     LEFT JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id
     LEFT JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
     LEFT JOIN core.cat_alcances_geograficos al ON al.id = core.alcance_caso(c.id)
     LEFT JOIN core.cat_prioridades_atencion pa ON pa.id = c.prioridad_id;

-- La vista conserva la evaluación con privilegios del invocador: la RLS de
-- `core.casos` sigue decidiendo qué filas ve cada rol (un caso anulado no se
-- muestra a `avisa_app`).
alter view analytics.vw_anexo_15_matriz_conflictividad set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 1 · Comprobación: 34 casos vigentes, 34 filas para `avisa_app`
--     (35 como propietario, que también ve el caso anulado).
-- -----------------------------------------------------------------------------
select count(*) as filas_como_propietario
  from analytics.vw_anexo_15_matriz_conflictividad;

set role avisa_app;
select count(*) as filas_como_avisa_app
  from analytics.vw_anexo_15_matriz_conflictividad;
reset role;

-- Las columnas sin dato ahora se publican vacías en lugar de borrar la fila.
select count(*) filter (where region is null) as sin_region,
       count(*) filter (where subsector is null) as sin_subsector,
       count(*) filter (where nivel_riesgo is null) as sin_riesgo
  from analytics.vw_anexo_15_matriz_conflictividad;

-- -----------------------------------------------------------------------------
-- 2 · Reversión (descomentar y ejecutar si hay que volver atrás):
--     restaurar el archivo de la vista de `migration/30_alcance_derivado.sql`
--     (bloque 4) y reaplicar `security_invoker = true`.
-- -----------------------------------------------------------------------------
