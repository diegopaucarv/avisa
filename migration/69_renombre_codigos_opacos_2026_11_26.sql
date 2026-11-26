-- =============================================================================
-- 69 · Renombre de los códigos de caso al esquema opaco
--
-- Fecha: 2026-11-26
--
-- Qué hace
-- --------
-- Lleva los códigos existentes (`CS-<subsector>-<temática>-<año>-<NN>`) al
-- esquema nuevo (`CS-<año>-<NNNN>`), conservando el año y un orden estable.
--
-- Reglas
-- ------
-- · prefijo: `RM` si el código ya empieza con `RM-`; en cualquier otro caso `CS`.
-- · año: el que trae el código (`…-AAAA-NN`). Si no lo trae, el de `fecha_inicio`
--   y, en su defecto, el de `created_at`.
-- · orden: dentro de (prefijo, año), por `codigo_caso` ascendente. Es
--   determinista y preserva la numeración histórica dentro de cada año.
--
-- Seguridad
-- ---------
-- Los valores nuevos (`CS-2025-0001`) no colisionan con ningún valor viejo
-- (`CS-MI-ITE-2025-01`), así que el UPDATE no choca con la UNIQUE
-- `casos_codigo_caso_key`. Se hace en una sola sentencia, sin estado intermedio.
--
-- Lo que NO toca: `codigo_legado` (la trazabilidad del Excel), `mapa_matriz_excel`
-- (que guarda el código del Excel, no el de la base) y `documentos`/`compromisos`,
-- que referencian por uuid.
--
-- OJO: `codigo_caso` aparece en URLs (`/casos/:codigo`) y en enlaces
-- compartidos. Después de esta migración, esos enlaces antiguos dejan de abrir.
-- =============================================================================

begin;

with base as (
  select
    id,
    codigo_caso,
    case when codigo_caso like 'RM-%' then 'RM' else 'CS' end as prefijo,
    coalesce(
      substring(codigo_caso from '([0-9]{4})-[0-9]+$'),
      to_char(coalesce(fecha_inicio, created_at::date), 'YYYY')
    ) as anio
  from core.casos
),
ranked as (
  select
    id,
    prefijo,
    anio,
    row_number() over (
      partition by prefijo, anio
      order by codigo_caso
    ) as n
  from base
)
update core.casos c
   set codigo_caso = r.prefijo || '-' || r.anio || '-' || lpad(r.n::text, 4, '0')
  from ranked r
 where c.id = r.id
   and c.codigo_caso is distinct from
       (r.prefijo || '-' || r.anio || '-' || lpad(r.n::text, 4, '0'));

insert into core.migracion_log (clave)
values ('69_renombre_codigos_opacos_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Ningún código debe conservar el formato viejo (dos segmentos de letras).
select count(*) filter (where codigo_caso ~ '^CS-[A-Z]+-[A-Z]+-[0-9]{4}-[0-9]+$') as viejos,
       count(*) as total
  from core.casos;

-- Reparto por año.
select split_part(codigo_caso, '-', 2) as anio, count(*)
  from core.casos
 group by 1
 order by 1;

-- -----------------------------------------------------------------------------
-- Reversión
-- -----------------------------------------------------------------------------
-- No es posible reconstruir el código viejo desde el nuevo: el subsector y la
-- temática incrustados se perdían al renombrar. Para revertir haría falta el
-- respaldo previo (`backups/`). Por eso el paso 1 del plan es el `pg_dump`.
