CREATE TEMP TABLE decl(nm text COLLATE "C");
INSERT INTO decl VALUES
('agent.run_log'),('audit.datos_personales_acceso'),('core.actor_datos_personales'),('core.actor_membresia'),('core.actores'),('core.alertas_actores'),('core.alertas_tempranas'),('core.caso_cronologia'),('core.caso_estado_historial'),('core.casos'),('core.casos_actores'),('core.cat_clasificacion'),('core.cat_estados_caso'),('core.cat_estados_compromiso'),('core.cat_estados_hito'),('core.cat_niveles_conflicto'),('core.cat_niveles_riesgo'),('core.cat_prioridades_alerta'),('core.cat_tipos_actor'),('core.cat_tipos_hecho'),('core.compromiso_colaboradores'),('core.compromisos'),('core.cronologia_vinculos'),('core.distritos'),('core.hitos_compromiso'),('core.log_accesos'),('core.organizaciones'),('core.output_contracts'),('core.permiso_aprobacion'),('core.reunion_participantes'),('core.roles'),('core.usuario_roles'),('core.usuarios'),('ind.resultado'),('policy.escenario_regla'),('qda.mapeo_pseudonimo'),('staging.lote');

CREATE TEMP TABLE permitidos(n text);
INSERT INTO permitidos VALUES
('core'),('ref'),('audit'),('ind'),('policy'),('qda'),('staging'),('agent'),('analytics');

-- FKs de las declaradas cuyo destino queda FUERA del conjunto permitido
SELECT (sn.nspname||'.'||s.relname) AS origen,
       (dn.nspname||'.'||d.relname) AS destino_fuera,
       c.conname
  FROM pg_constraint c
  JOIN pg_class s ON s.oid=c.conrelid
  JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_class d ON d.oid=c.confrelid
  JOIN pg_namespace dn ON dn.oid=d.relnamespace
 WHERE c.contype='f'
   AND (sn.nspname||'.'||s.relname) IN (SELECT nm FROM decl)
   AND dn.nspname NOT IN (SELECT n FROM permitidos)
 ORDER BY 1,2;
