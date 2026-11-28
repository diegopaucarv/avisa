-- =============================================================================
-- 91 · Ámbito de las mesas 004, 005 y 012 · registro de la migración 54
--
-- Fecha: 2026-11-29
-- Autor de la carga: OAIPCS
--
-- POR QUÉ EXISTE
-- --------------
-- La migración 89 dejó sin clasificar tres mesas porque `ambito_departamento`
-- venía vacío y no había una lista de regiones que contar:
--
--   * OAIPCS-004 «Comisión Sectorial de Transferencia del Ministerio de la
--     Producción, en materia de MYPE e Industria» (RM N° 159-2017-PRODUCE).
--     Su objetivo es asegurar la transferencia progresiva de competencias,
--     funciones, activos y recursos a los gobiernos regionales: cubre todo el
--     país, no una región concreta.
--   * OAIPCS-005 «Grupo de Trabajo Multisectorial - Política de
--     Descentralización» (RM N° 120-2022-PCM). Su objetivo es elaborar la
--     propuesta de la Política **Nacional** Multisectorial de Descentralización,
--     de alcance nacional por definición.
--   * OAIPCS-012 «Comisión Multisectorial de naturaleza permanente "VRAEM
--     Productivo"» (DS N° 006-2023-PCM). El VRAEM abarca cinco departamentos
--     —Apurímac, Ayacucho, Cusco, Junín y Huancavelica— (verificado en la
--     ficha pública del valle), es decir, más de tres regiones.
--
-- Con la regla automática de la migración 90 basta con escribir el ámbito: el
-- trigger deriva `es_nacional` y propaga `alcance_override` al caso espejo.
--
-- QUÉ HACE
-- --------
-- 1. Escribe `ambito_departamento` de las tres mesas:
--    - 004 y 005 → «Nacional» (no hay una lista de regiones que las describa;
--      su carácter nacional es de diseño, no geográfico).
--    - 012 → los cinco departamentos del VRAEM. El trigger cuenta cinco
--      regiones (> 3) y la marca nacional; `ambitoDetalle` conservará esa
--      cobertura real mientras el chip muestra «Nacional».
-- 2. Registra en `core.migracion_log` la clave de la migración 54
--    (`54_demandas_desvinculo_caso_2026_11_24`). Esa migración dejó de estar
--    registrada aunque su efecto sí está en los datos: CS-2026-0003 no tiene
--    ninguna demanda vinculada. Se anota para que el log refleje la realidad y
--    nadie la vuelva a ejecutar por error (es idempotente, pero mejor no).
--
-- ES ADITIVA
-- ----------
-- No crea ni borra columnas. Los tres `update` sólo rellenan un texto que
-- estaba vacío y el trigger completa las marcas derivadas. El `insert` en el
-- log es idempotente.
--
-- SEGURIDAD
-- ---------
-- `core.mesas_dialogo` y `core.casos` tienen FORCE RLS; el preflight aborta si
-- el rol no tiene BYPASSRLS. El trigger de la 90 es SECURITY DEFINER y escribe
-- `core.casos` con los permisos del propietario.
-- =============================================================================

begin;

-- 0 · Preflight de RLS --------------------------------------------------------
do $preflight$
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = current_user
       and (rolsuper or rolbypassrls)
  ) then
    raise exception '91: el rol % no es superusuario ni tiene BYPASSRLS; FORCE ROW LEVEL SECURITY ocultaría core.mesas_dialogo y core.casos. Ejecute con el propietario BYPASSRLS.', current_user;
  end if;
end $preflight$;

-- 1 · Ámbito de las tres mesas ------------------------------------------------
-- El trigger BEFORE de la 90 recalcula es_nacional y el AFTER propaga el
-- alcance al caso espejo.
update core.mesas_dialogo
   set ambito_departamento = 'Nacional'
 where codigo in ('OAIPCS-004', 'OAIPCS-005');

update core.mesas_dialogo
   set ambito_departamento = 'Apurímac, Ayacucho, Cusco, Junín, Huancavelica'
 where codigo = 'OAIPCS-012';

-- 2 · Registro de la migración 54 ---------------------------------------------
insert into core.migracion_log (clave)
values ('54_demandas_desvinculo_caso_2026_11_24')
on conflict (clave) do nothing;

insert into core.migracion_log (clave)
values ('91_ambito_mesas_nacionales_2026_11_29')
on conflict (clave) do nothing;

-- 3 · Guardas ----------------------------------------------------------------
do $verifica$
declare
  v_marcadas int;
  v_otras int;
begin
  select count(*) into v_marcadas
    from core.mesas_dialogo
   where codigo in ('OAIPCS-004', 'OAIPCS-005', 'OAIPCS-012')
     and es_nacional;
  if v_marcadas <> 3 then
    raise exception '91: las tres mesas debían quedar nacionales; quedaron % (¿se ejecutó sin el trigger de la 90 o sin BYPASSRLS?)', v_marcadas;
  end if;

  -- Sólo deben estar marcadas las nueve esperadas (seis de la 89 + tres nuevas).
  select count(*) into v_otras
    from core.mesas_dialogo
   where es_nacional
     and codigo not in (
       'OAIPCS-001','OAIPCS-002','OAIPCS-003','OAIPCS-004','OAIPCS-005',
       'OAIPCS-012','OAIPCS-013','OAIPCS-015','OAIPCS-034'
     );
  if v_otras > 0 then
    raise exception '91: hay % mesas nacionales inesperadas', v_otras;
  end if;
end $verifica$;

commit;

-- =============================================================================
-- Verificación (sólo lectura). Ejecutar con el mismo rol BYPASSRLS.
--
--   -- a) Las nueve mesas nacionales y su cobertura cruda:
--   select codigo, es_nacional, ambito_departamento
--     from core.mesas_dialogo
--    where es_nacional
--    order by codigo;
--
--   -- b) Sus casos espejo ya devuelven 5 (Nacional):
--   select m.codigo, c.codigo_caso, c.alcance_override, core.alcance_caso(c.id)
--     from core.mesas_dialogo m
--     join core.casos c on c.id = m.caso_id
--    where m.es_nacional
--    order by m.codigo;
--
--   -- c) La clave de la 54 quedó registrada:
--   select clave from core.migracion_log
--    where clave = '54_demandas_desvinculo_caso_2026_11_24';
--
-- Cómo revertir
-- -------------
--   begin;
--   -- El preflight de la 90 sigue vigente; para volver atrás hay que desactivar
--   -- el trigger antes de vaciar el ámbito, o el BEFORE lo volvería a marcar.
--   alter table core.mesas_dialogo disable trigger trg_mesa_nacional;
--   alter table core.mesas_dialogo disable trigger trg_mesa_nacional_caso;
--   update core.mesas_dialogo set ambito_departamento = null, es_nacional = false
--    where codigo in ('OAIPCS-004','OAIPCS-005','OAIPCS-012');
--   update core.casos set alcance_override = null
--    where codigo_caso in ('MD-2026-0004','MD-2026-0005','MD-2026-0012');
--   alter table core.mesas_dialogo enable trigger trg_mesa_nacional;
--   alter table core.mesas_dialogo enable trigger trg_mesa_nacional_caso;
--   delete from core.migracion_log
--    where clave in ('91_ambito_mesas_nacionales_2026_11_29',
--                    '54_demandas_desvinculo_caso_2026_11_24');
--   commit;
-- =============================================================================
