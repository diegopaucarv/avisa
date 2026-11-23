-- =============================================================================
--  36 · El historial de estado arranca en la fecha real del caso
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  `migration/34_historial_tramo_unico.sql` dejó **un** tramo abierto por caso,
--  pero conservó el `desde` del tramo sintético que creó la carga: el instante
--  en que se importó el legado (2026-10-31 07:52:56+00), idéntico para los 35
--  casos. Mientras tanto `migration/35_fecha_inicio_real.sql` sí llevó
--  `core.casos.fecha_inicio` a la fecha real de cada expediente (2012–2026).
--
--  Resultado visible: la ficha muestra «Inicio» en 2012 y, unas líneas más
--  abajo, el historial de estado empieza en 2026. Para el lector son dos fechas
--  del mismo caso que se contradicen, y la segunda es un artefacto de la carga.
--
--  Qué cambia
--  ----------
--  · `core.caso_estado_historial.desde` pasa a la fecha real del caso
--    (`core.casos.fecha_inicio`, medianoche de America/Lima).
--  · Solo se tocan los tramos sintéticos: abiertos (`hasta is null`), sin
--    motivo, del usuario de carga y cuya fecha sigue siendo la del 31/10.
--  · No se tocan los casos con `fecha_inicio is null` (3 de 35): `desde` es
--    `not null` y no se inventa una fecha. Siguen en el instante de carga.
--  · No se tocan estado, nivel de riesgo ni conflicto del tramo: la migración
--    corrige **cuándo** empezó el estado, no **cuál** es.
--  · No cambia el esquema, ni los permisos, ni las políticas RLS.
--
--  Cómo revertir
--  -------------
--  begin;
--  update core.caso_estado_historial h
--     set desde = timestamptz '2026-10-31 07:52:56.714777+00'
--    from core.casos c
--   where c.id = h.caso_id
--     and h.hasta is null
--     and h.motivo is null
--     and h.usuario_id = '00000000-0000-0000-0000-000000000001'
--     and c.fecha_inicio is not null;
--  commit;
-- =============================================================================

begin;

update core.caso_estado_historial h
   set desde = (c.fecha_inicio::timestamp at time zone 'America/Lima')
  from core.casos c
 where c.id = h.caso_id
   and c.fecha_inicio is not null
   and h.hasta is null
   and h.motivo is null
   and h.usuario_id = '00000000-0000-0000-0000-000000000001'
   and (h.desde at time zone 'America/Lima')::date = date '2026-10-31'
   -- Solo casos con un único tramo: si hubiera historia posterior, el orden
   -- de los tramos dejaría de ser coherente y la migración no debe adivinarlo.
   and not exists (
     select 1
       from core.caso_estado_historial x
      where x.caso_id = h.caso_id
        and x.id <> h.id
   );

commit;

-- ---------------------------------------------------------------------------
--  Comprobaciones (ejecutar por separado, como propietario)
-- ---------------------------------------------------------------------------
--
--  -- 1 · Ningún tramo sintético debería quedar en la fecha de carga.
--  select count(*) as en_carga
--    from core.caso_estado_historial
--   where (desde at time zone 'America/Lima')::date = date '2026-10-31';
--  -- esperado: 3 (solo los casos sin `fecha_inicio`)
--
--  -- 2 · El `desde` del tramo abierto debe coincidir con `fecha_inicio`.
--  select count(*) as alineados
--    from core.caso_estado_historial h
--    join core.casos c on c.id = h.caso_id
--   where h.hasta is null
--     and c.fecha_inicio is not null
--     and (h.desde at time zone 'America/Lima')::date = c.fecha_inicio;
--  -- esperado: 32 (35 casos menos los 3 sin fecha)
--
--  -- 3 · Sigue habiendo un solo tramo abierto por caso.
--  select count(*) as casos, count(*) filter (where hasta is null) as abiertos
--    from core.caso_estado_historial;
--  -- esperado: 35 y 35
--
--  -- 4 · Ningún tramo cerrado con `hasta < desde` (restricción de la tabla).
--  select count(*) as invalidos
--    from core.caso_estado_historial
--   where hasta is not null and hasta < desde;
--  -- esperado: 0
