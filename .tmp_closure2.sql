-- Clausura FK desde las 42 tablas MVP (T0+T1)
CREATE TEMP TABLE edges AS
SELECT (sn.nspname||'.'||s.relname) COLLATE "C" AS src,
       (dn.nspname||'.'||d.relname) COLLATE "C" AS dst
FROM pg_constraint c
JOIN pg_class s ON s.oid = c.conrelid
JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_class d ON d.oid = c.confrelid
JOIN pg_namespace dn ON dn.oid = d.relnamespace
WHERE c.contype = 'f'
  AND sn.nspname NOT LIKE 'pg\_%'
  AND dn.nspname NOT LIKE 'pg\_%'
  AND s.relkind IN ('r','p')
  AND d.relkind IN ('r','p');

CREATE TEMP TABLE seed(nm text COLLATE "C");
INSERT INTO seed VALUES
('core.regiones'),('core.provincias'),('core.distritos'),('core.entidades'),('core.cat_unidades_organicas'),('core.cat_subsectores'),('core.cat_tematicas'),('core.cat_niveles_alerta'),('core.cat_periodos'),('core.documentos'),('core.relatorias'),('core.mesas_dialogo'),('core.reuniones_dialogo'),('core.reunion_participantes'),('core.organizaciones'),('core.cat_tipos_organizacion'),('core.cat_nivel_identificacion'),('core.cat_perfiles_actor'),('core.cat_roles_actor'),('core.cat_roles_funcionales'),('core.cat_tipos_cambio_caso'),('core.cat_alcances_geograficos'),('core.cat_ciclos_intervencion'),('core.cat_prioridades_atencion'),('core.cronologia_vinculos'),('chat.commit'),('policy.snapshot'),('ctx.snapshot'),('ind.variante'),('policy.escenario'),('policy.regla'),('kag.documento_fragmento'),('analisis.plan_paso'),('analisis.punto_ingesta'),('qda.proyecto');

SELECT count(*) AS semilla FROM seed;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT count(*) AS clausura_total, count(*) FILTER (WHERE nm NOT IN (SELECT nm FROM seed)) AS adicionales FROM cl;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT split_part(nm,'.',1) AS esquema, count(*) AS tablas FROM cl GROUP BY 1 ORDER BY 2 DESC;
