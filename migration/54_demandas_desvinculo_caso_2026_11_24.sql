-- =============================================================================
-- 54 · Desvincular 16 demandas del caso CS-MI-ITE-2026-03
--
-- Fecha: 2026-11-24
--
-- Por qué existe esta migración
-- -----------------------------
-- El Excel legado trae 16 demandas sin caso propio: en `legacy.dim_demandas`,
-- `c04` (ID_Caso) está vacío y `legacy.bridge_caso_demandas` no tiene ninguna
-- fila para ellas. Aun así, la base las vinculó a `CS-MI-ITE-2026-03`
-- («Participación ciudadana en el EIA-d del proyecto Aceros Americanos
-- (Chilca)») por una regla de herencia automática desde la alerta:
-- `migration/37_demandas_caso_desde_alerta.sql` (y antes,
-- `p09_demandas.py::_heredar_caso()`).
--
-- El defecto se destapó con las claves de `legacy.bridge_alerta_demandas`: el
-- bloque de demanda de pota reinicia su numeración en `BAD-AT-2026-42-01`, que
-- colisiona con el bloque de Aceros. Las 16 demandas quedaron así:
--
--   AT-2026-36  DEM-2026-0097, 0098, 0099                         (3)
--   AT-2026-38  DEM-2026-0105, 0106, 0107, 0108, 0109             (5)
--   AT-2026-42  DEM-2026-0120, 0121                               (2)
--   AT-2026-42  DEM-2026-0135, 0136, 0137, 0138, 0139, 0140       (6, pota)
--
-- Regla vigente (2026-11-24): una demanda o alerta se vincula a un caso sólo si
-- (a) se registra en el caso o (b) el documento fuente declara ese caso de
-- forma explícita. La herencia automática desde la alerta queda prohibida: crea
-- vínculos que la fuente no declara y, como aquí, cruza temas ajenos.
--
-- Efecto observable del defecto
-- -----------------------------
-- · Las 16 demandas aparecían en la ficha de `CS-MI-ITE-2026-03` y no en
--   «Demandas sin caso».
-- · Seis de ellas son de pota: un tema distinto del conflicto del AA.HH. 15 de
--   Enero vs. Aceros Americanos, así que la ficha del caso mezclaba dos
--   conflictos sin relación.
--
-- Qué cambia
-- ----------
-- · Sólo el `caso_id` de esas 16 filas pasa a NULL. No se toca ningún otro
--   campo, ni `core.demandas.alerta_id`, ni `core.alertas_tempranas.caso_id`.
-- · Las 4 alertas (`AT-2026-36/38/42/84`) siguen vinculadas a
--   `CS-MI-ITE-2026-03`: su contenido sí es ese conflicto y
--   `legacy.dim_alertas.c02` declara el caso explícitamente. El defecto es de
--   la demanda, no de la alerta.
-- · Medido antes de escribir esto (base local):
--       demandas totales ................................ 325
--       vigentes ........................................ 306
--       con `caso_id` (incluye 19 anuladas) ............. 218
--       vigentes sin caso ............................... 107
--         · con alerta sin caso .........................  81
--         · sin alerta ..................................  26
--       vigentes mal vinculadas a CS-MI-ITE-2026-03 .....  16
--   Después de aplicarla:
--       con `caso_id` (incluye 19 anuladas) ............. 202
--       vigentes con caso ............................... 183
--       vigentes sin caso ............................... 123 (81 + 16)
--       demandas de CS-MI-ITE-2026-03 ...................   0
-- · No cambia el esquema, ni los permisos, ni las políticas RLS, ni catálogos.
--
-- Relación con la migración 37
-- ----------------------------
-- `migration/37_demandas_caso_desde_alerta.sql` queda SUPERADA por ésta: la
-- herencia desde la alerta deja de ser la regla. La 37 vinculó 119 demandas por
-- herencia; esta migración deshace sólo las 16 que la fuente no declaraba y que
-- además cruzaban de tema. Las otras 103 (incluidas las 19 del caso anulado) se
-- mantienen tal como quedaron: retirarlas exige una decisión humana, porque el
-- Excel no permite distinguir cuáles de esos vínculos quería declarar.
--
-- Alternativa NO aplicada: alinear con una carga limpia (99 con caso)
-- -------------------------------------------------------------------
-- El alcance decidido es sólo las 16 demandas que cruzaban de tema. Si más
-- adelante se decide alinear la base con lo que produciría una carga limpia
-- con el importador corregido (99 con caso de 325), el bloque siguiente
-- desvincula las 119 que la 37 heredó desde su alerta —las 16 ya desvinculadas
-- quedan fuera por el `caso_id IS NOT NULL`—. Se identifica la herencia con la
-- misma evidencia que sostiene este diagnóstico: `legacy.dim_demandas.c04`
-- (ID_Caso) vacío y `caso_id` igual al de la alerta.
--
-- Medido hoy: 119 filas cumplen la condición (103 vigentes + 16 de este parche
-- + 19 anuladas). Tras aplicarla quedarían 99 con caso y 226 sin caso, como en
-- una carga limpia. NO está aplicada: el Excel no permite distinguir cuáles de
-- esos 119 vínculos quería declarar, así que exige decisión humana.
--
--   -- begin;
--   -- select set_config('app.rol_codigo', 'administrador', true);
--   -- select set_config('app.user_id',
--   --                   '00000000-0000-0000-0000-000000000001', true);
--   -- update core.demandas d
--   --    set caso_id = null
--   --   from core.alertas_tempranas a, legacy.dim_demandas ld
--   --  where d.alerta_id = a.id
--   --    and ld.c01 = d.codigo_legado
--   --    and coalesce(btrim(ld.c04), '') = ''
--   --    and d.caso_id is not null
--   --    and d.caso_id = a.caso_id;
--   -- commit;
--
-- Contexto de sesión
-- ------------------
-- `core.demandas` es `FORCE ROW LEVEL SECURITY` y `core.clasificacion_max()`
-- devuelve 0 cuando falta `app.rol_codigo`: sin contexto, el `UPDATE` no
-- alcanzaría ninguna fila y la migración terminaría en silencio. Se fija un rol
-- con lectura total y el usuario de carga **sólo para esta transacción**; el
-- `trg_audit` deja constancia con `app.user_id`.
--
-- Cómo revertir
-- -------------
-- Es reversible: las 16 filas eran exactamente de `CS-MI-ITE-2026-03` antes de
-- esta migración y no había ambigüedad. Basta con repetir el `UPDATE` inverso,
-- acotado por la misma lista y por `caso_id IS NULL` para no tocar otras filas:
--
--   begin;
--   select set_config('app.rol_codigo', 'administrador', true);
--   select set_config('app.user_id',
--                     '00000000-0000-0000-0000-000000000001', true);
--   update core.demandas
--      set caso_id = (select id from core.casos
--                      where codigo_caso = 'CS-MI-ITE-2026-03')
--    where codigo_legado in ('DEM-2026-0097', 'DEM-2026-0098',
--                            'DEM-2026-0099', 'DEM-2026-0105',
--                            'DEM-2026-0106', 'DEM-2026-0107',
--                            'DEM-2026-0108', 'DEM-2026-0109',
--                            'DEM-2026-0120', 'DEM-2026-0121',
--                            'DEM-2026-0135', 'DEM-2026-0136',
--                            'DEM-2026-0137', 'DEM-2026-0138',
--                            'DEM-2026-0139', 'DEM-2026-0140')
--      and caso_id is null
--      and anulado_en is null;
--   commit;
--
-- No se reejecuta la herencia de la 37: alcanzaría también a otras demandas sin
-- caso y no se quiere reintroducir el defecto.
-- =============================================================================

begin;

-- 1 · Contexto RLS: rol de lectura total y autoría de la carga.
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · Desvincular sólo las 16 demandas cuyo `ID_Caso` venía vacío en el Excel.
--     El filtro por caso evita alcanzar filas ya corregidas o recargadas.
update core.demandas
   set caso_id = null
 where codigo_legado in (
         'DEM-2026-0097', 'DEM-2026-0098', 'DEM-2026-0099',
         'DEM-2026-0105', 'DEM-2026-0106', 'DEM-2026-0107',
         'DEM-2026-0108', 'DEM-2026-0109',
         'DEM-2026-0120', 'DEM-2026-0121',
         'DEM-2026-0135', 'DEM-2026-0136', 'DEM-2026-0137',
         'DEM-2026-0138', 'DEM-2026-0139', 'DEM-2026-0140'
       )
   and caso_id = (
         select id from core.casos
          where codigo_caso = 'CS-MI-ITE-2026-03'
       )
   and anulado_en is null;

-- 3 · Registro de la migración (idempotente, como el resto del repo).
insert into core.migracion_log (clave)
values ('54_demandas_desvinculo_caso_2026_11_24')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Debe dar 123 sin caso · 202 con caso · 19 anuladas · 325 de total.
select count(*) filter (where caso_id is null) as sin_caso,
       count(*) filter (where caso_id is not null) as con_caso,
       count(*) filter (where anulado_en is not null) as anuladas,
       count(*) as total
  from core.demandas;

-- Ninguna demanda debe seguir apuntando al caso de Aceros Americanos.
select count(*) as demandas_del_caso
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where c.codigo_caso = 'CS-MI-ITE-2026-03';

-- Las 4 alertas deben conservar su caso: el defecto era de la demanda.
select a.codigo_alerta, c.codigo_caso
  from core.alertas_tempranas a
  join core.casos c on c.id = a.caso_id
 where a.codigo_alerta in ('AT-2026-36', 'AT-2026-38', 'AT-2026-42', 'AT-2026-84')
 order by a.codigo_alerta;

-- Las 16 deben quedar sin caso y vigentes, con su alerta intacta.
select d.codigo_legado,
       a.codigo_alerta,
       d.caso_id is null as sin_caso,
       d.anulado_en is null as vigente
  from core.demandas d
  left join core.alertas_tempranas a on a.id = d.alerta_id
 where d.codigo_legado in (
         'DEM-2026-0097', 'DEM-2026-0098', 'DEM-2026-0099',
         'DEM-2026-0105', 'DEM-2026-0106', 'DEM-2026-0107',
         'DEM-2026-0108', 'DEM-2026-0109',
         'DEM-2026-0120', 'DEM-2026-0121',
         'DEM-2026-0135', 'DEM-2026-0136', 'DEM-2026-0137',
         'DEM-2026-0138', 'DEM-2026-0139', 'DEM-2026-0140'
       )
 order by d.codigo_legado;
