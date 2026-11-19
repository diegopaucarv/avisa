CREATE TEMP TABLE decl(nm text COLLATE "C");
INSERT INTO decl VALUES
('agent.run_log'),('audit.datos_personales_acceso'),('core.actor_datos_personales'),('core.actor_membresia'),('core.actores'),('core.alertas_actores'),('core.alertas_tempranas'),('core.caso_cronologia'),('core.caso_estado_historial'),('core.casos'),('core.casos_actores'),('core.cat_clasificacion'),('core.cat_estados_caso'),('core.cat_estados_compromiso'),('core.cat_estados_hito'),('core.cat_niveles_conflicto'),('core.cat_niveles_riesgo'),('core.cat_prioridades_alerta'),('core.cat_tipos_actor'),('core.cat_tipos_hecho'),('core.compromiso_colaboradores'),('core.compromisos'),('core.cronologia_vinculos'),('core.distritos'),('core.hitos_compromiso'),('core.log_accesos'),('core.organizaciones'),('core.output_contracts'),('core.permiso_aprobacion'),('core.reunion_participantes'),('core.roles'),('core.usuario_roles'),('core.usuarios'),('ind.resultado'),('policy.escenario_regla'),('qda.mapeo_pseudonimo'),('staging.lote');
INSERT INTO decl VALUES ('ref.base_legal_tratamiento'),('ref.base_legal_evidencia');

CREATE TEMP TABLE diferidos(n text);
INSERT INTO diferidos VALUES
('avisa'),('analisis'),('chat'),('community'),('config'),('consultation'),
('ctx'),('domain'),('economic'),('forecast'),('impact'),('lex'),('model'),
('mype'),('pesca'),('proteccion'),('territorio');

CREATE TEMP TABLE edges AS
SELECT (sn.nspname||'.'||s.relname) COLLATE "C" AS src,
       (dn.nspname||'.'||d.relname) COLLATE "C" AS dst
  FROM pg_constraint c
  JOIN pg_class s ON s.oid=c.conrelid
  JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_class d ON d.oid=c.confrelid
  JOIN pg_namespace dn ON dn.oid=d.relnamespace
 WHERE c.contype='f'
   AND sn.nspname NOT LIKE 'pg\_%'
   AND dn.nspname NOT LIKE 'pg\_%'
   AND dn.nspname NOT IN (SELECT n FROM diferidos)
   AND s.relkind IN ('r','p') AND d.relkind IN ('r','p');

WITH RECURSIVE cl(nm) AS (
   SELECT nm FROM decl
   UNION
   SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT split_part(nm,'.',1) AS esquema, count(*) AS tablas
  FROM cl GROUP BY 1 ORDER BY 1;

WITH RECURSIVE cl(nm) AS (
   SELECT nm FROM decl
   UNION
   SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT count(*) AS total_alcance FROM cl;
