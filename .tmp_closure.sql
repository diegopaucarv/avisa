-- Calcula la clausura de dependencias FK desde las tablas del MVP
CREATE TEMP TABLE keep(n text);
INSERT INTO keep(n) VALUES
('core.regiones'),('core.provincias'),('core.distritos'),('core.entidades'),('core.cat_unidades_organicas'),('core.cat_subsectores'),('core.cat_tematicas'),('core.cat_niveles_alerta'),('core.cat_periodos'),('core.documentos'),('core.relatorias'),('core.mesas_dialogo'),('core.reuniones_dialogo'),('core.reunion_participantes'),('core.organizaciones'),('core.cat_tipos_organizacion'),('core.cat_nivel_identificacion'),('core.cat_perfiles_actor'),('core.cat_roles_actor'),('core.cat_roles_funcionales'),('core.cat_tipos_cambio_caso'),('core.cat_alcances_geograficos'),('core.cat_ciclos_intervencion'),('core.cat_prioridades_atencion'),('core.cronologia_vinculos'),('chat.commit'),('policy.snapshot'),('ctx.snapshot'),('ind.variante'),('policy.escenario'),('policy.regla'),('kag.documento_fragmento'),('analisis.plan_paso'),('analisis.punto_ingesta'),('qda.proyecto');

-- semilla = tablas realmente presentes en avisa_mssql (sin legacy)
CREATE TEMP TABLE seed AS
SELECT table_schema||'.'||table_name AS nm
FROM information_schema.tables
WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema';

-- aristas: origen -> destino
CREATE TEMP TABLE edges AS
SELECT sn.nspname||'.'||s.relname AS src, dn.nspname||'.'||d.relname AS dst
FROM pg_constraint c
JOIN pg_class s ON s.oid = c.conrelid
JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_class d ON d.oid = c.confrelid
JOIN pg_namespace dn ON dn.oid = d.relnamespace
WHERE c.contype = 'f' AND sn.nspname NOT LIKE 'pg_%' AND dn.nspname NOT LIKE 'pg_%';

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT count(*) AS clausura_total FROM cl;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT split_part(nm, '.', 1) AS esquema, count(*) AS tablas
FROM cl GROUP BY 1 ORDER BY 2 DESC;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT nm FROM cl WHERE nm NOT IN (SELECT nm FROM seed) ORDER BY 1;
