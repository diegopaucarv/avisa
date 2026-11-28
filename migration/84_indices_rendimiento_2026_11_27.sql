-- ============================================================================
-- AVISA — Migración aditiva 84: índices de los listados y del panel de alertas
--
-- POR QUÉ EXISTE
--   La auditoría de rendimiento encontró cuatro accesos que no tienen índice
--   propio y que crecen con el uso, no con el número de pantallas:
--
--     1. `core.alerta_revision` se consulta en un LATERAL por cada alerta del
--        listado (`where r.alerta_id = a.id order by r.created_at desc`). Sin
--        índice por `alerta_id`, ese LATERAL hace un recorrido completo de la
--        tabla de revisiones por cada fila devuelta.
--     2. El listado de alertas filtra `anulado_en is null` y `archivado_en is
--        null`, y ordena por `fecha_reporte desc`. No hay índice que cubra ese
--        prefiltro.
--     3. El filtro «Riesgo» de alertas compara `nivel_riesgo_id` (declarado o
--        heredado del caso). Sólo existe el índice de la clave foránea, que no
--        ayuda cuando la consulta además filtra por vigencia.
--     4. El listado de casos filtra por sectorista (`punto_focal_usuario_id`),
--        por región (`core.caso_regiones.region_id`) y por estado. Ninguno de
--        los tres tiene índice propio: el de región no puede usar la PK de
--        `caso_regiones` porque ésta empieza por `caso_id`.
--
--   Ninguno de estos índices cambia el contrato ni los datos: son estructuras
--   de apoyo. Pueden quitarse con `drop index` sin migración de vuelta.
--
-- ALCANCE Y CAUTELA
--   · Se aplica con autorización de la Dirección; se deja el registro en
--     `core.migracion_log` para que el estado sea verificable.
--   · Al 27/11/2026 las tablas son pequeñas (59 casos, 82 alertas, 132
--     demandas), así que el efecto inmediato es imperceptible. El beneficio
--     aparece con el uso sostenido y con la carga del legado completo.
--   · Se usa `create index` normal (no `concurrently`) para que la migración
--     pueda correr dentro de la transacción del runner. Con tablas grandes hay
--     que ejecutarla fuera de transacción y con `concurrently`.
-- ============================================================================

begin;

-- 1. Revisiones de alerta: el LATERAL del listado y el «último revisor».
create index if not exists ix_alerta_revision_alerta
    on core.alerta_revision (alerta_id, created_at desc);

-- 2. Listado vigente de alertas, en el orden por defecto (más reciente).
create index if not exists ix_alertas_vigentes_fecha
    on core.alertas_tempranas (fecha_reporte desc, codigo_alerta)
    where anulado_en is null and archivado_en is null;

-- 3. Filtro y orden por riesgo declarado entre las alertas vigentes.
create index if not exists ix_alertas_vigentes_riesgo
    on core.alertas_tempranas (nivel_riesgo_id)
    where anulado_en is null;

-- 4. Filtro por sectorista del caso.
create index if not exists ix_casos_sectorista
    on core.casos (punto_focal_usuario_id)
    where anulado_en is null;

-- 5. Filtro por estado del caso (chips «Abierto», «En seguimiento», …).
create index if not exists ix_casos_estado
    on core.casos (estado_id)
    where anulado_en is null;

-- 6. Filtro por región: la PK de `caso_regiones` empieza por `caso_id`.
create index if not exists ix_caso_regiones_region
    on core.caso_regiones (region_id);

-- 7. Recuento de demandas activas por caso en el SELECT del listado.
create index if not exists ix_demandas_caso_activas
    on core.demandas (caso_id)
    where anulado_en is null;

-- 8. Registro del estado: la 84 también deja su clave en el log de migraciones.
insert into core.migracion_log (clave)
values ('84_indices_rendimiento_2026_11_27')
on conflict (clave) do nothing;

commit;
