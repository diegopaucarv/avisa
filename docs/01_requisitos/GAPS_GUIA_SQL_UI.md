# Gaps entre la Guía, la base de datos y la interfaz

| Campo                     | Valor                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fecha**                 | 2026-11-22                                                                                                                                      |
| **Base normativa**        | `docs/01_requisitos/guia.md`. Ante cualquier discrepancia de vocabulario, manda la Guía.                                                        |
| **Vocabulario operativo** | `docs/01_requisitos/GLOSARIO_ALINEACION_GUIA.md` (traducción de la Guía a etiquetas)                                                            |
| **Alcance**               | Catálogos `core.cat_*`, tablas de caso / alerta / compromiso, migraciones 12–19, API (`app/api`, `lib/db`) y SPA Angular (`angular/src`)        |
| **Sustituye a**           | La versión del 2026-11-21, que daba la migración 14 por «escrita, no aplicada». Hoy las ocho, de la 12 a la 19, están aplicadas.                |
| **Regla de evidencia**    | Toda afirmación sobre el repositorio cita archivo y línea. Los conteos marcados «base» provienen de la medición en la base viva del 2026-11-22. |

---

## 1 · Resumen

### 1.1 · Estado de las migraciones de alineación

Doce archivos, `migration/12_anulacion_y_secuencia.sql` a `migration/23_vistas_anexos_security_invoker.sql`.
Los doce están aplicados y verificados en la base.

| #   | Archivo                                 | Estado   |
| --- | --------------------------------------- | -------- |
| 12  | `12_anulacion_y_secuencia.sql`          | aplicada |
| 13  | `13_anulacion_segura.sql`               | aplicada |
| 14  | `14_alineacion_guia.sql`                | aplicada |
| 15  | `15_fusion_hechos_y_tematicas.sql`      | aplicada |
| 16  | `16_recodificacion_anexo15.sql`         | aplicada |
| 17  | `17_usuarios_y_privilegios.sql`         | aplicada |
| 18  | `18_normalizacion_refs.sql`             | aplicada |
| 19  | `19_codigos_genericos.sql`              | aplicada |
| 20  | `20_tipos_documento_anexos.sql`         | aplicada |
| 21  | `21_retiro_cat_tipos_reunion.sql`       | aplicada |
| 22  | `22_ciclos_intervencion_guia.sql`       | aplicada |
| 23  | `23_vistas_anexos_security_invoker.sql` | aplicada |

### 1.2 · Recuento de gaps por estado

| Estado                                           | Cuántos | Cuáles                                                                                          |
| ------------------------------------------------ | ------: | ----------------------------------------------------------------------------------------------- |
| Cerrados                                         |      26 | S1–S12 (migración 14), D1, D2, D5, D6, D8, E1, E3, D3, D7, D9, D10, E2, E5 (casos), E4          |
| Resueltos sin migración                          |       1 | D4 (los dos ejes se conservan; ver §2.2)                                                        |
| Abiertos que requieren decisión del usuario      |       0 | —                                                                                               |
| Estructurales abiertos                           |       0 | —                                                                                               |
| Observaciones abiertas (no son gaps de catálogo) |       2 | Sobrecarga heredada de `core.siguiente_codigo_caso()`; el catálogo de ciclos se ordena por `id` |

Ya no queda ningún gap de etiqueta ni estructural abierto. Lo que sigue son dos observaciones
técnicas (una sobrecarga latente de función y el orden de presentación del catálogo de ciclos). El
Anexo 17 se cerró sin crear tabla: se sirve desde la vista `analytics.vw_anexo_17_registro_reportes`
que ya existía (ver §2.1 y §2.3).

---

## 2 · Gaps de SQL (base de datos)

### 2.1 · Cerrados

| Bloque | Qué era                                                                                                                                                                                                                                                       | Cómo se cerró                                                                                                                                                                | Evidencia en la base (2026-11-22)                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1–S12 | Doce desalineaciones de catálogo: tipos y roles de actor, posicionamiento, subsectores, niveles de conflicto, niveles de alerta y Anexo 3                                                                                                                     | `migration/14_alineacion_guia.sql`, aplicada                                                                                                                                 | 3 tipos de actor · 4 roles de actor · 2 subsectores                                                                                                                    |
| D1     | Tipos de hecho duplicados (`Bloqueo` / `Protesta o Bloqueo`, `Comunicado` / `Comunicado o documento`)                                                                                                                                                         | Fusión en `migration/15_fusion_hechos_y_tematicas.sql`                                                                                                                       | 7 tipos de hecho                                                                                                                                                       |
| D2     | `Otros` en `cat_tematicas`                                                                                                                                                                                                                                    | Retiro en `migration/15_fusion_hechos_y_tematicas.sql`                                                                                                                       | 6 temáticas                                                                                                                                                            |
| D5     | Código de caso `CS-PRODUCE-AAAA-NNN`, fuera del Anexo 15                                                                                                                                                                                                      | `migration/16_recodificacion_anexo15.sql` recodificó los 35 casos y conservó `codigo_legado`                                                                                 | 35 casos · 0 fuera de formato                                                                                                                                          |
| D6     | Destino de las 83 alertas históricas                                                                                                                                                                                                                          | `PARCHE_20` y `PARCHE_22`: `estado_legado='Archivado'`, `paso_actual=5`                                                                                                      | 83 alertas                                                                                                                                                             |
| D8     | Grados de gravedad del ERS (`Crítica`/`Alta`/`Media`)                                                                                                                                                                                                         | El ERS usa los códigos reales del catálogo (`Crítica inmediata`, `Urgente`, `Temprana`)                                                                                      | 4 prioridades                                                                                                                                                          |
| E1     | `migration/13_anulacion_segura.sql` sin aplicar: las cuatro funciones de anulación seguían en `prosecdef = false` y `core.exigir_anulacion` no existía                                                                                                        | `migration/13_anulacion_segura.sql`, aplicada                                                                                                                                | `anular_caso`, `anular_registro`, `restaurar_caso` y `restaurar_registro` con `prosecdef = true` · `core.exigir_anulacion` creada                                      |
| E3     | El código de caso se derivaba en la aplicación con `max(sufijo)+1` y reintento `23505`                                                                                                                                                                        | `lib/db/repos/cases.ts:761-764` llama a `core.siguiente_codigo_caso($1,$2)`                                                                                                  | `core.secuencia_codigo` con 16 filas                                                                                                                                   |
| D3     | Faltaban como tipo documental los Anexos 1 y 2 (no los 14–17: son registros ya modelados)                                                                                                                                                                     | `migration/20_tipos_documento_anexos.sql`, aplicada                                                                                                                          | `cat_tipos_documento` con 17 filas · `matriz_sistematizacion_demandas` (anexo 1) y `reporte_regional_conflictividad_demandas` (anexo 2)                                |
| D7     | `cat_tipos_reunion` sin uso y sin eje propio                                                                                                                                                                                                                  | `migration/21_retiro_cat_tipos_reunion.sql`, aplicada                                                                                                                        | Se conserva con `comment on table` «OBSOLETO (D7)»: `reuniones_dialogo.tipo_id` lo referencia por FK y `analytics.vw_anexo_16_registro_reuniones` depende de esa tabla |
| D9     | `cat_ciclos_intervencion` con 4 valores legados (`Prevención`, `Seguimiento`, `Gestión del Conocimiento`)                                                                                                                                                     | `migration/22_ciclos_intervencion_guia.sql`, aplicada                                                                                                                        | 5 etiquetas de la Guía · 0 etiquetas legadas · 34 casos con ciclo · 1 sin ciclo                                                                                        |
| D10    | `KAG` y `WORKFLOW` caían en «Manual» por descarte en el mapeo de la UI                                                                                                                                                                                        | `angular/src/app/dominio/mapeo.ts` (sin tocar el `CHECK`)                                                                                                                    | `KAG → «KAG»` · `WORKFLOW → «Workflow»`; el `CHECK` sigue técnico                                                                                                      |
| E2     | No existía endpoint `anular` ni `restaurar`, y los `DELETE` borraban físicamente                                                                                                                                                                              | Endpoints nuevos y `DELETE` lógicos, verificados; la base ya tenía las funciones                                                                                             | `POST /api/v1/cases/[code]/anular` y `…/restaurar`, más `restaurar` para alertas, compromisos, demandas y documentos. Sin `motivo` → `400 MOTIVO_REQUERIDO`            |
| E5     | No existían exportaciones PDF / Excel / JSON                                                                                                                                                                                                                  | `lib/export/{json,xlsx,pdf}.ts` y `GET /api/v1/export`                                                                                                                       | `formato=json\|excel\|pdf` · `entidad=<entidad>\|base` · XLSX con firma `PK` y PDF 1.4 válidos                                                                         |
| E4     | El Anexo 17 (Registro de reportes) no tenía pantalla ni API; la vista `analytics.vw_anexo_17_registro_reportes` existía pero se ejecutaba con los privilegios del superusuario y saltaba la RLS de `core.documentos`, `core.casos` y `core.alertas_tempranas` | Repo `lib/db/repos/reportes.ts` · `GET /api/v1/reportes` · pantalla Angular `/reportes` · exportación `entidad=reportes` · `migration/23_vistas_anexos_security_invoker.sql` | Vista con `security_invoker=true` · `externo_publico` (clasificación 1): 0 filas por la vista (antes 42) · `sectorista`: 42 filas                                      |

**Contador de códigos.** Hay un único punto de emisión,
`core.siguiente_codigo_caso(subsector_id, tematica_id)`
(`migration/16_recodificacion_anexo15.sql:90-111`, ampliado a `GEN` por
`migration/19_codigos_genericos.sql:30-62`). Devuelve
`CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE>-<AAAA>-<NN>` y `GEN` en el tramo del subsector o de la
temática cuando falta clasificar. Sondeos ejecutados en transacción con `ROLLBACK` para no
consumir correlativos:

| Llamada     | Resultado           |
| ----------- | ------------------- |
| `(1, null)` | `CS-PA-GEN-2026-01` |
| `(1, 1)`    | `CS-PA-INF-2026-03` |
| `(2, 3)`    | `CS-MI-NOR-2026-01` |

Sólo la sigla `INF` está fijada por la Guía (Anexo 15, `guia.md:2619-2625`); `OAT`, `NOR`, `DBE`,
`GOB` e `ITE` son el acuerdo de la migración 16 y están documentados en el comentario de
`core.codigo_tematica` (`migration/16_recodificacion_anexo15.sql:84-85`).

#### Observación · sobrecarga heredada del contador

`migration/12_anulacion_y_secuencia.sql:152-166` definió `core.siguiente_codigo_caso()` **sin
argumentos**, con ámbito global `'CASO'` y prefijo `CS-PRODUCE-`. La migración 16 creó
`core.siguiente_codigo_caso(integer, integer)` con otra firma; como ninguna migración de las 10–19
ejecuta `drop function` (verificado con `grep -rn "drop function" migration/*.sql`, sin
resultados), la versión de la 12 sigue existiendo como sobrecarga y emite el formato antiguo si
alguien la invoca sin argumentos. Hoy no la llama nadie: el repositorio de casos pasa dos
argumentos. Es una trampa latente, no un gap abierto; se resuelve con un `drop function` explícito.

### 2.2 · Resuelto sin migración

| #   | Objeto                                          | Resolución                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4  | `cat_niveles_alerta` + `cat_prioridades_alerta` | **Se conservan los dos.** Son ejes distintos: nivel = `Inmediato · Táctico · Preventivo · Monitoreo`; prioridad = `Crítica inmediata · Urgente · Temprana · Seguimiento`, con `sla_horas` de 24 / 48 / 72 / sin plazo. Unificarlos perdería el nivel del semáforo o el SLA. No hay migración; la decisión queda documentada en `docs/04_migracion/DECISIONES_D3_D4_D7_D9_D10.md`. |

**D3.** Se tipificaron sólo los Anexos 1 y 2. Los Anexos 14–17 no se añaden: los 14, 15 y 16 son
registros estructurados que ya tienen tabla (`compromisos` con sus hitos, `casos`, `reuniones_dialogo`)
y el 17 no necesita tipo documental ni tabla: se sirve desde la vista `analytics.vw_anexo_17_registro_reportes` (E4, cerrado en §2.3).

**D7.** No se pudo retirar `core.cat_tipos_reunion`: `core.reuniones_dialogo.tipo_id` la referencia
por FK y `analytics.vw_anexo_16_registro_reuniones` depende de esa tabla. Borrarla habría exigido
alterar una tabla de dominio. Se conserva marcada como obsoleta con `comment on table`, y la
migración implementa la rama de retirada para cuando desaparezca la FK.

**D9.** Las etiquetas se alinearon renombrando las filas del catálogo **en sitio**, no moviendo casos:
`core.casos` no tiene `ciclo_id` sino `ciclo_intervencion_id`, y tiene RLS forzada, de modo que un
`UPDATE` masivo podía afectar 0 filas en silencio. Al conservar los `id`, los 34 casos quedan
clasificados correctamente. «Prevención estratégica» ya se puede emitir (0 casos todavía).

| Valor legado                 | Etiqueta vigente                             | Casos |
| ---------------------------- | -------------------------------------------- | ----: |
| `Prevención`                 | Prevención operativa                         |     1 |
| `Intervención y tratamiento` | Intervención y tratamiento                   |     1 |
| `Seguimiento`                | Monitoreo de compromisos                     |    32 |
| `Gestión del Conocimiento`   | Gestión de la información y del conocimiento |     0 |
| —                            | Prevención estratégica                       |     0 |

Queda **1 caso sin ciclo**. No es un gap de catálogo: es un dato incompleto y debe completarse
desde la ficha del caso cuando la UI permita escribir.

**D10.** No se tocó el `CHECK`: `MANUAL · KAG · WORKFLOW · AVISA_HISTORICO · WHATSAPP` son códigos
técnicos de procedencia. Se corrigió el mapeo de la UI para que `KAG` y `WORKFLOW` tengan etiqueta
explícita en lugar de caer en «Manual» por el valor de respaldo.

### 2.3 · Gaps estructurales abiertos

No queda ninguno. **E4** (Anexo 17: registro de reportes) se cerró sin crear tabla: la vista
`analytics.vw_anexo_17_registro_reportes` ya existía y se le dio pantalla, API y exportación. Además,
`migration/23_vistas_anexos_security_invoker.sql` corrigió la fuga de RLS de esa vista y de
`analytics.vw_anexo_16_registro_reuniones`, que se ejecutaban con los privilegios del superusuario
y devolvían filas fuera del ámbito del perfil (detalle en §2.1).

E2 y E5 también están cerrados (ver §2.1). Ningún mecanismo de la Guía queda sin soporte en la base.

### 2.4 · Catálogos que coinciden con la Guía (no se tocan)

`cat_niveles_riesgo` (Bajo / Moderado / Alto) · `cat_prioridades_atencion` (Urgente / Moderado / Bajo, Anexo 15 columna 10) ·
`cat_tematicas` (las 6 tipologías de §7.6) · `cat_alcances_geograficos` (Norte / Centro / Sur /
Oriente / Nacional) · `cat_niveles_conflicto.nombre` · `cat_estados_hito` (Registrado / En
ejecución / Paralizado / Cumplido / Desestimado) · `cat_tipos_documento` anexos 1–13 ·
`cat_ciclos_intervencion` (las 5 etapas de §8.1–8.4, tras D9).

`cat_ciclos_intervencion` **vuelve a figurar en esta lista** tras la migración 22. Su único defecto
restante es de presentación: se ordena por `id`, así que «Prevención estratégica» (id 5) aparece
última aunque la Guía la describa primero. La propia Guía §8 aclara que las etapas no son sucesivas,
por lo que no es un error de modelo.

### 2.5 · La tabla de las 62 modificaciones ya no es la unidad de seguimiento

El plan de `docs/07_frontend/frontend.md` se midió por modificaciones de la UI React. Esa UI es
hoy la productiva y está congelada; el reemplazo se construye en Angular y su avance se sigue en
`docs/07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md`. Conservar aquí el recuento 27/21/14
sugeriría un trabajo que ya no se hace sobre ese código.

---

## 3 · Gaps de UI

### 3.1 · Resuelto

| Cambio                                                                                                              | Dónde                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Adaptador de colecciones tolerante a claves ES/EN (`elementos`/`items`, `pagina`/`page`, `tamanoPagina`/`pageSize`) | `angular/src/app/core/http/coleccion.ts:41-89`                                           |
| Adaptador de errores de API, un único punto de traducción                                                           | `angular/src/app/core/http/errores.ts`                                                   |
| Fachada de consulta con señales; los componentes no importan `httpResource`                                         | `angular/src/app/core/http/consulta.ts:16-90`                                            |
| Ciclo de intervención (D9) ya es identidad: la base emite las 5 etiquetas de la Guía                                | `angular/src/app/dominio/mapeo.ts`                                                       |
| `origen_dato` (D10): `KAG` y `Workflow` con etiqueta explícita, sin descarte a «Manual»                             | `angular/src/app/dominio/mapeo.ts`                                                       |
| Las 20 pantallas tienen ruta real; sólo `/mapa` sigue en marcador                                                   | `angular/src/app/app.routes.ts`                                                          |
| Paginación en servidor en todas las vistas; contadores desde el `total` del sobre (`tamano=1`)                      | `features/resumen`, `features/bandeja`, `features/direccion`                             |
| Menú de exportación JSON / Excel / PDF                                                                              | `angular/src/app/shared/ui/exportar-menu.component.*`, cableado en `features/documentos` |
| Una demanda aceptada desde un documento conserva documento y fragmento de origen                                    | Modelo preparado; queda demostrarlo cuando la vista de documentos tenga escritura        |

### 3.2 · Abierto: anulación en la UI

El **backend ya sostiene la operación**: `POST /api/v1/cases/[code]/anular`, `…/restaurar` y los
equivalentes para alertas, compromisos, demandas y documentos; el `DELETE` exige `motivo` y no borra
físicamente. Lo que falta es la interfaz: la ficha de caso
(`angular/src/app/features/casos/caso-detalle.page.html`) sigue siendo de **sólo lectura** y no ofrece
ni el diálogo de anulación ni la edición.

La regla de producto del usuario se cumple en la base: una alerta se anula mientras exista el caso,
pero al anular el caso se anulan sus alertas en cascada bajo un `anulacion_id`; restaurar el caso las
restaura. Las alertas anuladas no se ven porque las políticas RLS de `SELECT` las esconden.

### 3.3 · Cerrado por D10

El mapeo de `origen_dato` ya no descarta valores: `KAG` y `WORKFLOW` tienen etiqueta propia
(`angular/src/app/dominio/mapeo.ts`).

### 3.4 · Pendiente, no es un gap de la Guía

- Prioridad de atención del caso: la Guía la lista como columna de la matriz (§8.3.1) pero no
  define la regla de cálculo; derivarla sería inventar.
- Evidencias de compromiso como archivos: requiere almacenamiento, fuera del prototipo.
- Preferencias y contraste por usuario: hoy viven en `localStorage`; persistirlas exige perfil en
  la base.

---

## 4 · Cobertura de los mecanismos de la Guía en la base

| Mecanismo (Guía)                                        | Tabla / objeto                                                      | Estado                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| §8.1.2.1 Gestión y sistematización de demandas (3P)     | `demandas` + `demanda_fuentes`                                      | cubierto                                                                                                        |
| §8.1.2.2 Alerta temprana (RED-RADAR)                    | `alertas_tempranas` + `cat_prioridades_alerta` + `vw_alerta_estado` | cubierto; el estado se deriva de `paso_actual` y del flujo de 5 pasos                                           |
| §8.1.2.3 Reportes de clima social                       | `cat_tipos_documento` (anexos 4 y 5)                                | cubierto como documento, no como entidad                                                                        |
| §8.2.4 Análisis de caso                                 | `casos` (nivel de conflicto, riesgo, descripción) + `casos_actores` | cubierto                                                                                                        |
| §8.2.5 Espacios de diálogo                              | `reuniones_dialogo` + `reunion_participantes`                       | cubierto; 0 filas cargadas                                                                                      |
| §8.3.1 Matriz de conflictividad (Anexo 15)              | `casos` con código `CS-PA/MI-Temática-AAAA-NN`                      | cubierto tras la migración 16                                                                                   |
| §8.3.2 Matriz de seguimiento de compromisos (Anexo 14)  | `compromisos` (8) + `hitos_compromiso` (12)                         | cubierto; el código se deriva del padre (`<caso>_COMP001`, `<compromiso>_H001`), que es el formato del Anexo 14 |
| §8.3.3 Registro de reportes (Anexo 17)                  | —                                                                   | **sin soporte** (E4)                                                                                            |
| §8.4 Gestión de la información (respaldo / exportación) | `lib/export/*` + `GET /api/v1/export`                               | cubierto: JSON por entidad y de base completa, XLSX y PDF                                                       |

La derivación del código de compromiso e hito no es un gap: la Guía la define así
(`guia.md:2611-2620`) y el código de caso es la clave de la que cuelga todo lo demás. Que el caso
use el contador persistente y el compromiso herede su código es correcto, no una inconsistencia.

---

## 5 · Verificación ejecutada

> Resultados registrados el **2026-11-22**. Son la última medición disponible sobre la base viva y
> el workspace Angular; no se repitieron al reescribir este documento.

### 5.1 · Base de datos

Los conteos de `core` se obtienen con el rol propietario. Con `avisa_api` devuelven 0 filas porque
las tablas tienen RLS y la sesión necesita `app.rol_codigo`: un `count(*) = 0` visto desde el rol
de aplicación **no** significa catálogo vacío.

```sql
-- Casos y anulación
select count(*) as casos,
       count(*) filter (where anulado_en is not null) as anulados
  from core.casos;

-- Formato del Anexo 15
select count(*) as fuera_de_formato
  from core.casos
 where codigo_caso !~ '^CS-(PA|MI)-(INF|OAT|NOR|DBE|GOB|ITE|GEN)-[0-9]{4}-[0-9]{2}$';

-- Alertas históricas
select count(*) from core.alertas_tempranas where estado_legado = 'Archivado';

-- Catálogos y contador
select 'tematicas' as catalogo, count(*) from core.cat_tematicas
union all select 'tipos_actor', count(*) from core.cat_tipos_actor
union all select 'subsectores', count(*) from core.cat_subsectores
union all select 'roles_actor', count(*) from core.cat_roles_actor
union all select 'tipos_hecho', count(*) from core.cat_tipos_hecho
union all select 'tipos_documento', count(*) from core.cat_tipos_documento
union all select 'secuencia_codigo', count(*) from core.secuencia_codigo;

-- Compromisos e hitos
select (select count(*) from core.compromisos) as compromisos,
       (select count(*) from core.hitos_compromiso) as hitos;

-- Sondeo del contador (dentro de begin / rollback para no consumir correlativos)
select core.siguiente_codigo_caso(1, null),
       core.siguiente_codigo_caso(1, 1),
       core.siguiente_codigo_caso(2, 3);
```

| Medición                                | Resultado                                                     |
| --------------------------------------- | ------------------------------------------------------------- |
| Casos                                   | 35                                                            |
| Casos anulados                          | 0                                                             |
| Códigos fuera de formato                | 0                                                             |
| Alertas con `estado_legado='Archivado'` | 83                                                            |
| Temáticas                               | 6                                                             |
| Tipos de actor                          | 3                                                             |
| Subsectores                             | 2                                                             |
| Roles de actor                          | 4                                                             |
| Tipos de hecho                          | 7                                                             |
| Compromisos                             | 8                                                             |
| Hitos                                   | 12                                                            |
| Filas en `core.secuencia_codigo`        | 16                                                            |
| `siguiente_codigo_caso`                 | `CS-PA-GEN-2026-01`, `CS-PA-INF-2026-03`, `CS-MI-NOR-2026-01` |

### 5.2 · Código y API

| Prueba                                                     | Resultado                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` en la raíz del repositorio              | pasa, sin errores                                                                                                             |
| Existencia de rutas `anular` / `restaurar` en `app/api/**` | no hay rutas; la única aparición de «restaurar» es un comentario (`app/api/v1/session/route.ts:9`)                            |
| Código de caso en `lib/db/repos/cases.ts`                  | llama a `core.siguiente_codigo_caso($1,$2)`                                                                                   |
| Listado de casos                                           | `{items, total, page, pageSize, generatedAt}`, `pageSize` por omisión 25 y tope 100 (`lib/db/repos/cases.ts:137-141,178-184`) |

### 5.3 · SPA Angular

| Prueba                                         | Resultado                                               |
| ---------------------------------------------- | ------------------------------------------------------- |
| `ng build` (producción)                        | 437,09 kB iniciales · 99,61 kB de transferencia         |
| `POST /api/auth/login` con las 5 cuentas de §8 | 200 en las cinco                                        |
| `GET /api/v1/session`                          | hidrata la sesión                                       |
| `GET /api/v1/cases?pagina=1&tamano=2`          | sobre paginado con `items`, `total`, `page`, `pageSize` |
| `grep -rn "tamano: 100" angular/src/app`       | sin coincidencias                                       |

El detalle de la SPA está en `docs/07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md`.

---

## 6 · Discrepancias detectadas al leer la Guía

Estas son las diferencias entre lo que suele darse por sentado y lo que dice el documento
normativo. Se registran aquí porque cambian cómo se nombra el modelo, no para corregir la Guía.

| #   | Lo asumido                                                   | Lo que dice el documento                                                                                                                                                                                                                                                                                                                                                                | Consecuencia                                                                                                            |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C1  | La Guía define «5 etapas» del ciclo                          | §7.8 dice expresamente que los componentes «no deben entenderse como etapas sucesivas o rígidas» y que pueden desarrollarse «de manera simultánea, complementaria o iterativa» (`guia.md:650`). El glosario §1.10 repite: «no son etapas rígidas ni secuenciales». Son **4 componentes** con **5 etiquetas**, porque la intervención preventiva se desdobla en estratégica y operativa. | No usar «etapa» como si fuera un estado secuencial del caso. El catálogo almacena un componente, no un avance de fases. |
| C2  | El nombre del cuarto y del quinto componente es único        | §7.8 los llama «Monitoreo de compromisos y seguimiento» y «Gestión del conocimiento y sistematización» (`guia.md:662-663`); §8.3 y §8.4 los titulan «Monitoreo de compromisos» y «Gestión de la Información y del Conocimiento» (`guia.md:1057`, `guia.md:1102`). El glosario §1.10 usa la forma de §8.                                                                                 | La UI y el glosario siguen §8.3/§8.4. La Guía no es uniforme en esos dos rótulos.                                       |
| C3  | El eje «ciclo» ya está alineado en la base                   | El glosario §1.12 afirma que los doce ejes «ya están en la base viva (migraciones 14 a 19)» (`GLOSARIO_ALINEACION_GUIA.md:207-213`). Ninguna de las migraciones 12–19 toca `cat_ciclos_intervencion`: el catálogo conserva los 4 valores legados.                                                                                                                                       | El glosario sobrestimaba el avance. **Corregido por la migración 22 (D9).**                                             |
| C4  | El código del Anexo 15 está completamente fijado por la Guía | La Guía fija la estructura `CS–PA/MI–Temática–Año–Correlativo` y ejemplifica `CS-PA-INF-2026-01`; sólo `INF` aparece como sigla. `OAT`, `NOR`, `DBE`, `GOB` e `ITE` son acuerdo interno (comentario de `core.codigo_tematica`). `GEN` también es interno (migración 19).                                                                                                                | Si la OAIPCS adopta otras siglas, hay que migrar los códigos; no basta con cambiar la etiqueta.                         |
| C5  | El presupuesto de la SPA es de 250 kB                        | `angular.json:33-38` configura 1,2 MB de aviso y 2 MB de error. Los 250 kB son la **puerta G5** del diseño, medida en gzip (`DISENO_MIGRACION_ANGULAR.md:1424-1431`).                                                                                                                                                                                                                   | Ambos umbrales son válidos, pero miden cosas distintas: el de `angular.json` es el tamaño bruto del bundle.             |
| C6  | El CSS portado es idéntico byte a byte                       | `app/globals.css` tiene 6 782 líneas y `angular/src/styles/global.css` 6 781. La copia está reformateada por Prettier, no importa `leaflet/dist/leaflet.css` y añade `@source` para Tailwind (`global.css:1-7`).                                                                                                                                                                        | La paridad es de contenido y de reglas, no de archivo. Comparar con `diff` produce ruido de formato.                    |
| C7  | Tres cuentas tienen la clave `demo`                          | Hoy son cinco (§8). La migración 17 y las cuentas demo posteriores cambiaron ese cuadro.                                                                                                                                                                                                                                                                                                | Cualquier documento que repita «sólo 3 DNIs» está desactualizado.                                                       |

---

## 7 · Decisiones tomadas

Ya no queda ninguna decisión de modelo pendiente. Las cinco que estaban abiertas se resolvieron
el 2026-11-22 y su detalle está en `docs/04_migracion/DECISIONES_D3_D4_D7_D9_D10.md`.

| #   | Decisión                                                                                         | Estado                  |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| D3  | Tipificar sólo los Anexos 1 y 2; los 14–17 no son tipos documentales (el 17 es E4)               | aplicada (migración 20) |
| D4  | Conservar los dos ejes de alerta: nivel (semáforo) y prioridad (SLA)                             | resuelta sin migración  |
| D7  | Retirar `cat_tipos_reunion`; no se pudo por la FK de `reuniones_dialogo`, queda marcada obsoleta | aplicada (migración 21) |
| D9  | Alinear `cat_ciclos_intervencion` a las 5 etiquetas de la Guía, renombrando en sitio             | aplicada (migración 22) |
| D10 | No tocar el `CHECK`; dar etiqueta explícita a `KAG` y `WORKFLOW` en la UI                        | aplicada (mapeo)        |

Queda una decisión **de producto** que el usuario aplazó expresamente: el dataset de ubigeo/centroide
y la calibración del riesgo. Hasta entonces `/mapa` sigue en marcador.

---

## 8 · Credenciales de verificación

Todas con la clave `demo`.

| Perfil                                                       | DNI        | Rol efectivo                      |
| ------------------------------------------------------------ | ---------- | --------------------------------- |
| Admin (acumula los 10 roles)                                 | `11111111` | todos                             |
| Alta Dirección (cuenta demo)                                 | `22222222` | `alta_direccion`                  |
| Edith Bautista León — Dirección OAIPCS; edita, no administra | `41907320` | `direccion_oaipcs` (sólo ese rol) |
| Peggy Contreras Montes                                       | `10654038` | `sectorista`                      |
| André Jiménez Agapito                                        | `46078289` | `sectorista` + `consulta_lectura` |

`41907320` no es administradora: puede editar y anular según las capacidades de su rol, pero no
gestiona usuarios ni catálogos. La cuenta `11111111` es la única que acumula los diez roles y sirve
para verificar cualquier pantalla sin cambiar de usuario.

Las credenciales del rol de base de datos de aplicación están en
`docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`; no se repiten aquí para no duplicar un secreto en
un documento de diagnóstico.

---

## 9 · Hallazgos del barrido documental del 2026-11-22

Salieron de la pasada de alineación descrita en `01_requisitos/AUDITORIA_ALINEACION_2026-11-22.md`.
Cada uno se deja **registrado y sin corregir**, porque exige una decisión de base, una regeneración
de artefacto o un cambio de código, no una edición de texto. Se anotan para no volver a
descubrirlos.

| #    | Hallazgo                                                                                                                                                                                                             | Evidencia                                                                                                                                      | Qué falta                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| G-01 | La v10 da `core.cat_roles_actor` con **7** filas; la base tiene **4**                                                                                                                                                | `02_arquitectura/AVISA_PRODUCE_v10.md:4797`                                                                                                    | cifra vieja del modelo; no se reescribe por la regla de no tocar mediciones                                                |
| G-02 | `core.demandas.caso_id` figura `NOT NULL` en el DDL pero es nullable en la base viva                                                                                                                                 | DDL de `core.demandas`                                                                                                                         | es lo que presupone «demandas sin caso»: el DDL debe alinearse a la base                                                   |
| G-03 | Sobrecarga heredada de `core.siguiente_codigo_caso()` sin argumentos (migración 12) emitiría `CS-PRODUCE-…`; nadie la llama                                                                                          | base viva, `pg_proc`                                                                                                                           | `DROP FUNCTION` de la sobrecarga                                                                                           |
| G-04 | `05_datos/DICCIONARIO_DATOS.md:1747` conserva el literal `Critica_Inmediata` en el comentario de `es_grave`                                                                                                          | artefacto generado                                                                                                                             | **regenerar** con `python migration/generar_diccionario.py`; no se edita a mano                                            |
| G-05 | `backend/main.py` conserva un usuario demo `12345678` y el runbook aún describe una API de ejemplo que no lee la base                                                                                                | `backend/main.py`, `06_operacion/ENTORNO_DOCKER_POSTGRES.md` §11                                                                               | la FastAPI está sellada: queda como nota, no se toca                                                                       |
| G-06 | La tabla generada de §11.5 apunta `log_envios` a `core.notificaciones`, mientras §2 usa `core.envios_comunicacion`                                                                                                   | `05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md:540` frente a `:105`                                                                       | se corrige al regenerar §11.5, no a mano                                                                                   |
| G-07 | `07_frontend/frontend.md` arrastra defectos de numeración (`2. 2.`, `5. 5.`)                                                                                                                                         | `07_frontend/frontend.md:11`, `:14`                                                                                                            | preexistentes; se corrigen al editar esas secciones                                                                        |
| G-08 | El calendario de compromisos de la SPA está pendiente; el listado y el panel ya funcionan                                                                                                                            | `angular/src/app/features/compromisos/`                                                                                                        | portar el calendario                                                                                                       |
| G-09 | `core.demandas.estado_atencion` admite `En_proceso`, el literal que el glosario §1.8 prohíbe. Es un eje distinto (atención de la demanda, no estado de hito o compromiso) y no figura entre los doce ejes congelados | base viva: `demandas_estado_atencion_check` admite `Pendiente` · `En_proceso` · `Atendida` · `Desestimada`, y sólo hay `Pendiente` (325 filas) | decidir si el eje entra al glosario o se renombra a `En proceso`: **no migra datos**, porque ningún registro usa ese valor |
| G-10 | **1 de los 35 casos no tiene ciclo de intervención**                                                                                                                                                                 | `select count(*) from core.casos where ciclo_intervencion_id is null` = 1                                                                      | es un dato incompleto, no un gap de catálogo; se completa desde la ficha cuando la UI permita escribir                     |
| G-11 | `cat_ciclos_intervencion` se ordena por `id`, así que «Prevención estratégica» (id 5) aparece última                                                                                                                 | `lib/db/repos/catalogs.ts` ordena por `id`; no existe columna `orden`                                                                          | añadir `orden` al catálogo cuando se reabra; la Guía §8 aclara que los componentes no son etapas sucesivas                 |

Quedaron **descartados** dos falsos positivos del inventario previo, comprobados en el código antes
de registrarlos: no existe redirección a `/sin-permiso` (el guard redirige a `/acceso`,
`angular/src/app/core/auth/sesion.guard.ts:17`), y la ausencia de `provideZonelessChangeDetection()`
es un hecho declarado y correcto en Angular 22, no un defecto
(`07_frontend/angular/ESTADO_MIGRACION_ANGULAR.md:37`).

**Alcance de las cuatro búsquedas del glosario.** Hoy devuelven coincidencias en tres clases, todas
justificadas y ninguna corregible por edición de texto: los pares legado → canónico de los documentos
de migración y datos (obligatorios: describen las dos capas), los literales de parches cerrados que
llevan ya su nota de posteridad, y los `CHECK` reales de la base que el DDL debe transcribir tal cual
(G-09). Fuera de eso, `01_requisitos/AUDITORIA_ALINEACION_2026-11-22.md` y este registro se excluyen
de las búsquedas porque su función es nombrar el legado para delimitarlo.
