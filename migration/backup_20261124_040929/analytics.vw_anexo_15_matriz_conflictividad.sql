CREATE OR REPLACE VIEW analytics.vw_anexo_15_matriz_conflictividad AS
 SELECT c.codigo_caso,
    g.region,
    al.codigo AS alcance,
    s.nombre AS subsector,
    uo.siglas AS responsable,
    nc.nombre AS nivel_conflicto,
    nr.codigo AS nivel_riesgo,
    c.descripcion_riesgo,
    pa.codigo AS prioridad_atencion,
    c.nombre_caso,
    ( SELECT string_agg((to_char(k.fecha_evento::timestamp with time zone, 'DD.MM.YYYY'::text) || ' '::text) || k.descripcion_hecho, '
'::text ORDER BY k.fecha_evento DESC) AS string_agg
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
     LEFT JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
     LEFT JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id
     LEFT JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
     LEFT JOIN core.cat_alcances_geograficos al ON al.id = core.alcance_caso(c.id)
     LEFT JOIN core.cat_prioridades_atencion pa ON pa.id = c.prioridad_id;
