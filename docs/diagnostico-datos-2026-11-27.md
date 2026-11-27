# Diagnóstico de datos · 2026-11-27

> Documento **solo de diagnóstico**. No se ejecutó ninguna escritura
> (`INSERT/UPDATE/DELETE/DDL`), ni migraciones. En materia de Git sólo se ejecutó
> **un** `git status --short` de lectura al inicio (sin modificar el repo). Todo el SQL de
> este documento está **comentado o envuelto en `begin; … rollback;`** para
> probarse en seco. Fuente de datos: `NEON_OWNER_URL` (rol `neondb_owner`).
> Los scripts temporales de lectura (`scripts/_tmp_*.mjs`) se borraron; ver §7.

---

## 0 · Resumen ejecutivo (lo más grave primero)

1. **La premisa del apartado 1 no se reproduce en este Neon.** `CS-2026-0003`
   **no tiene ninguna demanda vinculada** (`0` filas). Las 16 demandas sospechosas
   de `migration/37` **no existen en `core.demandas`** de esta base (sí están en
   `legacy.dim_demandas`, con `c04 = NULL`). Por tanto **no hay nada que
   desvincular** en el estado actual.
2. **Las 4 alertas de ese caso están correctamente vinculadas**: `AT-2026-36`,
   `AT-2026-38`, `AT-2026-42` y `AT-2026-84` citan explícitamente el proyecto
   (Aceros Americanos / ACERO AMERICANO S.A.C. / Chilca / AA.HH. 15 de Enero).
   No procede desvincularlas.
3. **Desajuste grave de volumen (requiere confirmación humana):** `core.demandas`
   tiene **132** filas frente a **325** en `legacy.dim_demandas`; `core.alertas_tempranas`
   tiene **82** frente a **83** en `legacy.dim_alertas`. Este Neon parece una
   **carga parcial** (o una rama distinta de la base que describen las
   migraciones 37/54). Cualquier conclusión sobre «las 325 demandas» sólo es
   válida en la base completa.
4. **`AT-2026-48_pdf-2` y `AT-2026-49_pdf-2` NO son duplicados de contenido.**
   Son documentos distintos cuyos nombres de archivo colisionaron en la
   importación (el sufijo `-2` es un artefacto de nombre, no una copia). El
   «original» de cada código es la fila **sin** `-2`. Ver §3.
5. **Sí hay duplicados reales** (mismo título y fecha) en `CS-2026-01 … CS-2026-06`
   (6 pares) y en `RED-2026-021/022`; `RED-2026-023/024` es **dudoso** (distinta URL).
   `core.medios` **no** presenta duplicados ni incoherencias.
6. `migration/54` (la que desvincula las 16) **no aparece en `core.migracion_log`**,
   pero el efecto observable (0 demandas en el caso) es compatible con una carga
   corregida. Ver §5.

---

## 1 · Método

- **Conexión:** `node` + `pg` con `process.loadEnvFile(".env")` y
  `process.env.NEON_OWNER_URL` (`sslmode`-compatible). Todas las consultas fueron
  `SELECT`.
- **Scripts temporales:** `scripts/_tmp_*.mjs` (fuera de `migration/`). Sólo lectura.
  Borrados al terminar (§7).
- **RLS:** `core.demandas`, `core.alertas_tempranas`, `core.casos`,
  `core.documentos` y `core.medios` son `ROW LEVEL SECURITY` **forzado**
  (`relforcerowsecurity = true`). El rol `neondb_owner` tiene `rolbypassrls = true`,
  así que las lecturas ven todas las filas. Para el SQL propuesto (que iría con
  un rol distinto) se fija contexto de sesión con `set_config(...)` como en las
  migraciones 37/54. **Comprobación hecha:** con y sin contexto de administrador
  los conteos son idénticos (132 demandas), por lo que los números no están
  filtrados por RLS.
- **Detección de citas:** búsqueda `~*` de
  `aceros? americanos?`, `acero americano`, `chilca`, `eia-d`, `15 de enero`
  sobre el texto de cada fila.
- **Detección de documentos mal colocados:** para documentos con código
  `AT-2026-<NN>_pdf[-2]` se resolvió su alerta homónima
  (`regexp_replace(codigo, '_pdf(-\d+)?$', '')`) y se comparó **caso** y **título**.
  Además: duplicados por `codigo`, `url_pdf`, `hash_sha256` y `titulo`.

### Esquema real encontrado (no asumido)

| Objeto                          | Existe | Notas                                                                                                                                                                                                        |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core.demandas`                 | sí     | `descripcion_demanda`, `problema_3p`, `propuesta_3p`, `pedido_3p`, `caso_id`, `alerta_id`, `origen_dato`, `fecha_registro`, `codigo_legado`, `anulado_en`, `anulado_por`, `anulacion_id`, `motivo_anulacion` |
| `core.alertas_tempranas`        | sí     | `codigo_alerta`, `titulo`, `situacion_actual`, `descripcion_riesgo`, `fecha_reporte`, `caso_id`, `anulado_en`                                                                                                |
| `core.casos`                    | sí     | `codigo_caso`, `nombre_caso`, `codigo_legado`, `anulado_en`                                                                                                                                                  |
| `core.documentos`               | sí     | `codigo` (UNIQUE), `codigo_legado` (UNIQUE), `titulo`, `fecha`, `caso_id`, `reunion_id`, `url_pdf`, `contenido` (bytea), `hash_sha256`, `tipo_id` NOT NULL, `anulado_*`                                      |
| `core.medios`                   | sí     | **no existe `core.media`**. `entidad_tipo`, `entidad_id`, `url`, `es_principal`, `rol`, `anulado_en`                                                                                                         |
| `legacy.dim_demandas`           | sí     | 325 filas, columnas `c01..c09` (`c01`=código, `c04`=ID_Caso)                                                                                                                                                 |
| `legacy.bridge_alerta_demandas` | sí     | 231 filas (`c03`=alerta, `c05`=demanda)                                                                                                                                                                      |
| `legacy.dim_alertas`            | sí     | 83 filas (`c01`=código, `c02`=ID_Caso)                                                                                                                                                                       |

**FKs relevantes (verificadas):**

- `demandas_caso_id_fkey` → `core.casos(id) ON DELETE CASCADE` · columna **nullable**.
- `alertas_tempranas_caso_id_fkey` → `core.casos(id) ON DELETE CASCADE` · columna **nullable**.
- `demandas_alerta_id_fkey` → `core.alertas_tempranas(id) ON DELETE SET NULL`.

Ninguna FK ni constraint impide poner `caso_id = NULL`: la columna es nullable y
la FK sólo actúa al **borrar** el caso. `core.demandas` tiene además
`UNIQUE (codigo_legado)`, que no interviene.

### Volumetría observada

| Tabla                           | Filas | Reparto                                                                                                                                                                 |
| ------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.casos`                    |    38 | 1 anulado (`CS-2026-0002`)                                                                                                                                              |
| `core.demandas`                 |   132 | 112 `AVISA_HISTORICO` (todas con `created_at = 2026-10-31`) + 20 `MANUAL` (2026-11-26); 25 con caso, 107 sin caso, 2 anuladas                                           |
| `core.alertas_tempranas`        |    82 | 49 con caso, 33 sin caso                                                                                                                                                |
| `core.documentos`               |   153 | 83 con caso; 105 con `url_pdf`; por tipo: 83 AT, 45 Ayuda Memoria, 7 Clima Social General, 7 Relatoría, 6 Clima Social Focalizado, 3 Otro, 1 Análisis, 1 Reporte Rápido |
| `core.medios`                   |   142 | 95 `actor`, 27 `local`, 20 `organizacion`                                                                                                                               |
| `legacy.dim_demandas`           |   325 | 225 con `c04` vacío                                                                                                                                                     |
| `legacy.dim_alertas`            |    83 | —                                                                                                                                                                       |
| `legacy.bridge_alerta_demandas` |   231 | —                                                                                                                                                                       |
| `legacy.bridge_caso_demandas`   |    12 | —                                                                                                                                                                       |

> ⚠️ La diferencia 132 ↔ 325 y 82 ↔ 83 es el hallazgo transversal más
> importante. Ver §5 (qué confirmar).

---

## 2 · Caso 1 — `CS-2026-0003` (Aceros Americanos)

### 2.1 Identificación

| Campo           | Valor                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `1156293b-8158-42f8-b804-5c607cf6527e`                                                                                                                                                                                                                      |
| `codigo_caso`   | `CS-2026-0003` (código opaco asignado por la migración 69). Las migraciones 37/54 se refieren a este mismo caso como `CS-MI-ITE-2026-03`; la equivalencia se infiere de `codigo_legado` y `nombre_caso`, porque la 69 **no persiste** el mapeo viejo→nuevo. |
| `codigo_legado` | `CS-PRODUCE-2026-031`                                                                                                                                                                                                                                       |
| `nombre_caso`   | «Disconformidad ciudadan en Chilca en horarios para de asistencia para mecanismos de participación ciudadana del EIA-d Aceros Americanos»                                                                                                                   |
| `anulado_en`    | `NULL` (vigente)                                                                                                                                                                                                                                            |

### 2.2 Demandas vinculadas al caso

**Resultado: 0 filas.**

```sql
select d.id, d.codigo_legado, d.origen_dato, d.fecha_registro,
       left(coalesce(d.descripcion_demanda,''),140) as texto
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where c.codigo_caso = 'CS-2026-0003';
-- → (sin filas)
```

Las **16 demandas** que motivan la sospecha (las de `migration/37`, ya tratadas
en `migration/54`) **no existen en `core.demandas`** de este Neon. Sí están en
`legacy.dim_demandas` con `c04` (ID_Caso) vacío, y `legacy.bridge_alerta_demandas`
las asocia a las alertas del caso:

| Demanda (legacy) | Alerta (legacy) | `c04` en legacy | ¿En `core.demandas`? |
| ---------------- | --------------- | --------------- | -------------------- |
| `DEM-2026-0097`  | `AT-2026-36`    | vacío           | **no**               |
| `DEM-2026-0098`  | `AT-2026-36`    | vacío           | **no**               |
| `DEM-2026-0099`  | `AT-2026-36`    | vacío           | **no**               |
| `DEM-2026-0105`  | `AT-2026-38`    | vacío           | **no**               |
| `DEM-2026-0106`  | `AT-2026-38`    | vacío           | **no**               |
| `DEM-2026-0107`  | `AT-2026-38`    | vacío           | **no**               |
| `DEM-2026-0108`  | `AT-2026-38`    | vacío           | **no**               |
| `DEM-2026-0109`  | `AT-2026-38`    | vacío           | **no**               |
| `DEM-2026-0120`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0121`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0135`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0136`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0137`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0138`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0139`  | `AT-2026-42`    | vacío           | **no**               |
| `DEM-2026-0140`  | `AT-2026-42`    | vacío           | **no**               |

Conclusión: en esta base **la desvinculación ya está hecha** (o esas filas nunca
se cargaron). No hay 16 demandas `core` que apunten al caso.

### 2.3 Alertas vinculadas al caso

**Resultado: 4 filas. Las 4 citan el caso.**

| Código       | `id`                                   | Título (recortado)                                                                                                              | Fecha      |                 ¿Cita el caso?                  |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | :---------------------------------------------: |
| `AT-2026-36` | `69929d28-0a91-4aa1-b9b0-a8b6a8eb7221` | «Plantón frente a PRODUCE por oposición al proyecto de planta de tratamiento de chatarra y acero de **ACERO AMERICANO S.A.C.**» | 2026-05-29 | **Sí** (por ACERO AMERICANO / chatarra y acero) |
| `AT-2026-38` | `8d8a042c-6e50-44ef-84ea-d0288af49958` | «Movilización de pobladores del AA. HH. 15 de Enero a PRODUCE por proceso de audiencia de EIA (**Proyecto Aceros Americanos**)» | 2026-06-11 |                     **Sí**                      |
| `AT-2026-42` | `0b1d7666-e099-48a3-8de6-c243a8e7e909` | «Movilización de representantes del AA. HH. 15 de Enero a sede Barlovento de PRODUCE – **Proyecto Aceros Americanos**»          | 2026-07-03 |                     **Sí**                      |
| `AT-2026-84` | `f23b630c-22a8-460e-b6d3-1ca0b3c14502` | «…PRODUCE POR AUDIENCIA PÚBLICA DE EIA – **PROYECTO ACEROS AMERICANOS**»                                                        | 2026-06-12 |                     **Sí**                      |

> `AT-2026-36` no contenía la cadena literal «Aceros» (plural) sino
> «ACERO AMERICANO S.A.C.», por eso una primera búsqueda simple de `%aceros%`
> pudo marcarlo como «no cita». Verificado: **sí** pertenece al mismo proyecto.
> `legacy.dim_alertas.c02` declara `CS-PRODUCE-2026-031` para las cuatro.

### 2.4 Documentos vinculados al caso (contexto)

Aunque el encargo pide demandas y alertas, los documentos del caso también están
coherentes (6 filas):

| `codigo`         | `id`                                   | Título                            | Fecha      |
| ---------------- | -------------------------------------- | --------------------------------- | ---------- |
| `AT-2026-36_pdf` | `ec58aaa3-4385-462e-957d-30b9d218ed3a` | Plantón / ACERO AMERICANO S.A.C.  | 2026-05-29 |
| `AT-2026-38_pdf` | `2f0c685a-76ca-4c11-b3d3-b9fad058a3a7` | Movilización 15 de Enero / Aceros | 2026-06-11 |
| `AT-2026-42_pdf` | `1d44f9d7-438e-48bd-bb54-29937f0a563c` | Movilización Barlovento / Aceros  | 2026-07-03 |
| `AT-2026-84_pdf` | `1766630f-a26c-4888-9492-7a1422fbb510` | Movilización / Aceros             | 2026-06-12 |
| `CT-2026-004`    | `8c84517c-e2a9-44b7-81c4-abaa8e581cdb` | «Residentes de 15 de enero»       | 2026-07-22 |
| `RED-2026-039`   | `0b943b30-6b43-4c92-b39f-c01e5df1db60` | «Representantes de 15 de enero»   | 2026-09-14 |

### 2.5 Criterio de desvinculación propuesto

Sólo se desvincula una fila si **está vinculada** al caso **y su propio contenido
no lo cita**. El vínculo por `alerta_id` **no** basta para heredar el caso
(regla vigente desde 2026-11-24). Criterio:

- **Demanda mal vinculada** = `caso_id = CS-2026-0003` **y**
  `descripcion_demanda` + `problema_3p` + `propuesta_3p` + `pedido_3p` **no**
  contienen `aceros? americanos?`, `acero americano`, `chilca`, `eia-d` ni
  `15 de enero`.
- **Alerta mal vinculada** = `caso_id = CS-2026-0003` **y** `titulo` +
  `situacion_actual` + `descripcion_riesgo` **no** contienen esos términos.
- Se excluyen las anuladas (`anulado_en is null`) para no tocar lotes de anulación.
- **No** se usa `legacy.bridge_alerta_demandas` como única evidencia: la fuente
  no declara el caso (`c04` vacío) pero el contenido manda.

Con ese criterio, en la base actual: **0 demandas** y **0 alertas** califican.

### 2.6 SQL propuesto (comentado, sin ejecutar)

```sql
-- ============================================================================
-- CS-2026-0003 · desvincular SOLO lo que no cita el caso
-- PROPUESTA · NO EJECUTADA · probar primero con begin/rollback
-- ============================================================================

begin;

-- Contexto RLS (las tablas son FORCE ROW LEVEL SECURITY)
select set_config('app.rol_codigo', 'administrador', true);
select set_config('app.user_id',
                  '00000000-0000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------------
-- PASO 1 · Inventario de demandas vinculadas y si citan el caso
-- ---------------------------------------------------------------------------
select d.id,
       d.codigo_legado,
       d.origen_dato,
       d.fecha_registro,
       left(coalesce(d.descripcion_demanda,''), 140) as texto,
       ( coalesce(d.descripcion_demanda,'') || ' ' ||
         coalesce(d.problema_3p,'')          || ' ' ||
         coalesce(d.propuesta_3p,'')         || ' ' ||
         coalesce(d.pedido_3p,'') )
         ~* '(aceros?[[:space:]]+americanos?|acero[[:space:]]+americano|chilca|eia-d|15[[:space:]]+de[[:space:]]+enero)'
         as cita_el_caso
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where c.codigo_caso = 'CS-2026-0003'
 order by d.anulado_en nulls first, d.codigo_legado;

-- ---------------------------------------------------------------------------
-- PASO 2 · Cuántas se desvincularían (sólo las que NO citan y están vigentes)
-- ---------------------------------------------------------------------------
select count(*) as demandas_a_desvincular
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where c.codigo_caso = 'CS-2026-0003'
   and d.anulado_en is null
   and not ( coalesce(d.descripcion_demanda,'') || ' ' ||
             coalesce(d.problema_3p,'')          || ' ' ||
             coalesce(d.propuesta_3p,'')         || ' ' ||
             coalesce(d.pedido_3p,'') )
             ~* '(aceros?[[:space:]]+americanos?|acero[[:space:]]+americano|chilca|eia-d|15[[:space:]]+de[[:space:]]+enero)' );

-- ---------------------------------------------------------------------------
-- PASO 3 · UPDATE de desvinculación (sólo `caso_id` a NULL)
--   No se toca: alerta_id, anulado_*, tematica_id, descripcion, fechas.
--   FKs: caso_id es nullable; la FK es ON DELETE CASCADE, no impide NULL.
-- ---------------------------------------------------------------------------
update core.demandas d
   set caso_id = null
  from core.casos c
 where c.id = d.caso_id
   and c.codigo_caso = 'CS-2026-0003'
   and d.anulado_en is null
   and not ( coalesce(d.descripcion_demanda,'') || ' ' ||
             coalesce(d.problema_3p,'')          || ' ' ||
             coalesce(d.propuesta_3p,'')         || ' ' ||
             coalesce(d.pedido_3p,'') )
             ~* '(aceros?[[:space:]]+americanos?|acero[[:space:]]+americano|chilca|eia-d|15[[:space:]]+de[[:space:]]+enero)' );

-- ---------------------------------------------------------------------------
-- PASO 4 · Comprobación post-update (debe quedar 0 si no había vínculos)
-- ---------------------------------------------------------------------------
select count(*) as demandas_que_quedan_en_el_caso
  from core.demandas d
  join core.casos c on c.id = d.caso_id
 where c.codigo_caso = 'CS-2026-0003';

rollback;   -- PRUEBA EN SECO. Cambiar por commit sólo tras revisión humana.

-- ============================================================================
-- (Opcional) Alertas: mismo criterio sobre titulo/situacion/descripcion.
-- En el estado actual afectaría 0 filas: las 4 alertas sí citan el caso.
-- ============================================================================
-- begin;
-- select set_config('app.rol_codigo','administrador',true);
-- select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true);
-- update core.alertas_tempranas a
--    set caso_id = null
--   from core.casos c
--  where c.id = a.caso_id
--    and c.codigo_caso = 'CS-2026-0003'
--    and a.anulado_en is null
--    and not ( coalesce(a.titulo,'') || ' ' ||
--              coalesce(a.situacion_actual,'') || ' ' ||
--              coalesce(a.descripcion_riesgo,'') )
--              ~* '(aceros?[[:space:]]+americanos?|acero[[:space:]]+americano|chilca|eia-d|15[[:space:]]+de[[:space:]]+enero)' );
-- rollback;
```

**Variante NO recomendada** (sólo si más adelante se trabaja sobre la base
completa de 325 demandas y se decide alinear con una carga limpia, tal como
deja anotado `migration/54`): identificar las heredadas por la 37 con
`legacy.dim_demandas.c04` vacío **y** `d.caso_id = a.caso_id`. No se ejecuta
aquí porque el Excel no permite distinguir cuáles vínculos quería declarar.

### 2.7 Cuantificación y qué se perdería

| Métrica                                  |       Valor en Neon |
| ---------------------------------------- | ------------------: |
| Demandas vinculadas hoy a `CS-2026-0003` |               **0** |
| Demandas que el criterio desvincularía   |               **0** |
| Alertas vinculadas hoy                   | **4** (las 4 citan) |
| Alertas que se desvincularían            |               **0** |
| Filas totales afectadas                  |               **0** |

Si se desvinculara (hipotéticamente) alguna fila: **no se pierde ningún dato**.
Sólo se anula la pertenencia al caso (`caso_id → NULL`); se conservan
`alerta_id`, la descripción, las evidencias, las fechas y el historial. El
vínculo es reversible reintroduciendo el `caso_id`. La auditoría (`audit.cambios`
vía trigger) registraría el cambio.

---

## 3 · Caso 2 — Documentos mal colocados y PDFs duplicados

### 3.1 Comprobaciones hechas

- Duplicados por `codigo`: **0**.
- Duplicados por `url_pdf`: **0**.
- Duplicados por `hash_sha256`: **0** (además, `hash_sha256`/`contenido` están
  `NULL` en las filas revisadas: el contenido vive en `url_pdf` externa, no en bytes).
- Duplicados por `titulo` + `fecha`: **8 grupos** (ver §3.4).
- Coherencia documento ↔ alerta homónima (por `codigo` `AT-2026-<NN>_pdf[-2]`):
  se comparó **caso** y **título**. Sólo **2** documentos divergen: los `-2`.

### 3.2 Tabla de hallazgos

| `id`                                   | Entidad (`caso_id` → `codigo_caso`)                          | `codigo` / título                                                                             | Fecha      | Veredicto                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4de2b713-d617-43f2-86d3-fe54eb16659a` | `7c81ab23…` → **`CS-2026-0002`** (MYPES/Compras MYPErú)      | `AT-2026-48_pdf` · «CAMBIO DE FECHA DE PLANTÓN NACIONAL DE MYPES… NEC TEXTIL»                 | 2026-03-10 | **Original** de `AT-2026-48`; coherente (caso y alerta MYPES). Está **anulado** (`anulado_en = 2026-11-22`), igual que su caso `CS-2026-0002`.                                                                       |
| `226147f5-f10e-48dd-82a4-177dc10882b4` | `NULL` (sin caso)                                            | `AT-2026-48_pdf-2` · «ESCALAMIENTO DE CONFLICTO EN DPA MORRO SAMA (TACNA)…»                   | 2026-04-11 | **NO es duplicado.** Es el PDF de otra alerta: `AT-2026-48-bis` (mismo título y fecha 2026-04-11, `caso_id = NULL`). **Mal nombrado** por colisión de nombre de archivo. Caso `NULL` es coherente con su alerta.     |
| `e6419480-630d-46ed-86b3-b62be72f2181` | `86040c3a…` → **`CS-2025-0001`** (Parque Industrial Ancón)   | `AT-2026-49_pdf` · «PARQUE INDUSTRIAL ANCÓN»                                                  | 2025-11-28 | **Original** de `AT-2026-49`; coherente.                                                                                                                                                                             |
| `3d7bac0c-e67c-44dc-be00-38fe55c18f33` | `25c62486…` → **`CS-2024-0004`** (Cabo Blanco / Los Órganos) | `AT-2026-49_pdf-2` · «Paro pescadores artesanales Los Órganos — posible bloqueo Panamericana» | 2026-05-04 | **NO es duplicado.** Documento distinto con nombre colisionado. El caso `CS-2024-0004` es **plausible** por contenido, pero **no existe alerta homónima** en `core` (huérfano de alerta). **Dudoso / mal nombrado**. |

### 3.3 Qué son y cuál es el «original»

- **`AT-2026-48_pdf-2`** → no es una segunda copia de `AT-2026-48` (MYPES). Es
  el PDF de la alerta **`AT-2026-48-bis`** (DPA Morro Sama, 2026-04-11), que
  quedó con el sufijo `-2` porque el nombre de archivo del Excel
  (`AT-2026-48_pdf`) ya estaba tomado. **Original del código `AT-2026-48`:
  `AT-2026-48_pdf`** (la fila anulada de MYPES). El `-2` **no** es su par.
- **`AT-2026-49_pdf-2`** → no es copia de `AT-2026-49` (Ancón). Es un
  documento distinto (paro de pescadores de Los Órganos, 2026-05-04).
  **Original del código `AT-2026-49`: `AT-2026-49_pdf`** (Ancón, `CS-2025-0001`).
- En ambos casos el `-2` **no es un duplicado del contenido**: es una
  **colisión de nombre** en la importación.

### 3.4 Duplicados reales y dudosos (por título + fecha)

| Grupo                            | Códigos                        | Fecha      | Caso                 | Veredicto                                                                                                                        |
| -------------------------------- | ------------------------------ | ---------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pisco – II Audiencia Pública     | `CS-2026-01`, `CS-2026-01-2`   | 2025-11-07 | ambos `NULL`         | **Duplicado real**. La versión `-2` es la que trae `url_pdf`; la base no.                                                        |
| DPA Chancay – inauguración       | `CS-2026-02`, `CS-2026-02-2`   | 2025-11-20 | ambos `NULL`         | **Duplicado real** (igual: `-2` con URL).                                                                                        |
| Piura – conflictividad           | `CS-2026-03`, `CS-2026-03-2`   | 2025-11-28 | ambos `NULL`         | **Duplicado real** (`-2` con URL).                                                                                               |
| Piura/Sechura – pota             | `CS-2026-04`, `CS-2026-04-2`   | 2026-01-28 | ambos `NULL`         | **Duplicado real** (`-2` con URL).                                                                                               |
| Sechura – conflictividad         | `CS-2026-05`, `CS-2026-05-2`   | 2025-12-03 | ambos `NULL`         | **Duplicado real** (`-2` con URL).                                                                                               |
| Piura – paro agrario             | `CS-2026-06`, `CS-2026-06-2`   | 2026-05-26 | ambos `NULL`         | **Duplicado real** (`-2` con URL).                                                                                               |
| Reunión OSPAS selectivas y cerco | `RED-2026-021`, `RED-2026-022` | 2026-09-17 | ambos `NULL`         | **Duplicado real** (idénticos, sin URL).                                                                                         |
| Reunión diálogo Piura            | `RED-2026-023`, `RED-2026-024` | 2026-08-15 | ambos `CS-2026-0012` | **Dudoso**: mismo título/fecha/caso, pero **distinta URL** (dos archivos de Drive). Pueden ser dos adjuntos de la misma reunión. |

> **No hay** documentos con `codigo` repetido, ni con `url_pdf` repetida, ni con
> `hash_sha256` repetido. Los duplicados que existen lo son **por título+fecha**
> (copias importadas dos veces), no por identificador.

### 3.5 `core.medios`

Sin hallazgos: **142** filas, **0** URLs duplicadas, **0** entidades con más de
un `es_principal`, todos los `entidad_id` con formato válido. Reparto:
95 `actor`, 27 `local`, 20 `organizacion`. No existe `core.media`.

### 3.6 SQL propuesto (comentado, sin ejecutar)

```sql
-- ============================================================================
-- Documentos · detección y correcciones PROPUESTAS · NO EJECUTADAS
-- ============================================================================

-- 3.6.1 · Ver duplicados reales por título+fecha (solo lectura)
-- select titulo, fecha, count(*) as n,
--        array_agg(codigo order by codigo) as codigos,
--        array_agg(coalesce(url_pdf,'(sin url)') order by codigo) as urls
--   from core.documentos
--  group by titulo, fecha
-- having count(*) > 1
--  order by n desc;

-- 3.6.2 · Corregir el nombre de AT-2026-48_pdf-2 → AT-2026-48-bis_pdf
--   · `codigo` y `codigo_legado` son UNIQUE, así que sólo se renombra si el
--     destino no existe (verificado: no hay ningún documento con ese código).
--   · Se conserva `codigo_legado` como rastro de la importación; sólo se
--     cambia `codigo` (el identificador visible). Si se prefiere preservar
--     ambos, dejar `codigo_legado = 'AT-2026-48_pdf-2'`.
-- begin;
-- select set_config('app.rol_codigo','administrador',true);
-- select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true);
-- update core.documentos
--    set codigo = 'AT-2026-48-bis_pdf'
--  where codigo = 'AT-2026-48_pdf-2'
--    and codigo_legado = 'AT-2026-48_pdf-2'
--    and not exists (select 1 from core.documentos x
--                     where x.codigo = 'AT-2026-48-bis_pdf');
-- rollback;

-- 3.6.3 · AT-2026-49_pdf-2: NO renombrar todavía.
--   No existe alerta homónima en core para fechar/titular el documento
--   (probablemente una alerta legado no cargada en esta rama). Renombrar
--   exige identificar primero el código de alerta de origen.

-- 3.6.4 · Anular UNA de las copias reales (ejemplo CS-2026-01..06)
--   Criterio propuesto: conservar la copia `-2` (que trae `url_pdf`) y
--   anular la base (sin URL). Es una decisión de contenido: confirmar antes.
-- begin;
-- select set_config('app.rol_codigo','administrador',true);
-- select set_config('app.user_id','00000000-0000-0000-0000-000000000001',true);
-- update core.documentos
--    set anulado_en       = now(),
--        anulado_por      = '00000000-0000-0000-0000-000000000001',
--        anulacion_id     = gen_random_uuid(),
--        motivo_anulacion = 'Duplicado por título y fecha; se conserva la copia -2 con URL'
--  where codigo in ('CS-2026-01','CS-2026-02','CS-2026-03',
--                   'CS-2026-04','CS-2026-05','CS-2026-06')
--    and url_pdf is null
--    and anulado_en is null;
-- rollback;

-- 3.6.5 · RED-2026-021/022 (idénticos, sin URL): mismo tratamiento, conservar uno.
-- begin;
-- update core.documentos
--    set anulado_en       = now(),
--        anulado_por      = '00000000-0000-0000-0000-000000000001',
--        anulacion_id     = gen_random_uuid(),
--        motivo_anulacion = 'Duplicado exacto de RED-2026-021'
--  where codigo = 'RED-2026-022'
--    and anulado_en is null;
-- rollback;

-- 3.6.6 · RED-2026-023/024: NO tocar sin confirmación (URLs distintas).
```

> `core.documentos` exige `tipo_id NOT NULL` y `contenido_json NOT NULL`; los
> `UPDATE` anteriores no los alteran. Anular (`anulado_en`) es preferible a
> `DELETE`: preserva el rastro y es reversible.

---

## 4 · Riesgos

1. **Base equivocada.** Si la base autoritativa no es este Neon (132 demandas)
   sino la de 325, todas las conclusiones del §2 deben reejecutarse allí. El
   hallazgo 132↔325 es en sí mismo un riesgo de integridad que hay que explicar
   antes de cualquier corrección.
2. **Activar la herencia otra vez.** No reintroducir `migration/37`; la regla
   vigente es vincular sólo lo que se registra en el caso o lo que la fuente
   declara.
3. **Renombrar códigos de documento** puede romper enlaces guardados o
   integraciones que busquen `AT-2026-48_pdf-2`. La migración 69 ya advierte de
   ese efecto para `codigo_caso`.
4. **Anular duplicados** es una decisión de contenido: conservar la copia con
   URL parece lo correcto, pero debe confirmarlo quien conoce el expediente.
5. **RLS.** Cualquier `UPDATE` real debe ejecutarse con el contexto
   `app.rol_codigo`/`app.user_id` o no alcanzará filas (terminaría «en silencio»).
6. **No ejecutar** ninguna de estas sentencias sin autorización explícita; este
   documento es un diagnóstico.

## 5 · Qué falta confirmar con el usuario

- **¿Qué base es la autoritativa?** Este Neon tiene 132 demandas / 82 alertas;
  `legacy` conserva 325 / 83. ¿Es una rama de demo, una carga parcial o la base
  real? De ello depende si las 16 demandas existen en algún sitio.
- **Las 16 demandas de `migration/54`**: ¿se consideran ya resueltas (no están en
  `core`), o se esperaba encontrarlas y su ausencia es un fallo de carga?
- **`migration/54` no figura en `core.migracion_log`.** ¿Se aplicó a esta rama o
  el estado «0 demandas en el caso» se debe a que nunca se cargaron?
- **`AT-2026-49_pdf-2`**: ¿a qué alerta pertenece realmente? No hay alerta
  homónima cargada en `core`; hace falta el código de origen para renombrarlo.
- **Duplicados `CS-2026-0X` y `RED-2026-021/022`**: ¿se anula una copia? ¿Cuál
  se conserva? ¿`RED-2026-023/024` son dos adjuntos de la misma reunión o
  duplicados?
- **`AT-2026-48_pdf`** está anulado y su caso `CS-2026-0002` también: ¿se
  mantiene así o el documento debe reapuntar a un caso vigente? (Hoy es
  coherente: caso anulado ⇒ documento anulado.)

## 6 · Consultas que no se pudieron completar

- **Alerta de origen de `AT-2026-49_pdf-2`**: no existe en `core.alertas_tempranas`
  una alerta con título/fecha equivalentes (2026-05-04, «Paro pescadores Los
  Órganos / Panamericana»). Además `core` sólo tiene 82 de las 83 alertas de
  `legacy`, así que probablemente la alerta no está cargada en esta rama.
- **Trazabilidad de las 16 demandas**: `audit.cambios` sólo contiene **10**
  registros de `core.demandas` (QA y altas manuales), ninguno sobre las 16; y
  `migration/54` no está en `migracion_log`. No se puede probar si fueron
  desvinculadas por la 54 o si nunca se cargaron. La evidencia (`created_at`
  único 2026-10-31 para las 112 históricas y ausencia total de esos códigos)
  apunta a **carga parcial / base distinta**.
- **Contenido de los PDF**: no hay bytes (`contenido`/`hash_sha256` NULL en las
  filas revisadas), así que la duplicación se evaluó por código/título/fecha/URL,
  no por hash de contenido.

## 7 · Confirmación de limpieza

- No se ejecutó ningún `INSERT`, `UPDATE`, `DELETE`, `DDL` ni migración.
- En materia de Git sólo se ejecutó **un** `git status --short` de lectura al
  inicio; ningún comando de escritura (`commit`, `push`, `reset`, `merge`, etc.).
- Todos los scripts fueron de sólo lectura (`SELECT`) y se crearon en
  `scripts/_tmp_*.mjs`, fuera de `migration/`.
- **No queda ningún `scripts/_tmp_*.mjs`** (verificado con `ls scripts/_tmp_*` →
  sin resultados).
- No se modificó ningún archivo de `lib/`, `app/`, `angular/` ni `migration/`.
