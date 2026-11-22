-- =============================================================================
--  14 · Alineación de los catálogos `core.cat_*` con la Guía PRODUCE
--
--  Por qué existe esta migración
--  -----------------------------
--  La Guía de Prevención y Gestión de Conflictos Sociales (PRODUCE) es ahora
--  la fuente de verdad del vocabulario del sistema. Varias filas de los
--  catálogos `core.cat_*` se cargaron con etiquetas heredadas que no coinciden
--  con el texto normativo. Esta migración normaliza el nombre (y, en el nivel
--  de conflicto, el código) para que la base use directamente la terminología
--  de la Guía. La interfaz ya normaliza parte de estas etiquetas en el cliente,
--  por eso el cambio es tolerante y reversible.
--
--  Referencias normativas
--  ----------------------
--    · §7.4.1  Rol estructural: actores sociales / públicos / privados.
--    · §7.4.2  Función en la intervención: principales, secundarios y
--              terceros imparciales.
--    · §7.6    Tipos de casos de conflictividad: los subsectores describen
--              actividades productivas, no áreas internas de la oficina.
--    · §8.2.4  Análisis de caso: el posicionamiento del actor es dialogante,
--              legitimante o conflictivo.
--    · Anexo N° 3  Formato de Alerta Temprana → `cat_tipos_documento`.
--
--  Qué cambia
--  ----------
--    cat_tipos_actor      Actor del Estado → Actor público
--                         Actor Sociedad Civil → Actor social
--                         Actor Privado se conserva
--                         elimina NEC / Exportador CITES / CITE / SANIPES (0 usos)
--    cat_roles_actor      Tercero → Tercero imparcial
--                         No_determinado → No determinado
--                         elimina Proveedor MYPE / Exportador CITES / Inspector CITE
--    cat_perfiles_actor   Disruptivo → Conflictivo
--    cat_subsectores      Mype e Industria → MYPE e Industria
--                         elimina Gestión y Prevención de Conflictos (0 casos)
--    cat_niveles_conflicto  codigo Conflicto_social → Conflicto social
--                           codigo Crisis_social    → Crisis social
--    cat_niveles_alerta   quita el SLA de la etiqueta (ya vive en sla_horas):
--                         Inmediato (24h) → Inmediato, Táctico (24h - 48h) →
--                         Táctico, Preventivo (48h - 72h) → Preventivo
--    cat_tipos_documento  reporte_alerta_temprana: anexo_numero = 3
--
--  Notas de seguridad
--  ------------------
--    · `codigo_legado` NUNCA se toca: es la clave estable del ETL y de los
--      cruces con el legado.
--    · Todo `DELETE` está precedido por una guarda que falla ruidosamente si
--      la fila tiene referencias FK (no se destruyen datos por accidente).
--    · Todo `UPDATE` es idempotente: re-ejecutar el archivo tras un run
--      exitoso no modifica nada.
--    · `core.cat_niveles_conflicto` está protegido por
--      `core.bloquear_escritura_directa()`, que solo deja escribir cuando
--      `app.cambio_normativo_en_curso = 'true'`. Esta migración se aplica a
--      mano con rol superusuario y usa el mismo interruptor que emplea
--      internamente `core.aplicar_cambio_normativo()`; el camino de runtime
--      sigue siendo esa función sancionada.
--    · Tras aplicar, si se quieren ver las nuevas etiquetas de nivel en el
--      tablero, refrescar la matview: `refresh materialized view
--      analytics.mv_dashboard_alta_direccion;` (las vistas
--      `analytics.vw_anexo_02_panorama_regional` y
--      `analytics.vw_anexo_15_matriz_conflictividad` son vistas normales y se
--      actualizan solas).
--
--  Cómo revertir
--  -------------
--  Al final del archivo, tras el `commit;`, hay un bloque comentado con las
--  sentencias inversas exactas (`UPDATE` para los renombres e `INSERT` para las
--  filas eliminadas, conservando `id` y `codigo_legado`). Se ejecuta a mano,
--  dentro de su propia transacción.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · cat_tipos_actor — §7.4.1: actores sociales / públicos / privados
-- -----------------------------------------------------------------------------
update core.cat_tipos_actor
   set nombre = 'Actor público'
 where nombre = 'Actor del Estado'
   and not exists (
     select 1 from core.cat_tipos_actor x where x.nombre = 'Actor público');

update core.cat_tipos_actor
   set nombre = 'Actor social'
 where nombre = 'Actor Sociedad Civil'
   and not exists (
     select 1 from core.cat_tipos_actor x where x.nombre = 'Actor social');

-- Guarda + borrado. Cada fila se elimina solo si `core.actores` no la referencia.
do $$
declare
  v_nombre text;
  v_id     integer;
  v_refs   bigint;
begin
  foreach v_nombre in array array['NEC', 'Exportador CITES', 'CITE', 'SANIPES']
  loop
    select id into v_id from core.cat_tipos_actor where nombre = v_nombre;

    if v_id is null then
      continue;  -- ya no existe: ejecución repetida, nada que hacer
    end if;

    select count(*) into v_refs
      from core.actores
     where tipo_actor_id = v_id;

    if v_refs > 0 then
      raise exception
        'core.cat_tipos_actor "%" (id %) está referenciado por % actores; no se elimina',
        v_nombre, v_id, v_refs
        using errcode = '23503';
    end if;

    delete from core.cat_tipos_actor where id = v_id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2 · cat_roles_actor — §7.4.2: terceros imparciales
-- -----------------------------------------------------------------------------
update core.cat_roles_actor
   set nombre = 'Tercero imparcial'
 where nombre = 'Tercero'
   and not exists (
     select 1 from core.cat_roles_actor x where x.nombre = 'Tercero imparcial');

update core.cat_roles_actor
   set nombre = 'No determinado'
 where nombre = 'No_determinado'
   and not exists (
     select 1 from core.cat_roles_actor x where x.nombre = 'No determinado');

-- Guarda + borrado contra `core.actores.rol_actor_id`.
do $$
declare
  v_nombre text;
  v_id     integer;
  v_refs   bigint;
begin
  foreach v_nombre in array array['Proveedor MYPE', 'Exportador CITES', 'Inspector CITE']
  loop
    select id into v_id from core.cat_roles_actor where nombre = v_nombre;

    if v_id is null then
      continue;
    end if;

    select count(*) into v_refs
      from core.actores
     where rol_actor_id = v_id;

    if v_refs > 0 then
      raise exception
        'core.cat_roles_actor "%" (id %) está referenciado por % actores; no se elimina',
        v_nombre, v_id, v_refs
        using errcode = '23503';
    end if;

    delete from core.cat_roles_actor where id = v_id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3 · cat_perfiles_actor — §8.2.4: dialogante / legitimante / conflictivo
-- -----------------------------------------------------------------------------
update core.cat_perfiles_actor
   set nombre = 'Conflictivo'
 where nombre = 'Disruptivo'
   and not exists (
     select 1 from core.cat_perfiles_actor x where x.nombre = 'Conflictivo');

-- -----------------------------------------------------------------------------
-- 4 · cat_subsectores — §7.6: el subsector es una actividad productiva
-- -----------------------------------------------------------------------------
update core.cat_subsectores
   set nombre = 'MYPE e Industria'
 where nombre = 'Mype e Industria'
   and not exists (
     select 1 from core.cat_subsectores x where x.nombre = 'MYPE e Industria');

-- Guarda + borrado contra las dos FK: `core.casos` y `core.alertas_tempranas`.
do $$
declare
  v_nombre  text := 'Gestión y Prevención de Conflictos';
  v_id      integer;
  v_casos   bigint;
  v_alertas bigint;
begin
  select id into v_id from core.cat_subsectores where nombre = v_nombre;

  if v_id is null then
    return;  -- ya no existe
  end if;

  select count(*) into v_casos   from core.casos             where subsector_id = v_id;
  select count(*) into v_alertas from core.alertas_tempranas where subsector_id = v_id;

  if v_casos > 0 or v_alertas > 0 then
    raise exception
      'core.cat_subsectores "%" (id %) está en uso: % casos y % alertas; no se elimina',
      v_nombre, v_id, v_casos, v_alertas
      using errcode = '23503';
  end if;

  delete from core.cat_subsectores where id = v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5 · cat_niveles_conflicto — el `codigo` debe coincidir con el `nombre`
--     Catálogo protegido por core.bloquear_escritura_directa(): se usa el
--     mismo interruptor que core.aplicar_cambio_normativo() de forma acotada.
-- -----------------------------------------------------------------------------
select set_config('app.cambio_normativo_en_curso', 'true', true);

update core.cat_niveles_conflicto
   set codigo = 'Conflicto social'
 where codigo = 'Conflicto_social'
   and not exists (
     select 1 from core.cat_niveles_conflicto x where x.codigo = 'Conflicto social');

update core.cat_niveles_conflicto
   set codigo = 'Crisis social'
 where codigo = 'Crisis_social'
   and not exists (
     select 1 from core.cat_niveles_conflicto x where x.codigo = 'Crisis social');

select set_config('app.cambio_normativo_en_curso', 'false', true);

-- -----------------------------------------------------------------------------
-- 6 · cat_niveles_alerta — el SLA vive en `sla_horas`, no en la etiqueta
--     No se tocan `sla_horas`, `categoria` ni `codigo_legado`.
-- -----------------------------------------------------------------------------
update core.cat_niveles_alerta
   set nombre = 'Inmediato'
 where nombre = 'Inmediato (24h)'
   and not exists (
     select 1 from core.cat_niveles_alerta x where x.nombre = 'Inmediato');

update core.cat_niveles_alerta
   set nombre = 'Táctico'
 where nombre = 'Táctico (24h - 48h)'
   and not exists (
     select 1 from core.cat_niveles_alerta x where x.nombre = 'Táctico');

update core.cat_niveles_alerta
   set nombre = 'Preventivo'
 where nombre = 'Preventivo (48h - 72h)'
   and not exists (
     select 1 from core.cat_niveles_alerta x where x.nombre = 'Preventivo');

-- -----------------------------------------------------------------------------
-- 7 · cat_tipos_documento — Anexo N° 3: Formato de Alerta Temprana
--     No se agregan tipos nuevos (decisión de usuario).
-- -----------------------------------------------------------------------------
update core.cat_tipos_documento
   set anexo_numero = 3
 where codigo = 'reporte_alerta_temprana'
   and anexo_numero is distinct from 3;

-- -----------------------------------------------------------------------------
-- 8 · Verificación (sólo lectura) — estado resultante y conteos de uso
-- -----------------------------------------------------------------------------
select 'cat_tipos_actor'       as catalogo, id, nombre, codigo_legado
  from core.cat_tipos_actor order by id;
select 'cat_roles_actor'       as catalogo, id, nombre, codigo_legado
  from core.cat_roles_actor order by id;
select 'cat_perfiles_actor'    as catalogo, id, nombre, codigo_legado
  from core.cat_perfiles_actor order by id;
select 'cat_subsectores'       as catalogo, id, nombre, codigo_legado
  from core.cat_subsectores order by id;
select 'cat_niveles_conflicto' as catalogo, id, codigo, nombre, orden
  from core.cat_niveles_conflicto order by id;
select 'cat_niveles_alerta'    as catalogo, id, nombre, categoria, sla_horas, codigo_legado
  from core.cat_niveles_alerta order by id;
select 'cat_tipos_documento'   as catalogo, id, codigo, anexo_numero
  from core.cat_tipos_documento order by id;

-- Conteos de uso: los renombrados deben conservar su conteo y los eliminados
-- no deben tener ninguna referencia.
select 'tipos_actor' as uso, ta.nombre, count(a.*) as referencias
  from core.cat_tipos_actor ta
  left join core.actores a on a.tipo_actor_id = ta.id
 group by ta.id, ta.nombre
 order by ta.id;

select 'roles_actor' as uso, r.nombre, count(a.*) as referencias
  from core.cat_roles_actor r
  left join core.actores a on a.rol_actor_id = r.id
 group by r.id, r.nombre
 order by r.id;

select 'perfiles_actor' as uso, p.nombre, count(a.*) as referencias
  from core.cat_perfiles_actor p
  left join core.actores a on a.perfil_id = p.id
 group by p.id, p.nombre
 order by p.id;

select 'subsectores_casos' as uso, s.nombre, count(c.id) as referencias
  from core.cat_subsectores s
  left join core.casos c on c.subsector_id = s.id
 group by s.id, s.nombre
 order by s.id;

select 'subsectores_alertas' as uso, s.nombre, count(al.id) as referencias
  from core.cat_subsectores s
  left join core.alertas_tempranas al on al.subsector_id = s.id
 group by s.id, s.nombre
 order by s.id;

select 'niveles_alerta' as uso, n.nombre, count(al.id) as referencias
  from core.cat_niveles_alerta n
  left join core.alertas_tempranas al on al.nivel_alerta_id = n.id
 group by n.id, n.nombre
 order by n.id;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar y ajustar si se decide deshacer la alineación.
-- =============================================================================
--
-- begin;
--
-- -- Renombres inversos
-- update core.cat_tipos_actor    set nombre = 'Actor del Estado'     where nombre = 'Actor público';
-- update core.cat_tipos_actor    set nombre = 'Actor Sociedad Civil' where nombre = 'Actor social';
-- update core.cat_roles_actor    set nombre = 'Tercero'              where nombre = 'Tercero imparcial';
-- update core.cat_roles_actor    set nombre = 'No_determinado'       where nombre = 'No determinado';
-- update core.cat_perfiles_actor set nombre = 'Disruptivo'           where nombre = 'Conflictivo';
-- update core.cat_subsectores    set nombre = 'Mype e Industria'     where nombre = 'MYPE e Industria';
--
-- -- Niveles de conflicto (mismo interruptor normativo)
-- select set_config('app.cambio_normativo_en_curso', 'true', true);
-- update core.cat_niveles_conflicto set codigo = 'Conflicto_social' where codigo = 'Conflicto social';
-- update core.cat_niveles_conflicto set codigo = 'Crisis_social'    where codigo = 'Crisis social';
-- select set_config('app.cambio_normativo_en_curso', 'false', true);
--
-- -- Niveles de alerta
-- update core.cat_niveles_alerta set nombre = 'Inmediato (24h)'        where nombre = 'Inmediato';
-- update core.cat_niveles_alerta set nombre = 'Táctico (24h - 48h)'    where nombre = 'Táctico';
-- update core.cat_niveles_alerta set nombre = 'Preventivo (48h - 72h)' where nombre = 'Preventivo';
--
-- -- Tipos de documento
-- update core.cat_tipos_documento set anexo_numero = null where codigo = 'reporte_alerta_temprana';
--
-- -- Filas eliminadas (ids, nombres y codigo_legado originales)
-- insert into core.cat_tipos_actor (id, nombre, codigo_legado) values
--   (4, 'NEC',              null),
--   (5, 'Exportador CITES', null),
--   (6, 'CITE',             null),
--   (7, 'SANIPES',          null);
--
-- insert into core.cat_roles_actor (id, nombre, codigo_legado) values
--   (4, 'Proveedor MYPE',   null),
--   (5, 'Exportador CITES', null),
--   (6, 'Inspector CITE',   null);
--
-- insert into core.cat_subsectores (id, nombre, codigo_legado, id_area_legado) values
--   (3, 'Gestión y Prevención de Conflictos', 'Sector-03', 'AR-047');
--
-- -- Reajustar las secuencias tras reinsertar con id explícito.
-- select setval('core.cat_tipos_actor_id_seq', (select max(id) from core.cat_tipos_actor));
-- select setval('core.cat_roles_actor_id_seq', (select max(id) from core.cat_roles_actor));
-- select setval('core.cat_subsectores_id_seq', (select max(id) from core.cat_subsectores));
--
-- commit;
