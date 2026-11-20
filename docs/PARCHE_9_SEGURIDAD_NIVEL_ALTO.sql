-- =============================================================================
-- PARCHE 9 — SEGURIDAD DE NIVEL ALTO SOBRE DATOS PERSONALES DE ACTORES
-- AVISA / SIPRECS · OAIPCS · PRODUCE · Ley 29733
--
-- QUÉ HACE, EN ORDEN
--   1. Crea el esquema `audit` y la tabla `audit.datos_personales_acceso`
--      (append-only: triggers que rechazan UPDATE, DELETE y TRUNCATE).
--   2. Añade a `core.actor_datos_personales` las columnas
--      `dni_cifrado`, `email_cifrado`, `telefono_cifrado`, `dni_hmac`.
--   3. Instala el trigger de auditoría de escritura sobre la tabla de PII
--      (antes del backfill, para que la propia migración quede trazada).
--   4. Cifra los valores en claro existentes (pgp_sym_encrypt, AES-256) y
--      calcula la huella de búsqueda del DNI (hmac SHA-256).
--   5. Crea la vista `core.v_actor_datos_personales_seguro` (solo blobs) y la
--      función `core.actor_datos_personales_descifrar(uuid, text)`.
--   6. Purga el plano (dni, email, teléfonos) SOLO si el roundtrip de
--      descifrado cuadra y solo si nada depende de esas columnas.
--
-- QUÉ NO HACE (y por qué)
--   · No implementa TLS en tránsito: eso es `ssl=on`, certificado y `hostssl`
--     en `pg_hba.conf`; requiere tocar la imagen y el servicio. Ver informe.
--   · No instala `pgaudit`: no está en `pg_available_extensions` de la imagen.
--     La trazabilidad se resuelve con tabla y triggers propios.
--   · No custodia la clave: la clave NO se guarda en la base. Se pasa por
--     sesión (`app.crypto_key`) y vive en `.env` (local) o en el gestor de
--     secretos de OGTI (producción).
--   · No toca `config.guardrail_contract` ni `config.parametro`.
--   · No re-cifra `genero` ni `autoidentificacion_etnica` (también son datos
--     sensibles del art. 13): quedan en claro y se reportan como pendiente.
--
-- REQUISITOS DE EJECUCIÓN
--   · Clave obligatoria. Sin `-v crypto_key=...` el script se detiene.
--   · `ON_ERROR_STOP` activo: cualquier verificación fallida aborta la
--     transacción completa y NO se purga nada.
--   · Rol con BYPASSRLS (o superusuario) para que el backfill no afecte 0
--     filas en silencio: `core.actor_datos_personales` tiene RLS FORCE y las
--     políticas exigen `core.clasificacion_max() >= 2/3`. El rol `avisa` es
--     superusuario, así que cumple. Con otro rol, fijar antes:
--       SET app.clasificacion_max = '3';
--
-- EJECUCIÓN
--   docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--     -v crypto_key="$APP_CRYPTO_KEY" -f - \
--     < docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql
--
--   (La clave sale de `.env` → `APP_CRYPTO_KEY`. Ver docs/04_migracion/parches/P9_SEGURIDAD.md.)
--
-- IDEMPOTENCIA
--   Todo el DDL usa IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
--   El backfill solo actúa sobre filas con blob nulo; una segunda pasada no
--   re-cifra ni duplica nada. La purga solo actúa sobre filas con plano.
--   La bitácora sí crece en cada pasada: es su función registrar la ejecución.
--
-- CIFRAS DE REFERENCIA (medidas el 2026-11-18, antes del parche)
--   core.actor_datos_personales .......... 847 filas
--   dni en claro ......................... 642 (587 distintos; 55 filas
--                                          sobrantes: 45 DNI repetidos, máx. 4)
--   email en claro ....................... 141
--   telefono_contacto .................... 556
--   telefono_raw ......................... 606 (50 filas SOLO tienen raw)
--   telefono_alt ......................... 0
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 0. Clave de sesión: obligatoria. No se escribe en ninguna tabla.
-- -----------------------------------------------------------------------------
\if :{?crypto_key}
\else
\echo 'ERROR: falta la clave. Ejecutar con: -v crypto_key=<clave de 32 bytes>'
\echo '       La clave está en .env como APP_CRYPTO_KEY; ver docs/04_migracion/parches/P9_SEGURIDAD.md'
DO $$ BEGIN
    RAISE EXCEPTION 'Parámetro psql crypto_key ausente: no se ejecuta el parche 9';
END $$;
\endif

SELECT set_config('app.crypto_key', :'crypto_key', false) AS clave_cargada_en_sesion,
       length(current_setting('app.crypto_key'))          AS largo_clave;

-- Marca de origen: permite distinguir en `audit` las escrituras del parche
-- de las escrituras de la aplicación.
SELECT set_config('app.p9_origen', 'PARCHE_9', false) AS origen_sesion;


-- =============================================================================
-- 0-bis. DIAGNÓSTICO PREVIO (solo lectura). Contrastar con las cifras de arriba.
-- =============================================================================

SELECT
    count(*)                                            AS filas_totales,
    count(dni)                                          AS dni_en_claro,
    count(DISTINCT dni)                                 AS dni_distintos,
    count(email)                                        AS email_en_claro,
    count(telefono_contacto)                            AS telefono_contacto,
    count(telefono_alt)                                 AS telefono_alt,
    count(telefono_raw)                                 AS telefono_raw,
    count(*) FILTER (WHERE telefono_raw IS NOT NULL
                       AND telefono_contacto IS NULL)   AS solo_telefono_raw
FROM core.actor_datos_personales;

-- Extensiones y capacidades realmente disponibles.
SELECT 'pgcrypto' AS requisito, extversion AS version
FROM pg_extension WHERE extname = 'pgcrypto'
UNION ALL
SELECT 'pgaudit (disponible para instalar)', count(*)::text
FROM pg_available_extensions WHERE name = 'pgaudit'
UNION ALL
SELECT 'ssl (valor actual)', current_setting('ssl');


BEGIN;

-- Bloquea la tabla durante la migración: nadie escribe PII a mitad de camino.
LOCK TABLE core.actor_datos_personales IN SHARE ROW EXCLUSIVE MODE;


-- =============================================================================
-- 1. TRAZABILIDAD: esquema `audit` y bitácora append-only
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.datos_personales_acceso (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ocurrido_en     timestamptz NOT NULL DEFAULT now(),
    usuario         text        NOT NULL DEFAULT current_user,
    operacion       text        NOT NULL
        CHECK (operacion IN ('select_descifrado','insert','update','delete','export')),
    actor_uid       uuid,
    motivo          text,
    filas_afectadas integer     NOT NULL DEFAULT 0,
    contexto        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE audit.datos_personales_acceso IS
    'Bitácora append-only de acceso y escritura sobre datos personales de actores '
    '(Ley 29733). UPDATE/DELETE/TRUNCATE están bloqueados por trigger: el historial '
    'no se corrige, se corrige con una fila nueva.';
COMMENT ON COLUMN audit.datos_personales_acceso.usuario IS
    'session_user de la conexión. Dentro de una función SECURITY DEFINER, '
    'current_user sería el propietario del objeto y no diría quién accedió.';
COMMENT ON COLUMN audit.datos_personales_acceso.contexto IS
    'Metadatos: origen (PARCHE_9 o aplicacion), columnas modificadas, resultado.';

-- Rechazo de mutaciones. Se cubren los tres niveles: fila, sentencia y TRUNCATE.
CREATE OR REPLACE FUNCTION audit.tg_rechazar_mutacion()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    RAISE EXCEPTION
        'audit.datos_personales_acceso es append-only: % no está permitido', TG_OP
        USING ERRCODE = '42501',
              HINT = 'El historial no se modifica ni se borra. Si hubo un error, '
                     'registrar una fila nueva que lo explique.';
END $fn$;

DROP TRIGGER IF EXISTS tg_append_only_row ON audit.datos_personales_acceso;
CREATE TRIGGER tg_append_only_row
    BEFORE UPDATE OR DELETE ON audit.datos_personales_acceso
    FOR EACH ROW EXECUTE FUNCTION audit.tg_rechazar_mutacion();

DROP TRIGGER IF EXISTS tg_append_only_stmt ON audit.datos_personales_acceso;
CREATE TRIGGER tg_append_only_stmt
    BEFORE UPDATE OR DELETE ON audit.datos_personales_acceso
    FOR EACH STATEMENT EXECUTE FUNCTION audit.tg_rechazar_mutacion();

DROP TRIGGER IF EXISTS tg_append_only_truncate ON audit.datos_personales_acceso;
CREATE TRIGGER tg_append_only_truncate
    BEFORE TRUNCATE ON audit.datos_personales_acceso
    FOR EACH STATEMENT EXECUTE FUNCTION audit.tg_rechazar_mutacion();

CREATE INDEX IF NOT EXISTS ix_audit_dp_actor     ON audit.datos_personales_acceso (actor_uid);
CREATE INDEX IF NOT EXISTS ix_audit_dp_ocurrido  ON audit.datos_personales_acceso (ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS ix_audit_dp_operacion ON audit.datos_personales_acceso (operacion);


-- =============================================================================
-- 2. COLUMNAS NUEVAS (todas nullable: la PII puede no existir)
-- =============================================================================

ALTER TABLE core.actor_datos_personales
    ADD COLUMN IF NOT EXISTS dni_cifrado      bytea,
    ADD COLUMN IF NOT EXISTS email_cifrado    bytea,
    ADD COLUMN IF NOT EXISTS telefono_cifrado bytea,
    ADD COLUMN IF NOT EXISTS dni_hmac         bytea;

COMMENT ON COLUMN core.actor_datos_personales.dni_cifrado IS
    'DNI cifrado con pgp_sym_encrypt AES-256. Clave fuera de la base (app.crypto_key).';
COMMENT ON COLUMN core.actor_datos_personales.email_cifrado IS
    'Correo cifrado con pgp_sym_encrypt AES-256. Clave fuera de la base (app.crypto_key).';
COMMENT ON COLUMN core.actor_datos_personales.telefono_cifrado IS
    'Teléfono cifrado con pgp_sym_encrypt AES-256. Contiene telefono_contacto '
    'normalizado cuando existe; si la fila solo tenía telefono_raw, contiene ese valor.';
COMMENT ON COLUMN core.actor_datos_personales.dni_hmac IS
    'HMAC-SHA256 del DNI con la misma clave: permite buscar y detectar duplicados '
    'sin descifrar nada. NO es único a propósito: hay DNI repetidos en la fuente.';


-- =============================================================================
-- 3. AUDITORÍA DE ESCRITURA (INSERT/UPDATE/DELETE sobre la tabla de PII)
--    Se instala antes del backfill para que la migración quede trazada.
-- =============================================================================

CREATE OR REPLACE FUNCTION core.tg_audit_datos_personales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, audit
AS $fn$
DECLARE
    v_actor  uuid;
    v_campos text[];
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_actor := OLD.actor_uid;
    ELSE
        v_actor := NEW.actor_uid;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(COALESCE(n.key, o.key) ORDER BY COALESCE(n.key, o.key))
          INTO v_campos
          FROM jsonb_each(to_jsonb(NEW)) n
          FULL JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
         WHERE n.value IS DISTINCT FROM o.value;
    END IF;

    INSERT INTO audit.datos_personales_acceso
        (usuario, operacion, actor_uid, motivo, filas_afectadas, contexto)
    VALUES
        (session_user, lower(TG_OP), v_actor, NULL, 1,
         jsonb_build_object(
             'origen', COALESCE(NULLIF(current_setting('app.p9_origen', true), ''), 'aplicacion'),
             'tabla',  TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
             'campos', to_jsonb(COALESCE(v_campos, ARRAY[]::text[]))));

    RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS tg_audit_datos_personales ON core.actor_datos_personales;
CREATE TRIGGER tg_audit_datos_personales
    AFTER INSERT OR UPDATE OR DELETE ON core.actor_datos_personales
    FOR EACH ROW EXECUTE FUNCTION core.tg_audit_datos_personales();

COMMENT ON FUNCTION core.tg_audit_datos_personales() IS
    'Registra en audit.datos_personales_acceso cada INSERT/UPDATE/DELETE de la tabla '
    'de PII, con las columnas que cambiaron y el origen (aplicacion o PARCHE_9).';


-- =============================================================================
-- 4. BACKFILL
--    Solo filas con blob nulo: re-ejecutar no re-cifra ni duplica.
-- =============================================================================

DO $blk$
DECLARE
    v_clave text := current_setting('app.crypto_key', true);
BEGIN
    IF v_clave IS NULL OR btrim(v_clave) = '' THEN
        RAISE EXCEPTION 'app.crypto_key no está definida en la sesión: no se cifra nada';
    END IF;
END $blk$;

-- 4.1 DNI (642 esperadas)
UPDATE core.actor_datos_personales
   SET dni_cifrado = pgp_sym_encrypt(dni, current_setting('app.crypto_key'), 'cipher-algo=aes256'),
       dni_hmac    = hmac(dni, current_setting('app.crypto_key'), 'sha256')
 WHERE dni IS NOT NULL
   AND dni_cifrado IS NULL;

-- 4.2 Correo (141 esperadas)
UPDATE core.actor_datos_personales
   SET email_cifrado = pgp_sym_encrypt(email, current_setting('app.crypto_key'), 'cipher-algo=aes256')
 WHERE email IS NOT NULL
   AND email_cifrado IS NULL;

-- 4.3 Teléfono (556 desde telefono_contacto + 50 desde telefono_raw = 606).
--     Se incluyen las 50 filas que solo tenían raw: si se purga telefono_raw sin
--     cifrarlas, se perderían del plano de core (recuperables solo en el legado).
UPDATE core.actor_datos_personales
   SET telefono_cifrado = pgp_sym_encrypt(COALESCE(telefono_contacto, telefono_raw),
                                          current_setting('app.crypto_key'), 'cipher-algo=aes256')
 WHERE COALESCE(telefono_contacto, telefono_raw) IS NOT NULL
   AND telefono_cifrado IS NULL;

-- 4.4 Índice de búsqueda por huella. NO único: hay DNI repetidos en la fuente
--     (45 valores repetidos, 55 filas sobrantes, máximo 4 repeticiones).
CREATE INDEX IF NOT EXISTS ix_actor_datos_personales_dni_hmac
    ON core.actor_datos_personales (dni_hmac);


-- =============================================================================
-- 5. VISTA SEGURA Y FUNCIÓN DE DESCIFRADO
-- =============================================================================

DROP VIEW IF EXISTS core.v_actor_datos_personales_seguro;
CREATE VIEW core.v_actor_datos_personales_seguro
WITH (security_invoker = true)
AS
SELECT actor_uid,
       nivel_clasificacion,
       dni_cifrado,
       dni_hmac,
       email_cifrado,
       telefono_cifrado
  FROM core.actor_datos_personales;

COMMENT ON VIEW core.v_actor_datos_personales_seguro IS
    'Vista de exposición mínima: identificadores cifrados y huella del DNI. '
    'Nunca devuelve datos en claro. security_invoker=true: el RLS de la tabla '
    'se evalúa con el rol que consulta, no con el dueño de la vista.';

CREATE OR REPLACE FUNCTION core.actor_datos_personales_descifrar(
    p_actor_uid uuid,
    p_motivo    text
)
RETURNS TABLE (dni text, email text, telefono text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, audit
AS $fn$
DECLARE
    v_clave text     := current_setting('app.crypto_key', true);
    v_nivel smallint := core.clasificacion_max();
    v_fila  core.actor_datos_personales%ROWTYPE;
BEGIN
    -- Ley 29733: finalidad declarada y nivel de acceso mínimo.
    IF v_nivel < 3 THEN
        RAISE EXCEPTION
            'Acceso denegado: se requiere clasificación 3 (Confidencial). Nivel de sesión: %', v_nivel
            USING ERRCODE = '42501',
                  HINT = 'app.clasificacion_max la fija el aplicativo tras autenticar. '
                         'No es una credencial: ver limitación DC-02 en el informe P9.';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo del descifrado es obligatorio (principio de finalidad)'
            USING ERRCODE = '22023';
    END IF;

    IF v_clave IS NULL OR v_clave = '' THEN
        RAISE EXCEPTION 'No hay clave en la sesión: falta app.crypto_key'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_fila
      FROM core.actor_datos_personales d
     WHERE d.actor_uid = p_actor_uid
       AND d.nivel_clasificacion <= v_nivel;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El actor % no existe o su clasificación excede el nivel de la sesión',
            p_actor_uid USING ERRCODE = 'P0002';
    END IF;

    -- Se audita antes de devolver: si el INSERT falla, no hay descifrado.
    INSERT INTO audit.datos_personales_acceso
        (usuario, operacion, actor_uid, motivo, filas_afectadas, contexto)
    VALUES
        (session_user, 'select_descifrado', p_actor_uid, p_motivo, 1,
         jsonb_build_object(
             'origen', COALESCE(NULLIF(current_setting('app.p9_origen', true), ''), 'aplicacion'),
             'funcion', 'core.actor_datos_personales_descifrar',
             'clasificacion_sesion', v_nivel,
             'descifro_dni',      v_fila.dni_cifrado      IS NOT NULL,
             'descifro_email',    v_fila.email_cifrado    IS NOT NULL,
             'descifro_telefono', v_fila.telefono_cifrado IS NOT NULL));

    RETURN QUERY
    SELECT CASE WHEN v_fila.dni_cifrado      IS NOT NULL
                THEN public.pgp_sym_decrypt(v_fila.dni_cifrado, v_clave) END,
           CASE WHEN v_fila.email_cifrado    IS NOT NULL
                THEN public.pgp_sym_decrypt(v_fila.email_cifrado, v_clave) END,
           CASE WHEN v_fila.telefono_cifrado IS NOT NULL
                THEN public.pgp_sym_decrypt(v_fila.telefono_cifrado, v_clave) END;
END $fn$;

COMMENT ON FUNCTION core.actor_datos_personales_descifrar(uuid, text) IS
    'Único camino soportado para ver PII en claro. Exige nivel 3, motivo no vacío y '
    'registra el acceso en audit.datos_personales_acceso. pgcrypto se invoca '
    'cualificado (public.pgp_sym_decrypt) porque el search_path está endurecido; '
    'si pgcrypto se mueve de schema, hay que actualizar esta función.';

-- El descifrado no se ofrece a PUBLIC: hay que concederlo rol por rol.
REVOKE ALL ON FUNCTION core.actor_datos_personales_descifrar(uuid, text) FROM PUBLIC;


-- =============================================================================
-- 6. VERIFICACIÓN OBLIGATORIA ANTES DE PURGAR
--    Si algo falla, RAISE EXCEPTION aborta todo y el plano queda intacto.
-- =============================================================================

DO $verif$
DECLARE
    v_clave          text := current_setting('app.crypto_key', true);
    v_total          int;
    v_con_dni        int;
    v_con_email      int;
    v_con_tel        int;
    v_sin_blob       int;
    v_dni_mal        int;
    v_email_mal      int;
    v_tel_mal        int;
    v_hmac_mal       int;
    v_dni_legado_ok  int;
    v_dni_legado_mal int;
BEGIN
    SELECT count(*),
           count(*) FILTER (WHERE dni_cifrado      IS NOT NULL),
           count(*) FILTER (WHERE email_cifrado    IS NOT NULL),
           count(*) FILTER (WHERE telefono_cifrado IS NOT NULL)
      INTO v_total, v_con_dni, v_con_email, v_con_tel
      FROM core.actor_datos_personales;

    -- 6.1 Ninguna fila con plano puede quedarse sin blob.
    SELECT count(*) INTO v_sin_blob
      FROM core.actor_datos_personales
     WHERE (dni IS NOT NULL AND dni_cifrado IS NULL)
        OR (email IS NOT NULL AND email_cifrado IS NULL)
        OR (COALESCE(telefono_contacto, telefono_raw) IS NOT NULL AND telefono_cifrado IS NULL);
    IF v_sin_blob > 0 THEN
        RAISE EXCEPTION 'Verificación 6.1 falló: % filas con dato en claro y sin cifrar', v_sin_blob;
    END IF;

    -- 6.2 Roundtrip: descifrar TODAS las filas y comparar contra el plano.
    SELECT count(*) INTO v_dni_mal
      FROM core.actor_datos_personales
     WHERE dni IS NOT NULL AND dni_cifrado IS NOT NULL
       AND pgp_sym_decrypt(dni_cifrado, v_clave) IS DISTINCT FROM dni;
    IF v_dni_mal > 0 THEN
        RAISE EXCEPTION 'Verificación 6.2 falló: % DNI no vuelven igual al descifrar', v_dni_mal;
    END IF;

    SELECT count(*) INTO v_email_mal
      FROM core.actor_datos_personales
     WHERE email IS NOT NULL AND email_cifrado IS NOT NULL
       AND pgp_sym_decrypt(email_cifrado, v_clave) IS DISTINCT FROM email;
    IF v_email_mal > 0 THEN
        RAISE EXCEPTION 'Verificación 6.2 falló: % correos no vuelven igual al descifrar', v_email_mal;
    END IF;

    SELECT count(*) INTO v_tel_mal
      FROM core.actor_datos_personales
     WHERE COALESCE(telefono_contacto, telefono_raw) IS NOT NULL
       AND telefono_cifrado IS NOT NULL
       AND pgp_sym_decrypt(telefono_cifrado, v_clave)
           IS DISTINCT FROM COALESCE(telefono_contacto, telefono_raw);
    IF v_tel_mal > 0 THEN
        RAISE EXCEPTION 'Verificación 6.2 falló: % teléfonos no vuelven igual al descifrar', v_tel_mal;
    END IF;

    -- 6.3 La huella del DNI es fiel: mismas filas y mismos duplicados que el plano.
    SELECT count(*) INTO v_hmac_mal
      FROM core.actor_datos_personales
     WHERE dni IS NOT NULL
       AND dni_hmac IS DISTINCT FROM hmac(dni, v_clave, 'sha256');
    IF v_hmac_mal > 0 THEN
        RAISE EXCEPTION 'Verificación 6.3 falló: % HMAC no corresponden al DNI', v_hmac_mal;
    END IF;

    -- 6.4 Contraste con la fuente legada (informativo, no bloquea; ver hallazgo H3).
    SELECT count(*) INTO v_dni_legado_ok
      FROM core.actores a
      JOIN core.actor_datos_personales d USING (actor_uid)
     WHERE d.dni IS NOT NULL
       AND EXISTS (SELECT 1 FROM legacy.dim_actores l
                    WHERE l.c02 = a.nombre_actual AND btrim(l.c03) = btrim(d.dni));
    SELECT count(*) INTO v_dni_legado_mal
      FROM core.actores a
      JOIN core.actor_datos_personales d USING (actor_uid)
     WHERE d.dni IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM legacy.dim_actores l
                        WHERE l.c02 = a.nombre_actual AND btrim(l.c03) = btrim(d.dni));

    RAISE NOTICE 'Verificación OK — filas: %, DNI cifrados: %, correos: %, teléfonos: %',
        v_total, v_con_dni, v_con_email, v_con_tel;
    RAISE NOTICE 'Contraste legado — DNI con fila legada de igual nombre: %, sin coincidencia: %',
        v_dni_legado_ok, v_dni_legado_mal;
END $verif$;


-- =============================================================================
-- 7. PURGA DEL PLANO
--    Solo se ejecuta si 6.1–6.3 pasaron (si no, la transacción ya abortó).
-- =============================================================================

-- 7.1 Dependencias: ni vistas, ni funciones, ni índices pueden quedar colgando
--     de las columnas que se van a vaciar. Se descubre, no se supone.
DO $deps$
DECLARE
    r         record;
    v_bloqueo text := '';
BEGIN
    FOR r IN
        SELECT DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid) AS objeto,
                        a.attname
          FROM pg_depend d
          JOIN pg_attribute a
            ON a.attrelid = 'core.actor_datos_personales'::regclass
           AND a.attnum   = d.refobjsubid
         WHERE d.refobjid = 'core.actor_datos_personales'::regclass
           AND a.attname IN ('dni','email','telefono_contacto','telefono_alt','telefono_raw')
           AND d.deptype <> 'i'
    LOOP
        -- El índice parcial ix_actor_dni es el único dependiente previsto; se
        -- elimina junto con la purga porque deja de tener sentido (todo NULL).
        IF r.objeto NOT LIKE 'index core.ix_actor_dni%' THEN
            v_bloqueo := v_bloqueo || r.objeto || ' [' || r.attname || ']; ';
        END IF;
    END LOOP;

    -- Objetos que mencionan la tabla y, además, alguna columna en claro.
    v_bloqueo := v_bloqueo || COALESCE((
        SELECT string_agg(DISTINCT x.obj, '; ')
          FROM (
            SELECT ('vista ' || schemaname || '.' || viewname) AS obj
              FROM pg_views
             WHERE schemaname NOT IN ('pg_catalog','information_schema')
               AND definition ~* 'actor_datos_personales'
               AND definition ~* '\m(dni|email|telefono_contacto|telefono_alt|telefono_raw)\M'
            UNION ALL
            SELECT ('funcion ' || p.oid::regprocedure::text) AS obj
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT IN ('pg_catalog','information_schema')
               AND p.prosrc ~* 'actor_datos_personales'
               AND p.prosrc ~* '\m(dni|email|telefono_contacto|telefono_alt|telefono_raw)\M'
          ) x
    ), '');

    IF v_bloqueo <> '' THEN
        RAISE EXCEPTION
            'Purga bloqueada: hay objetos que dependen de las columnas en claro: %', v_bloqueo
            USING HINT = 'No se purgó nada. Revisar los objetos listados y actualizarlos '
                         'para que usen las columnas cifradas.';
    END IF;

    RAISE NOTICE 'Dependencias OK: ningún objeto (salvo el índice ix_actor_dni) usa las columnas en claro.';
END $deps$;

-- 7.2 Copia de seguridad operativa (temporal, dentro de la misma transacción).
CREATE TABLE IF NOT EXISTS core.actor_datos_personales_bkp_p9 AS
SELECT * FROM core.actor_datos_personales;

-- 7.3 Purga (y constancia explícita, solo si hubo algo que purgar).
DROP INDEX IF EXISTS core.ix_actor_dni;

DO $purga$
DECLARE
    v_filas int;
BEGIN
    UPDATE core.actor_datos_personales
       SET dni               = NULL,
           email             = NULL,
           telefono_contacto = NULL,
           telefono_alt      = NULL,
           telefono_raw      = NULL,
           updated_at        = now()
     WHERE dni IS NOT NULL
        OR email IS NOT NULL
        OR telefono_contacto IS NOT NULL
        OR telefono_alt IS NOT NULL
        OR telefono_raw IS NOT NULL;

    GET DIAGNOSTICS v_filas = ROW_COUNT;

    IF v_filas > 0 THEN
        -- Constancia explícita de la purga (además de la fila por fila del trigger).
        INSERT INTO audit.datos_personales_acceso
            (usuario, operacion, actor_uid, motivo, filas_afectadas, contexto)
        VALUES
            (session_user, 'update', NULL,
             'Purga del plano tras cifrado (PARCHE 9)',
             v_filas,
             jsonb_build_object(
                 'accion', 'purga_plano',
                 'columnas', jsonb_build_array('dni','email','telefono_contacto','telefono_alt','telefono_raw'),
                 'fuente_de_recuperacion', 'legacy.dim_actores (c03 DNI, c04 telefono, c05 correo)',
                 'indice_eliminado', 'core.ix_actor_dni'));
        RAISE NOTICE 'Purga: % filas vaciadas', v_filas;
    ELSE
        RAISE NOTICE 'Purga: nada que vaciar (el plano ya estaba vacío)';
    END IF;
END $purga$;

-- 7.4 Los blobs deben seguir idénticos tras la purga.
DO $postpurga$
DECLARE
    v_dif   int;
    v_plano int;
BEGIN
    SELECT count(*) INTO v_dif
      FROM core.actor_datos_personales d
      JOIN core.actor_datos_personales_bkp_p9 b USING (actor_uid)
     WHERE d.dni_cifrado      IS DISTINCT FROM b.dni_cifrado
        OR d.email_cifrado    IS DISTINCT FROM b.email_cifrado
        OR d.telefono_cifrado IS DISTINCT FROM b.telefono_cifrado
        OR d.dni_hmac         IS DISTINCT FROM b.dni_hmac;
    IF v_dif > 0 THEN
        RAISE EXCEPTION 'Verificación 7.4 falló: % filas con blobs alterados por la purga', v_dif;
    END IF;

    SELECT count(*) INTO v_plano
      FROM core.actor_datos_personales
     WHERE dni IS NOT NULL OR email IS NOT NULL
        OR telefono_contacto IS NOT NULL OR telefono_alt IS NOT NULL
        OR telefono_raw IS NOT NULL;
    IF v_plano > 0 THEN
        RAISE EXCEPTION 'Verificación 7.4 falló: % filas conservan plano tras la purga', v_plano;
    END IF;

    RAISE NOTICE 'Purga OK: 0 discrepancias en blobs, 0 filas con plano.';
END $postpurga$;

-- 7.5 La copia se elimina: el respaldo real es el legado y los blobs cifrados.
DROP TABLE core.actor_datos_personales_bkp_p9;

COMMIT;

RESET app.p9_origen;


-- =============================================================================
-- 8. VERIFICACIÓN POSTERIOR (solo lectura; la clave sigue en la sesión)
-- =============================================================================

-- 8.1 Inventario final. Esperado: plano en 0; cifrados 642 / 141 / 606.
SELECT count(*)                                       AS filas,
       count(dni)                                     AS dni_en_claro,
       count(email)                                   AS email_en_claro,
       count(telefono_contacto) + count(telefono_raw) AS telefonos_en_claro,
       count(dni_cifrado)                             AS dni_cifrados,
       count(dni_hmac)                                AS dni_hmac,
       count(email_cifrado)                           AS email_cifrados,
       count(telefono_cifrado)                        AS telefono_cifrados
  FROM core.actor_datos_personales;

-- 8.2 Duplicados reales del DNI sobre la huella (se conservan; no se impone unicidad).
SELECT (SELECT count(*) FROM core.actor_datos_personales WHERE dni_hmac IS NOT NULL) AS filas_con_dni,
       (SELECT count(DISTINCT dni_hmac) FROM core.actor_datos_personales WHERE dni_hmac IS NOT NULL) AS dnis_distintos,
       (SELECT count(*) FROM core.actor_datos_personales WHERE dni_hmac IS NOT NULL)
         - (SELECT count(DISTINCT dni_hmac) FROM core.actor_datos_personales WHERE dni_hmac IS NOT NULL) AS filas_sobrantes,
       (SELECT count(*) FROM (SELECT dni_hmac FROM core.actor_datos_personales
                               WHERE dni_hmac IS NOT NULL GROUP BY dni_hmac HAVING count(*) > 1) z) AS dnis_repetidos,
       (SELECT max(c) FROM (SELECT count(*) c FROM core.actor_datos_personales
                             WHERE dni_hmac IS NOT NULL GROUP BY dni_hmac) x) AS max_repeticiones;

-- 8.3 Roundtrip contra legacy para 5 filas (DNI descifrado vs dim_actores.c03).
WITH muestra AS (
    SELECT a.codigo_legado, a.nombre_actual, d.dni_cifrado
      FROM core.actores a
      JOIN core.actor_datos_personales d USING (actor_uid)
     WHERE d.dni_cifrado IS NOT NULL
     ORDER BY a.codigo_legado
     LIMIT 5
), descifrado AS (
    SELECT *, pgp_sym_decrypt(dni_cifrado, current_setting('app.crypto_key')) AS dni_txt
      FROM muestra
)
SELECT d.codigo_legado,
       d.nombre_actual,
       d.dni_txt                          AS dni_descifrado,
       (SELECT btrim(l.c03) FROM legacy.dim_actores l
         WHERE l.c02 = d.nombre_actual AND btrim(l.c03) = btrim(d.dni_txt) LIMIT 1) AS dni_legado,
       EXISTS (SELECT 1 FROM legacy.dim_actores l
                WHERE l.c02 = d.nombre_actual AND btrim(l.c03) = btrim(d.dni_txt)) AS coincide
  FROM descifrado d;

-- 8.4 Bitácora: volumen por operación, origen y acción.
SELECT operacion,
       COALESCE(contexto->>'origen', 'parche')   AS origen,
       COALESCE(contexto->>'accion', '-')        AS accion,
       count(*)                                   AS filas
  FROM audit.datos_personales_acceso
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- 8.5 Trigger de auditoría y protecciones activas.
SELECT tgname, pg_get_triggerdef(oid) AS definicion
  FROM pg_trigger
 WHERE tgrelid IN ('core.actor_datos_personales'::regclass,
                   'audit.datos_personales_acceso'::regclass)
   AND NOT tgisinternal
 ORDER BY tgname;

-- 8.6 La vista segura no expone plano: solo blobs.
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS columnas_vista
  FROM information_schema.columns
 WHERE table_schema = 'core'
   AND table_name   = 'v_actor_datos_personales_seguro';
