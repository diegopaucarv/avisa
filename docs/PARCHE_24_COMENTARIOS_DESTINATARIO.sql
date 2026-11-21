-- =====================================================================
--  PARCHE 24 · LOS SIETE COMENTARIOS QUE FALTABAN EN EL DESTINATARIO
-- =====================================================================
--  QUÉ CIERRA
--  El parche 23 creó `core.alerta_destinatario` y describió cuatro de
--  sus once columnas (`usuario_id`, `cargo`, `canal`, `notificado_en`).
--  Las otras siete —`id`, `alerta_id`, `motivo`, `created_at`,
--  `updated_at`, `created_by`, `updated_by`— quedaron sin descripción.
--  Hoy son las ÚNICAS siete columnas del modelo entero sin comentario.
--  Este parche solo agrega esos siete comentarios: ninguna otra
--  sentencia, ningún cambio de estructura.
--
--  POR QUÉ UN PARCHE APARTE Y NO EDITAR EL 23
--  El 23 ya está aplicado y se reejecuta entero cuando se levanta un
--  entorno nuevo. Añadirle sentencias cambiaría el contenido de un
--  parche cerrado; uno nuevo deja el rastro de qué se corrigió y cuándo.
--  Es el mismo criterio que se siguió con el parche 19.
--
--  EFECTO SECUNDARIO BUSCADO: EL PARCHE 19 VUELVE A SER REEJECUTABLE
--  El parche 19 termina con una guardia que aborta si queda una sola
--  columna del modelo sin comentario. Como las siete de este parche
--  existían, esa guardia hoy dispara y revierte al 19 entero. Al
--  describirlas aquí, el 19 vuelve a cerrar limpio. Por eso este parche
--  debe correr DESPUÉS del 19: si corriera antes, la guardia del 19
--  seguiría encontrando columnas propias del 23 creadas después.
--
--  IDEMPOTENTE
--  `COMMENT ON` sobrescribe el comentario anterior, así que se puede
--  ejecutar cuantas veces sea necesario sin error ni duplicados.
--
--  CÓMO SE APLICA
--      psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--          -f docs/PARCHE_24_COMENTARIOS_DESTINATARIO.sql
-- =====================================================================

\echo 'PARCHE 24 · comentarios restantes de core.alerta_destinatario'

BEGIN;

-- ---------------------------------------------------------------------
-- 1 · Columnas de identidad y relación
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.alerta_destinatario.id IS
    'Identificador interno de la fila';
COMMENT ON COLUMN core.alerta_destinatario.alerta_id IS
    'Alerta a la que pertenece el destinatario, según core.alertas_tempranas. Al borrar la alerta se borran sus destinatarios';

-- ---------------------------------------------------------------------
-- 2 · Columna de negocio
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.alerta_destinatario.motivo IS
    'Motivo o causa del aviso, cuando el canal no basta para explicar por qué se remite a esta persona o cargo';

-- ---------------------------------------------------------------------
-- 3 · Bloque estándar de auditoría
-- ---------------------------------------------------------------------
COMMENT ON COLUMN core.alerta_destinatario.created_at IS
    'Momento en que se creó el registro';
COMMENT ON COLUMN core.alerta_destinatario.updated_at IS
    'Momento de la última modificación del registro';
COMMENT ON COLUMN core.alerta_destinatario.created_by IS
    'Usuario que registró el destinatario';
COMMENT ON COLUMN core.alerta_destinatario.updated_by IS
    'Usuario que realizó la última modificación del registro';

-- ---------------------------------------------------------------------
-- 4 · Verificación
--     La guardia comprueba solo las columnas de ESTE parche. El recuento
--     global del modelo se informa, no bloquea: el candado global es lo
--     que volvió no reejecutable al parche 19 y aquí no se replica.
-- ---------------------------------------------------------------------
DO $p24_verify$
DECLARE
    v_propias integer;
    v_global  integer;
BEGIN
    SELECT count(*) INTO v_propias
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND c.relname = 'alerta_destinatario'
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND NOT EXISTS (
           SELECT 1 FROM pg_description d
            WHERE d.objoid = c.oid AND d.objsubid = a.attnum
       );

    IF v_propias <> 0 THEN
        RAISE EXCEPTION 'quedan % columnas de core.alerta_destinatario sin comentario', v_propias;
    END IF;

    SELECT count(*) INTO v_global
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'legacy')
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND NOT EXISTS (
           SELECT 1 FROM pg_description d
            WHERE d.objoid = c.oid AND d.objsubid = a.attnum
       );

    RAISE NOTICE 'core.alerta_destinatario comentada · columnas del modelo sin comentario: %', v_global;
END
$p24_verify$;

COMMIT;

\echo 'PARCHE 24 · aplicado'
