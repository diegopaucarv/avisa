-- ============================================================================
-- AVISA — Migración 87: ampliar los textos que recibe la carga histórica
--
-- POR QUÉ EXISTE
--   El libro del sectorista (carga histórica may–nov 2026) trae dos campos que
--   no caben en las columnas actuales:
--
--     · `core.actores.cargo_actual` es varchar(150) y hay cuatro actores con
--       cargos de 157, 186, 508 y 539 caracteres (el sectorista volcó en el
--       cargo listas de actores y párrafos completos).
--     · `core.reuniones_dialogo.titulo` es varchar(255) y la reunión RD-033
--       trae un título de 363 caracteres.
--
--   La carga debe conservar el texto íntegro y no descartar la fila, así que
--   ambas columnas pasan a `text`.
--
-- POR QUÉ ES SEGURO
--   · En PostgreSQL el cambio varchar(n) -> text es solo de metadatos: no
--     reescribe la tabla, no pierde datos y no invalida los índices.
--   · `analytics.vw_anexo_16_registro_reuniones` depende de
--     `reuniones_dialogo.titulo`, y PostgreSQL no deja cambiar el tipo de una
--     columna usada por una vista. La vista se recrea en esta misma transacción
--     con la definición y los permisos idénticos: no hay ventana de
--     indisponibilidad ni cambio de contrato para `avisa_app`; el único cambio
--     es el tipo declarado de la columna `titulo`, que pasa de varchar a text.
--   · Todo va en una transacción: o se aplica entero o no se aplica.
--
-- ALCANCE
--   · Ningún objeto de aplicación cambia de forma. No hay migración de vuelta
--     necesaria: `text` admite todo lo que admitía `varchar(n)`.
--   · Se registra la clave en `core.migracion_log` para que el estado sea
--     verificable, igual que la 84.
--
-- VERIFICACIÓN
--   select table_name, column_name, data_type, character_maximum_length
--     from information_schema.columns
--    where table_schema = 'core'
--      and ((table_name = 'actores' and column_name = 'cargo_actual')
--        or (table_name = 'reuniones_dialogo' and column_name = 'titulo'));
-- ============================================================================

begin;

alter table core.actores
    alter column cargo_actual type text;

drop view analytics.vw_anexo_16_registro_reuniones;

alter table core.reuniones_dialogo
    alter column titulo type text;

create view analytics.vw_anexo_16_registro_reuniones as
select
    case
        when r.programada then 'Programado'::text
        else 'No programado'::text
    end as tipo,
    r.codigo_reunion as codigo,
    s.nombre as sector,
    u.nombre as responsable,
    r.fecha,
    g.region as departamento,
    r.lugar,
    r.titulo,
    (
        select count(*)
          from core.reunion_participantes p
         where p.reunion_id = r.id and p.asistio
    ) as asistentes,
    (
        exists (
            select 1
              from core.documentos d
             where d.reunion_id = r.id and d.tipo_id = 10
        )
    ) as tiene_ayuda_memoria,
    (
        exists (
            select 1
              from core.documentos d
             where d.reunion_id = r.id and d.tipo_id = 11
        )
    ) as tiene_relatoria,
    r.nota_publicacion_url as publicacion_nota
from core.reuniones_dialogo r
join core.casos c on c.id = r.caso_id
join core.cat_subsectores s on s.id = c.subsector_id
join analytics.vw_geo_distrito g on g.distrito_id = c.distrito_principal_id
left join core.usuarios u on u.id = r.responsable_usuario_id;

grant select on analytics.vw_anexo_16_registro_reuniones to avisa_app;

insert into core.migracion_log (clave)
values ('87_ampliar_textos_carga_historica_2026_11_27')
on conflict (clave) do nothing;

commit;
