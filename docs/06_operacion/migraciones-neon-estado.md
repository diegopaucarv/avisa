# Estado de las migraciones en Neon

> Última verificación: **29/11/2026**, contra `core.migracion_log` de la base
> de producción en Neon (consulta de sólo lectura).
>
> Este documento es la fuente única para saber **qué está aplicado**, **qué
> falta** y **qué número sigue**. Cuando se aplique una migración, se actualiza
> aquí y se registra en `core.migracion_log`.

## 0. Operaciones de datos (no son migraciones)

| Fecha      | Script                                                     | Efecto                                                                                                                                                                                               | Reversible                                                   |
| ---------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 2026-11-28 | `scripts/_marcar_alertas_atendidas_2026-11-28.mjs --apply` | `paso_actual = 5` en las 53 alertas activas con `fecha_reporte < 2026-11-01`, para que el filtro binario Atendidas/Pendientes deje como pendiente sólo el mes en curso (89 atendidas / 1 pendiente). | Sí: `--rollback backups/alertas_paso_actual_2026-11-28.json` |

## 1. Reglas

1. Las migraciones son **aditivas**: agregan columnas con `DEFAULT`, tablas
   nuevas o índices. No borran ni renombran nada.
2. Cada archivo se aplica **una sola vez** y se anota en `core.migracion_log`
   con la clave del nombre del archivo, sin la extensión.
3. **Ninguna migración se ejecuta sin autorización explícita de la Dirección.**
   Diseñarlas y revisarlas no es ejecutarlas.
4. El número siguiente es el **mayor aplicado + 1**, sin reutilizar huecos: la
   numeración es un registro histórico, no una secuencia compacta.

## 2. Estado real (verificado en `core.migracion_log`)

### 2.1 Aplicadas

| Clave en `migracion_log`                                          | Tema                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `40_casos_naturaleza` … `70_sembrar_secuencia_codigos_2026_11_26` | Serie histórica (ver tabla completa abajo)                                            |
| `73_alerta_hechos_2026_11_26`                                     | Tabla `core.alerta_hechos`                                                            |
| `74_usuarios_sectoristas_lectura_2026_11_27`                      | Lectura de usuarios sectoristas                                                       |
| `75_unificar_territorio_gis_2026_11_27`                           | Unificación de territorio/GIS                                                         |
| `76_caso_priorizado_2026_11_26`                                   | `core.casos.priorizado`                                                               |
| `77_casos_actores_posicion_guia_2026_11_26`                       | `posicion` con el vocabulario de la Guía                                              |
| `78_alertas_anulacion_direccion_2026_11_27`                       | Anulación de alertas por Dirección                                                    |
| `79_alerta_hechos_fechas_2026_11_27`                              | Fechas de los hechos                                                                  |
| `80_alerta_hechos_sin_anio_2026_11_27`                            | Hechos sin año                                                                        |
| `81_mesas_como_casos_2026_11_27`                                  | Mesas como casos                                                                      |
| `82_porteo_campos_mesas_2026_11_27`                               | Satélite `core.mesa_ficha` y porteo de la ficha de mesas                              |
| `83_alerta_hechos_lineas_heredadas_2026_11_27`                    | Reinserta líneas de `hechos_recientes` que la 73 descartó                             |
| `84_indices_rendimiento_2026_11_27`                               | Índices de listados y panel de alertas                                                |
| `85_c8_hechos_fecha_compacta_2026_11_27`                          | Mueve la fecha compacta (`* 05NOV2026`) a `alerta_hechos.fecha`                       |
| `86_c8_hechos_vineta_asterisco_2026_11_27`                        | Quita la viñeta `*` inicial de los hechos                                             |
| `87_ampliar_textos_carga_historica_2026_11_27`                    | `cargo_actual` y `reuniones_dialogo.titulo` pasan a `text`                            |
| `88_auditoria_descargas_2026_11_28`                               | Tabla `audit.descargas` (auditoría de exportaciones)                                  |
| `89_mesas_nacionales_2026_11_29`                                  | Marca de mesas nacionales y `core.casos.alcance_override`                             |
| `90_trigger_mesa_nacional_2026_11_29`                             | Trigger que deriva `es_nacional` y propaga el alcance al caso                         |
| `91_ambito_mesas_nacionales_2026_11_29`                           | Ámbito de las mesas 004/005/012 y registro de la clave 54                             |
| `92_capas_mapa_2026_11_29`                                        | Capas `territorio.region`, `territorio.provincia` y `territorio.anp_reserva_nacional` |

Claves históricas fuera de la serie numérica, también aplicadas:
`casos_tematica_anulable`, `distritos_inei_2025` y
`54_demandas_desvinculo_caso_2026_11_24`.

> **La `54` se registró el 29/11/2026 sin volver a ejecutarla.** Su efecto ya
> estaba en los datos (CS-2026-0003 sin demandas vinculadas), pero la clave
> faltaba en el log. Se insertó de forma idempotente para que el registro
> refleje la realidad y nadie la repita por error.

### 2.2 Pendientes de aplicar

No hay migraciones pendientes de aplicar.

La `92_capas_mapa_2026_11_29` se aplicó el 29/11/2026 y **no introduce datos**: crea
`territorio.region` (25 filas, unión de los distritos por prefijo de ubigeo con
`ST_MakeValid` + `ST_SimplifyPreserveTopology`), `territorio.provincia` (196) y la
tabla vacía `territorio.anp_reserva_nacional`. Las 42 Reservas Nacionales se
cargaron aparte con `scripts/_cargar_anp_reserva_nacional.mjs --apply` desde
`gis/derived/anp_reserva_nacional.geojson` (48 features disueltas por `codigo`).
Verificado: 25 regiones, 196 provincias, 42 ANP válidas (MultiPolygon), todas
`categoria = 'Reserva Nacional'`.

> **Priorización de la demo (datos, no migración).** El 29/11/2026 se marcaron
> como `priorizado = true` los cuatro casos abiertos más recientes para que la
> tabla «Casos priorizados» del panorama no salga vacía: `CS-2026-0003`,
> `CS-2026-0015`, `CS-2026-0010` y `CS-2026-0014`. Lo hace
> `scripts/_priorizar_ultimos_casos_2026-11-29.mjs` (simulación por defecto,
> `--apply` escribe). Es reversible con un `update ... set priorizado = false`.

La `88` (auditoría de descargas) se llevó a producción el 28/11/2026 y la
`90`/`91` el 29/11/2026.

La `82_porteo_campos_mesas` se aplicó el 27/11/2026 en una única transacción
con `COMMIT`: creó `core.mesa_ficha` (satélite 1:1 del caso espejo) y portó la
ficha de las 21 mesas. Verificado tras el `COMMIT`: 21 fichas alineadas a los
casos `MD-2026-0001..0021`, 0 mesas sin ficha, 0 desalineadas y la clave
`82_porteo_campos_mesas_2026_11_27` en `core.migracion_log`.

> **La regla «más de tres regiones ⇒ Nacional» es ahora un trigger.** La `89`
> marcó las mesas nacionales con un `update` puntual; la `90` añade
> `core.mesa_es_nacional(text)`, el trigger BEFORE que recalcula
> `es_nacional` en cada escritura y el trigger AFTER que fija o limpia
> `core.casos.alcance_override` del caso espejo. La marca es un valor
> **derivado**: una edición manual de `es_nacional` se sobrescribe. Verificado
> con una transacción revertida (`OAIPCS-013` → `ambito = 'Loreto'` desmarca la
> mesa y limpia el override; el `rollback` lo restaura).
>
> La `91` completó las tres mesas que la `89` dejó sin clasificar:
>
> | Mesa         | Ámbito escrito                                   | Fundamento                                                                                                                                            |
> | ------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `OAIPCS-004` | `Nacional`                                       | Comisión Sectorial de Transferencia MYPE e Industria (RM N° 159-2017-PRODUCE): transferencia de competencias a los gobiernos regionales, todo el país |
> | `OAIPCS-005` | `Nacional`                                       | Grupo de Trabajo Multisectorial de la Política Nacional Multisectorial de Descentralización (RM N° 120-2022-PCM)                                      |
> | `OAIPCS-012` | `Apurímac, Ayacucho, Cusco, Junín, Huancavelica` | VRAEM Productivo (DS N° 006-2023-PCM): el valle abarca cinco departamentos                                                                            |
>
> Resultado: **nueve** mesas nacionales (001, 002, 003, 004, 005, 012, 013,
> 015 y 034), todas con su caso espejo en alcance 5, y cero discrepancias entre
> la marca almacenada y la regla.

> **El número `89` quedó para las mesas nacionales.** La búsqueda de alertas
> por nombre de sectorista necesitaba resolver `core.usuarios.nombre` para roles
> distintos de `administrador` (la política `p18_usuarios_sel` sólo deja ver la
> fila propia). Se resolvió con `core.nombres_sectoristas()` de la **74**, que ya
> está aplicada y es `security definer`: `listAlerts` la usa como `left join` y
> como columna de búsqueda, con el join original a `core.usuarios` como respaldo.
> No hizo falta DDL por ese motivo, así que el `89` se usó para la marca de mesas
> nacionales (`migration/89_mesas_nacionales_2026_11_29.sql`): añade
> `core.mesas_dialogo.es_nacional` y `core.casos.alcance_override`, y ajusta
> `core.alcance_caso()` para respetar el override.

### 2.3 Diseñadas, no aplicadas

No hay migraciones diseñadas y sin aplicar en este momento. Las propuestas del
Bloque C (riesgo concreto, tipologías de actor, artes de pesca, datos de
organización, locales, motivo de descarte en el alta de alertas) siguen **sin
decisión funcional**, así que no se numeran todavía.

## 3. Claves huérfanas del plan

El plan original hablaba de `71_proceso_instancia_cascada` y
`72_cronologia_vinculos_cascada`. **No existen en `migracion_log`** y no hace
falta crearlas: la `66_fk_borrado_cascada_2026_11_26` absorbió su contenido.
Si alguna herramienta busca esas claves, debe leer la 66.

## 4. Correspondencia con el plan de cambios

La numeración del plan (Anexo A) quedó desfasada al ejecutarse los cambios:

| Plan                                        | Migración real                               | Estado                          |
| ------------------------------------------- | -------------------------------------------- | ------------------------------- |
| 71 — `core.casos.priorizado`                | `76_caso_priorizado_2026_11_26`              | Aplicada                        |
| 72 — CHECK de `core.casos_actores.posicion` | `77_casos_actores_posicion_guia_2026_11_26`  | Aplicada                        |
| 73 — `core.alerta_hechos`                   | `73_alerta_hechos_2026_11_26` (+ 79, 80, 83) | Aplicada; 83 pendiente          |
| 74+ — Bloque C                              | Sin asignar                                  | Pendiente de decisión funcional |

## 5. Decisiones de fechas ratificadas

### 5.1 `valid_to` es un fin **exclusivo**

Una membresía se cierra con `valid_to = current_date` y la nueva arranca con
`valid_from = current_date`. Por eso todos los predicados de vigencia usan
`valid_to > current_date` (estrictamente mayor) y `valid_from <= current_date`.

Predicados verificados en el código:

| Archivo                                                                                                                          | Uso                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `lib/db/repos/actors.ts` (`ACTOR_FROM`, `membresiaVigenteDe`, `cerrarMembresiaVigente`, `listActors`, `listMembresiasDeActores`) | Membresías del directorio |
| `lib/db/repos/cases.ts` (`getCaseByCode`, organización ancla del actor)                                                          | Ficha del caso            |

El mismo criterio rige en `core.actor_membresia`, `config.parametro`,
`domain.artefacto` y `kag`. **No cambiar a `>=`**: duplicaría la vigencia el día
del reemplazo.

### 5.2 Zona horaria

- Backend: los instantes se emiten en UTC (ISO-8601) y las fechas de negocio
  con `to_char(..., 'YYYY-MM-DD')`. Donde importa el instante local se usa
  `at time zone 'America/Lima'` (p. ej. `fecha_ultima_actualizacion`).
- Frontend: `core/fecha/zona-horaria.ts` es el único traductor. `hoyIso()` y
  `diaIso(fecha)` devuelven el día de Lima; **no usar
  `new Date().toISOString().slice(0, 10)`**, que desde las 19:00 devuelve el
  día siguiente.
- `shared/formato-fecha.ts` es el formato único de lectura (`02NOV2025`) y
  `formatearFechaHora` ya compone la hora con `partesEnZona` (zona de Lima), no
  con la hora local del navegador.

## 6. Cómo aplicar una migración (procedimiento)

```sh
# 1. Respaldo lógico del esquema afectado (fuera de este repositorio).
# 2. Aplicar con la URL de propietario, en orden y con ON_ERROR_STOP.
psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -f migration/84_indices_rendimiento_2026_11_27.sql

# 3. Registrar la clave en core.migracion_log (la hace el runner del proyecto;
#    si se aplica a mano, insertarla con la misma convención).
```

Después de aplicar: actualizar este documento y volver a correr el _contract
check_ (los `SELECT` principales de los listados) para detectar `42703`.

## 7. Operaciones de datos aplicadas el 2026-11-28

| Fecha      | Script                                                 | Filas afectadas                                                                                                                                             | Cómo revertir                                                                                                                      |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-28 | `scripts/_b5_anclas_membresias_2026-11-28.mjs --apply` | `core.actores.organizacion_ancla_uid`: 292 personas. `core.actores.caso_ancla_id`: 45 actores. `core.actor_membresia.cargo`: 249 membresías. `valid_to`: 0. | `node scripts/_b5_anclas_membresias_2026-11-28.mjs --rollback` (lee `backups/b5_anclas_membresias_2026-11-28T10-00-12-397Z.json`). |
| 2026-11-28 | `scripts/_b7_restaurar_ruc_2026-11-28.mjs --apply`     | 0 filas.                                                                                                                                                    | No aplica: no se escribió nada.                                                                                                    |

- **B5:** la organización ancla sale de la membresía vigente más reciente de cada
  persona; el caso ancla, del caso con más vínculos vigentes (empate: el más
  reciente por `fecha_inicio`); el cargo, de `core.actores.cargo_actual` con
  respaldo en `legacy.dim_actores.c06`. `valid_to` no se tocó: ni el legado ni
  ninguna otra tabla traen fecha de cese.
- **B7:** el RUC del legado es `legacy.dim_organizacion.c14` (5 filas) y ya
  estaba completo. Las 22 filas de `c07` son inscripciones SUNARP, ya cargadas
  en `core.organizaciones.inscripcion_sunarp`; no son RUC y cargarlas como tal
  habría corrompido el dato.
- **OSPA:** `expediente_ospa` y `estado_ospa` siguen vacíos por falta de fuente;
  ver `docs/06_operacion/OSPA-sin-fuente-2026-11-28.md`.
