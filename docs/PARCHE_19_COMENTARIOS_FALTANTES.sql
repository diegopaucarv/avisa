-- =====================================================================
--  PARCHE 19 · LOS 19 COMENTARIOS QUE FALTABAN
-- =====================================================================
--  QUÉ CIERRA
--  El parche 12 comentó las columnas del modelo tal como estaban el
--  2026-11-18. El parche 17 creó después tres tablas
--  (`core.cat_privilegio`, `core.privilegio_usuario`,
--  `core.consulta_reniec`) y añadió cinco columnas a
--  `core.envios_comunicacion`, así que 19 columnas quedaron sin
--  descripción en la base. Este parche solo agrega esos 19 comentarios:
--  ninguna otra sentencia, ningún cambio de estructura.
--
--  POR QUÉ UN PARCHE APARTE Y NO EDITAR EL 17
--  El 17 ya está aplicado y se reejecuta entero cuando se levanta un
--  entorno nuevo. Añadirle sentencias cambiaría el contenido de un
--  parche cerrado; uno nuevo deja el rastro de qué se corrigió y cuándo.
--
--  IDEMPOTENTE
--  `COMMENT ON` sobrescribe el comentario anterior, así que se puede
--  ejecutar cuantas veces sea necesario sin error ni duplicados.
--
--  CÓMO SE APLICA
--      psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--          -f docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
-- =====================================================================

\echo 'PARCHE 19 · comentarios faltantes de los parches 15 y 17'

BEGIN;

-- ---------------------------------------------------------------------
-- 1 · core.cat_privilegio (parche 17)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.cat_privilegio.id IS
    'Identificador corto del privilegio; es la clave que usan las tablas de concesión.';
COMMENT ON COLUMN core.cat_privilegio.codigo IS
    'Código estable del privilegio, el que consultan las funciones de permiso.';
COMMENT ON COLUMN core.cat_privilegio.nombre IS
    'Nombre del privilegio tal como se muestra a las personas.';
COMMENT ON COLUMN core.cat_privilegio.descripcion IS
    'Qué permite hacer el privilegio, en una frase.';

-- ---------------------------------------------------------------------
-- 2 · core.privilegio_usuario (parche 17)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.privilegio_usuario.id IS
    'Identificador interno de la fila';
COMMENT ON COLUMN core.privilegio_usuario.usuario_id IS
    'Persona que recibe el privilegio, según core.usuarios.';
COMMENT ON COLUMN core.privilegio_usuario.privilegio_id IS
    'Privilegio concedido, según core.cat_privilegio.';
COMMENT ON COLUMN core.privilegio_usuario.desde IS
    'Fecha desde la que rige la concesión.';
COMMENT ON COLUMN core.privilegio_usuario.otorgado_por_usuario_id IS
    'Persona que autorizó la concesión; queda registrada para la auditoría.';
COMMENT ON COLUMN core.privilegio_usuario.activo IS
    'Si la concesión está vigente. Se apaga para retirar el privilegio sin borrar el rastro.';
COMMENT ON COLUMN core.privilegio_usuario.creado_en IS
    'Momento en que se registró la concesión.';

-- ---------------------------------------------------------------------
-- 3 · core.consulta_reniec (parche 17)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.consulta_reniec.id IS
    'Identificador interno de la consulta.';
COMMENT ON COLUMN core.consulta_reniec.actor_uid IS
    'Actor sobre el que se consultó, según core.actores.';
COMMENT ON COLUMN core.consulta_reniec.caso_id IS
    'Caso en cuyo contexto se pidió la consulta, si la consulta se hizo por uno.';
COMMENT ON COLUMN core.consulta_reniec.consultado_por_usuario_id IS
    'Persona que pidió y ejecutó la consulta; solo puede ser quien tiene el privilegio.';
COMMENT ON COLUMN core.consulta_reniec.fecha_consulta IS
    'Momento en que se hizo la consulta a PIDE-RENIEC.';
COMMENT ON COLUMN core.consulta_reniec.integracion_id IS
    'Integración por la que se llegó al servicio, según core.integraciones.';

-- ---------------------------------------------------------------------
-- 4 · core.envios_comunicacion, columnas del parche 17
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.envios_comunicacion.plantilla_codigo IS
    'Código de la plantilla de mensaje con la que se redactó el envío.';
COMMENT ON COLUMN core.envios_comunicacion.actualizado_en IS
    'Momento de la última actualización del estado del envío.';

-- ---------------------------------------------------------------------
-- 5 · Verificación: el modelo no debe tener ninguna columna sin describir
-- ---------------------------------------------------------------------
DO $p19_verify$
DECLARE
    v_sin integer;
BEGIN
    WITH modelo AS (
        SELECT c.oid
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'legacy')
           AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
    )
    SELECT count(*) INTO v_sin
      FROM pg_attribute a
      JOIN modelo m ON m.oid = a.attrelid
     WHERE a.attnum > 0
       AND NOT a.attisdropped
       AND NOT EXISTS (
           SELECT 1 FROM pg_description d
            WHERE d.objoid = m.oid AND d.objsubid = a.attnum
       );

    IF v_sin <> 0 THEN
        RAISE EXCEPTION 'quedan % columnas del modelo sin comentario', v_sin;
    END IF;

    RAISE NOTICE 'columnas del modelo sin comentario: 0';
END
$p19_verify$;

COMMIT;

\echo 'PARCHE 19 · aplicado'
