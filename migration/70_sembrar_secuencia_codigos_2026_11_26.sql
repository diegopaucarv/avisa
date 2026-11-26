-- =============================================================================
-- 70 · Sembrar el contador de códigos tras el renombre
--
-- Fecha: 2026-11-26
--
-- Por qué
-- -------
-- `core.secuencia_codigo` es un contador por ámbito: `siguiente_codigo()` hace
-- `insert … on conflict do update ultimo = ultimo + 1` y devuelve el valor.
-- No mira `core.casos`. Tras renombrar los 35 códigos a `CS-<año>-<NNNN>`, el
-- ámbito `CASO-<año>` seguía vacío, así que el próximo código volvía a
-- `CS-2026-0001` y **colisionaba** con uno existente.
--
-- Qué hace
-- --------
-- Siembra `core.secuencia_codigo` con el máximo sufijo ya usado en cada
-- (serie, año), tomándolo de `core.casos`. Usa `greatest(...)` para no bajar un
-- contador que ya estuviera más alto.
--
-- Idempotente: puede reejecutarse sin efectos.
-- =============================================================================

begin;

with usados as (
  select
    case when codigo_caso like 'RM-%' then 'RM' else 'CS' end as serie,
    split_part(codigo_caso, '-', 2) as anio,
    max(split_part(codigo_caso, '-', 3)::integer) as ultimo
  from core.casos
  where codigo_caso ~ '^(CS|RM)-[0-9]{4}-[0-9]+$'
  group by 1, 2
)
insert into core.secuencia_codigo (ambito, ultimo, actualizado_en)
select
    case when serie = 'RM' then 'CASO-RM-' else 'CASO-' end || anio,
    ultimo,
    now()
  from usados
on conflict (ambito) do update
   set ultimo = greatest(core.secuencia_codigo.ultimo, excluded.ultimo),
       actualizado_en = now();

-- Limpieza de los ámbitos mal nombrados de una corrida previa (`CASO-CS-*`).
delete from core.secuencia_codigo where ambito like 'CASO-CS-%';

insert into core.migracion_log (clave)
values ('70_sembrar_secuencia_codigos_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
select ambito, ultimo
  from core.secuencia_codigo
 where ambito like 'CASO-%'
 order by ambito;
