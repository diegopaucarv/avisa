/* =====================================================================
   AVISA · Paso 4 · Chequeos posteriores a la migración (SQL Server)
   =====================================================================
   PARA QUÉ
   Este script se ejecuta EN SQL SERVER, DESPUÉS de que SSMA haya
   migrado el esquema y los datos. No migra nada: comprueba que lo
   migrado se parece al origen y reconstruye lo que SSMA no trae
   (seguridad por fila e índices filtrados).

   DE DÓNDE SALEN LOS VALORES ESPERADOS
   Todos están medidos sobre la base de origen `avisa_mssql`
   (PostgreSQL 16.14, contenedor `avisa-db`) el 2026-11-19, con el rol
   `avisa` (superusuario y BYPASSRLS). Ninguno es estimado.
   La consulta de origen que produce los conteos está en §1.1.

   CÓMO SE EJECUTA
       sqlcmd -S <servidor> -d <base_destino> -E -i 04_chequeos_postmigracion.sql
   o abrirlo en Azure Data Studio / SSMS y ejecutarlo por bloques.
   No contiene credenciales: usa autenticación integrada o el login que
   corresponda.

   ALCANCE Y SUPUESTOS
   · El alcance del staging son 73 tablas de dominio (agent, audit, core,
     ind, kag, policy, qda, ref, staging), 87 de `legacy` y 1 de PostGIS
     (`public.spatial_ref_sys`): 161 tablas en total.
   · Se asume que SSMA creó los esquemas con el mismo nombre que en
     origen: agent, audit, core, ind, kag, policy, qda, ref, staging
     (más legacy y public).
     Si los renombró, ajustar las listas de §1 y las llamadas de §5/§6.
   · Se asume SQL Server 2016 SP1 o superior (CREATE OR ALTER).
   · Las secciones §1 a §4 y §7 son de LECTURA (no cambian nada).
     Las secciones §5 y §6 CREAN objetos (funciones, política de
     seguridad, índices). Ejecutar primero en una base de pruebas.
   · §5 y §6 son idempotentes: se pueden volver a ejecutar.

   ORDEN RECOMENDADO
     1) §1 conteos y §1.3 identidades  → si algo no cuadra, parar.
     2) §2 JSON, §3 DEFAULT, §4 fechas.
     3) §6 índices  (antes de §5: el índice único de DNI debe existir).
     4) §5 seguridad por fila y sus pruebas.
     5) §7 comentarios (opcional).
   ===================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT OFF;   -- para que un error de §5 no aborte el lote entero
GO

PRINT '=== AVISA · chequeos post-migración · inicio ===';
GO


/* =====================================================================
   §1 · CONTEOS DE FILAS
   =====================================================================
   Objetivo: que ninguna tabla llegue vacía por accidente y que cada
   tabla tenga exactamente las filas del origen.

   Las 19 tablas que en origen están vacías NO son un fallo: se listan
   con 0 esperado y el informe las distingue ("vacía de origen").
   ===================================================================== */

/* ---------------------------------------------------------------------
   1.1 · Consulta de ORIGEN que produce estos valores
   ---------------------------------------------------------------------
   Se ejecuta en PostgreSQL, no aquí. Deja una fila por tabla:

   WITH alcance(esquema, tabla) AS (
     VALUES ('agent','run_log'),('audit','datos_personales_acceso'),
            ('core','actor_datos_personales'),('core','actor_membresia'),
            ('core','actores'),('core','alertas_actores'),
            ('core','alertas_tempranas'),('core','caso_cronologia'),
            ('core','caso_estado_historial'),('core','casos'),
            ('core','casos_actores'),('core','cat_alcances_geograficos'),
            ('core','cat_ciclos_intervencion'),('core','cat_clasificacion'),
            ('core','cat_estados_caso'),('core','cat_estados_compromiso'),
            ('core','cat_estados_hito'),('core','cat_nivel_identificacion'),
            ('core','cat_niveles_alerta'),('core','cat_niveles_conflicto'),
            ('core','cat_niveles_riesgo'),('core','cat_perfiles_actor'),
            ('core','cat_prioridades_alerta'),
            ('core','cat_prioridades_atencion'),
            ('core','cat_roles_actor'),('core','cat_roles_funcionales'),
            ('core','cat_subsectores'),('core','cat_tematicas'),
            ('core','cat_tipos_actor'),('core','cat_tipos_cambio_caso'),
            ('core','cat_tipos_documento'),
            ('core','cat_tipos_espacio_dialogo'),
            ('core','cat_tipos_hecho'),('core','cat_tipos_organizacion'),
            ('core','cat_tipos_reunion'),('core','cat_unidades_organicas'),
            ('core','compromiso_colaboradores'),('core','compromisos'),
            ('core','cronologia_vinculos'),('core','distritos'),
            ('core','documentos'),('core','entidades'),
            ('core','hitos_compromiso'),('core','log_accesos'),
            ('core','mesas_dialogo'),('core','organizaciones'),
            ('core','output_contracts'),('core','permiso_aprobacion'),
            ('core','provincias'),('core','regiones'),
            ('core','reunion_participantes'),('core','reuniones_dialogo'),
            ('core','roles'),('core','usuario_roles'),('core','usuarios'),
            ('ind','indicador'),('ind','resultado'),('ind','variante'),
            ('kag','cat_corpus'),('kag','documento_fragmento'),
            ('kag','documento_fuente'),
            ('policy','cat_tipos_regla'),('policy','escenario'),
            ('policy','escenario_regla'),('policy','gobierno'),
            ('policy','regla'),('policy','snapshot'),('policy','titular'),
            ('qda','mapeo_pseudonimo'),('qda','proyecto'),
            ('ref','base_legal_evidencia'),('ref','base_legal_tratamiento'),
            ('staging','lote')
   )
   SELECT a.esquema||'.'||a.tabla AS tabla,
          (xpath('/row/c/text()',
                 query_to_xml(format('select count(*) as c from %I.%I',
                                     a.esquema, a.tabla),
                              false, true, '')))[1]::text::bigint AS filas
     FROM alcance a
    ORDER BY 1;

   Suma de control: 8 242 filas en las 73 tablas.
   (Con un rol sujeto a RLS y sin contexto, varias darían 0 sin error.)
   --------------------------------------------------------------------- */

IF OBJECT_ID('tempdb..#esperado') IS NOT NULL DROP TABLE #esperado;
CREATE TABLE #esperado
(
    esquema sysname NOT NULL,
    tabla   sysname NOT NULL,
    filas   bigint  NOT NULL,
    CONSTRAINT pk_esperado PRIMARY KEY (esquema, tabla)
);

INSERT INTO #esperado (esquema, tabla, filas) VALUES
    ('agent',   'run_log',                       0),
    ('audit',   'datos_personales_acceso',    3088),
    ('core',    'actor_datos_personales',      847),
    ('core',    'actor_membresia',             292),
    ('core',    'actores',                    1160),
    ('core',    'alertas_actores',             161),
    ('core',    'alertas_tempranas',            83),
    ('core',    'caso_cronologia',              80),
    ('core',    'caso_estado_historial',        35),
    ('core',    'casos',                        35),
    ('core',    'casos_actores',                60),
    ('core',    'cat_alcances_geograficos',      5),
    ('core',    'cat_ciclos_intervencion',       4),
    ('core',    'cat_clasificacion',             3),
    ('core',    'cat_estados_caso',              4),
    ('core',    'cat_estados_compromiso',        5),
    ('core',    'cat_estados_hito',              5),
    ('core',    'cat_nivel_identificacion',      5),
    ('core',    'cat_niveles_alerta',            4),
    ('core',    'cat_niveles_conflicto',         4),
    ('core',    'cat_niveles_riesgo',            3),
    ('core',    'cat_perfiles_actor',            3),
    ('core',    'cat_prioridades_alerta',        4),
    ('core',    'cat_prioridades_atencion',      3),
    ('core',    'cat_roles_actor',               7),
    ('core',    'cat_roles_funcionales',         4),
    ('core',    'cat_subsectores',               3),
    ('core',    'cat_tematicas',                 7),
    ('core',    'cat_tipos_actor',               7),
    ('core',    'cat_tipos_cambio_caso',         6),
    ('core',    'cat_tipos_documento',           15),
    ('core',    'cat_tipos_espacio_dialogo',     7),
    ('core',    'cat_tipos_hecho',               9),
    ('core',    'cat_tipos_organizacion',        7),
    ('core',    'cat_tipos_reunion',             4),
    ('core',    'cat_unidades_organicas',       66),
    ('core',    'compromiso_colaboradores',      0),
    ('core',    'compromisos',                   8),
    ('core',    'cronologia_vinculos',           5),
    ('core',    'distritos',                   698),
    ('core',    'documentos',                  153),
    ('core',    'entidades',                    23),
    ('core',    'hitos_compromiso',             12),
    ('core',    'log_accesos',                 857),
    ('core',    'mesas_dialogo',                21),
    ('core',    'organizaciones',              224),
    ('core',    'output_contracts',              0),
    ('core',    'permiso_aprobacion',            0),
    ('core',    'provincias',                   70),
    ('core',    'regiones',                     25),
    ('core',    'reunion_participantes',         0),
    ('core',    'reuniones_dialogo',             0),
    ('core',    'roles',                         9),
    ('core',    'usuario_roles',                34),
    ('core',    'usuarios',                     32),
    ('ind',     'indicador',                     0),
    ('ind',     'resultado',                     0),
    ('ind',     'variante',                      0),
    ('kag',     'cat_corpus',                    6),
    ('kag',     'documento_fragmento',            0),
    ('kag',     'documento_fuente',             10),
    ('policy',  'cat_tipos_regla',               5),
    ('policy',  'escenario',                     0),
    ('policy',  'escenario_regla',               0),
    ('policy',  'gobierno',                      0),
    ('policy',  'regla',                        10),
    ('policy',  'snapshot',                      0),
    ('policy',  'titular',                       0),
    ('qda',     'mapeo_pseudonimo',              0),
    ('qda',     'proyecto',                      0),
    ('ref',     'base_legal_evidencia',          0),
    ('ref',     'base_legal_tratamiento',        5),
    ('staging', 'lote',                          0);

/* Suma de control de los valores esperados: debe dar 8242. */
SELECT SUM(filas) AS filas_esperadas_totales,
       COUNT(*)    AS tablas_esperadas
  FROM #esperado;


/* ---------------------------------------------------------------------
   1.2 · Conteo real y comparación
   --------------------------------------------------------------------- */
IF OBJECT_ID('tempdb..#real') IS NOT NULL DROP TABLE #real;
CREATE TABLE #real
(
    esquema sysname NOT NULL,
    tabla   sysname NOT NULL,
    filas   bigint  NULL,          -- NULL = la tabla no existe o no se pudo leer
    mensaje nvarchar(400) NULL
);

DECLARE @esq sysname, @tab sysname, @n bigint, @sql nvarchar(max);

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT esquema, tabla FROM #esperado ORDER BY esquema, tabla;

OPEN cur;
FETCH NEXT FROM cur INTO @esq, @tab;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @n   = NULL;
    SET @sql = N'SELECT @n = COUNT_BIG(*) FROM '
             + QUOTENAME(@esq) + N'.' + QUOTENAME(@tab) + N';';

    BEGIN TRY
        EXEC sp_executesql @sql, N'@n bigint OUTPUT', @n = @n OUTPUT;
        INSERT INTO #real (esquema, tabla, filas) VALUES (@esq, @tab, @n);
    END TRY
    BEGIN CATCH
        INSERT INTO #real (esquema, tabla, filas, mensaje)
        VALUES (@esq, @tab, NULL, ERROR_MESSAGE());
    END CATCH

    FETCH NEXT FROM cur INTO @esq, @tab;
END
CLOSE cur;
DEALLOCATE cur;

/* Informe: sólo las diferencias. Si no devuelve filas, todo cuadra. */
SELECT  e.esquema,
        e.tabla,
        e.filas AS filas_origen,
        r.filas AS filas_destino,
        CASE WHEN r.filas IS NULL            THEN 'FALLA: tabla ausente o ilegible'
             WHEN r.filas <> e.filas         THEN 'FALLA: diferencia de conteo'
             WHEN e.filas = 0                THEN 'OK (vacía en origen)'
             ELSE                                 'OK'
        END AS resultado,
        r.mensaje
  FROM #esperado e
  LEFT JOIN #real r
         ON r.esquema = e.esquema AND r.tabla = e.tabla
 WHERE r.filas IS NULL OR r.filas <> e.filas
 ORDER BY e.esquema, e.tabla;

/* Resumen de una línea. */
SELECT  COUNT(*)                                     AS tablas_comprobadas,
        SUM(CASE WHEN r.filas = e.filas THEN 1 ELSE 0 END) AS coinciden,
        SUM(CASE WHEN r.filas IS NULL OR r.filas <> e.filas THEN 1 ELSE 0 END) AS discrepan
  FROM #esperado e
  LEFT JOIN #real r
         ON r.esquema = e.esquema AND r.tabla = e.tabla;

/* Tablas del destino que NO estaban en el origen (SSMA pudo crear de más). */
SELECT s.name AS esquema, t.name AS tabla_sobrante
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE s.name IN ('agent','audit','core','ind','kag','policy','qda','ref','staging')
   AND NOT EXISTS (SELECT 1 FROM #esperado e
                    WHERE e.esquema = s.name AND e.tabla = t.name)
 ORDER BY 1, 2;
/* Esperado: 0 filas. */


/* ---------------------------------------------------------------------
   1.3 · Identidades (IDENTITY): reajuste de la semilla
   ---------------------------------------------------------------------
   En origen hay 11 columnas con contador: 8 `serial` y 3 IDENTITY.
   `audit.datos_personales_acceso` tiene un hueco: MAX(id) = 3089 con
   3088 filas. Si la semilla queda por debajo, la siguiente alta choca
   con la clave primaria.

   MAX(id) medido en origen:
       audit.datos_personales_acceso 3089
       core.cat_roles_actor             7
       core.cat_subsectores             3
       core.cat_tematicas               7
       core.cat_tipos_actor             7
       core.cat_unidades_organicas     66
       core.distritos                 698
       core.log_accesos               857
       core.provincias                 70
       core.regiones                   25
       policy.titular                   0 (tabla vacía; no necesita reajuste)
   --------------------------------------------------------------------- */

SELECT  OBJECT_SCHEMA_NAME(ic.object_id) AS esquema,
        OBJECT_NAME(ic.object_id)        AS tabla,
        c.name                           AS columna,
        ic.seed_value,
        ic.increment_value,
        ic.last_value
  FROM sys.identity_columns AS ic
  JOIN sys.columns c
         ON c.object_id = ic.object_id AND c.column_id = ic.column_id
 ORDER BY 1, 2;

/* Reajuste idempotente. DBCC CHECKIDENT exige ser dueño de la tabla. */
IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'audit.datos_personales_acceso')), 0) < 3089
    DBCC CHECKIDENT (N'audit.datos_personales_acceso', RESEED, 3089);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.cat_roles_actor')), 0) < 7
    DBCC CHECKIDENT (N'core.cat_roles_actor', RESEED, 7);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.cat_subsectores')), 0) < 3
    DBCC CHECKIDENT (N'core.cat_subsectores', RESEED, 3);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.cat_tematicas')), 0) < 7
    DBCC CHECKIDENT (N'core.cat_tematicas', RESEED, 7);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.cat_tipos_actor')), 0) < 7
    DBCC CHECKIDENT (N'core.cat_tipos_actor', RESEED, 7);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.cat_unidades_organicas')), 0) < 66
    DBCC CHECKIDENT (N'core.cat_unidades_organicas', RESEED, 66);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.distritos')), 0) < 698
    DBCC CHECKIDENT (N'core.distritos', RESEED, 698);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.log_accesos')), 0) < 857
    DBCC CHECKIDENT (N'core.log_accesos', RESEED, 857);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.provincias')), 0) < 70
    DBCC CHECKIDENT (N'core.provincias', RESEED, 70);

IF ISNULL((SELECT last_value FROM sys.identity_columns
            WHERE object_id = OBJECT_ID(N'core.regiones')), 0) < 25
    DBCC CHECKIDENT (N'core.regiones', RESEED, 25);


/* ---------------------------------------------------------------------
   1.4 · Opcional · archivo histórico `legacy` (87 tablas, 4 729 filas)
   ---------------------------------------------------------------------
   Si OGTI no migró todavía `legacy`, saltar este bloque.
   Las tablas vacías de `legacy` son legítimas: es un archivo.
   --------------------------------------------------------------------- */
IF SCHEMA_ID(N'legacy') IS NOT NULL
BEGIN
    IF OBJECT_ID('tempdb..#legado') IS NOT NULL DROP TABLE #legado;
    CREATE TABLE #legado (tabla sysname NOT NULL PRIMARY KEY, filas bigint NOT NULL);

    INSERT INTO #legado (tabla, filas) VALUES
        ('_hojas',86),('bridge_actor_grupo',0),('bridge_alerta_actor',162),
        ('bridge_alerta_actorestado',5),('bridge_alerta_demandas',231),
        ('bridge_alerta_recurso',32),('bridge_capacitacion_participant',9),
        ('bridge_caso_actor',80),('bridge_caso_actor_estado',61),
        ('bridge_caso_actorestado',1),('bridge_caso_causas',4),
        ('bridge_caso_demandas',12),('bridge_caso_depto',87),
        ('bridge_caso_descencadenantes',1),('bridge_caso_impulsores',5),
        ('bridge_caso_ineteres_comunes',0),('bridge_caso_intereses',0),
        ('bridge_caso_medios',4),('bridge_caso_necesidades',0),
        ('bridge_caso_posiciones',0),('bridge_caso_recurso',0),
        ('bridge_clima_actor',1),('bridge_clima_actor_estado',1),
        ('bridge_nodo_actor',3),('bridge_radar_actor',1),
        ('bridge_reporte_actor',1),('bridge_reporte_actor_estado',1),
        ('bridge_sectorista_departamento',27),('dim_acciones_hitos',8),
        ('dim_actores',828),('dim_actores_estado',108),('dim_alertas',83),
        ('dim_anuncios_acuerdos',0),('dim_area_responsable',66),
        ('dim_autoridades',2),('dim_capacitaciones',1),('dim_causas',0),
        ('dim_climasocial',7),('dim_climasocial_focalizado',6),
        ('dim_coordinacion_tecnica',4),('dim_demandas',325),
        ('dim_departamentos',27),('dim_descencadenantes',0),
        ('dim_destinatarios_fijos',4),('dim_distritos',698),
        ('dim_entidad_responsable',23),('dim_estado_proceso',5),
        ('dim_hitos',12),('dim_impulsores',0),('dim_intervencion',4),
        ('dim_locales',27),('dim_medios',0),('dim_mesas_grupos',21),
        ('dim_nivel_alertas',4),('dim_organizacion',224),
        ('dim_paso_proceso',3),('dim_paso_proceso_caso',4),
        ('dim_perfil',3),('dim_provincias',70),('dim_punto_focal',17),
        ('dim_recurso_pesca',37),('dim_redaccion',51),
        ('dim_reporte_rapido',1),('dim_responsable',3),('dim_riesgos',3),
        ('dim_rol_actor',4),('dim_sectoristas',15),('dim_tipo_actor',3),
        ('dim_tipo_actor_radar',3),('dim_tipo_cambio',6),
        ('dim_tipo_caso',4),('dim_tipo_org',4),('dim_tipo_proceso',4),
        ('dim_tipo_sector',3),('dim_tipo_tematica',7),
        ('dim_unidades_organicas_responsa',27),('fact_analisis_casos',1),
        ('fact_casos',35),('fact_hechos_casos',80),
        ('fact_historial_estado',27),('fact_nodo',1),
        ('fact_proceso_caso',36),('fact_proceso_reporte',99),
        ('fact_red_radar',1),('log_accesos',857),('log_envios',17),
        ('respuestas_de_formulario_1',1);

    /* Suma de control: 87 tablas y 4 729 filas. */
    SELECT COUNT(*) AS tablas_legacy_esperadas,
           SUM(filas) AS filas_legacy_esperadas
      FROM #legado;

    DECLARE @lt sysname, @lf bigint, @lreal bigint;
    DECLARE cur2 CURSOR LOCAL FAST_FORWARD FOR SELECT tabla, filas FROM #legado;
    OPEN cur2;
    FETCH NEXT FROM cur2 INTO @lt, @lf;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @lreal = NULL;
        SET @sql   = N'SELECT @n = COUNT_BIG(*) FROM legacy.' + QUOTENAME(@lt) + N';';
        BEGIN TRY
            EXEC sp_executesql @sql, N'@n bigint OUTPUT', @n = @lreal OUTPUT;
        END TRY
        BEGIN CATCH
            SET @lreal = NULL;
        END CATCH

        IF @lreal IS NULL OR @lreal <> @lf
            SELECT 'legacy.' + @lt AS tabla,
                   @lf          AS filas_origen,
                   @lreal       AS filas_destino,
                   'FALLA'      AS resultado;

        FETCH NEXT FROM cur2 INTO @lt, @lf;
    END
    CLOSE cur2;
    DEALLOCATE cur2;
    DROP TABLE #legado;
END
GO


/* =====================================================================
   §2 · JSON: CHECK (ISJSON(columna) = 1)
   =====================================================================
   Las 12 columnas que llegan de `jsonb` (y 0 de `json`).
   Sin este CHECK, un texto cualquiera puede entrar en la columna y
   JSON_VALUE/OPENJSON fallarán en tiempo de consulta, no de escritura.

   Nota: un CHECK se cumple si la expresión da UNKNOWN, así que las 8
   columnas nulables aceptan NULL. Las 4 NOT NULL son
   audit.datos_personales_acceso.contexto, core.documentos.contenido_json,
   ind.variante.especificacion y policy.regla.parametros (todas con
   DEFAULT '{}').
   ===================================================================== */

/* 2.1 · Antes de crear el CHECK: ¿hay algún valor que no sea JSON?
         Todas las filas deben dar 0. */
SELECT 'agent.run_log.detalle'                     AS columna,
       COUNT_BIG(*) AS invalidos
  FROM agent.run_log
 WHERE detalle IS NOT NULL AND ISJSON(detalle) = 0
UNION ALL
SELECT 'audit.datos_personales_acceso.contexto',
       COUNT_BIG(*)
  FROM audit.datos_personales_acceso
 WHERE contexto IS NOT NULL AND ISJSON(contexto) = 0
UNION ALL
SELECT 'core.alertas_tempranas.acciones_sugeridas_json',
       COUNT_BIG(*)
  FROM core.alertas_tempranas
 WHERE acciones_sugeridas_json IS NOT NULL AND ISJSON(acciones_sugeridas_json) = 0
UNION ALL
SELECT 'core.alertas_tempranas.riesgos_json',
       COUNT_BIG(*)
  FROM core.alertas_tempranas
 WHERE riesgos_json IS NOT NULL AND ISJSON(riesgos_json) = 0
UNION ALL
SELECT 'core.cat_tipos_documento.esquema_json',
       COUNT_BIG(*)
  FROM core.cat_tipos_documento
 WHERE esquema_json IS NOT NULL AND ISJSON(esquema_json) = 0
UNION ALL
SELECT 'core.compromisos.criterios_smart',
       COUNT_BIG(*)
  FROM core.compromisos
 WHERE criterios_smart IS NOT NULL AND ISJSON(criterios_smart) = 0
UNION ALL
SELECT 'core.documentos.contenido_json',
       COUNT_BIG(*)
  FROM core.documentos
 WHERE contenido_json IS NOT NULL AND ISJSON(contenido_json) = 0
UNION ALL
SELECT 'core.output_contracts.response_json',
       COUNT_BIG(*)
  FROM core.output_contracts
 WHERE response_json IS NOT NULL AND ISJSON(response_json) = 0
UNION ALL
SELECT 'ind.variante.especificacion',
       COUNT_BIG(*)
  FROM ind.variante
 WHERE especificacion IS NOT NULL AND ISJSON(especificacion) = 0
UNION ALL
SELECT 'policy.cat_tipos_regla.esquema_json',
       COUNT_BIG(*)
  FROM policy.cat_tipos_regla
 WHERE esquema_json IS NOT NULL AND ISJSON(esquema_json) = 0
UNION ALL
SELECT 'policy.regla.parametros',
       COUNT_BIG(*)
  FROM policy.regla
 WHERE parametros IS NOT NULL AND ISJSON(parametros) = 0
UNION ALL
SELECT 'staging.lote.validacion',
       COUNT_BIG(*)
  FROM staging.lote
 WHERE validacion IS NOT NULL AND ISJSON(validacion) = 0;

/* 2.2 · Creación idempotente de los CHECK. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_run_log_detalle_isjson'
                  AND parent_object_id = OBJECT_ID(N'agent.run_log'))
    ALTER TABLE agent.run_log WITH CHECK
      ADD CONSTRAINT ck_run_log_detalle_isjson CHECK (ISJSON(detalle) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_audit_dp_contexto_isjson'
                  AND parent_object_id = OBJECT_ID(N'audit.datos_personales_acceso'))
    ALTER TABLE audit.datos_personales_acceso WITH CHECK
      ADD CONSTRAINT ck_audit_dp_contexto_isjson CHECK (ISJSON(contexto) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_alertas_acciones_json_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.alertas_tempranas'))
    ALTER TABLE core.alertas_tempranas WITH CHECK
      ADD CONSTRAINT ck_alertas_acciones_json_isjson
      CHECK (ISJSON(acciones_sugeridas_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_alertas_riesgos_json_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.alertas_tempranas'))
    ALTER TABLE core.alertas_tempranas WITH CHECK
      ADD CONSTRAINT ck_alertas_riesgos_json_isjson CHECK (ISJSON(riesgos_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_compromisos_criterios_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.compromisos'))
    ALTER TABLE core.compromisos WITH CHECK
      ADD CONSTRAINT ck_compromisos_criterios_isjson
      CHECK (ISJSON(criterios_smart) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_output_response_json_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.output_contracts'))
    ALTER TABLE core.output_contracts WITH CHECK
      ADD CONSTRAINT ck_output_response_json_isjson CHECK (ISJSON(response_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_lote_validacion_isjson'
                  AND parent_object_id = OBJECT_ID(N'staging.lote'))
    ALTER TABLE staging.lote WITH CHECK
      ADD CONSTRAINT ck_lote_validacion_isjson CHECK (ISJSON(validacion) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_cat_tipos_documento_esquema_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.cat_tipos_documento'))
    ALTER TABLE core.cat_tipos_documento WITH CHECK
      ADD CONSTRAINT ck_cat_tipos_documento_esquema_isjson
      CHECK (ISJSON(esquema_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_documentos_contenido_isjson'
                  AND parent_object_id = OBJECT_ID(N'core.documentos'))
    ALTER TABLE core.documentos WITH CHECK
      ADD CONSTRAINT ck_documentos_contenido_isjson
      CHECK (ISJSON(contenido_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_ind_variante_especificacion_isjson'
                  AND parent_object_id = OBJECT_ID(N'ind.variante'))
    ALTER TABLE ind.variante WITH CHECK
      ADD CONSTRAINT ck_ind_variante_especificacion_isjson
      CHECK (ISJSON(especificacion) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_policy_cat_tipos_regla_esquema_isjson'
                  AND parent_object_id = OBJECT_ID(N'policy.cat_tipos_regla'))
    ALTER TABLE policy.cat_tipos_regla WITH CHECK
      ADD CONSTRAINT ck_policy_cat_tipos_regla_esquema_isjson
      CHECK (ISJSON(esquema_json) = 1);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'ck_policy_regla_parametros_isjson'
                  AND parent_object_id = OBJECT_ID(N'policy.regla'))
    ALTER TABLE policy.regla WITH CHECK
      ADD CONSTRAINT ck_policy_regla_parametros_isjson
      CHECK (ISJSON(parametros) = 1);

/* 2.3 · Verificación: los 12 CHECK existen sobre las 11 tablas. */
SELECT OBJECT_SCHEMA_NAME(parent_object_id) AS esquema,
       OBJECT_NAME(parent_object_id)        AS tabla,
       name                                 AS restriccion
  FROM sys.check_constraints
 WHERE name LIKE N'%_isjson'
 ORDER BY 1, 2;
/* Esperado: 12 filas. */


/* =====================================================================
   §3 · DEFAULT NEWID() / NEWSEQUENTIALID() en uniqueidentifier
   =====================================================================
   En origen había 25 columnas `uuid` con DEFAULT gen_random_uuid()
   (el paso 3 les retiró el DEFAULT a propósito). Deben recuperarlo en
   SQL Server. Las otras 89 columnas `uuid` NO llevan DEFAULT: heredan
   el valor de la clave de otra tabla o lo genera la API.
   ===================================================================== */

IF OBJECT_ID('tempdb..#uuid_esperado') IS NOT NULL DROP TABLE #uuid_esperado;
CREATE TABLE #uuid_esperado
(
    esquema sysname NOT NULL,
    tabla   sysname NOT NULL,
    columna sysname NOT NULL,
    CONSTRAINT pk_uuid_esperado PRIMARY KEY (esquema, tabla, columna)
);

INSERT INTO #uuid_esperado (esquema, tabla, columna) VALUES
    ('agent',   'run_log',                 'id'),
    ('core',    'actor_membresia',         'id'),
    ('core',    'actores',                 'actor_uid'),
    ('core',    'alertas_tempranas',       'id'),
    ('core',    'caso_cronologia',         'id'),
    ('core',    'caso_estado_historial',   'id'),
    ('core',    'casos',                   'id'),
    ('core',    'compromisos',             'id'),
    ('core',    'documentos',              'id'),
    ('core',    'hitos_compromiso',        'id'),
    ('core',    'mesas_dialogo',           'id'),
    ('core',    'output_contracts',        'id'),
    ('core',    'permiso_aprobacion',      'id'),
    ('core',    'reuniones_dialogo',       'id'),
    ('core',    'usuarios',                'id'),
    ('ind',     'indicador',               'id'),
    ('ind',     'resultado',               'id'),
    ('ind',     'variante',                'id'),
    ('kag',     'documento_fragmento',     'id'),
    ('kag',     'documento_fuente',        'id'),
    ('policy',  'escenario',               'id'),
    ('policy',  'regla',                   'id'),
    ('policy',  'snapshot',                'id'),
    ('qda',     'proyecto',                'id'),
    ('staging', 'lote',                    'id');

/* 3.1 · Las 25 deben tener default NEWSEQUENTIALID() (o NEWID()).
         Informe: sólo las que faltan o están mal. */
SELECT  e.esquema,
        e.tabla,
        e.columna,
        ISNULL(d.definition, N'(sin DEFAULT)') AS default_actual,
        CASE WHEN d.definition LIKE N'%NEWSEQUENTIALID%' THEN 'OK'
             WHEN d.definition LIKE N'%NEWID%'           THEN 'OK (menos eficiente)'
             ELSE                                             'FALLA'
        END AS resultado
  FROM #uuid_esperado e
  LEFT JOIN sys.schemas s ON s.name = e.esquema
  LEFT JOIN sys.tables  t ON t.name = e.tabla AND t.schema_id = s.schema_id
  LEFT JOIN sys.columns c ON c.object_id = t.object_id AND c.name = e.columna
  LEFT JOIN sys.default_constraints d
         ON d.parent_object_id = t.object_id
        AND d.parent_column_id = c.column_id
 ORDER BY e.esquema, e.tabla, e.columna;

/* 3.2 · No debe haber DEFAULT en ninguna OTRA uniqueidentifier.
         Esperado: 0 filas. */
SELECT s.name AS esquema, t.name AS tabla, c.name AS columna, d.definition
  FROM sys.default_constraints d
  JOIN sys.tables  t ON t.object_id = d.parent_object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.columns c ON c.object_id = d.parent_object_id
                    AND c.column_id = d.parent_column_id
  JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
 WHERE ty.name = N'uniqueidentifier'
   AND s.name IN ('agent','audit','core','ind','kag','policy','qda','ref','staging')
   AND NOT EXISTS (SELECT 1 FROM #uuid_esperado e
                    WHERE e.esquema = s.name
                      AND e.tabla   = t.name
                      AND e.columna = c.name)
 ORDER BY 1, 2, 3;

/* 3.3 · Conteo: 114 columnas uniqueidentifier en las 73 tablas. */
SELECT COUNT(*) AS columnas_uniqueidentifier
  FROM sys.columns c
  JOIN sys.tables  t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
 WHERE ty.name = N'uniqueidentifier'
   AND s.name IN ('agent','audit','core','ind','kag','policy','qda','ref','staging');
/* Esperado: 114. */


/* =====================================================================
   §4 · FECHAS: que ninguna columna haya perdido la zona
   =====================================================================
   En origen hay 44 columnas `timestamptz` (34 con DEFAULT `now()`)
   y 0 `timestamp` sin zona. El destino debe tener 44 `datetimeoffset(7)`
   y 0 `datetime`, `datetime2` o `smalldatetime`.

   Si OGTI decide DATETIME2 en UTC (v10 §3.17.2.v10), §4.1 y §4.2
   deben adaptarse deliberadamente: no dejar que SSMA lo haga solo.
   ===================================================================== */

/* 4.1 · Ninguna columna datetime2/datetime/smalldatetime.
         Esperado: 0 filas. */
SELECT s.name AS esquema, t.name AS tabla, c.name AS columna, ty.name AS tipo
  FROM sys.columns c
  JOIN sys.tables  t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
 WHERE ty.name IN (N'datetime', N'datetime2', N'smalldatetime')
   AND s.name IN ('agent','audit','core','ind','kag','policy','qda','ref','staging')
 ORDER BY 1, 2, 3;

/* 4.2 · Las 44 columnas medidas en origen, una por una. */
IF OBJECT_ID('tempdb..#fechas_esperado') IS NOT NULL DROP TABLE #fechas_esperado;
CREATE TABLE #fechas_esperado
(
    esquema sysname NOT NULL,
    tabla   sysname NOT NULL,
    columna sysname NOT NULL,
    CONSTRAINT pk_fechas_esperado PRIMARY KEY (esquema, tabla, columna)
);

INSERT INTO #fechas_esperado (esquema, tabla, columna) VALUES
    ('agent',   'run_log',                  'ts'),
    ('audit',   'datos_personales_acceso',  'ocurrido_en'),
    ('core',    'actor_datos_personales',   'updated_at'),
    ('core',    'actores',                  'created_at'),
    ('core',    'actores',                  'updated_at'),
    ('core',    'alertas_tempranas',        'created_at'),
    ('core',    'alertas_tempranas',        'updated_at'),
    ('core',    'caso_cronologia',          'created_at'),
    ('core',    'caso_cronologia',          'updated_at'),
    ('core',    'caso_estado_historial',    'desde'),
    ('core',    'caso_estado_historial',    'hasta'),
    ('core',    'casos',                    'created_at'),
    ('core',    'casos',                    'fecha_ultima_actualizacion'),
    ('core',    'casos',                    'updated_at'),
    ('core',    'compromisos',              'created_at'),
    ('core',    'compromisos',              'updated_at'),
    ('core',    'documentos',               'created_at'),
    ('core',    'documentos',               'updated_at'),
    ('core',    'log_accesos',              'fecha'),
    ('core',    'mesas_dialogo',            'created_at'),
    ('core',    'mesas_dialogo',            'updated_at'),
    ('core',    'organizaciones',           'ultima_sync'),
    ('core',    'output_contracts',         'created_at'),
    ('core',    'reuniones_dialogo',        'created_at'),
    ('core',    'reuniones_dialogo',        'fecha'),
    ('core',    'reuniones_dialogo',        'updated_at'),
    ('core',    'usuarios',                 'created_at'),
    ('ind',     'resultado',                'calculado_en'),
    ('ind',     'resultado',                'superseded_at'),
    ('ind',     'resultado',                'valido_desde'),
    ('ind',     'variante',                 'created_at'),
    ('kag',     'documento_fuente',         'fecha_ingesta'),
    ('policy',  'escenario',                'creado_en'),
    ('policy',  'regla',                    'recorded_at'),
    ('policy',  'regla',                    'superseded_at'),
    ('policy',  'regla',                    'valid_from'),
    ('policy',  'regla',                    'valid_to'),
    ('policy',  'snapshot',                 'conocido_en'),
    ('policy',  'snapshot',                 'creado_en'),
    ('policy',  'snapshot',                 'valido_en'),
    ('qda',     'proyecto',                 'importado_en'),
    ('ref',     'base_legal_evidencia',     'created_at'),
    ('ref',     'base_legal_tratamiento',   'created_at'),
    ('staging', 'lote',                     'created_at');

SELECT  f.esquema, f.tabla, f.columna,
        ISNULL(ty.name, N'(columna ausente)') AS tipo_destino,
        c.scale AS escala,
        CASE WHEN ty.name = N'datetimeoffset' THEN 'OK' ELSE 'FALLA: perdió la zona' END AS resultado
  FROM #fechas_esperado f
  LEFT JOIN sys.schemas s ON s.name = f.esquema
  LEFT JOIN sys.tables  t ON t.name = f.tabla AND t.schema_id = s.schema_id
  LEFT JOIN sys.columns c ON c.object_id = t.object_id AND c.name = f.columna
  LEFT JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
 WHERE ty.name IS NULL
    OR ty.name <> N'datetimeoffset'
    OR c.scale <> 7
 ORDER BY f.esquema, f.tabla, f.columna;
/* Esperado: 0 filas. */

/* 4.3 · Conteo por tipo. Esperado: datetimeoffset 44, date 32. */
SELECT ty.name AS tipo, COUNT(*) AS columnas
  FROM sys.columns c
  JOIN sys.tables  t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
 WHERE s.name IN ('agent','audit','core','ind','kag','policy','qda','ref','staging')
   AND ty.name IN (N'datetimeoffset', N'date', N'datetime', N'datetime2',
                   N'smalldatetime', N'time')
 GROUP BY ty.name
 ORDER BY ty.name;


/* =====================================================================
   §5 · SEGURIDAD POR FILA: reconstrucción y pruebas
   =====================================================================
   Se traduce el modelo de PostgreSQL:

     app.rol_codigo            → SESSION_CONTEXT(N'rol_codigo')
     core.clasificacion_max()  → SESSION_CONTEXT(N'nivel_clasificacion')
     core.puede_crear()        → SESSION_CONTEXT(N'puede_crear')
     core.puede_editar()       → SESSION_CONTEXT(N'puede_editar')
     core.puede_eliminar()     → SESSION_CONTEXT(N'puede_eliminar')
     core.puede_auditar()      → SESSION_CONTEXT(N'puede_auditar')

   REGLA DE ORO: esos valores los fija la API desde el token, nunca
   desde el cuerpo de la petición, y se derivan de la fila de
   `core.roles` (como hacía clasificacion_max()), no de un número que
   declare el cliente.

   Las funciones de predicado leen SÓLO SESSION_CONTEXT: no tocan
   tablas, así que no pueden entrar en recursión ni cuestan E/S.
   Si la clave no está, el resultado es NULL → no hay fila → DENIEGA.
   ===================================================================== */

IF SCHEMA_ID(N'seg') IS NULL
    EXEC (N'CREATE SCHEMA seg');
GO

/* ---- 5.1 · Funciones de predicado ---------------------------------- */

/* SELECT: nivel de la fila <= nivel de la sesión. */
CREATE OR ALTER FUNCTION seg.fn_ver (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint);
GO

/* INSERT (WITH CHECK de p_insert + r_rol_insert):
   nivel <= max  AND  max >= 2  AND  puede_crear. */
CREATE OR ALTER FUNCTION seg.fn_insertar (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 2
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint)
       AND TRY_CAST(SESSION_CONTEXT(N'puede_crear') AS bit) = 1;
GO

/* UPDATE, fila anterior (USING de p_update + r_rol_update):
   nivel <= max  AND  max >= 2  AND  puede_editar. */
CREATE OR ALTER FUNCTION seg.fn_actualizar_previo (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 2
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint)
       AND TRY_CAST(SESSION_CONTEXT(N'puede_editar') AS bit) = 1;
GO

/* UPDATE, fila nueva (WITH CHECK de p_update + r_rol_update):
   nivel <= max  AND  puede_editar. */
CREATE OR ALTER FUNCTION seg.fn_actualizar_nuevo (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint)
       AND TRY_CAST(SESSION_CONTEXT(N'puede_editar') AS bit) = 1;
GO

/* DELETE (USING de p_delete + r_rol_delete):
   nivel <= max  AND  max >= 3  AND  puede_eliminar. */
CREATE OR ALTER FUNCTION seg.fn_borrar (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 3
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint)
       AND TRY_CAST(SESSION_CONTEXT(N'puede_eliminar') AS bit) = 1;
GO

/* staging.lote NO tiene políticas r_rol_* en origen: sólo clasificación.
   Se replica tal cual para no cambiar el comportamiento. */
CREATE OR ALTER FUNCTION seg.fn_insertar_clasif (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 2
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint);
GO

CREATE OR ALTER FUNCTION seg.fn_actualizar_previo_clasif (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 2
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint);
GO

CREATE OR ALTER FUNCTION seg.fn_actualizar_nuevo_clasif (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint);
GO

CREATE OR ALTER FUNCTION seg.fn_borrar_clasif (@nivel smallint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint) >= 3
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS smallint);
GO

/* Bitácora de PII: sólo lectura para administrador, auditor y
   alta_direccion (equivale a core.puede_auditar()).
   El parámetro existe porque un predicado FILTER recibe una columna;
   no se usa en la comparación. */
CREATE OR ALTER FUNCTION seg.fn_auditar (@id bigint)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'puede_auditar') AS bit) = 1;
GO

/* ---- 5.2 · Política de seguridad ----------------------------------
   Una sola política para las 15 tablas protegidas en origen.
   FILTER      → SELECT (y visibilidad de las filas para UPDATE/DELETE)
   BLOCK AFTER INSERT   → WITH CHECK del INSERT
   BLOCK BEFORE UPDATE  → USING del UPDATE (fila anterior)
   BLOCK AFTER UPDATE   → WITH CHECK del UPDATE (fila nueva)
   BLOCK BEFORE DELETE  → USING del DELETE
   --------------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.security_policies
            WHERE name = N'pol_avisa' AND schema_id = SCHEMA_ID(N'seg'))
    DROP SECURITY POLICY seg.pol_avisa;
GO

CREATE SECURITY POLICY seg.pol_avisa

    /* --- 13 tablas con clasificación + capacidades --- */
    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON core.actor_datos_personales,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.actor_datos_personales AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.actor_datos_personales BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.actor_datos_personales AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.actor_datos_personales BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON core.actores,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.actores AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.actores BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.actores AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.actores BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON core.alertas_tempranas,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.alertas_tempranas AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.alertas_tempranas BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.alertas_tempranas AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.alertas_tempranas BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON core.caso_cronologia,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.caso_cronologia AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.caso_cronologia BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.caso_cronologia AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.caso_cronologia BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON core.casos,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.casos AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.casos BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.casos AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.casos BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON core.compromisos,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.compromisos AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.compromisos BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.compromisos AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.compromisos BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON core.documentos,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.documentos AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.documentos BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.documentos AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.documentos BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON core.reuniones_dialogo,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON core.reuniones_dialogo AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON core.reuniones_dialogo BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON core.reuniones_dialogo AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON core.reuniones_dialogo BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON qda.mapeo_pseudonimo,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON qda.mapeo_pseudonimo AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON qda.mapeo_pseudonimo BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON qda.mapeo_pseudonimo AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON qda.mapeo_pseudonimo BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON qda.proyecto,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON qda.proyecto AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON qda.proyecto BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON qda.proyecto AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON qda.proyecto BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON kag.documento_fragmento,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON kag.documento_fragmento AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON kag.documento_fragmento BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON kag.documento_fragmento AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON kag.documento_fragmento BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON kag.documento_fuente,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON kag.documento_fuente AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON kag.documento_fuente BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON kag.documento_fuente AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON kag.documento_fuente BEFORE DELETE,

    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion)
        ON policy.regla,
    ADD BLOCK  PREDICATE seg.fn_insertar(nivel_clasificacion)
        ON policy.regla AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo(nivel_clasificacion)
        ON policy.regla BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo(nivel_clasificacion)
        ON policy.regla AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar(nivel_clasificacion)
        ON policy.regla BEFORE DELETE,

    /* --- staging.lote: sólo clasificación (como en origen) --- */
    ADD FILTER PREDICATE seg.fn_ver(nivel_clasificacion) ON staging.lote,
    ADD BLOCK  PREDICATE seg.fn_insertar_clasif(nivel_clasificacion)
        ON staging.lote AFTER INSERT,
    ADD BLOCK  PREDICATE seg.fn_actualizar_previo_clasif(nivel_clasificacion)
        ON staging.lote BEFORE UPDATE,
    ADD BLOCK  PREDICATE seg.fn_actualizar_nuevo_clasif(nivel_clasificacion)
        ON staging.lote AFTER UPDATE,
    ADD BLOCK  PREDICATE seg.fn_borrar_clasif(nivel_clasificacion)
        ON staging.lote BEFORE DELETE,

    /* --- bitácora de PII: lectura sólo con puede_auditar --- */
    ADD FILTER PREDICATE seg.fn_auditar(id)
        ON audit.datos_personales_acceso

WITH (STATE = ON);
GO

/* 5.3 · Verificación de la política: 15 tablas, 71 predicados. */
SELECT OBJECT_SCHEMA_NAME(p.target_object_id) AS esquema,
       OBJECT_NAME(p.target_object_id)        AS tabla,
       p.predicate_type_desc                  AS predicado,
       sp.name                                AS politica,
       p.is_enabled
  FROM sys.security_predicates p
  JOIN sys.security_policies  sp ON sp.object_id = p.security_policy_id
 ORDER BY 1, 2, 3;


/* ---------------------------------------------------------------------
   5.4 · Pruebas
   ---------------------------------------------------------------------
   Las políticas se aplican a todos los usuarios de la base, incluidos
   dbo y db_owner. Aun así se prueba con un usuario sin privilegios y
   EXECUTE AS USER, por dos motivos:
     · un login con permisos de DDL sobre seg.* podría alterar o
       desactivar la política y falsear la prueba;
     · así se comprueba exactamente lo que verá el login de la API.

   Si la sesión ya fijó las claves con @read_only = 1, sp_set_session_context
   fallará al intentar cambiarlas: ejecutar las pruebas en una conexión
   nueva.
   --------------------------------------------------------------------- */

IF DATABASE_PRINCIPAL_ID(N'avisa_prueba_rls') IS NULL
    CREATE USER avisa_prueba_rls WITHOUT LOGIN;
GO

GRANT SELECT ON SCHEMA::core  TO avisa_prueba_rls;
GRANT SELECT ON SCHEMA::audit TO avisa_prueba_rls;
GRANT SELECT, INSERT ON staging.lote TO avisa_prueba_rls;
GO

/* La prueba 4 necesita permiso de UPDATE: si no se concede, el error
   sería "permission denied" y no probaría nada de la RLS. */
GRANT UPDATE ON core.actores TO avisa_prueba_rls;
GO

PRINT '--- Prueba 1: SIN contexto de sesión no se ve NADA ---';
EXEC sp_set_session_context @key = N'rol_codigo',          @value = NULL;
EXEC sp_set_session_context @key = N'nivel_clasificacion', @value = NULL;
EXEC sp_set_session_context @key = N'puede_crear',         @value = NULL;
EXEC sp_set_session_context @key = N'puede_editar',        @value = NULL;
EXEC sp_set_session_context @key = N'puede_eliminar',      @value = NULL;
EXEC sp_set_session_context @key = N'puede_auditar',       @value = NULL;

EXECUTE AS USER = N'avisa_prueba_rls';
    SELECT COUNT_BIG(*) AS actores_visibles   FROM core.actores;              -- 0
    SELECT COUNT_BIG(*) AS casos_visibles     FROM core.casos;                -- 0
    SELECT COUNT_BIG(*) AS pii_visibles       FROM core.actor_datos_personales; -- 0
    SELECT COUNT_BIG(*) AS auditoria_visible  FROM audit.datos_personales_acceso; -- 0
REVERT;
GO

PRINT '--- Prueba 2: nivel 2 (tipo consulta_lectura) ---';
EXEC sp_set_session_context @key = N'rol_codigo',          @value = N'consulta_lectura', @read_only = 0;
EXEC sp_set_session_context @key = N'nivel_clasificacion', @value = 2,                    @read_only = 0;
EXEC sp_set_session_context @key = N'puede_crear',         @value = 0,                    @read_only = 0;
EXEC sp_set_session_context @key = N'puede_editar',        @value = 0,                    @read_only = 0;
EXEC sp_set_session_context @key = N'puede_eliminar',      @value = 0,                    @read_only = 0;
EXEC sp_set_session_context @key = N'puede_auditar',       @value = 0,                    @read_only = 0;

EXECUTE AS USER = N'avisa_prueba_rls';
    SELECT COUNT_BIG(*) AS actores_visibles  FROM core.actores;              -- 1160
    SELECT COUNT_BIG(*) AS casos_visibles    FROM core.casos;                -- 35
    SELECT COUNT_BIG(*) AS pii_visibles      FROM core.actor_datos_personales; -- 0 (son nivel 3)
    SELECT COUNT_BIG(*) AS auditoria_visible FROM audit.datos_personales_acceso; -- 0
REVERT;
GO

PRINT '--- Prueba 3: nivel 3 + puede_auditar (tipo administrador) ---';
EXEC sp_set_session_context @key = N'rol_codigo',          @value = N'administrador', @read_only = 0;
EXEC sp_set_session_context @key = N'nivel_clasificacion', @value = 3,              @read_only = 0;
EXEC sp_set_session_context @key = N'puede_auditar',       @value = 1,              @read_only = 0;

EXECUTE AS USER = N'avisa_prueba_rls';
    SELECT COUNT_BIG(*) AS actores_visibles  FROM core.actores;                 -- 1160
    SELECT COUNT_BIG(*) AS pii_visibles      FROM core.actor_datos_personales;  -- 847
    SELECT COUNT_BIG(*) AS auditoria_visible FROM audit.datos_personales_acceso; -- 3088
REVERT;
GO

PRINT '--- Prueba 3b: nivel 3 pero SIN puede_auditar ---';
EXEC sp_set_session_context @key = N'puede_auditar', @value = 0, @read_only = 0;
EXECUTE AS USER = N'avisa_prueba_rls';
    SELECT COUNT_BIG(*) AS auditoria_visible FROM audit.datos_personales_acceso; -- 0
REVERT;
GO

PRINT '--- Prueba 4: puede_editar = 0 -> el UPDATE no modifica filas ---';
/* Semántica: el BLOCK ... BEFORE UPDATE hace de USING (como en PostgreSQL).
   Lo que NUNCA puede pasar es que se actualice una fila; según la versión,
   las filas se descartan en silencio (0 filas) o la sentencia falla. Se
   aceptan las dos respuestas y se rechaza cualquier otra. */
EXEC sp_set_session_context @key = N'puede_editar', @value = 0, @read_only = 0;
EXECUTE AS USER = N'avisa_prueba_rls';
    BEGIN TRY
        UPDATE TOP (1) core.actores SET nombre_actual = nombre_actual;
        SELECT @@ROWCOUNT AS filas_actualizadas;   -- 0
    END TRY
    BEGIN CATCH
        PRINT 'OK: el UPDATE fue bloqueado con error -> ' + ERROR_MESSAGE();
    END CATCH
REVERT;
GO

PRINT '--- Prueba 5: nivel 1 no puede insertar una fila de nivel 2 ---';
EXEC sp_set_session_context @key = N'nivel_clasificacion', @value = 1, @read_only = 0;
EXECUTE AS USER = N'avisa_prueba_rls';
    BEGIN TRANSACTION;
    BEGIN TRY
        INSERT INTO staging.lote
               (id, punto_ingesta_id, archivo_uri, hash_archivo, nivel_clasificacion)
        VALUES (NEWID(), 1, N'prueba://rls', REPLICATE(N'0', 64), 2);

        PRINT 'FALLA: el INSERT debió bloquearse';
    END TRY
    BEGIN CATCH
        PRINT 'OK: INSERT bloqueado -> ' + ERROR_MESSAGE();
    END CATCH
    ROLLBACK TRANSACTION;
REVERT;
GO

/* Limpieza del usuario de prueba (ejecutar cuando ya no haga falta):
       DROP USER avisa_prueba_rls;
*/


/* =====================================================================
   §6 · ÍNDICES: parciales y únicos con NULL
   =====================================================================
   Dos problemas distintos:

   A) Índices PARCIALES (WHERE ...): se traducen a índices FILTRADOS,
      salvo que el predicado use IN / NOT IN, que no se admite.

   B) Índices ÚNICOS sobre columnas nulables: PostgreSQL admite muchos
      NULL; SQL Server, UNO SOLO. Medido en origen, seis índices únicos
      fallarían tal cual:
          core.organizaciones.ruc                   219 NULL de 224
          core.usuarios.email                        27 NULL de 32
          core.usuarios.sso_subject                  32 NULL de 32
          core.caso_estado_historial.codigo_legado   35 NULL de 35
          core.cat_tipos_actor.codigo_legado          4 de 7
          core.compromisos.redefinido_de_id           8 de 8
      Solución: índice único FILTRADO con `WHERE col IS NOT NULL`.
   ===================================================================== */

/* 6.1 · Comprobación de NULL antes de crear los índices. */
SELECT 'core.organizaciones' AS tabla, 'ruc' AS columna,
       COUNT_BIG(*) AS filas, COUNT_BIG(*) - COUNT(ruc) AS nulos
  FROM core.organizaciones
UNION ALL
SELECT 'core.usuarios', 'email',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(email)
  FROM core.usuarios
UNION ALL
SELECT 'core.usuarios', 'sso_subject',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(sso_subject)
  FROM core.usuarios
UNION ALL
SELECT 'core.caso_estado_historial', 'codigo_legado',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(codigo_legado)
  FROM core.caso_estado_historial
UNION ALL
SELECT 'core.cat_tipos_actor', 'codigo_legado',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(codigo_legado)
  FROM core.cat_tipos_actor
UNION ALL
SELECT 'core.compromisos', 'redefinido_de_id',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(redefinido_de_id)
  FROM core.compromisos
UNION ALL
SELECT 'core.usuarios', 'dni',
       COUNT_BIG(*), COUNT_BIG(*) - COUNT(dni)
  FROM core.usuarios
ORDER BY nulos DESC;

/* ---------------------------------------------------------------------
   6.2 · Restricciones UNIQUE de origen que hay que convertir en
         índice único FILTRADO.

   Dos pasos, en este orden y para cada columna:
     1) si existe una UNIQUE CONSTRAINT con ese nombre, se elimina;
     2) si existe un índice con ese nombre pero SIN filtro, se elimina
        (SSMA pudo crearlo como índice normal: dejaría pasar un solo NULL);
     3) se crea el índice único filtrado sólo si no existe ya.

   Sin el paso 2, un índice no filtrado preexistente haría que el paso 3
   no se ejecutara y el destino quedaría con la unicidad equivocada.
   --------------------------------------------------------------------- */

/* --- core.organizaciones.ruc (219 NULL de 224) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'organizaciones_ruc_key'
              AND parent_object_id = OBJECT_ID(N'core.organizaciones'))
    ALTER TABLE core.organizaciones DROP CONSTRAINT organizaciones_ruc_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'organizaciones_ruc_key'
              AND object_id = OBJECT_ID(N'core.organizaciones')
              AND has_filter = 0)
    DROP INDEX organizaciones_ruc_key ON core.organizaciones;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'organizaciones_ruc_key'
                  AND object_id = OBJECT_ID(N'core.organizaciones'))
    CREATE UNIQUE INDEX organizaciones_ruc_key
        ON core.organizaciones(ruc) WHERE ruc IS NOT NULL;

/* --- core.usuarios.email (27 NULL de 32) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'usuarios_email_key'
              AND parent_object_id = OBJECT_ID(N'core.usuarios'))
    ALTER TABLE core.usuarios DROP CONSTRAINT usuarios_email_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'usuarios_email_key'
              AND object_id = OBJECT_ID(N'core.usuarios')
              AND has_filter = 0)
    DROP INDEX usuarios_email_key ON core.usuarios;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'usuarios_email_key'
                  AND object_id = OBJECT_ID(N'core.usuarios'))
    CREATE UNIQUE INDEX usuarios_email_key
        ON core.usuarios(email) WHERE email IS NOT NULL;

/* --- core.usuarios.sso_subject (32 NULL de 32) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'usuarios_sso_subject_key'
              AND parent_object_id = OBJECT_ID(N'core.usuarios'))
    ALTER TABLE core.usuarios DROP CONSTRAINT usuarios_sso_subject_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'usuarios_sso_subject_key'
              AND object_id = OBJECT_ID(N'core.usuarios')
              AND has_filter = 0)
    DROP INDEX usuarios_sso_subject_key ON core.usuarios;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'usuarios_sso_subject_key'
                  AND object_id = OBJECT_ID(N'core.usuarios'))
    CREATE UNIQUE INDEX usuarios_sso_subject_key
        ON core.usuarios(sso_subject) WHERE sso_subject IS NOT NULL;

/* --- core.caso_estado_historial.codigo_legado (35 NULL de 35) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'caso_estado_historial_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.caso_estado_historial'))
    ALTER TABLE core.caso_estado_historial
        DROP CONSTRAINT caso_estado_historial_codigo_legado_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'caso_estado_historial_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.caso_estado_historial')
              AND has_filter = 0)
    DROP INDEX caso_estado_historial_codigo_legado_key
        ON core.caso_estado_historial;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'caso_estado_historial_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.caso_estado_historial'))
    CREATE UNIQUE INDEX caso_estado_historial_codigo_legado_key
        ON core.caso_estado_historial(codigo_legado)
        WHERE codigo_legado IS NOT NULL;

/* --- core.cat_tipos_actor.codigo_legado (4 NULL de 7) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'cat_tipos_actor_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.cat_tipos_actor'))
    ALTER TABLE core.cat_tipos_actor
        DROP CONSTRAINT cat_tipos_actor_codigo_legado_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'cat_tipos_actor_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.cat_tipos_actor')
              AND has_filter = 0)
    DROP INDEX cat_tipos_actor_codigo_legado_key ON core.cat_tipos_actor;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'cat_tipos_actor_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.cat_tipos_actor'))
    CREATE UNIQUE INDEX cat_tipos_actor_codigo_legado_key
        ON core.cat_tipos_actor(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* --- core.compromisos.redefinido_de_id (8 NULL de 8) --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'compromisos_redefinido_de_id_key'
              AND parent_object_id = OBJECT_ID(N'core.compromisos'))
    ALTER TABLE core.compromisos DROP CONSTRAINT compromisos_redefinido_de_id_key;

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'compromisos_redefinido_de_id_key'
              AND object_id = OBJECT_ID(N'core.compromisos')
              AND has_filter = 0)
    DROP INDEX compromisos_redefinido_de_id_key ON core.compromisos;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'compromisos_redefinido_de_id_key'
                  AND object_id = OBJECT_ID(N'core.compromisos'))
    CREATE UNIQUE INDEX compromisos_redefinido_de_id_key
        ON core.compromisos(redefinido_de_id)
        WHERE redefinido_de_id IS NOT NULL;

/* ---------------------------------------------------------------------
   6.2b · Los 5 UNIQUE que HOY no fallan pero fallarían mañana
   ---------------------------------------------------------------------
   Estos 5 índices tienen una columna nulable pero hoy 0 NULL (medido).
   Un índice único NO filtrado de SQL Server acepta un solo NULL; el
   segundo rechazaría el alta. En PostgreSQL se admiten muchos, así que
   para conservar el comportamiento de origen también se filtran.
   Son UNIQUE constraints en origen (contype = 'u').
   --------------------------------------------------------------------- */

/* --- core.actores.codigo_legado --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'actores_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.actores'))
    ALTER TABLE core.actores DROP CONSTRAINT actores_codigo_legado_key;
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'actores_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.actores') AND has_filter = 0)
    DROP INDEX actores_codigo_legado_key ON core.actores;
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'actores_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.actores'))
    CREATE UNIQUE INDEX actores_codigo_legado_key
        ON core.actores(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* --- core.alertas_tempranas.codigo_legado --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'alertas_tempranas_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.alertas_tempranas'))
    ALTER TABLE core.alertas_tempranas
        DROP CONSTRAINT alertas_tempranas_codigo_legado_key;
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'alertas_tempranas_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.alertas_tempranas') AND has_filter = 0)
    DROP INDEX alertas_tempranas_codigo_legado_key ON core.alertas_tempranas;
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'alertas_tempranas_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.alertas_tempranas'))
    CREATE UNIQUE INDEX alertas_tempranas_codigo_legado_key
        ON core.alertas_tempranas(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* --- core.caso_cronologia.codigo_legado --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'caso_cronologia_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.caso_cronologia'))
    ALTER TABLE core.caso_cronologia
        DROP CONSTRAINT caso_cronologia_codigo_legado_key;
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'caso_cronologia_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.caso_cronologia') AND has_filter = 0)
    DROP INDEX caso_cronologia_codigo_legado_key ON core.caso_cronologia;
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'caso_cronologia_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.caso_cronologia'))
    CREATE UNIQUE INDEX caso_cronologia_codigo_legado_key
        ON core.caso_cronologia(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* --- core.casos.codigo_legado --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'casos_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.casos'))
    ALTER TABLE core.casos DROP CONSTRAINT casos_codigo_legado_key;
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'casos_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.casos') AND has_filter = 0)
    DROP INDEX casos_codigo_legado_key ON core.casos;
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'casos_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.casos'))
    CREATE UNIQUE INDEX casos_codigo_legado_key
        ON core.casos(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* --- core.usuarios.codigo_legado --- */
IF EXISTS (SELECT 1 FROM sys.key_constraints
            WHERE name = N'usuarios_codigo_legado_key'
              AND parent_object_id = OBJECT_ID(N'core.usuarios'))
    ALTER TABLE core.usuarios DROP CONSTRAINT usuarios_codigo_legado_key;
IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = N'usuarios_codigo_legado_key'
              AND object_id = OBJECT_ID(N'core.usuarios') AND has_filter = 0)
    DROP INDEX usuarios_codigo_legado_key ON core.usuarios;
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'usuarios_codigo_legado_key'
                  AND object_id = OBJECT_ID(N'core.usuarios'))
    CREATE UNIQUE INDEX usuarios_codigo_legado_key
        ON core.usuarios(codigo_legado) WHERE codigo_legado IS NOT NULL;

/* ---------------------------------------------------------------------
   6.3 · Los 3 índices únicos parciales del origen (traducción directa).
   --------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ux_usuarios_dni' AND object_id = OBJECT_ID(N'core.usuarios'))
    CREATE UNIQUE INDEX ux_usuarios_dni
        ON core.usuarios(dni) WHERE dni IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ux_caso_historial_vigente'
                  AND object_id = OBJECT_ID(N'core.caso_estado_historial'))
    CREATE UNIQUE INDEX ux_caso_historial_vigente
        ON core.caso_estado_historial(caso_id) WHERE hasta IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ux_ind_resultado_vigente'
                  AND object_id = OBJECT_ID(N'ind.resultado'))
    CREATE UNIQUE INDEX ux_ind_resultado_vigente
        ON ind.resultado(variante_id, distrito_id, periodo)
        WHERE superseded_at IS NULL;
/* Nota: distrito_id es nulable. Con el índice filtrado sólo puede
   existir UNA fila con distrito_id NULL por (variante_id, periodo).
   Hoy ind.resultado tiene 0 filas. */

/* ---------------------------------------------------------------------
   6.4 · Índices parciales NO únicos de traducción directa.
   --------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ix_membresia_org'
                  AND object_id = OBJECT_ID(N'core.actor_membresia'))
    CREATE INDEX ix_membresia_org
        ON core.actor_membresia(organizacion_uid) WHERE valid_to IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ix_output_chat_commit'
                  AND object_id = OBJECT_ID(N'core.output_contracts'))
    CREATE INDEX ix_output_chat_commit
        ON core.output_contracts(chat_commit_id) WHERE chat_commit_id IS NOT NULL;

/* ---------------------------------------------------------------------
   6.5 · Los 2 que NO se pueden traducir literalmente
   ---------------------------------------------------------------------
   El predicado de un índice filtrado no admite IN ni NOT IN.
   Se dejan como índice plano: se pierde el filtro (índice algo mayor),
   pero se conserva el patrón de consulta. La alternativa con dos
   índices filtrados o con columna calculada está comentada.
   --------------------------------------------------------------------- */

/* core.casos.ix_casos_activos
   Origen: (nivel_riesgo_id, fecha_ultima_actualizacion DESC)
           WHERE estado_id IN (1, 2)
   Alternativa A (recomendada si el espacio no importa): dos índices.
       CREATE INDEX ix_casos_activos_1 ON core.casos(nivel_riesgo_id, fecha_ultima_actualizacion DESC) WHERE estado_id = 1;
       CREATE INDEX ix_casos_activos_2 ON core.casos(nivel_riesgo_id, fecha_ultima_actualizacion DESC) WHERE estado_id = 2;
   Aquí: índice plano. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ix_casos_activos' AND object_id = OBJECT_ID(N'core.casos'))
    CREATE INDEX ix_casos_activos
        ON core.casos(nivel_riesgo_id, fecha_ultima_actualizacion DESC);

/* core.hitos_compromiso.ix_hitos_por_vencer
   Origen: (fecha_vencimiento) WHERE estado_id NOT IN (4, 5)
   Alternativa: columna calculada persistida + índice filtrado.
       ALTER TABLE core.hitos_compromiso
         ADD es_vigente AS (CASE WHEN estado_id NOT IN (4,5) THEN 1 ELSE 0 END) PERSISTED;
       CREATE INDEX ix_hitos_por_vencer ON core.hitos_compromiso(fecha_vencimiento) WHERE es_vigente = 1;
   Esa columna no existe en origen: añadirla obliga a tocar el modelo de
   EF Core. Aquí: índice plano. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'ix_hitos_por_vencer'
                  AND object_id = OBJECT_ID(N'core.hitos_compromiso'))
    CREATE INDEX ix_hitos_por_vencer
        ON core.hitos_compromiso(fecha_vencimiento);

/* 6.6 · Verificación: índices filtrados creados.
         Esperado: 16 (5 parciales directos de origen + 6 únicos con NULL
         que fallaban + 5 únicos con NULL que aún no fallaban). */
SELECT OBJECT_SCHEMA_NAME(i.object_id) AS esquema,
       OBJECT_NAME(i.object_id)        AS tabla,
       i.name,
       i.is_unique,
       i.filter_definition
  FROM sys.indexes i
 WHERE i.has_filter = 1
 ORDER BY 1, 2, 3;


/* =====================================================================
   §7 · OPCIONAL · comentarios (propiedades extendidas)
   =====================================================================
   En la base fuente `avisa` hay 411 comentarios en tablas y columnas del
   alcance (39 de tabla + 372 de columna) más 10 de función. En la copia de
   staging `avisa_mssql` son 410: `agent.run_log` tiene comentario de tabla en
   `avisa` pero lo perdió al aplanarse en el paso 1. SSMA no los trae.
   Se reconstruyen con sp_addextendedproperty; aquí sólo se comprueba
   cuántos hay.
   ===================================================================== */
SELECT COUNT(*) AS propiedades_extendidas
  FROM sys.extended_properties ep
 WHERE ep.major_id IN (
        SELECT t.object_id
          FROM sys.tables t
          JOIN sys.schemas s ON s.schema_id = t.schema_id
         WHERE s.name IN ('agent','audit','core','ind','policy','qda','ref','staging'));
/* Esperado: 410 si se restaura desde `avisa_mssql`; 411 si se restaura
   desde la base fuente `avisa` (allí `agent.run_log` sí tiene el suyo). */

PRINT '=== AVISA · chequeos post-migración · fin ===';
GO
