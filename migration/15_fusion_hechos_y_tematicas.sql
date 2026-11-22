-- =============================================================================
--  15 · Fusión de tipos de hecho, retiro de `Otros` y ortografía de catálogos
--
--  Requiere: migration/14_alineacion_guia.sql aplicada.
--
--  Por qué existe
--  --------------
--  Cierra los gaps D1 y D2 del registro `docs/01_requisitos/GAPS_GUIA_SQL_UI.md`
--  y termina la normalización ortográfica que dejó a medias la migración 14.
--
--  Referencias normativas
--  ----------------------
--    · §7.5.1  Niveles de conflictividad (no se toca aquí).
--    · §7.6    Tipos de casos de conflictividad: seis tipologías cerradas, sin
--              «Otros».
--    · §7.4.1  Actores sociales / públicos / privados (minúscula en el
--              adjetivo, como en el texto normativo).
--    · §8.3.2  Estados del hito: `Registrado`, `En ejecución`, `Paralizado`,
--              `Cumplido`, `Desestimado`.
--    · Anexo N° 3 / §11.1  Prioridades de alerta: `Crítica inmediata`,
--              `Urgente`, `Temprana`, `Seguimiento`.
--
--  Qué cambia
--  ----------
--  1. cat_tipos_hecho      `Protesta o Bloqueo`    → `Bloqueo`     (4 hechos)
--                          `Comunicado o documento`→ `Comunicado`  (21 hechos)
--                          se eliminan las dos variantes largas
--  2. cat_tematicas        `Otros` se elimina tras reclasificar sus
--                          2 casos y sus 48 demandas (ver §2.2)
--  3. cat_tipos_actor      `Actor Privado` → `Actor privado`
--  4. cat_estados_caso     `En_seguimiento` → `En seguimiento`
--  5. cat_estados_hito     `En_ejecucion`   → `En ejecución`
--  6. cat_prioridades_alerta `Critica_Inmediata` → `Crítica inmediata`
--  7. cat_estados_compromiso `Por_iniciar` → `Por iniciar`,
--                            `En_proceso`  → `En proceso`
--
--  Nota: estos catálogos usan `codigo` como etiqueta visible (no tienen
--  columna `nombre`). Renombrar el `codigo` ES el cambio de etiqueta. El
--  repositorio de la API compara de forma tolerante (espacios ↔ guiones
--  bajos); ver `lib/db/repos/cases.ts`.
--
--  Notas de seguridad
--  ------------------
--    · Todo `UPDATE` es idempotente.
--    · Todo `DELETE` está precedido por una guarda que falla con 23503 si
--      quedan referencias FK.
--    · El detalle de la reclasificación de demandas está explícito y auditable
--      (§2.2): no se infiere nada en tiempo de ejecución.
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final, tras el `commit;`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · cat_tipos_hecho — §7.5.1 no distingue estas variantes
-- -----------------------------------------------------------------------------
-- Se reasigna primero y se borra después: el orden evita la violación de FK.
update core.caso_cronologia
   set tipo_hecho_id = (select id from core.cat_tipos_hecho where nombre = 'Bloqueo')
 where tipo_hecho_id = (select id from core.cat_tipos_hecho where nombre = 'Protesta o Bloqueo');

update core.caso_cronologia
   set tipo_hecho_id = (select id from core.cat_tipos_hecho where nombre = 'Comunicado')
 where tipo_hecho_id = (select id from core.cat_tipos_hecho where nombre = 'Comunicado o documento');

do $$
declare
  v_nombre text;
  v_id     smallint;
  v_refs   bigint;
begin
  foreach v_nombre in array array['Protesta o Bloqueo', 'Comunicado o documento']
  loop
    select id into v_id from core.cat_tipos_hecho where nombre = v_nombre;

    if v_id is null then
      continue;  -- ya no existe: ejecución repetida
    end if;

    select count(*) into v_refs
      from core.caso_cronologia
     where tipo_hecho_id = v_id;

    if v_refs > 0 then
      raise exception
        'core.cat_tipos_hecho "%" (id %) sigue referenciado por % hechos; no se elimina',
        v_nombre, v_id, v_refs
        using errcode = '23503';
    end if;

    delete from core.cat_tipos_hecho where id = v_id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2 · cat_tematicas — §7.6: seis tipologías cerradas, sin «Otros»
-- -----------------------------------------------------------------------------

-- 2.1 · Los dos casos clasificados como «Otros»
--   · CS-PRODUCE-2026-009 (Tumbes): control, fiscalización y seguridad en el
--     litoral → Gobernanza (capacidad institucional del Estado).
--   · CS-PRODUCE-2026-033 (Pariahuanca): mortandad de truchas por causa
--     externa a la actividad → Impactos de terceros.
update core.casos
   set tematica_id = 5
 where tematica_id = (select id from core.cat_tematicas where nombre = 'Otros')
   and codigo_legado = 'CS-PRODUCE-2026-009';

update core.casos
   set tematica_id = 6
 where tematica_id = (select id from core.cat_tematicas where nombre = 'Otros')
   and codigo_legado = 'CS-PRODUCE-2026-033';

-- 2.2 · Las 48 demandas clasificadas como «Otros».
--   Cada fila se asigna a mano, leyendo su texto. La lista queda aquí para que
--   la decisión sea auditable y revisable una por una:
--     1 Infraestructura · 2 Ordenamiento y acceso territorial · 3 Normatividad
--     4 Distribución de beneficios · 5 Gobernanza · 6 Impactos de terceros
update core.demandas d
   set tematica_id = m.tematica_id
  from (values
    ('DEM-2026-0003', 5),  -- espera de resultados IMARPE y acciones inmediatas
    ('DEM-2026-0006', 5),  -- comunicación directa con autoridades
    ('DEM-2026-0008', 5),  -- exigen respuestas por falta de avance en compromisos
    ('DEM-2026-0014', 5),  -- investigación de Contraloría por malversación (DPA)
    ('DEM-2026-0018', 5),  -- reunión con SM PRODUCE por situación del recurso
    ('DEM-2026-0019', 5),  -- diálogo tripartito y transparencia en decisiones
    ('DEM-2026-0028', 5),  -- fiscalización sanitaria de SANIPES
    ('DEM-2026-0029', 5),  -- monitoreo sanitario focalizado de SANIPES
    ('DEM-2026-0030', 4),  -- cierre de brechas de capacitación (FONDEPES)
    ('DEM-2026-0039', 5),  -- salida de directivos por presunta corrupción
    ('DEM-2026-0044', 5),  -- reunión con directores generales
    ('DEM-2026-0048', 6),  -- desinfección de estanques y análisis de agua
    ('DEM-2026-0051', 6),  -- causa de contaminación del río Yuracyacu
    ('DEM-2026-0067', 5),  -- instalación de mesa de diálogo con el Ministro
    ('DEM-2026-0076', 2),  -- fiscalización de pesca ilegal en el litoral
    ('DEM-2026-0084', 2),  -- acciones frente a pesca ilegal
    ('DEM-2026-0088', 2),  -- reforzar acciones frente a pesca ilegal
    ('DEM-2026-0096', 6),  -- causa de contaminación del río Yuracyacu
    ('DEM-2026-0124', 3),  -- dejar sin efecto multas impuestas a MYPE
    ('DEM-2026-0125', 5),  -- cambio de Ministro de la Producción
    ('DEM-2026-0133', 5),  -- reunión con Directora General de DGAAMI
    ('DEM-2026-0138', 3),  -- revisión de «pesquerías de oportunidad»
    ('DEM-2026-0139', 4),  -- distribución equitativa de la cuota de captura
    ('DEM-2026-0140', 5),  -- documentos y pronunciamientos sobre el recurso pota
    ('DEM-2026-0142', 5),  -- explicación de criterios de la autorización
    ('DEM-2026-0143', 3),  -- condiciones de la autorización (fines científicos)
    ('DEM-2026-0144', 5),  -- renuncia de ministro y viceministro
    ('DEM-2026-0146', 4),  -- subsidio de combustible y exoneración de IGV
    ('DEM-2026-0149', 5),  -- renuncia del Ministro y del Viceministro
    ('DEM-2026-0152', 5),  -- información sobre estudios y cronogramas
    ('DEM-2026-0163', 5),  -- transparencia en el uso de recursos del DPA
    ('DEM-2026-0165', 2),  -- acceso a terrenos para Parque Industrial PYME
    ('DEM-2026-0166', 2),  -- denuncias de presunto tráfico de terrenos
    ('DEM-2026-0168', 5),  -- evaluación técnica participativa
    ('DEM-2026-0234', 5),  -- audiencia con Ministro y Viceministro
    ('DEM-2026-0243', 5),  -- reunión de trabajo en FONDEPES
    ('DEM-2026-0249', 4),  -- acceso a capacitación y certificación
    ('DEM-2026-0258', 5),  -- instalación de mesa de diálogo
    ('DEM-2026-0263', 3),  -- derogar la ley que criminaliza al pescador
    ('DEM-2026-0264', 5),  -- nombramiento en el Viceministerio de Pesca
    ('DEM-2026-0266', 5),  -- no continuidad del Viceministro de Pesca
    ('DEM-2026-0267', 1),  -- cubicación de bodegas
    ('DEM-2026-0271', 5),  -- fortalecimiento de las Direcciones Regionales
    ('DEM-2026-0272', 4),  -- seguridad social para pescadores artesanales
    ('DEM-2026-0273', 4),  -- seguro de vida para pescadores artesanales
    ('DEM-2026-0274', 1),  -- modernización de infraestructura pesquera
    ('DEM-2026-0275', 4),  -- Fondo Nacional para la Pesca Artesanal
    ('DEM-2026-0277', 5)   -- Consejo Nacional de la Pesca Artesanal
  ) as m(codigo_legado, tematica_id)
 where d.codigo_legado = m.codigo_legado
   and d.tematica_id = (select id from core.cat_tematicas where nombre = 'Otros');

-- 2.3 · Guarda + borrado de la temática «Otros»
do $$
declare
  v_id        integer;
  v_casos     bigint;
  v_demandas  bigint;
  v_compromis bigint;
begin
  select id into v_id from core.cat_tematicas where nombre = 'Otros';

  if v_id is null then
    return;  -- ya no existe
  end if;

  select count(*) into v_casos     from core.casos      where tematica_id = v_id;
  select count(*) into v_demandas  from core.demandas   where tematica_id = v_id;
  select count(*) into v_compromis from core.compromisos where tematica_id = v_id;

  if v_casos > 0 or v_demandas > 0 or v_compromis > 0 then
    raise exception
      'core.cat_tematicas "Otros" (id %) sigue en uso: % casos, % demandas, % compromisos',
      v_id, v_casos, v_demandas, v_compromis
      using errcode = '23503';
  end if;

  delete from core.cat_tematicas where id = v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3 · cat_tipos_actor — §7.4.1: «actores privados», con adjetivo en minúscula
-- -----------------------------------------------------------------------------
update core.cat_tipos_actor
   set nombre = 'Actor privado'
 where nombre = 'Actor Privado'
   and not exists (
     select 1 from core.cat_tipos_actor x where x.nombre = 'Actor privado');

-- -----------------------------------------------------------------------------
-- 4 · cat_estados_caso — ortografía
-- -----------------------------------------------------------------------------
update core.cat_estados_caso set codigo = 'En seguimiento' where codigo = 'En_seguimiento';

-- -----------------------------------------------------------------------------
-- 5 · cat_estados_hito — §8.3.2
-- -----------------------------------------------------------------------------
update core.cat_estados_hito set codigo = 'En ejecución' where codigo = 'En_ejecucion';

-- -----------------------------------------------------------------------------
-- 6 · cat_prioridades_alerta — §11.1 del ERS, ya renombrado a códigos reales
-- -----------------------------------------------------------------------------
update core.cat_prioridades_alerta
   set codigo = 'Crítica inmediata'
 where codigo = 'Critica_Inmediata';

-- -----------------------------------------------------------------------------
-- 7 · cat_estados_compromiso — ortografía (los códigos son la etiqueta)
-- -----------------------------------------------------------------------------
update core.cat_estados_compromiso set codigo = 'Por iniciar' where codigo = 'Por_iniciar';
update core.cat_estados_compromiso set codigo = 'En proceso'  where codigo = 'En_proceso';

-- -----------------------------------------------------------------------------
-- 8 · Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
select 'tipos_hecho' as catalogo, t.id, t.nombre, count(c.*) as usos
  from core.cat_tipos_hecho t
  left join core.caso_cronologia c on c.tipo_hecho_id = t.id
 group by t.id, t.nombre
 order by t.id;

select 'tematicas' as catalogo, t.id, t.nombre, count(ca.*) as casos
  from core.cat_tematicas t
  left join core.casos ca on ca.tematica_id = t.id
 group by t.id, t.nombre
 order by t.id;

select 'tipos_actor' as catalogo, id, nombre from core.cat_tipos_actor order by id;
select 'estados_caso' as catalogo, id, codigo from core.cat_estados_caso order by id;
select 'estados_hito' as catalogo, id, codigo from core.cat_estados_hito order by id;
select 'prioridades_alerta' as catalogo, id, codigo, sla_horas, es_grave
  from core.cat_prioridades_alerta order by id;
select 'estados_compromiso' as catalogo, id, codigo, categoria
  from core.cat_estados_compromiso order by id;

select 'demandas_sin_tematica' as control, count(*) from core.demandas where tematica_id is null;
select 'casos_sin_tematica'    as control, count(*) from core.casos    where tematica_id is null;

commit;

-- =============================================================================
--  Reversión manual (descomentar y ejecutar en su propia transacción)
-- =============================================================================
--
-- begin;
--
-- update core.cat_tipos_actor     set nombre = 'Actor Privado' where nombre = 'Actor privado';
-- update core.cat_estados_caso    set codigo = 'En_seguimiento' where codigo = 'En seguimiento';
-- update core.cat_estados_hito    set codigo = 'En_ejecucion'   where codigo = 'En ejecución';
-- update core.cat_prioridades_alerta set codigo = 'Critica_Inmediata' where codigo = 'Crítica inmediata';
-- update core.cat_estados_compromiso set codigo = 'Por_iniciar' where codigo = 'Por iniciar';
-- update core.cat_estados_compromiso set codigo = 'En_proceso'  where codigo = 'En proceso';
--
-- insert into core.cat_tematicas (id, nombre) values (7, 'Otros');
--
-- insert into core.cat_tipos_hecho (id, nombre) values
--   (4, 'Comunicado o documento'),
--   (7, 'Protesta o Bloqueo');
--
-- select setval('core.cat_tematicas_id_seq', (select max(id) from core.cat_tematicas));
--
-- -- La reclasificación de los 2 casos y de las 48 demandas se revierte con el
-- -- respaldo previo (pg_dump), porque el valor original era siempre 7.
--
-- commit;
