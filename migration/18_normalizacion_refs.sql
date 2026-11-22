-- =============================================================================
--  18 · Normalización de referencias a catálogo
--
--  Por qué existe
--  --------------
--  A partir de la migración 15 los catálogos que usan `codigo` como etiqueta
--  visible llevan el texto normativo con espacio y tilde (`En ejecución`,
--  `Crítica inmediata`, `Por iniciar`). La API comparaba por igualdad exacta
--  tras cambiar espacios por guiones bajos, así que dejaría de resolver.
--
--  Esta función centraliza la regla: dos referencias son la misma si coinciden
--  al pasar a minúsculas, quitar tildes y eliminar espacios, guiones y guiones
--  bajos. Así `En_ejecucion`, `en ejecucion` y `En ejecución` resuelven todas
--  a la misma fila, sin duplicar la comparación en cada consulta.
--
--  Es IMMUTABLE y de sólo lectura: no toca datos ni RLS.
-- =============================================================================

begin;

create or replace function core.normalizar_ref(p_texto text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           translate(
             lower(coalesce(p_texto, '')),
             'áéíóúüñ',
             'aeiouun'
           ),
           '[\s_\-]+',
           '',
           'g'
         );
$$;

comment on function core.normalizar_ref(text) is
  'Clave de comparación tolerante para referencias de catálogo: minúsculas, sin tildes ni separadores (En_ejecucion = En ejecución).';

grant execute on function core.normalizar_ref(text) to avisa_app, avisa_api;

-- Comprobación rápida.
select core.normalizar_ref('En_ejecucion')       as sin_tilde,
       core.normalizar_ref('En ejecución')       as canonico,
       core.normalizar_ref('Crítica inmediata')  as con_tilde,
       core.normalizar_ref('Critica_Inmediata')  as legado;

commit;
