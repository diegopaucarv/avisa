# Contrato de API de la SPA Angular

**Estado (2026-11-22):** vigente · inventario de traspaso.
**Autoridad:** la fuente de verdad es el código de la SPA (`angular/src/app/**`). Este documento lo transcribe; no lo interpreta. La implementación de referencia es `app/api/**` de la app Next congelada.
**Destino:** el equipo que reescribe la API en **.NET sobre un servidor de PRODUCE** (`docs/06_operacion/DESPLIEGUE_VERCEL_NEON.md` §8).

## 0 · Propósito y regla de evidencia

La SPA no conoce Next ni Vercel: conoce rutas `/api/**` y formas JSON. Este documento fija **qué llama la SPA, con qué parámetros y qué forma espera de vuelta**, para que el reemplazo en .NET no obligue a tocar `angular/`.

Tres reglas:

1. **Cada fila está anclada a código.** Si hay contradicción entre este documento y `angular/src/app`, manda el código; se corrige aquí.
2. **Las formas de respuesta se citan por su mapeo**, no campo a campo: el mapeo es el traductor y el único lugar donde un cambio de contrato se absorbe.
3. **Lo que la SPA no envía, no se inventa.** Cuando el servidor admite un filtro que hoy nadie usa, se marca como tal: es superficie disponible, no requisito.

Las líneas citadas corresponden al árbol de esta fecha. Si `archivo:línea` no coincide, mandan el archivo y el literal de la ruta.

---

## 1 · Alcance

Veintiséis pantallas, una sola API. Recursos consumidos: casos, alertas, compromisos, demandas, documentos, actores, organizaciones, locales, reportes, notificaciones, catálogos, búsqueda y exportación.

Prefijo: `urlApi()` antepone `ENTORNO.apiBase` (por defecto `/api`) —`angular/src/app/core/config/entorno.ts:41-46`. Las rutas de este documento ya lo incluyen.

**Verificación de cobertura:** las 34 rutas documentadas existen como `route.ts` en `app/api/**`. No hay ninguna ruta inventada ni ninguna llamada de la SPA sin implementación.

---

## 2 · Autenticación y sesión

| Método | Ruta               | Cuerpo              | Respuesta                                                                                | Archivo:línea                                                     |
| ------ | ------------------ | ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST` | `/api/auth/login`  | `{ dni, password }` | **objeto plano** `{ dni, nombre, rol, id, area, cargo, regiones?, roles?, rolCodigo? }`  | `core/auth/sesion.store.ts:58`, `core/auth/sesion.model.ts:32-42` |
| `GET`  | `/api/v1/session`  | —                   | `{ user: { dni, nombre, rol, roles?, id, area, cargo, regiones? }, scope?, expiresAt? }` | `core/auth/sesion.store.ts:41`, `sesion.model.ts:16-29`           |
| `POST` | `/api/auth/logout` | `{}`                | cualquiera (la UI limpia en local)                                                       | `sesion.store.ts:70-76`                                           |

Reglas que .NET debe reproducir:

- **Login plano, sesión envuelta.** El login devuelve el usuario en la raíz; la hidratación lo devuelve bajo `user`. Invertirlos rompe el arranque.
- **Cookie, no bearer.** `avisa_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` en producción, `exp` **en milisegundos**. El payload va firmado: `{uid, rol, roles[], nom, cod, dn, area, cargo, regs[], exp}`.
- **`withCredentials` selectivo.** El interceptor solo lo activa si la URL empieza por `/api` o es absoluta (`core/auth/sesion.interceptor.ts:16-20`). Si `apiBase` cambia de forma, hay que revisarlo.
- **401 = sesión inexistente.** El interceptor limpia el estado local y **no redirige** (`sesion.interceptor.ts:22-26`); el guard decide al navegar (`core/auth/sesion.guard.ts:11-27`).
- **403 no se trata en el interceptor.** Cada pantalla decide el mensaje.
- **`expiresAt` se tipa pero no se usa.** No hay expiración proactiva: la SPA depende de un 401 en la siguiente petición.
- Los roles de base (`direccion_oaipcs`, `sectorista`, `administrador`, `alta_direccion`) viajan en `roles[]`; las capacidades se calculan en cliente (`core/permisos/capacidades.service.ts:32-103`). **La API no debe confiar en esa decisión**: debe imponer la autorización.

---

## 3 · Convenciones transversales

### 3.1 · Sobre paginado

`core/http/coleccion.ts` normaliza **una sola** forma para todas las listas:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 25,
  "pagina": 1,
  "tamanoPagina": 25,
  "generatedAt": "2026-11-22T00:00:00Z"
}
```

El servidor emite `items`/`page`/`pageSize` y añade los alias `pagina`/`tamanoPagina` (`lib/db/http.ts:102-106`). El cliente acepta además `elementos`, `data`, `generatedAt|generadoEn` y un array suelto (`coleccion.ts:41-74`). **Para .NET basta `items`/`page`/`pageSize`/`total`/`generatedAt`**; los alias españoles son compatibilidad, no requisito.

Sobres con campos extra, que también son contrato:

| Endpoint       | Campo extra                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| `/v1/cases`    | `conteos: { todos, abiertos, resueltos, archivados }` (solo con `conteos=true`) |
| `/v1/demandas` | `sinCasoTotal`, `vinculadasTotal`                                               |

### 3.2 · Paginación duplicada

La SPA envía **siempre cuatro** claves (`coleccion.ts:82-89`):

```
pagina=1&page=1&tamano=25&pageSize=25
```

El servidor prioriza `pagina`/`tamano` y acota `pageSize` a 1–100, por defecto 25 (`lib/db/http.ts:68-96`). .NET debe **aceptar ambas grafías** (o ignorar una de forma determinista): si las trata como filtros distintos, cualquier listado se rompe.

### 3.3 · Booleanos y fechas

- Booleanos tolerantes en query: `true/1/si/sí/on`; todo lo demás es `false` (`lib/db/http.ts:31-40`).
- Fechas en query y en cuerpo: **`YYYY-MM-DD`**. En `commitments` el rango invertido es `400 INVALID_DATE_RANGE`.
- El cliente serializa el cuerpo en JSON; los `POST` de restauración pueden llegar como `{}` o con cuerpo nulo.

### 3.4 · Filtros y valores literales

Los filtros de catálogo viajan como **etiquetas exactas**, no como códigos, y con acentos y espacios: `estado=Pendiente de revisión`, `estado=En proceso`, `prioridad=Urgente`, `tematica=Ordenamiento y acceso territorial`, `nivelGobierno=Sociedad Civil`. Se URL-encodean con `URLSearchParams`. Comparar tras decodificar, sin normalizar a la ligera.

`sort` es la única clave en inglés. Valores usados hoy:

| Recurso                                                             | Valores                      |
| ------------------------------------------------------------------- | ---------------------------- |
| `/v1/cases`                                                         | `recent`, `risk`, `priority` |
| `/v1/alerts`                                                        | `recent`, `prioridad`        |
| `/v1/demandas`, `/v1/documents`, `/v1/actors`, `/v1/organizaciones` | `recent`, `code`             |

### 3.5 · Errores

Forma única: `{ "detail": "texto para el usuario", "code": "CODIGO" }` (`lib/db/errors.ts:20-26`). El cliente lee `detail` → `mensaje` → respaldo, y guarda `code` en `ErrorApi.codigo` (`core/http/errores.ts:25-53`).

| HTTP | `code`                                              | Cuándo                                                       |
| ---- | --------------------------------------------------- | ------------------------------------------------------------ |
| 400  | `INVALID_BODY`                                      | cuerpo mal formado o campo obligatorio ausente               |
| 400  | `SIN_CAMBIOS`                                       | `PATCH` sin diferencias (lo compara la SPA)                  |
| 400  | `MOTIVO_REQUERIDO`                                  | anulación sin motivo                                         |
| 400  | `INVALID_DATE_RANGE`                                | `vencimiento_desde > vencimiento_hasta`                      |
| 400  | `FORMATO_INVALIDO`, `ENTIDAD_INVALIDA`              | exportación                                                  |
| 401  | `NO_SESSION`                                        | cookie ausente o inválida                                    |
| 403  | _(sin `code`)_                                      | rol sin permiso; el detalle viene en `detail`                |
| 404  | `NOT_FOUND`                                         | registro inexistente o por encima del nivel de clasificación |
| 409  | `ALERT_VISIBILITY`                                  | la alerta no cumple las firmas de visibilidad                |
| 409  | _(sin `code`)_                                      | unicidad o FK (`23505`/`23503`)                              |
| 422  | `INVALID_INPUT`, `FILTRO_INVALIDO`, `INVALID_QUERY` | validación de dominio, catálogo o término de búsqueda        |
| 500  | `ANULAR_FAILED`                                     | fallo de la operación de anulación                           |
| 503  | `CONFIG` u otros                                    | base no disponible o capa sin inicializar                    |

**Códigos que la SPA compara explícitamente:** `SIN_CAMBIOS`, `INVALID_INPUT` (o `422`), `ALERT_VISIBILITY` (con `409`). El resto se muestra como texto. Traducciones de PostgreSQL que hoy producen estos estados: `42501→403`, `22023→422`, `P0002→404`, `22P02|23514→422`, `23505|23503→409`, `42883|42P01|28P01|28000→503` (`lib/db/errors.ts:35-91`).

### 3.6 · Autorización

Dos capas, y las dos deben sobrevivir a la migración:

1. **RLS en la base.** Toda consulta va dentro de `withSession({ usuarioId, rolCodigo })`. Un registro fuera del alcance responde 404, no 403.
2. **Comprobación en la ruta.** `anulados=true` exige capacidad de anulación y responde **403** sin `code` si el rol no la tiene (`app/api/v1/cases/route.ts:64-72` y equivalentes en alertas, compromisos, demandas y documentos).

La SPA oculta controles por rol, pero eso es cosmético: **la API debe seguir rechazando**.

---

## 4 · Recursos

### 4.1 · Casos

| Método  | Ruta                             | Query / cuerpo                                  | Respuesta                   | Uso                                                            |
| ------- | -------------------------------- | ----------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `GET`   | `/v1/cases`                      | ver abajo                                       | sobre paginado (+`conteos`) | `/casos`, `/mapa`, `/resumen`, `/direccion`, `/casos/sin-caso` |
| `GET`   | `/v1/cases/{codigo}`             | —                                               | ficha compuesta (ver abajo) | `/casos/{codigo}`, ficha de alerta                             |
| `POST`  | `/v1/cases/{codigo}/events`      | `{ fecha, tipoHecho, descripcion, evidencia? }` | —                           | cronología                                                     |
| `PATCH` | `/v1/cases/{codigo}/events/{id}` | diff parcial de los mismos campos               | —                           | cronología                                                     |
| `POST`  | `/v1/cases/{codigo}/anular`      | `{ motivo }`                                    | —                           | anulación                                                      |
| `POST`  | `/v1/cases/{codigo}/restaurar`   | `{}`                                            | —                           | restauración                                                   |

**Filtros de `GET /v1/cases`**

| Clave                                        | Origen                        | ¿La envía la SPA?            |
| -------------------------------------------- | ----------------------------- | ---------------------------- |
| `q`                                          | input de búsqueda (300 ms)    | sí                           |
| `estado`                                     | desplegable de estado         | sí                           |
| `abiertos`                                   | opción «Abiertos»             | sí                           |
| `nivel`                                      | desplegable de conflictividad | sí (item 100)                |
| `prioridad`, `alcance`, `tematica`, `unidad` | selects de búsqueda avanzada  | sí                           |
| `region`                                     | select de búsqueda avanzada   | sí                           |
| `sort`                                       | select de orden               | sí                           |
| `anulados`                                   | pestaña de papelera           | sí (`true` solo en papelera) |
| `conteos`                                    | desplegable de estado         | sí (`true`)                  |
| `riesgo`                                     | —                             | **no** (solo `/direccion`)   |

Archivo: `angular/src/app/features/casos/casos.page.ts:293-313`; servidor: `app/api/v1/cases/route.ts:40-80`.

`abiertos=true` no es una etiqueta de `estado`: se resuelve con `es_activo` del catálogo. `nivel` viaja con el **`codigo` de `core.cat_niveles_conflicto`**, que en esta base coincide con el nombre visible (`Diferencia`, `Controversia`, `Conflicto social`, `Crisis social`, con acentos y espacios); el repositorio lo resuelve con `core.normalizar_ref` contra `codigo` y `nombre`, igual que `riesgo`, y responde `422` si el valor no existe. No se filtra en cliente para que `conteos` y la paginación sigan siendo ciertos. `conteos=true` no filtra: añade el bloque `conteos` calculado **sin** `estado` ni `abiertos`, para que las opciones del desplegable no se muevan al elegirlas.

> **Requiere redeploy.** `nivel` es superficie nueva en `lib/db/repos/cases.ts`, `app/api/v1/cases/route.ts` y `app/api/v1/export/route.ts`. Hasta desplegar, la SPA puede enviar `nivel` y el servidor antiguo lo ignora (la lista llega sin recortar); no rompe la pantalla, pero el filtro no surte efecto.

**Forma de la ficha** —claves de primer nivel (`angular/src/app/dominio/mapeo.ts:451-506`):

```
caso | case, actores | actors, eventos | events, demandas,
alertas | alerts, compromisos | commitments, documentos | documents,
historial | stateHistory | state_history, completitud | completeness
```

`completitud` es parte del contrato de facto: `hechos{total,validados}`, `actores{total,conTipoYFuncion}`, `demandas{total,con3PCompletos}`, `geografia{tieneGeografia,regiones,distrito}`, `marcoSituacional{consistencia,correspondencia,coherenciaContextual,saturacion,trazabilidad}`.

**Campos de fila y de ficha** (`dominio/mapeo.ts:314-560`): cada campo acepta alias camelCase y snake_case (`codigo|code`, `nivelConflicto|nivel_conflicto`, `anuladoPorNombre|anulado_por_nombre`, `fechaInicio|fecha_inicio|inicio`, `actualizado|updated|actualizadoEn`…). Esa tolerancia **no es el contrato**: la grafía queda fijada en la decisión **C1** (§7.1) —la que cada repositorio emite hoy— y no se añade una segunda.

### 4.2 · Alertas

| Método   | Ruta                        | Query / cuerpo                                         | Respuesta                         |
| -------- | --------------------------- | ------------------------------------------------------ | --------------------------------- |
| `GET`    | `/v1/alerts`                | `q, prioridad, nivel, estado, sinCaso, sort, anulados` | sobre paginado                    |
| `GET`    | `/v1/alerts/{id}`           | —                                                      | `{ alert \| alerta, demandas[] }` |
| `PATCH`  | `/v1/alerts/{id}`           | campos de edición (abajo)                              | —                                 |
| `DELETE` | `/v1/alerts/{id}`           | `{ motivo }` **en el cuerpo**                          | —                                 |
| `POST`   | `/v1/alerts/{id}/restaurar` | `{}`                                                   | —                                 |

Servidor admite además `caso` (`app/api/v1/alerts/route.ts:20`), que la SPA envía solo cuando llega por URL. `sinCaso` (`true` = sin caso, `false` = con caso) usa el mismo vocabulario que `/v1/demandas`; el repositorio lo resuelve con `a.caso_id is null` / `is not null` (`lib/db/repos/alerts.ts`).

**Cuerpo de `PATCH`** (`alerta-panel.component.ts:473-511`): `titulo`, `prioridad`, `nivel` (código `NA-001…NA-004`), `situacionActual`, `hechosRecientes`, `descripcionRiesgo`, `accionesOaipcs`, `accionesSugeridas` (`string[] | null`), `casoCode`, y `{ pasoActual }` en las acciones de flujo. Solo viajan los campos cambiados.

`DELETE` con cuerpo JSON es deliberado; algunos proxies lo descartan. .NET debe aceptarlo o acordar alternativa. `motivo` es obligatorio en la anulación y la SPA exige además ≥10 caracteres antes de enviarlo (`shared/ui/anular-panel.component.ts:136-162`).

### 4.3 · Compromisos

| Método   | Ruta                                  | Query / cuerpo                                                                                                                                |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/v1/commitments`                     | `q, estado, tipo, nivelGobierno, atiendeGenero, anulados, excluir_terminales, vencimiento_desde, vencimiento_hasta`                           |
| `GET`    | `/v1/commitments/{id}`                | — → `{ commitment \| compromiso, caso, documentoOrigen }`                                                                                     |
| `PATCH`  | `/v1/commitments/{id}`                | `accion, tipo, estado, unidad, nivelGobierno, alcance, tematica, atiendeGenero, criteriosSmart, evidenciaUri, fechaVencimiento, fechaInicio?` |
| `POST`   | `/v1/commitments/{id}/hitos`          | `{ descripcion, estado, fecha? }`                                                                                                             |
| `PATCH`  | `/v1/commitments/{id}/hitos/{hitoId}` | `{ estado }`                                                                                                                                  |
| `DELETE` | `/v1/commitments/{id}`                | `{ motivo }`                                                                                                                                  |
| `POST`   | `/v1/commitments/{id}/restaurar`      | `{}`                                                                                                                                          |

Servidor admite además `caso` y `unidad` en el listado, que la SPA no envía hoy (`app/api/v1/commitments/route.ts:19-27`).

`criteriosSmart` es **JSON libre**: se lee como objeto y se reenvía tal cual, sin transformar. Los hitos sin `fecha` se descartan en el mapeo y `proximoHito` exige fecha (`compromiso.mapeo.ts:219-228`).

Variantes de la misma ruta que la SPA usa para cambiar de petición, no de endpoint:

- **Calendario**: añade `vencimiento_desde`/`vencimiento_hasta` y páginas de 100.
- **Desglose**: páginas de 100, sin fechas.
- **Archivo**: `anulados=true`; en ese modo el calendario y el desglose no se consultan.

### 4.4 · Demandas

| Método  | Ruta                          | Query / cuerpo                                                                   |
| ------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `GET`   | `/v1/demandas`                | `q, estado, sinCaso, sort` (+ sobre con `sinCasoTotal`/`vinculadasTotal`)        |
| `POST`  | `/v1/demandas`                | `{ casoCode?, descripcion, problema, estado, propuesta?, pedido? }`              |
| `PATCH` | `/v1/demandas/{id}`           | diff de `problema, propuesta, pedido, estado` **o** `{ casoCode }` para vincular |
| `POST`  | `/v1/demandas/{id}/restaurar` | `{}`                                                                             |

`descripcion` es obligatoria en el alta. `sinCaso=true` es el filtro de la pantalla `/casos/sin-caso`; la vinculación a un caso se hace con `PATCH { casoCode }`. El `sinCaso` de cada fila se **deriva** de que falte `casoCode|caso_code` (`dominio/mapeo.ts:344-356`).

### 4.5 · Documentos

| Método   | Ruta                           | Query / cuerpo                                                                                                                 |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/v1/documents`                | `q, tipo, estado, sort, anulados`                                                                                              |
| `GET`    | `/v1/documents/{id}`           | — → `{ document \| documento, fuentes[] }`                                                                                     |
| `PATCH`  | `/v1/documents/{id}`           | `titulo, tipo, fecha` (no admiten `null`) · `resumen, archivo, casoCode` (`null` vacía) · `{ estado }` para Validado/Rechazado |
| `DELETE` | `/v1/documents/{id}`           | `{ motivo }`                                                                                                                   |
| `POST`   | `/v1/documents/{id}/restaurar` | `{}`                                                                                                                           |

El `caso` existe como filtro de servidor y la pantalla no lo expone (`app/api/v1/documents/route.ts:19`). `estadoUi` cae a `estado` y luego a `Cargado` (`documento.mapeo.ts:173-181`).

### 4.6 · Directorio

| Método  | Ruta                   | Query                                 | Escritura                    |
| ------- | ---------------------- | ------------------------------------- | ---------------------------- |
| `GET`   | `/v1/actors`           | `q, naturaleza, tipo, region`         | no                           |
| `GET`   | `/v1/actors/{uid}`     | —                                     | no (la SPA no lo llama)      |
| `PATCH` | `/v1/actors/{uid}`     | JSON con atributos públicos editables | sí, sujeta a RLS y auditoría |
| `GET`   | `/v1/actors/{uid}/pii` | `motivo=<texto>`                      | no                           |
| `GET`   | `/v1/organizaciones`   | `q, tipo, activo, vigente`            | no                           |
| `GET`   | `/v1/locales`          | `q, activo`                           | no                           |

- `PATCH /v1/actors/{uid}` admite `nombre`, `abreviatura`, `naturaleza`, `tipo`, `funcion`, `posicionamiento`, `cargo`, `nivelGobierno`, `categoria`, `perfilDescripcion` y `activo`. Los catálogos se validan en servidor; la clasificación se conserva y RLS aplica el permiso de edición. Cada cambio registra `audit.cambios` en la misma transacción.
- La mutación no acepta DNI, correo, teléfono, membresías ni ubicación por ID. Esos datos requieren su flujo separado de PII o relaciones y no deben añadirse a este payload.
- El directorio conserva lectura en organizaciones, instituciones y locales; solo Actores ofrece edición de los campos públicos enumerados.
- El servidor admite además `sort` en actores y organizaciones; la SPA no lo envía hoy.
- **PII**: `GET /v1/actors/{uid}/pii?motivo=…` responde `{ pii: { dni, email, telefono }, generatedAt }`. Un actor sin ficha devuelve **200 con los tres en `null`**, no 404. `motivo` es obligatorio (principio de finalidad): sin él, `422` por `22023`. El rol sin privilegio recibe `403` por `42501`.
- **Instituciones** fuerza `tipo=Actor público` en la query y limpia `tipo` de la URL (`instituciones.page.ts:162-168`).
- `activo`/`vigente` viajan como `true`/`false` en texto.
- Los booleanos de local (`tieneProyector`, `tieneEquiposComputo`, `tieneAudioMicro`) son **tri-estado**: `true`, `false` y `null` significan «sí», «no» y «no declarado». No colapsar `null` a `false`.

### 4.7 · Reportes

`GET /v1/reportes` —filtros `q, tipo, region, desde, hasta`; solo lectura— sobre `analytics.vw_anexo_17_registro_reportes`, que desde la migración 23 es `security_invoker` y por tanto respeta la RLS de las tablas base (`app/api/v1/reportes/route.ts:18-27`).

### 4.8 · Notificaciones

`GET /v1/notifications` —solo paginación—. No hay `PATCH`, `POST` ni «marcar leída»: la pantalla es de lectura (`app/api/v1/notifications/route.ts:15-37`). Las filas aceptan camelCase y snake_case (`entidadTipo|entidad_tipo`, `venceEn|vence_en`, `createdAt|created_at`).

### 4.9 · Catálogos

`GET /v1/catalogs` devuelve `{ catalogs: { … }, catalogos?: … }` con `{ id, codigo, etiqueta }` por ítem. Claves que la SPA consume hoy:

| Clave                                                      | Dónde                              |
| ---------------------------------------------------------- | ---------------------------------- |
| `prioridadesAtencion`, `alcances`, `tematicas`, `unidades` | filtros de `/casos`                |
| `tiposHecho`                                               | panel de cronología                |
| `tiposDocumento`                                           | `/documentos` y panel de documento |
| `tiposActor`                                               | `/directorio/actores`              |
| `unidades`, `tematicas`                                    | panel de compromiso                |

El servidor expone además `estadosCaso`, `nivelesRiesgo`, `nivelesConflicto`, `prioridadesAlerta`, `subsectores`, `ciclos`, `estadosCompromiso`, `estadosHito`, `rolesActor`, `perfilesActor` (`lib/db/repos/catalogs.ts:16-32`), sin consumo actual. Es superficie disponible: no se debe retirar sin comprobar los mapeos.

### 4.10 · Búsqueda global

| Método | Ruta                                                                                        | Query                            |
| ------ | ------------------------------------------------------------------------------------------- | -------------------------------- |
| `GET`  | `/v1/search`                                                                                | `q` (≥2 caracteres) + paginación |
| `GET`  | `/v1/cases`, `/v1/alerts`, `/v1/commitments`, `/v1/documents`, `/v1/actors`, `/v1/demandas` | `q` (≥2) + paginación de 5       |

`/v1/search` es el **índice**: devuelve `{ type, id, code, region }` por coincidencia y es la única fuente de la región heredada; con menos de 2 caracteres responde `422 INVALID_QUERY` (`app/api/v1/search/route.ts:25-32`). Los seis listados dan el total por grupo y la SPA recorta a 5 filas en cliente. `/v1/search` mantiene `limit`/`limitPerType` heredados como tamaño de página si no llega `tamano`/`pageSize`.

### 4.11 · Exportación

`GET /v1/export` — `formato=json|excel|pdf`, `entidad=<…>`, `id=<uuid>` opcional y los filtros activos.

- Entidades: `casos`, `alertas`, `compromisos`, `documentos`, `demandas`, `actores`, `organizaciones`, `locales`, `notificaciones`, `reportes` y `base` (respaldo completo). Se aceptan alias en singular (`caso`, `alerta`…). Un valor desconocido es `400 ENTIDAD_INVALIDA`; un formato desconocido, `400 FORMATO_INVALIDO`.
- La respuesta es **binaria** con `Content-Type` por formato y `Content-Disposition` (`filename*=UTF-8''…` preferido, `filename="…"` como respaldo). Si no hay cabecera, el cliente nombra `avisa_{entidad}_{YYYY-MM-DD}.{json|xlsx|pdf}` (`core/http/descargas.ts:20-54,109-124`).
- La descarga usa `fetch` propio, **no** el interceptor: un 401 aquí no limpia la sesión. Mantener `credentials` y CORS con credenciales si el origen deja de ser el mismo.
- El servidor reenvía solo los filtros que la entidad declara (`app/api/v1/export/route.ts:214-236`). En 2026-11-23 **Casos, Alertas y Compromisos** envían `[consulta]` con los filtros activos (`q`, `estado`, `nivel`, `prioridad`, `alcance`, `region`, `tematica`, `unidad`, `sort`); Demandas sin caso envía `sinCaso=true`. Las demás pantallas siguen exportando la entidad completa.
- **Formatos por perfil (item 107).** `app-exportar-menu` decide qué formatos ofrece según `CapacidadesService.formatosExportacion`: Alta Dirección, Dirección OAIPCS y administración conservan JSON/Excel/PDF; el resto de perfiles ve solo Excel y PDF. Es una regla **de cliente**: el endpoint sigue aceptando los tres formatos para cualquier rol autorizado, así que .NET debe decidir si replica el recorte en servidor.

### 4.12 · Salud

`GET /api/v1/health/db`. No lo consume ninguna pantalla; existe para verificar la conexión tras el despliegue.

---

## 5 · Matriz pantalla → endpoints

| Pantalla                     | Endpoints                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/mapa` (inicio)             | `GET /v1/cases?abiertos=true` paginado de 100 hasta agotar                                                                                              |
| `/resumen`                   | `cases`, `alerts`, `commitments`, `demandas` (4 KPI con `tamano=1`) · `alerts` (5) · `commitments` ×3 (vencidos, próximos 30 d, lista) · export `casos` |
| `/bandeja`                   | `alerts?estado=Pendiente de revisión` · `commitments` ×3 · `demandas?sinCaso=true`                                                                      |
| `/casos`                     | `GET /v1/cases` (+`catalogs`) · `POST /v1/cases/{codigo}/restaurar`                                                                                     |
| `/casos/sin-caso`            | `GET /v1/demandas?sinCaso=true` · `GET /v1/cases` (drawer) · `PATCH /v1/demandas/{id}`                                                                  |
| `/casos/{codigo}`            | `GET /v1/cases/{codigo}` · `catalogs` (al abrir panel) · `events` `POST`/`PATCH` · `demandas` `POST`/`PATCH` · `anular`/`restaurar`                     |
| `/alertas`                   | `GET /v1/alerts` · `GET /v1/alerts/{id}` · `PATCH` · `DELETE`                                                                                           |
| `/compromisos`               | `GET /v1/commitments` (lista, calendario, desglose) · `GET /{id}` · `PATCH` · hitos `POST`/`PATCH` · `DELETE` · `restaurar`                             |
| `/documentos`                | `GET /v1/documents` (+`catalogs`) · `GET /{id}` · `PATCH` · `DELETE` · `restaurar`                                                                      |
| `/archivo`                   | `GET` de los 5 recursos con `anulados=true` · `POST …/restaurar`                                                                                        |
| `/directorio/actores`        | `GET /v1/actors` (+`catalogs`) · `PATCH /v1/actors/{uid}` · `GET /v1/actors/{uid}/pii`                                                                  |
| `/directorio/organizaciones` | `GET /v1/organizaciones`                                                                                                                                |
| `/directorio/instituciones`  | `GET /v1/actors?tipo=Actor público`                                                                                                                     |
| `/directorio/locales`        | `GET /v1/locales`                                                                                                                                       |
| `/direccion`                 | 17 `GET` de `total`: `cases` (×7), `alerts`, `commitments`, `demandas` · export `casos`                                                                 |
| `/notificaciones`            | `GET /v1/notifications` · export `notificaciones`                                                                                                       |
| `/busqueda`                  | `GET /v1/search` + los 6 listados                                                                                                                       |
| `/reportes`                  | `GET /v1/reportes`                                                                                                                                      |
| `/ayuda`, `/preferencias`    | ninguna llamada                                                                                                                                         |
| `/acceso`                    | `POST /api/auth/login`                                                                                                                                  |
| shell                        | `GET /api/v1/session`, `POST /api/auth/logout`                                                                                                          |

---

## 6 · Lo que .NET debe preservar (lista de verificación)

1. **Rutas y métodos** de las §4.1–4.12, incluido el prefijo `/api` y que `login`/`logout` cuelguen de `/api/auth/**`, no de `/v1`.
2. **Sobre paginado** con `items`/`total`/`page`/`pageSize`/`generatedAt`, y el bloque `conteos` cuando llega `conteos=true`.
3. **Aceptar las dos grafías de paginación**, con la española prioritaria y `pageSize` acotado a 100.
4. **Error `{detail, code}`** con los códigos de §3.5; 401 con `NO_SESSION`; 403 sin `code` para permisos.
5. **Cookie firmada** `avisa_session` con `exp` en milisegundos y CORS con credenciales.
6. **Login plano y sesión envuelta** (§2). No unificar.
7. **`anulados=true` exige permiso y responde 403**, con RLS aplicada dentro de la transacción.
8. **Restauración por identificador**: casos por `codigo`, el resto por `id`. Cuerpo vacío tolerado.
9. **`DELETE` con cuerpo** `{motivo}` en alertas, compromisos y documentos.
10. **`conteos` calculado sin `estado` ni `abiertos`**, para que los chips no se recalculen con el filtro activo.
11. **`sinCasoTotal` y `vinculadasTotal`** en `/v1/demandas`.
12. **`/v1/search` como índice** `type,id,code,region` y `422` por término corto.
13. **Exportación binaria** con `Content-Disposition` y los tres formatos, más `entidad=base`.
14. **Fechas `YYYY-MM-DD`** y validación de rango en compromisos.
15. **`criteriosSmart` como JSON libre**, sin reinterpretar.
16. **`null` con significado** en los tres booleanos de local y en los campos anulables de documento.
17. **El riesgo no se recalcula en cliente**; si .NET lo recalcula, debe hacerlo en servidor con la misma regla del legado.
18. **Los filtros de catálogo se comparan como etiquetas exactas**, no como códigos.

---

## 7 · Decisiones cerradas y lo que sigue abierto

### 7.1 · Decisiones cerradas

Aprobadas el 2026-11-22. No se reabren al escribir la API nueva; si alguna debe cambiar, se anota aquí y se ajustan los mapeos en el mismo cambio.

| #   | Tema                                   | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Motivo                                                                                                                                                                                                     |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Grafía de los campos de respuesta      | Se **congela la que hoy emite cada repositorio**, sin añadir una segunda. En casos: identidad y textos en inglés (`id`, `code`, `title`, `summary`, `progress`, `updated`, `updatedAt`, `region`, `risk`, `stage`) y dominio en español (`estado`, `prioridad`, `alcance`, `nivelConflicto`, `tematica`, `subsector`, `unidadResponsable`, `fechaInicio`, `anuladoEn`, `motivoAnulacion`, `anuladoPor`, `anulacionId`). Los campos nuevos van en camelCase. Los alias de los mapeos siguen siendo tolerancia, no contrato. | El mapeo acepta `codigo \| code` para sobrevivir a la transición; con dos grafías conviven dos contratos y los defectos aparecen solo por una de las ramas. Verificado en `lib/db/repos/cases.ts:334-362`. |
| C2  | Filtros publicados sin uso en pantalla | Se **conservan todos**: `region` y `riesgo` en `/v1/cases`; `caso`, `unidad` y `sort` en los listados que ya los aceptan; `sort` en actores y organizaciones; `limit`/`limitPerType` heredados en `/v1/search`.                                                                                                                                                                                                                                                                                                            | Ya están implementados y probados; `riesgo` lo usa Dirección y el resto es la vía de consulta que la SPA necesitará sin inventar endpoints. Retirarlos ahorra poco y cierra puertas.                       |
| C3  | `GET /v1/actors/{uid}`                 | Se **conserva**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Es la ficha del actor y la base del enlace desde el detalle del caso (`item 12`); que hoy no se llame no la hace sobrante.                                                                                 |

### 7.2 · Lo que sigue abierto

Deudas reales. Ninguna bloquea al equipo de .NET: tres se resuelven solo en la SPA (F1, F2, F4), tres dependen de la SPA y de la API a la vez (F3, F5, F6) y una es solo de la API (F7).

| #   | Falta                                                         | Dónde                                    | Acción                                                                                                             | ¿Bloquea a .NET?                                               |
| --- | ------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| F1  | «Esta vista» exporta la entidad completa fuera de Compromisos | SPA (`app-exportar-menu` en las páginas) | ◐ Hecho en Casos, Alertas, Compromisos y Demandas sin caso (2026-11-23); faltan Documentos, Directorios y Reportes | No: `/v1/export` ya reenvía los filtros que la entidad declara |
| F2  | La exportación de «demandas sin caso» no envía `sinCaso=true` | SPA (`demandas-sin-caso.page.html`)      | ✔ Hecho 2026-11-23: `filtrosExportacion` declara `sinCaso=true`                                                    | No                                                             |
| F3  | La papelera se puede forzar por URL sin permiso               | SPA + API                                | la API ya responde 403; la SPA debería no construir la consulta si el rol no puede                                 | No: no relajar el 403                                          |
| F4  | `consulta()` declara `mantener` y no lo implementa            | SPA (`core/http/consulta.ts`)            | retirar la opción o implementarla; no cambia el comportamiento actual                                              | No                                                             |
| F5  | `expiresAt` se recibe y no se usa                             | SPA / API                                | se depende del 401; revisar solo si .NET implanta cookie deslizante                                                | No                                                             |
| F6  | El panorama del mapa pagina en cliente con tope 100           | SPA / API                                | conservar el tope y un `total` exacto                                                                              | No: el contrato ya exige `total` exacto (§3.1)                 |
| F7  | La descarga no queda en auditoría                             | API                                      | registrar quién exportó qué y con qué filtros (item 42)                                                            | No, pero es requisito del item 42                              |

**Lo que no falta.** Las 34 rutas del §4 existen y están verificadas contra `app/api/**`; no hay ninguna llamada de la SPA sin implementación ni ninguna ruta documentada sin uso. Las parciales de la §«Entrega: implementable ahora» de `frontend.md` (items 11, 12, 13, 15, 26, 30, 31, 42) son trabajo de interfaz o de columnas concretas, no huecos del contrato.

---

## 8 · Referencias

- Inventario de pantallas y componentes: `docs/07_frontend/angular/INVENTARIO_PARIDAD_UI.md`.
- Decisiones de la migración (rutas, servicios, signals): `docs/07_frontend/angular/DISENO_MIGRACION_ANGULAR.md`.
- Topología de despliegue y traspaso a .NET: `docs/06_operacion/DESPLIEGUE_VERCEL_NEON.md` §8.
- Convenciones del sobre y de error: `angular/src/app/core/http/coleccion.ts`, `angular/src/app/core/http/errores.ts`, `lib/db/http.ts`, `lib/db/errors.ts`.
