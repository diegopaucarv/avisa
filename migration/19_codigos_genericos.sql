-- =============================================================================
--  AVISA / SIPRECS - PRODUCE · OAIPCS
--  19 · Siglas genéricas para casos sin subsector o sin temática
-- =============================================================================
--  Problema
--  --------
--  `core.codigo_subsector(null)` devolvía 'XX' y `core.codigo_tematica(null)`
--  devolvía 'XXX'. Un caso puede registrarse antes de clasificarlo (la Guía
--  pide una temática principal, pero no impide el alta mínima), y el código
--  resultante `CS-PA-XXX-2026-01` parece un error de sistema en la UI.
--
--  Qué cambia
--  ----------
--  Ambos traductores devuelven 'GEN' cuando no hay valor. No cambia el esquema,
--  no se recodifica ningún caso existente y el formato del Anexo 15 se mantiene:
--  `CS-PA-GEN-2026-01` se lee como "caso de Pesca y Acuicultura sin temática
--  asignada todavía".
--
--  Los códigos ya emitidos con 'XX'/'XXX' se dejan intactos: el código es
--  inmutable una vez asignado (es la clave de negocio).
--
--  Cómo revertir
--  -------------
--  Volver a ejecutar las definiciones de `migration/16_recodificacion_anexo15.sql`
--  (sección 1). Los códigos 'GEN' emitidos quedan como están.
-- =============================================================================

begin;

create or replace function core.codigo_subsector(p_subsector_id integer)
returns text
language sql
immutable
as $$
  select case p_subsector_id
           when 1 then 'PA'    -- Pesca y Acuicultura
           when 2 then 'MI'    -- MYPE e Industria
           else 'GEN'          -- sin subsector asignado
         end;
$$;

comment on function core.codigo_subsector(integer) is
  'Sigla del subsector para el código de caso del Anexo 15: 1=PA (Pesca y Acuicultura), 2=MI (MYPE e Industria), null/otro=GEN (sin clasificar).';

create or replace function core.codigo_tematica(p_tematica_id integer)
returns text
language sql
immutable
as $$
  select case p_tematica_id
           when 1 then 'INF'   -- Infraestructura (fijado por la Guía)
           when 2 then 'OAT'   -- Ordenamiento y acceso territorial
           when 3 then 'NOR'   -- Normatividad
           when 4 then 'DBE'   -- Distribución de beneficios
           when 5 then 'GOB'   -- Gobernanza
           when 6 then 'ITE'   -- Impactos de terceros
           else 'GEN'          -- sin temática asignada
         end;
$$;

comment on function core.codigo_tematica(integer) is
  'Sigla de la temática para el código de caso del Anexo 15. La Guía sólo fija INF; OAT/NOR/DBE/GOB/ITE son el acuerdo de la migración 16; null/otro=GEN (sin clasificar).';

-- -----------------------------------------------------------------------------
--  Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
select core.codigo_subsector(null) as subsector_sin_valor,
       core.codigo_tematica(null)  as tematica_sin_valor,
       core.codigo_subsector(1)    as subsector_pesca,
       core.codigo_tematica(1)     as tematica_infraestructura;

commit;
