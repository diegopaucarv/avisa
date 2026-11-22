-- =============================================================================
--  21 · Retiro de `core.cat_tipos_reunion` (gap D7)
--
--  Por qué existe esta migración
--  -----------------------------
--  `core.cat_tipos_reunion` (Asistencia_Tecnica, Reunion_Preparatoria,
--  Reunion_Ordinaria_Plenaria, Otra) no tiene ninguna fila de uso y su eje
--  semántico —programado / no programado— ya vive en
--  `core.reuniones_dialogo.programada`. Es un catálogo redundante.
--
--  La decisión sobre D7 es condicional: retirarlo SÓLO si no tiene
--  dependientes. En esta base sí los tiene, así que la tabla se conserva y se
--  marca obsoleta con `comment on table`:
--
--    · `core.reuniones_dialogo.tipo_id` la referencia por FK
--      (`reuniones_dialogo_tipo_id_fkey`, visible en `pg_depend` como
--      dependencia normal `deptype = 'n'`).
--    · `analytics.vw_anexo_16_registro_reuniones` depende de
--      `core.reuniones_dialogo` y, por tanto, del catálogo.
--
--  Borrar la tabla exigiría eliminar antes la FK y tocar una tabla de dominio
--  (`core.reuniones_dialogo`) fuera del alcance de esta tarea. Por eso el
--  camino que se ejecuta aquí es el del comentario.
--
--  Qué hace el bloque
--  ------------------
--  · Si la tabla no existe: no hace nada (re-ejecución tras un retiro).
--  · Si no tiene FKs, dependencias ni vistas: la retira.
--  · Si tiene alguna: la conserva y la marca como OBSOLETA.
--
--  Cómo revertir
--  -------------
--  En el camino ejecutado (tabla conservada) la reversión es restaurar el
--  comentario anterior; el bloque comentado al final del archivo lo contiene.
-- =============================================================================

begin;

do $$
declare
  v_fks    integer;
  v_deps   integer;
  v_vistas integer;
begin
  if to_regclass('core.cat_tipos_reunion') is null then
    raise notice 'core.cat_tipos_reunion no existe: nada que hacer';
    return;
  end if;

  -- FKs que apuntan al catálogo.
  select count(*) into v_fks
    from pg_constraint
   where contype = 'f'
     and confrelid = 'core.cat_tipos_reunion'::regclass;

  -- Dependencias normales (constraints y reglas de vistas), excluyendo la
  -- propia tabla. Su pkey y su unique aparecen como deptype 'a', no 'n'.
  select count(*) into v_deps
    from pg_depend d
   where d.refobjid = 'core.cat_tipos_reunion'::regclass
     and d.deptype = 'n'
     and d.objid <> 'core.cat_tipos_reunion'::regclass;

  -- Vistas o matviews que lean el catálogo directamente.
  select count(*) into v_vistas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v', 'm')
     and pg_get_viewdef(c.oid) ilike '%cat_tipos_reunion%';

  if v_fks = 0 and v_deps = 0 and v_vistas = 0 then
    drop table core.cat_tipos_reunion;
    raise notice 'core.cat_tipos_reunion retirada: no tiene dependientes';
  else
    execute 'comment on table core.cat_tipos_reunion is ' ||
      quote_literal(
        'OBSOLETO (D7): catálogo de tipos de reunión sin uso. Se conserva ' ||
        'porque core.reuniones_dialogo.tipo_id lo referencia por FK y ' ||
        'analytics.vw_anexo_16_registro_reuniones depende de esa tabla. ' ||
        'El eje «programado / no programado» del Anexo 16 vive en ' ||
        'core.reuniones_dialogo.programada. No agregar valores nuevos.');
    raise notice
      'core.cat_tipos_reunion conservada y marcada obsoleta: % FK, % dependencia(s), % vista(s)',
      v_fks, v_deps, v_vistas;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- Dependencia que impide el retiro (debe seguir existiendo).
select c.conname,
       c.conrelid::regclass as tabla_dependiente,
       c.confrelid::regclass as catalogo
  from pg_constraint c
 where c.confrelid = to_regclass('core.cat_tipos_reunion');

-- Comentario resultante: «OBSOLETO (D7)…» si se conservó.
select coalesce(
         obj_description(to_regclass('core.cat_tipos_reunion'), 'pg_class'),
         '(core.cat_tipos_reunion no existe)'
       ) as comentario;

-- Vistas que leen el catálogo directamente (se espera ninguna).
select n.nspname as esquema, c.relname as vista
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('v', 'm')
   and pg_get_viewdef(c.oid) ilike '%cat_tipos_reunion%';

-- Filas conservadas (se esperan las 4 originales si la tabla sigue viva).
-- Se consulta por SQL dinámico para no romper la migración si el retiro se
-- ejecutó en una base sin dependientes.
do $$
declare
  r record;
begin
  if to_regclass('core.cat_tipos_reunion') is null then
    raise notice 'sin filas: core.cat_tipos_reunion no existe';
    return;
  end if;

  for r in execute 'select id, codigo from core.cat_tipos_reunion order by id'
  loop
    raise notice 'core.cat_tipos_reunion id=% codigo=%', r.id, r.codigo;
  end loop;
end $$;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para restaurar el comentario anterior del catálogo.
-- =============================================================================
--
-- begin;
--
-- comment on table core.cat_tipos_reunion is
--   'Catálogo de tipos de reunión de diálogo: asistencia técnica, preparatoria, ordinaria plenaria u otra.';
--
-- commit;
