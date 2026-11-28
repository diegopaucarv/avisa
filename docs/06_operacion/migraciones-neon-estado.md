# Estado de las migraciones en Neon

> Última verificación: **28/11/2026**, contra `core.migracion_log` de la base
> de producción en Neon (consulta de sólo lectura).
>
> Este documento es la fuente única para saber **qué está aplicado**, **qué
> falta** y **qué número sigue**. Cuando se aplique una migración, se actualiza
> aquí y se registra en `core.migracion_log`.

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

| Clave en `migracion_log`                                          | Tema                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `40_casos_naturaleza` … `70_sembrar_secuencia_codigos_2026_11_26` | Serie histórica (ver tabla completa abajo)                      |
| `73_alerta_hechos_2026_11_26`                                     | Tabla `core.alerta_hechos`                                      |
| `74_usuarios_sectoristas_lectura_2026_11_27`                      | Lectura de usuarios sectoristas                                 |
| `75_unificar_territorio_gis_2026_11_27`                           | Unificación de territorio/GIS                                   |
| `76_caso_priorizado_2026_11_26`                                   | `core.casos.priorizado`                                         |
| `77_casos_actores_posicion_guia_2026_11_26`                       | `posicion` con el vocabulario de la Guía                        |
| `78_alertas_anulacion_direccion_2026_11_27`                       | Anulación de alertas por Dirección                              |
| `79_alerta_hechos_fechas_2026_11_27`                              | Fechas de los hechos                                            |
| `80_alerta_hechos_sin_anio_2026_11_27`                            | Hechos sin año                                                  |
| `81_mesas_como_casos_2026_11_27`                                  | Mesas como casos                                                |
| `82_porteo_campos_mesas_2026_11_27`                               | Satélite `core.mesa_ficha` y porteo de la ficha de mesas        |
| `83_alerta_hechos_lineas_heredadas_2026_11_27`                    | Reinserta líneas de `hechos_recientes` que la 73 descartó       |
| `84_indices_rendimiento_2026_11_27`                               | Índices de listados y panel de alertas                          |
| `85_c8_hechos_fecha_compacta_2026_11_27`                          | Mueve la fecha compacta (`* 05NOV2026`) a `alerta_hechos.fecha` |
| `86_c8_hechos_vineta_asterisco_2026_11_27`                        | Quita la viñeta `*` inicial de los hechos                       |
| `87_ampliar_textos_carga_historica_2026_11_27`                    | `cargo_actual` y `reuniones_dialogo.titulo` pasan a `text`      |

Claves históricas fuera de la serie numérica, también aplicadas:
`casos_tematica_anulable`, `distritos_inei_2025`.

### 2.2 Pendientes de aplicar

No hay migraciones pendientes de aplicar. La `82_porteo_campos_mesas` se aplicó
el 27/11/2026 en una única transacción con `COMMIT`: creó `core.mesa_ficha`
(satélite 1:1 del caso espejo) y portó la ficha de las 21 mesas. Verificado tras
el `COMMIT`: 21 fichas alineadas a los casos `MD-2026-0001..0021`, 0 mesas sin
ficha, 0 desalineadas y la clave `82_porteo_campos_mesas_2026_11_27` en
`core.migracion_log`.

### 2.3 Diseñadas, no aplicadas

No hay migraciones diseñadas y sin aplicar en este momento. Las propuestas del
Bloque C (riesgo concreto, tipologías de actor, artes de pesca, datos de
organización, locales) siguen **sin decisión funcional**, así que no se
numeran todavía.

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
