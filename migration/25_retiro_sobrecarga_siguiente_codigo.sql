-- =============================================================================
--  25 · Retiro de la sobrecarga heredada de `core.siguiente_codigo_caso()` (G-03)
--
--  Por qué existe esta migración
--  -----------------------------
--  `migration/12_anulacion_y_secuencia.sql` (líneas 152-166) creó
--  `core.siguiente_codigo_caso()` **sin argumentos**, con contador global de
--  ámbito `'CASO'` y prefijo `CS-PRODUCE-`. La migración 16 creó
--  `core.siguiente_codigo_caso(integer, integer)` con el formato del Anexo 15.
--  Ninguna migración de las 10-24 ejecutaba `DROP FUNCTION`, así que ambas
--  firmas convivían. Es el hallazgo G-03 del registro de gaps.
--
--  Qué se midió antes de escribir esta migración
--  ---------------------------------------------
--  · `pg_proc` (esquema `core`): dos sobrecargas vivas —
--        oid 131283 · `siguiente_codigo_caso()` · prosecdef = true
--        oid 131297 · `siguiente_codigo_caso(integer, integer)` · prosecdef = true
--    La de dos argumentos declara `DEFAULT 1` en ambos parámetros
--    (`pronargdefaults = 2`); la de cero, ninguno.
--
--  · Dependientes de la sobrecarga de cero argumentos (oid 131283):
--        pg_depend  (refclassid = pg_proc, refobjid = 131283) → 0 filas
--        pg_proc.prosrc de otras funciones (todos los esquemas) → 0 filas
--        pg_views / pg_class relkind v,m con el nombre en la definición → 0 filas
--        pg_policy, pg_trigger, pg_attrdef con el nombre → 0 filas
--    Es decir: no hay función, vista, política, trigger ni default que la use.
--
--  · Llamadas en el código: `grep -rn "siguiente_codigo_caso" app lib angular
--    migration` sólo encuentra `lib/db/repos/cases.ts:763`, que pasa dos
--    argumentos (`core.siguiente_codigo_caso($1::int, $2::int)`).
--
--  · Datos: `core.secuencia_codigo` tiene **0 filas** con `ambito = 'CASO'`.
--    La sobrecarga heredada nunca llegó a ejecutarse en esta base.
--
--  · Comportamiento observado de una llamada sin argumentos ANTES del retiro:
--        select core.siguiente_codigo_caso();
--        ERROR: function core.siguiente_codigo_caso() is not unique
--    No emitía `CS-PRODUCE-…`: el `DEFAULT 1` de la versión de la 16 hace que
--    el parser vea dos candidatos y rechace la llamada (SQLSTATE 42725). El
--    formato heredado sólo sería alcanzable nombrando la firma exacta. Este
--    detalle corrige la redacción de G-03, que suponía que la llamada sin
--    argumentos devolvía el código antiguo.
--
--  Qué hace el bloque
--  ------------------
--  · Si la sobrecarga de cero argumentos no existe: no hace nada (idempotente).
--  · Si existe y NO tiene dependientes: la retira con `DROP FUNCTION`.
--  · Si existe y tiene dependientes: NO la retira; la conserva y la marca como
--    OBSOLETA con `COMMENT`, explicando por qué (patrón de dos ramas de
--    `migration/21_retiro_cat_tipos_reunion.sql`).
--
--  Efecto en quien llame sin argumentos
--  ------------------------------------
--  Después del retiro, `select core.siguiente_codigo_caso()` ya no es ambiguo:
--  se resuelve a la única firma viva, la de dos argumentos, aplicando sus
--  `DEFAULT 1, 1`. Por eso devuelve `CS-PA-INF-<AAAA>-NN` (Anexo 15) y no el
--  formato `CS-PRODUCE-…`. El formato heredado deja de ser alcanzable.
--
--  Cómo revertir
--  -------------
--  Al final del archivo hay un bloque comentado que recrea la función de cero
--  argumentos tal como la definió `migration/12_anulacion_y_secuencia.sql`
--  (cuerpo, `COMMENT` y `GRANT`). Revertir reintroduce el error de ambigüedad
--  en las llamadas sin argumentos.
-- =============================================================================

begin;

do $$
declare
  v_oid      oid;
  v_deps     integer;
  v_funcs    integer;
  v_vistas   integer;
  v_exprs    integer;
begin
  -- Identificar la sobrecarga exacta por firma, no por nombre: `pronargs = 0`.
  select p.oid
    into v_oid
    from pg_proc p
   where p.pronamespace = 'core'::regnamespace
     and p.proname = 'siguiente_codigo_caso'
     and p.pronargs = 0;

  if v_oid is null then
    raise notice 'core.siguiente_codigo_caso() no existe: nada que hacer';
    return;
  end if;

  -- (1) Dependencias registradas en el catálogo (vistas, reglas, otras
  --     funciones con cuerpo SQL estándar, etc.).
  select count(*) into v_deps
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass
     and d.refobjid = v_oid;

  -- (2) Otras funciones cuyo cuerpo (texto) la nombre. Las funciones PL/pgSQL
  --     no registran dependencia en pg_depend, así que se comprueba aparte.
  select count(*) into v_funcs
    from pg_proc p
   where p.oid <> v_oid
     and p.prosrc ilike '%siguiente_codigo_caso%';

  -- (3) Vistas y matviews que la lean en su definición.
  select count(*) into v_vistas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v', 'm')
     and pg_get_viewdef(c.oid) ilike '%siguiente_codigo_caso%';

  -- (4) Políticas RLS, triggers y default de columna que la invoquen.
  select (
           (select count(*) from pg_policy
             where pg_get_expr(polqual, polrelid) ilike '%siguiente_codigo_caso%'
                or pg_get_expr(polwithcheck, polrelid) ilike '%siguiente_codigo_caso%')
         + (select count(*) from pg_trigger
             where not tgisinternal
               and pg_get_triggerdef(oid) ilike '%siguiente_codigo_caso%')
         + (select count(*) from pg_attrdef
             where pg_get_expr(adbin, adrelid) ilike '%siguiente_codigo_caso%')
         ) into v_exprs;

  if v_deps = 0 and v_funcs = 0 and v_vistas = 0 and v_exprs = 0 then
    drop function core.siguiente_codigo_caso();
    raise notice 'core.siguiente_codigo_caso() retirada (oid %): sin dependientes', v_oid;
  else
    -- Rama de conservación: hay algo que la usa. No se borra. Se marca.
    execute 'comment on function core.siguiente_codigo_caso() is ' ||
      quote_literal(
        'OBSOLETO (G-03): sobrecarga heredada sin argumentos. Emite el formato ' ||
        'anterior (CS-PRODUCE-…) con contador global de ámbito CASO y NO debe ' ||
        'usarse; la firma vigente es core.siguiente_codigo_caso(integer, integer). ' ||
        'Se conserva porque tiene dependientes: ' || v_deps || ' dependencia(s) ' ||
        'en pg_depend, ' || v_funcs || ' función(es) en prosrc, ' ||
        v_vistas || ' vista(s), ' || v_exprs || ' política/trigger/default.');
    raise notice
      'core.siguiente_codigo_caso() conservada y marcada obsoleta: % dependencia(s), % función(es), % vista(s), % política/trigger/default',
      v_deps, v_funcs, v_vistas, v_exprs;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- (a) Sobrecargas vivas. Se espera UNA sola fila: `(integer, integer)`.
select p.oid,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       p.prosecdef,
       p.pronargdefaults
  from pg_proc p
 where p.pronamespace = 'core'::regnamespace
   and p.proname = 'siguiente_codigo_caso'
 order by p.oid;

-- (b) Recuento de sobrecargas: se espera 1.
select count(*) as sobrecargas
  from pg_proc p
 where p.pronamespace = 'core'::regnamespace
   and p.proname = 'siguiente_codigo_caso';

-- (c) Ninguna función viva debe contener el prefijo heredado en su cuerpo.
select count(*) as funciones_con_cs_produce
  from pg_proc p
 where p.prosrc ilike '%CS-PRODUCE-%';

commit;

-- (d) Quien llame sin argumentos se resuelve a la firma de dos argumentos con
--     sus DEFAULT (1, 1) y devuelve el formato del Anexo 15. Se ejecuta en su
--     propia transacción y se revierte: NO consume un correlativo real.
begin;
select core.siguiente_codigo_caso() as sin_argumentos;
rollback;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para recrear la sobrecarga heredada tal como estaba en
--  migration/12_anulacion_y_secuencia.sql:152-166. Reintroduce el formato
--  CS-PRODUCE-… y el error «is not unique» en las llamadas sin argumentos,
--  por el DEFAULT de la firma de dos argumentos.
-- =============================================================================
--
-- begin;
--
-- create or replace function core.siguiente_codigo_caso()
-- returns text
-- language sql
-- security definer
-- set search_path = pg_catalog, core
-- as $$
--   select core.siguiente_codigo(
--     'CASO',
--     'CS-PRODUCE-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
--     3
--   );
-- $$;
--
-- comment on function core.siguiente_codigo_caso() is
--   'Código de caso con contador global monótono; el número nunca se reutiliza.';
--
-- grant execute on function core.siguiente_codigo_caso() to avisa_app;
--
-- commit;
