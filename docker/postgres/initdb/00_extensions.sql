-- =============================================================================
--  00 · Extensiones
--
--  Se crean ANTES de aplicar el esquema. El orden importa: si `postgis` no
--  existe, cada CREATE TABLE con una columna GEOGRAPHY falla y, como el DDL se
--  aplica tolerando errores, la tabla queda simplemente sin crear.
--
--  La cabecera de la DDL v9 se contradice a sí misma (§1 dice que pgcrypto no
--  hace falta y que btree_gist es opcional; la cabecera del archivo los lista
--  como requeridos). Se instalan todas: son extensiones contrib del propio
--  PostgreSQL 16, no añaden dependencias externas y evitan fallos silenciosos.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;      -- kag.embedding (pgvector)
CREATE EXTENSION IF NOT EXISTS postgis;     -- GEOGRAPHY en territorio.*
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- índices EXCLUDE/USING gist
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- funciones de resumen en funciones
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- búsqueda difusa en catálogos

-- Deja constancia en el log de inicialización.
\echo '00_extensions: vector, postgis, btree_gist, pgcrypto, pg_trgm'
