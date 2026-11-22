-- =============================================================================
--  30 · Alcance derivado de las regiones + `security_invoker` del Anexo 15
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  `core.casos.alcance_id` era un valor **almacenado a mano** (o heredado del
--  legado) que no guardaba relación con las regiones del caso. Los dos datos
--  podían contradecirse y la UI mostraba ambos sin avisar:
--
--    · `CS-PA-GOB-2026-02` tenía `alcance_id = 5` (Nacional) pero sus regiones
--      en `core.caso_regiones` son Lambayeque y Piura, ambas del alcance Norte.
--    · La matriz del Anexo 15 (`analytics.vw_anexo_15_matriz_conflictividad`)
--      publicaba ese valor almacenado, así que el anexo arrastraba el error.
--
--  Además, la vista del Anexo 15 es una vista ordinaria: se evaluaba con los
--  privilegios de su dueño (`avisa`, superusuario con `rolbypassrls`), no con
--  los de quien la consulta. Con `core.casos` en `FORCE ROW LEVEL SECURITY`,
--  eso significa que la vista podía devolver filas fuera del ámbito del perfil.
--  La migración 23 cerró el mismo hueco en los anexos 16 y 17; faltaba el 15.
--
--  Qué cambia
--  ----------
--  1 · `core.regiones` gana `alcance_id` (FK a
--      `core.cat_alcances_geograficos`) y se rellena por `ubigeo` para las 25
--      regiones. El alcance deja de ser un atributo del caso: se deduce de la
--      geografía.
--  2 · Se crea `core.alcance_caso(uuid)`: mira primero `core.caso_regiones`; si
--      el caso no tiene regiones, cae a región principal → provincia principal
--      → distrito principal. Varias regiones con alcances distintos ⇒ Nacional
--      (5); sin ninguna ⇒ `NULL`.
--  3 · La vista del Anexo 15 se reemplaza **antes** de borrar la columna y pasa
--      a resolver el alcance con `core.alcance_caso(c.id)`.
--  4 · La vista se cierra con `security_invoker = true`: se evalúa con los
--      privilegios y la RLS del rol que la consulta.
--  5 · Se elimina `core.casos.alcance_id` (su único dependiente era la vista,
--      ya reemplazada en el paso anterior).
--
--  Por qué no hay triggers
--  -----------------------
--  `core.casos` y `core.caso_regiones` son `FORCE ROW LEVEL SECURITY` y
--  `core.casos` tiene `trg_audit`, que reescribe `fecha_ultima_actualizacion` en
--  cada UPDATE. Un trigger de derivación ensuciaría esa marca de auditoría y
--  obligaría a escribir sobre filas que la RLS puede ocultar. La derivación se
--  calcula al leer (`STABLE`, `parallel safe`), como `core.clasificacion_max()`.
--
--  Qué NO cambia
--  -------------
--  · `core.compromisos.alcance_id` sigue existiendo: el compromiso **no** tiene
--    región y su alcance se registra a mano. Esta migración no lo toca.
--  · No se crean triggers, ni índices, ni columnas fuera de `core.regiones`.
--  · El resto de la definición de la vista (columnas, orden, separadores de
--    `string_agg`) queda igual; sólo cambia el `left join` del alcance.
--
--  Cómo revertir
--  -------------
--  Al final del archivo hay un bloque comentado. Revertir **reabre** la fuga de
--  RLS de la vista y vuelve a dejar el alcance como dato almacenado; no se
--  puede recuperar el valor original por caso (sólo el derivado).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · `core.regiones.alcance_id`
-- -----------------------------------------------------------------------------
alter table core.regiones add column if not exists alcance_id smallint;

alter table core.regiones drop constraint if exists regiones_alcance_id_fkey;
alter table core.regiones add constraint regiones_alcance_id_fkey
  foreign key (alcance_id) references core.cat_alcances_geograficos(id);

-- -----------------------------------------------------------------------------
-- 2 · Backfill por ubigeo (mapa validado 25/25)
--     `core.regiones.ubigeo` es `character(2)`; se compara como texto.
-- -----------------------------------------------------------------------------
update core.regiones r
   set alcance_id = v.alcance_id
  from (values
    ('01', 4::smallint), -- Amazonas      → Oriente
    ('02', 2::smallint), -- Ancash        → Centro
    ('03', 3::smallint), -- Apurímac      → Sur
    ('04', 3::smallint), -- Arequipa      → Sur
    ('05', 3::smallint), -- Ayacucho      → Sur
    ('06', 1::smallint), -- Cajamarca     → Norte
    ('07', 2::smallint), -- Callao        → Centro
    ('08', 3::smallint), -- Cusco         → Sur
    ('09', 2::smallint), -- Huancavelica  → Centro
    ('10', 2::smallint), -- Huánuco       → Centro
    ('11', 2::smallint), -- Ica           → Centro
    ('12', 2::smallint), -- Junín         → Centro
    ('13', 1::smallint), -- La Libertad   → Norte
    ('14', 1::smallint), -- Lambayeque    → Norte
    ('15', 2::smallint), -- Lima          → Centro
    ('16', 4::smallint), -- Loreto        → Oriente
    ('17', 4::smallint), -- Madre de Dios → Oriente
    ('18', 3::smallint), -- Moquegua      → Sur
    ('19', 2::smallint), -- Pasco         → Centro
    ('20', 1::smallint), -- Piura         → Norte
    ('21', 3::smallint), -- Puno          → Sur
    ('22', 4::smallint), -- San Martín    → Oriente
    ('23', 3::smallint), -- Tacna         → Sur
    ('24', 1::smallint), -- Tumbes        → Norte
    ('25', 4::smallint)  -- Ucayali       → Oriente
  ) as v(ubigeo, alcance_id)
 where r.ubigeo::text = v.ubigeo;

-- Verificación del backfill: 25 regiones, 0 sin alcance.
select count(*) as regiones,
       count(*) filter (where alcance_id is null) as sin_alcance
  from core.regiones;

-- -----------------------------------------------------------------------------
-- 3 · Derivación del alcance de un caso
--     Mismo estilo que `core.clasificacion_max()`: SQL estable, paralelo y con
--     `search_path` fijo. Sin `SECURITY DEFINER`: la RLS del invocador se
--     respeta igual que en una lectura directa.
-- -----------------------------------------------------------------------------
create or replace function core.alcance_caso(p_caso_id uuid)
returns smallint
language sql
stable
parallel safe
set search_path to 'pg_catalog', 'core'
as $$
  with alcances as (
    select r.alcance_id
      from core.caso_regiones cr
      join core.regiones r on r.id = cr.region_id
     where cr.caso_id = p_caso_id
       and r.alcance_id is not null
    union
    select r.alcance_id
      from core.casos c
      join core.regiones r
        on r.id = coalesce(
             c.region_principal_id,
             (select p.region_id from core.provincias p where p.id = c.provincia_principal_id),
             (select p.region_id from core.distritos d join core.provincias p on p.id = d.provincia_id
               where d.id = c.distrito_principal_id)
           )
     where c.id = p_caso_id
       and r.alcance_id is not null
       and not exists (select 1 from core.caso_regiones x where x.caso_id = p_caso_id)
  )
  select case
           when count(*) = 0 then null
           when count(distinct alcance_id) = 1 then min(alcance_id)
           else 5::smallint
         end
    from alcances
$$;

comment on function core.alcance_caso(uuid) is
  'Alcance geográfico derivado de las regiones del caso (Nacional si hay varios alcances).';

-- -----------------------------------------------------------------------------
-- 4 · Vista del Anexo 15: reemplazar ANTES de borrar `core.casos.alcance_id`
--     Mismas columnas, mismo orden y mismos separadores que la definición viva;
--     sólo cambia el join del alcance. El separador de la cronología es un
--     salto de línea literal, igual que en la vista original.
-- -----------------------------------------------------------------------------
create or replace view analytics.vw_anexo_15_matriz_conflictividad as
 SELECT c.codigo_caso,
    g.region,
    al.codigo AS alcance,
    s.nombre AS subsector,
    tm.nombre AS tematica,
    uo.siglas AS responsable,
    nc.nombre AS nivel_conflicto,
    nr.codigo AS nivel_riesgo,
    c.descripcion_riesgo,
    pa.codigo AS prioridad_atencion,
    c.nombre_caso,
    ( SELECT string_agg(
               (to_char(k.fecha_evento::timestamp with time zone, 'DD.MM.YYYY'::text) || ' '::text)
               || k.descripcion_hecho,
               E'\n'::text
               ORDER BY k.fecha_evento DESC) AS string_agg
           FROM core.caso_cronologia k
          WHERE k.caso_id = c.id) AS narracion_cronologica,
    ( SELECT string_agg(a.codigo_alerta::text, ', '::text) AS string_agg
           FROM core.alertas_tempranas a
          WHERE a.caso_id = c.id) AS alertas_vinculadas,
    ( SELECT string_agg(ac.nombre_actual::text, '; '::text) AS string_agg
           FROM core.casos_actores ca
             JOIN core.actores ac ON ac.actor_uid = ca.actor_id
          WHERE ca.caso_id = c.id) AS actores_involucrados,
    pf.nombre AS punto_focal
   FROM core.casos c
     LEFT JOIN core.usuarios pf ON pf.id = c.punto_focal_usuario_id
     JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
     JOIN core.cat_subsectores s ON s.id = c.subsector_id
     JOIN core.cat_tematicas tm ON tm.id = c.tematica_id
     JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
     JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id
     JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
     LEFT JOIN core.cat_alcances_geograficos al ON al.id = core.alcance_caso(c.id)
     LEFT JOIN core.cat_prioridades_atencion pa ON pa.id = c.prioridad_id;

-- -----------------------------------------------------------------------------
-- 5 · `security_invoker` + privilegios del invocador
--     Con `security_invoker = true` la vista se evalúa con los privilegios del
--     rol que consulta. `avisa_api` (la credencial de `avisa-ui`) hereda de
--     `avisa_app`, que ya tiene SELECT sobre todos los objetos implicados; el
--     bloque siguiente comprueba los cinco que exige la nueva derivación y
--     concede sólo los que falten, para que la migración sea reejecutable en
--     entornos donde el GRANT no hubiera llegado.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'core.regiones',
    'core.caso_regiones',
    'core.provincias',
    'core.distritos',
    'core.cat_alcances_geograficos'
  ] loop
    if not has_table_privilege('avisa_app', v_tabla, 'select') then
      execute format('grant select on %s to avisa_app', v_tabla);
      raise notice 'Se otorgó SELECT sobre % a avisa_app: la vista ahora se evalúa con los privilegios del invocador.', v_tabla;
    end if;
  end loop;
end $$;

alter view analytics.vw_anexo_15_matriz_conflictividad set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 6 · Retirar la columna almacenada (la vista ya no la usa)
-- -----------------------------------------------------------------------------
alter table core.casos drop column if exists alcance_id cascade;

-- -----------------------------------------------------------------------------
-- 7 · Verificación (dentro de la transacción; abortar si algo no cuadra)
-- -----------------------------------------------------------------------------
-- (a) Los 35 casos derivan un alcance (0 sin alcance).
select count(*) filter (where core.alcance_caso(id) is null) as sin_alcance,
       count(*) as total
  from core.casos;

-- (b) La matriz del Anexo 15 conserva sus 22 filas.
select count(*) as filas_anexo_15
  from analytics.vw_anexo_15_matriz_conflictividad;

-- (c) `CS-PA-GOB-2026-02` ahora es Norte (1). Antes almacenaba 5 (Nacional).
select core.alcance_caso(id) as alcance_gob_2026_02
  from core.casos
 where codigo_caso = 'CS-PA-GOB-2026-02';

-- (d) La vista queda con security_invoker.
select reloptions as opciones_vista
  from pg_class
 where oid = 'analytics.vw_anexo_15_matriz_conflictividad'::regclass;

-- (e) Alcance derivado de los 35 casos (sin nulos).
select codigo_caso, core.alcance_caso(id) as alcance
  from core.casos
 order by codigo_caso;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para volver al comportamiento anterior. REABRE la fuga de RLS de
--  la vista y devuelve el alcance a un dato almacenado (ya sólo derivado).
-- =============================================================================
--
-- begin;
--
-- -- Vuelve a abrir la vista (sin security_invoker) con el alcance almacenado.
-- alter view analytics.vw_anexo_15_matriz_conflictividad
--   set (security_invoker = false);
--
-- -- Recupera una columna almacenada a partir del valor derivado.
-- alter table core.casos add column if not exists alcance_id smallint;
-- update core.casos c set alcance_id = core.alcance_caso(c.id);
-- alter table core.casos
--   add constraint casos_alcance_id_fkey
--   foreign key (alcance_id) references core.cat_alcances_geograficos(id);
--
-- -- Reemplaza la vista para leer de nuevo `c.alcance_id` (misma definición que
-- -- antes de esta migración; ver `migration/23` y el historial de 15/16).
-- -- drop function core.alcance_caso(uuid);
-- -- alter table core.regiones drop constraint if exists regiones_alcance_id_fkey;
-- -- alter table core.regiones drop column if exists alcance_id;
--
-- commit;
