-- SUPERSEDIDA por 54_demandas_desvinculo_caso_2026_11_24.sql: la herencia
-- automática desde la alerta deja de ser la regla (2026-11-24).
-- =============================================================================
-- 37 · La demanda hereda el caso de la alerta que la originó
--
-- Fecha: 2026-11-22
--
-- Por qué existe esta migración
-- -----------------------------
-- `migration/loader/phases/p09_demandas.py` resolvió `caso_id` **sólo** desde
-- `DIM_Demandas.ID_Caso` (decisión D1: 99 de 325) y no lo heredó nunca de la
-- alerta, aunque `core.demandas.alerta_id` ya existía y apunta a una alerta que
-- sí tiene caso. Medido antes de escribir esto, en local y en Neon (idénticos):
--
--   demandas totales ................................. 325
--   con `caso_id` directo del legado ..................  99
--   sin caso .......................................... 226
--     · su alerta tiene un caso vigente ............... 100
--     · su alerta tiene un caso anulado ...............  19
--     · su alerta no tiene caso .......................  81
--     · no tienen alerta ..............................  26
--
-- No hay ni un solo conflicto: 0 filas con `demandas.caso_id` distinto del
-- `caso_id` de su alerta. La relación es unívoca, así que heredar no fuerza
-- ninguna equivalencia entre series de códigos (D19).
--
-- Efecto observable del defecto
-- -----------------------------
-- · 119 demandas no aparecían en la ficha de su caso (`lib/db/repos/cases.ts`
--   lista por `d.caso_id = c.id`) y sí en «Demandas sin caso», que las
--   presentaba como trabajo pendiente.
-- · Las 19 del único caso anulado (`CS-MI-ITE-2026-02`) seguían contando como
--   pendientes de vinculación: `core.anular_caso` cascada `core.demandas` por
--   `caso_id` y no las alcanzó al no estar vinculadas.
--
-- Qué cambia
-- ----------
-- · Las 100 demandas cuya alerta vive heredan `caso_id`. No se toca ningún otro
--   campo: un `caso_id` propio del legado sigue teniendo precedencia.
-- · Las 19 del caso anulado heredan `caso_id` y se sellan con **el mismo lote
--   del caso** (`anulado_en`, `anulado_por`, `anulacion_id`,
--   `motivo_anulacion`), replicando exactamente lo que habría hecho
--   `core.anular_caso`. No se reejecuta esa función: exige un caso no anulado y
--   emitiría un `anulacion_id` nuevo, rompiendo el lote original.
-- · «Demandas sin caso» pasa de 226 a 107: 81 con alerta sin caso y 26 sin
--   alerta. Esas no se estiman; se declaran.
-- · No cambia el esquema, ni los permisos, ni las políticas RLS, ni catálogos.
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
-- No hay inversa parcial fiable: una vez vinculadas, las 119 no se distinguen
-- de las 99 que ya traían caso. El estado anterior se reproduce recargando el
-- legado con el cargador (`p09_demandas.py`), y sólo después de retirar de allí
-- la herencia. La base no guarda rastro de cuál vino de dónde.
-- =============================================================================

begin;

-- 1 · Contexto RLS: rol de lectura total y autoría de la carga.
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · Las 100 demandas cuya alerta apunta a un caso vigente.
update core.demandas d
   set caso_id = a.caso_id
  from core.alertas_tempranas a
  join core.casos c on c.id = a.caso_id
 where a.id = d.alerta_id
   and d.caso_id is null
   and a.anulado_en is null
   and c.anulado_en is null;

-- 3 · Las 19 demandas cuya alerta pertenece a un caso ya anulado. Heredan el
--     caso y el sello del **mismo lote**, para que la anulación se lea como una
--     sola operación y no como una anulación nueva.
update core.demandas d
   set caso_id = c.id,
       anulado_en = c.anulado_en,
       anulado_por = c.anulado_por,
       anulacion_id = c.anulacion_id,
       motivo_anulacion = c.motivo_anulacion
  from core.alertas_tempranas a
  join core.casos c on c.id = a.caso_id
 where a.id = d.alerta_id
   and d.caso_id is null
   and c.anulado_en is not null;

-- 4 · Caso residual: alerta anulada dentro de un caso vigente. La demanda sigue
--     vigente y sólo hereda el vínculo; la alerta anulada no la sella.
update core.demandas d
   set caso_id = c.id
  from core.alertas_tempranas a
  join core.casos c on c.id = a.caso_id
 where a.id = d.alerta_id
   and d.caso_id is null
   and c.anulado_en is null;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Debe dar 107 sin caso · 218 con caso · 19 anuladas · 325 de total.
select count(*) filter (where caso_id is null) as sin_caso,
       count(*) filter (where caso_id is not null) as con_caso,
       count(*) filter (where anulado_en is not null) as anuladas,
       count(*) as total
  from core.demandas;

-- Desglose de lo que sigue sin caso: 81 con alerta sin caso y 26 sin alerta.
select case
         when d.alerta_id is null then 'sin alerta'
         when a.caso_id is null then 'alerta sin caso'
         else 'otro'
       end as situacion,
       count(*) as demandas
  from core.demandas d
  left join core.alertas_tempranas a on a.id = d.alerta_id
 where d.caso_id is null
 group by 1
 order by 2 desc;

-- Los casos que ganan demandas en su ficha (14 expedientes, 100 demandas) y el
-- sello de las 19: todas deben compartir el lote del caso y no uno nuevo.
select c.codigo_caso,
       count(*) as demandas_anuladas,
       count(*) filter (where d.anulacion_id = c.anulacion_id) as con_lote_del_caso
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where d.anulado_en is not null
 group by 1
 order by 1;
