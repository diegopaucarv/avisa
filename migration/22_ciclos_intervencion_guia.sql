-- =============================================================================
--  22 · Alineación de `core.cat_ciclos_intervencion` a la Guía (gap D9)
--
--  Por qué existe esta migración
--  -----------------------------
--  La Guía §8 define cinco componentes del ciclo de intervención sectorial:
--  prevención estratégica, prevención operativa, intervención y tratamiento,
--  monitoreo de compromisos y gestión de la información y del conocimiento.
--  El catálogo legado sólo tenía cuatro etiquetas: Prevención, Intervención y
--  tratamiento, Seguimiento y Gestión del Conocimiento. La UI traducía esos
--  valores en `angular/src/app/dominio/mapeo.ts`; tras esta migración la base
--  habla directamente el vocabulario de la Guía y esa traducción deja de ser
--  necesaria.
--
--  Referencias normativas
--  ----------------------
--    · §8 Ciclo de intervención sectorial (guia.md:648-690), Tabla 6.
--
--  Cómo se remapea `core.casos`
--  ----------------------------
--  El remapeo se hace renombrando la fila del catálogo, no moviendo casos:
--
--    Prevención                → Prevención operativa
--    Seguimiento               → Monitoreo de compromisos
--    Gestión del Conocimiento  → Gestión de la información y del conocimiento
--    Intervención y tratamiento → sin cambio
--    (nueva)                   → Prevención estratégica, sin casos
--
--  Como el `id` de cada fila no cambia, `core.casos.ciclo_intervencion_id`
--  sigue apuntando a la misma etapa y el remapeo queda aplicado sin un `UPDATE`
--  masivo sobre `core.casos`. Esto además evita tocar una tabla de dominio con
--  RLS forzada (`core.casos`): una actualización directa sería filtrada por las
--  políticas y podría no afectar ninguna fila de forma silenciosa.
--
--  `codigo_legado` se conserva: es la clave estable del ETL y de los cruces con
--  el legado. Por eso Ciclo-001 seguirá identificando la fila que hoy se llama
--  «Prevención operativa».
--
--  Notas de seguridad
--  ------------------
--    · Los renombres se hacen por etiqueta y son idempotentes: si la etiqueta
--      de destino ya existe, la fila de origen ya se migró.
--    · Si en otro entorno coexistieran la etiqueta legada y la nueva, la
--      migración falla ruidosamente en vez de dejar casos apuntando a una
--      etapa que la Guía no reconoce.
--    · «Prevención estratégica» se inserta sin casos, tal como decide D9. No se
--      reclasifica ningún caso existente hacia ella.
--
--  Cómo revertir
--  -------------
--  Al final del archivo, tras el `commit;`, hay un bloque comentado con los
--  renombres inversos. Es una reversión de etiquetas: si después de esta
--  migración se registraron casos en las etapas nuevas, esos casos quedarían
--  en una etapa que el catálogo legado no distingue.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Renombres (identificados por etiqueta, no por id)
-- -----------------------------------------------------------------------------
do $$
declare
  v_mapa    record;
  v_origen  smallint;
  v_destino smallint;
begin
  for v_mapa in
    select * from (values
      ('Prevención',               'Prevención operativa'),
      ('Seguimiento',              'Monitoreo de compromisos'),
      ('Gestión del Conocimiento', 'Gestión de la información y del conocimiento')
    ) as m(origen, destino)
  loop
    select id into v_origen
      from core.cat_ciclos_intervencion
     where nombre = v_mapa.origen;

    select id into v_destino
      from core.cat_ciclos_intervencion
     where nombre = v_mapa.destino;

    if v_origen is null then
      continue;  -- ya migrado: sólo existe la etiqueta de destino
    end if;

    if v_destino is not null then
      raise exception
        'core.cat_ciclos_intervencion contiene "%" (id %) y "%" (id %): estado ambiguo, resolver a mano',
        v_mapa.origen, v_origen, v_mapa.destino, v_destino
        using errcode = '23505';
    end if;

    update core.cat_ciclos_intervencion
       set nombre = v_mapa.destino
     where id = v_origen;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2 · Alta de «Prevención estratégica» (sin casos)
-- -----------------------------------------------------------------------------
insert into core.cat_ciclos_intervencion (id, nombre, codigo_legado)
select (select coalesce(max(id), 0) + 1 from core.cat_ciclos_intervencion),
       'Prevención estratégica',
       null
 where not exists (
   select 1
     from core.cat_ciclos_intervencion
    where nombre = 'Prevención estratégica'
 )
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3 · Comentario del catálogo alineado a la Guía
-- -----------------------------------------------------------------------------
comment on table core.cat_ciclos_intervencion is
  'Catálogo de ciclos de intervención alineado a la Guía §8 (migración 22): prevención estratégica, prevención operativa, intervención y tratamiento, monitoreo de compromisos, y gestión de la información y del conocimiento.';

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- Catálogo resultante.
select id, nombre, codigo_legado
  from core.cat_ciclos_intervencion
 order by id;

-- Las cinco etiquetas de la Guía deben existir.
select e.orden, e.nombre, ci.id
  from (values
    (1, 'Prevención estratégica'),
    (2, 'Prevención operativa'),
    (3, 'Intervención y tratamiento'),
    (4, 'Monitoreo de compromisos'),
    (5, 'Gestión de la información y del conocimiento')
  ) as e(orden, nombre)
  left join core.cat_ciclos_intervencion ci on ci.nombre = e.nombre
 order by e.orden;

-- Casos por ciclo: los conteos se conservan (32 en Seguimiento → Monitoreo,
-- 1 en Prevención → Prevención operativa, 1 en Intervención y tratamiento).
select ci.id, ci.nombre, count(c.id) as casos
  from core.cat_ciclos_intervencion ci
  left join core.casos c on c.ciclo_intervencion_id = ci.id
 group by ci.id, ci.nombre
 order by ci.id;

-- Casos sin ciclo (deben seguir sin ciclo; esta migración no los toca).
select count(*) as casos_sin_ciclo
  from core.casos
 where ciclo_intervencion_id is null;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para volver a las etiquetas legadas.
-- =============================================================================
--
-- begin;
--
-- update core.cat_ciclos_intervencion
--    set nombre = 'Prevención'
--  where nombre = 'Prevención operativa';
--
-- update core.cat_ciclos_intervencion
--    set nombre = 'Seguimiento'
--  where nombre = 'Monitoreo de compromisos';
--
-- update core.cat_ciclos_intervencion
--    set nombre = 'Gestión del Conocimiento'
--  where nombre = 'Gestión de la información y del conocimiento';
--
-- -- «Prevención estratégica» se elimina sólo si ningún caso la referencia.
-- delete from core.cat_ciclos_intervencion ci
--  where ci.nombre = 'Prevención estratégica'
--    and not exists (select 1 from core.casos c where c.ciclo_intervencion_id = ci.id);
--
-- comment on table core.cat_ciclos_intervencion is
--   'Catálogo de ciclos de intervención: prevención, intervención y tratamiento, seguimiento y gestión del conocimiento.';
--
-- commit;
