-- =============================================================================
-- 38 · La organización hereda su región del departamento que trae el legado
--
-- Fecha: 2026-11-23
--
-- Por qué existe esta migración
-- -----------------------------
-- `migration/loader/phases/p05_actores.py` no usaba `DIM_ORGANIZACION.ID_Ubigeo`
-- (columna 3, `DEP-xx`): leía el dato y lo descartaba. Las 224 organizaciones
-- quedaron con `core.actores.region_id` nulo y sólo las personas lo recibieron,
-- por el parche post-carga que une `legacy.dim_actores.c13` con
-- `legacy.dim_departamentos`. Medido antes de escribir esto, en local:
--
--   organizaciones totales ................................ 224
--   con `ID_Ubigeo` que resuelve a una región ............. 119
--   sin `ID_Ubigeo` ....................................... 103
--   con `DEP-20` («Más de Uno») ...........................   2
--
-- Efecto observable del defecto
-- -----------------------------
-- · «Actores por región» y «OSPAS por región» subestiman la representación: la
--   organización existe y tiene territorio, pero la consulta por región no la
--   encuentra (items 120 y 121 de `docs/07_frontend/frontend.md`).
-- · El directorio agrupa en «sin región» a organizaciones que sí la tienen.
--
-- Qué cambia
-- ----------
-- · Las 119 organizaciones resueltas toman la `region_id` de su departamento.
--   La región se deriva SÓLO del prefijo INEI de sus provincias, igual que en
--   las fases 1 y 6 del cargador: `DIM_Departamentos.Codigo_Depto` es
--   secuencial (DEP-20 = «Más de Uno») y no sirve como ubigeo.
-- · No se toca ninguna persona, ni el distrito de nadie, ni `core.organizaciones`.
-- · Las 103 sin ubigeo y las 2 de `DEP-20` siguen sin región: se declaran, no
--   se estiman (regla de §1 y §2 del catálogo).
-- · No cambia el esquema, ni los permisos, ni las políticas RLS, ni catálogos.
--
-- Cómo revertir
-- -------------
-- Antes de esta migración ninguna organización tenía región (`con_region = 0`),
-- así que la inversa exacta es:
--
--   update core.actores set region_id = null
--    where naturaleza = 'organizacion';
--
-- =============================================================================

begin;

-- 1 · Contexto de sesión: autoría de la corrección en `trg_audit`.
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · DEP-xx -> región por el prefijo INEI de sus provincias. Una provincia por
--     departamento basta: se toma el menor `id` de región para que la sentencia
--     sea determinista aunque DEP-15 y DEP-16 caigan en la misma.
with mapa as (
  select btrim(p.c04) as dep,
         min(r.id) as region_id
    from legacy.dim_provincias p
    join core.regiones r
      on r.ubigeo = left(lpad(btrim(p.c02), 4, '0'), 2)
   group by 1
)
update core.actores a
   set region_id = m.region_id
  from legacy.dim_organizacion o
  join mapa m on m.dep = btrim(o.c03)
 where a.codigo_legado = btrim(o.c01)
   and a.naturaleza = 'organizacion'
   and a.region_id is null;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Debe dar 119 con región y 105 sin ella (103 sin ubigeo + 2 de DEP-20); las
-- personas no se mueven: 236 con región.
select naturaleza,
       count(*) as total,
       count(*) filter (where region_id is not null) as con_region,
       count(*) filter (where region_id is null) as sin_region
  from core.actores
 group by 1
 order by 1;

-- Las organizaciones que siguen sin región, con el motivo a la vista.
with mapa as (
  select btrim(p.c04) as dep
    from legacy.dim_provincias p
    join core.regiones r
      on r.ubigeo = left(lpad(btrim(p.c02), 4, '0'), 2)
   group by 1
)
select case
         when nullif(btrim(o.c03), '') is null then 'sin ubigeo'
         when m.dep is null then 'departamento no mapeado: ' || btrim(o.c03)
         else 'otro'
       end as motivo,
       count(*) as organizaciones
  from core.actores a
  join legacy.dim_organizacion o on btrim(o.c01) = a.codigo_legado
  left join mapa m on m.dep = btrim(o.c03)
 where a.naturaleza = 'organizacion'
   and a.region_id is null
 group by 1
 order by 2 desc;
