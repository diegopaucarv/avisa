-- =============================================================================
--  20 · Tipos documentales de los Anexos N° 1 y N° 2 (gap D3)
--
--  Por qué existe esta migración
--  -----------------------------
--  `core.cat_tipos_documento` tipifica los anexos 3–13 de la Guía, pero no los
--  dos instrumentos con los que §8.1.2.1 documenta la gestión y sistematización
--  de demandas. Sin esas filas, un reporte regional o una matriz de demandas no
--  puede registrarse como documento tipado y queda como «Otro (sin clasificar)».
--
--  La decisión sobre D3 es acotada: se agregan SÓLO los Anexos N° 1 y N° 2.
--  Los Anexos 14–17 no se tipifican como documento porque ya están modelados
--  como registros propios (matriz de compromisos, matriz de conflictividad,
--  reuniones de diálogo y reportes). Tipificarlos también aquí duplicaría el
--  mismo hecho en dos sitios.
--
--  Referencias normativas
--  ----------------------
--    · §8.1.2.1 Gestión y sistematización de demandas.
--    · Anexo N° 1  Matriz de Sistematización de Demandas.
--    · Anexo N° 2  Reporte Regional de Conflictividad y Demandas.
--
--  Qué cambia
--  ----------
--    cat_tipos_documento  + matriz_sistematizacion_demandas        (anexo 1)
--                         + reporte_regional_conflictividad_demandas (anexo 2)
--
--  Notas de seguridad
--  ------------------
--    · `id` no tiene default ni secuencia: se asigna `max(id) + n` en la misma
--      sentencia, nunca un id fijo (el catálogo puede haber crecido en otro
--      entorno).
--    · La inserción se identifica por `codigo` y usa `on conflict do nothing`,
--      de modo que re-ejecutar el archivo no duplica filas.
--    · No se toca ninguna fila existente ni `core.documentos`.
--
--  Cómo revertir
--  -------------
--  Al final del archivo, tras el `commit;`, hay un bloque comentado que borra
--  las dos filas sólo si ningún documento ni plantilla las referencia.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Alta de los Anexos N° 1 y N° 2
--     `row_number()` asigna ids consecutivos libres sin fijarlos a mano y se
--     aplica después del filtro, así que una re-ejecución parcial tampoco
--     reutiliza un id ocupado.
-- -----------------------------------------------------------------------------
insert into core.cat_tipos_documento (id, codigo, nombre, anexo_numero)
select
  (select coalesce(max(id), 0) from core.cat_tipos_documento)
    + row_number() over (order by v.anexo_numero),
  v.codigo,
  v.nombre,
  v.anexo_numero
from (values
  ('matriz_sistematizacion_demandas',
   'Matriz de Sistematización de Demandas',
   1),
  ('reporte_regional_conflictividad_demandas',
   'Reporte Regional de Conflictividad y Demandas',
   2)
) as v(codigo, nombre, anexo_numero)
where not exists (
  select 1
    from core.cat_tipos_documento d
   where d.codigo = v.codigo
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2 · Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- Las dos filas nuevas, con su anexo.
select id, codigo, nombre, anexo_numero
  from core.cat_tipos_documento
 where codigo in ('matriz_sistematizacion_demandas',
                  'reporte_regional_conflictividad_demandas')
 order by anexo_numero;

-- Catálogo completo: no debe haber ids ni códigos duplicados.
select id, codigo, nombre, anexo_numero
  from core.cat_tipos_documento
 order by id;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar sólo si se decide deshacer el alta.
-- =============================================================================
--
-- begin;
--
-- delete from core.cat_tipos_documento d
--  where d.codigo in ('matriz_sistematizacion_demandas',
--                     'reporte_regional_conflictividad_demandas')
--    and not exists (select 1 from core.documentos  x where x.tipo_id = d.id)
--    and not exists (select 1 from ind.plantilla    x where x.tipo_documento_id = d.id);
--
-- commit;
