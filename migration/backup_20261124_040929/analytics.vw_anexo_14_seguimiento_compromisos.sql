CREATE OR REPLACE VIEW analytics.vw_anexo_14_seguimiento_compromisos AS
 SELECT c.codigo_compromiso,
    cs.codigo_caso,
    ( SELECT string_agg(DISTINCT g.region::text, ', '::text) AS string_agg
           FROM core.compromiso_distritos cd
             JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
          WHERE cd.compromiso_id = c.id) AS region,
    ( SELECT string_agg(DISTINCT g.provincia::text, ', '::text) AS string_agg
           FROM core.compromiso_distritos cd
             JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
          WHERE cd.compromiso_id = c.id) AS provincia,
    ( SELECT string_agg(DISTINCT g.distrito::text, ', '::text) AS string_agg
           FROM core.compromiso_distritos cd
             JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
          WHERE cd.compromiso_id = c.id) AS distrito,
    al.codigo AS alcance_geografico,
    td.nombre AS documento_origen,
    c.fecha_inicio,
    c.accion_compromiso,
    uo.siglas AS area_responsable,
    h.codigo_hito,
    h.descripcion_hito AS hito,
    eh.codigo AS estado_hito,
        CASE
            WHEN eh.es_terminal THEN 'VERDE'::text
            WHEN h.fecha_vencimiento < CURRENT_DATE THEN 'ROJO'::text
            WHEN h.fecha_vencimiento <= (CURRENT_DATE + 15) THEN 'AMARILLO'::text
            ELSE 'VERDE'::text
        END AS semaforo,
    h.fecha_vencimiento AS fecha_planificada,
    h.fecha_real
   FROM core.compromisos c
     JOIN core.casos cs ON cs.id = c.caso_id
     JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
     LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id
     LEFT JOIN core.documentos dc ON dc.id = c.documento_origen_id
     LEFT JOIN core.cat_tipos_documento td ON td.id = dc.tipo_id
     LEFT JOIN core.hitos_compromiso h ON h.compromiso_id = c.id
     LEFT JOIN core.cat_estados_hito eh ON eh.id = h.estado_id;
