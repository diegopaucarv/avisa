# Estado de la migración a Angular

| Campo                | Valor                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fecha**            | 2026-11-22                                                                                                                                                         |
| **Alcance**          | El workspace `angular/` del monorepo: arranque, núcleo, vistas portadas y pantallas pendientes                                                                     |
| **No cubre**         | El diseño de la migración (`DISENO_MIGRACION_ANGULAR.md`), el inventario de paridad (`INVENTARIO_PARIDAD_UI.md`) ni el análisis previo (`../migracion_angular.md`) |
| **Regla de lectura** | «Portado» significa que la vista existe y consume la API. «En migración» significa que la ruta muestra un marcador sin datos simulados.                            |

Este documento describe lo que **está construido y verificado**, no lo que está planificado. Donde
una cifra depende de una medición, se indica la fecha.

---

## 1 · Posición de la SPA en el sistema

La SPA es un workspace independiente dentro del monorepo, en `angular/`, con su propio
`package.json`, `angular.json` y `node_modules`. No comparte build con la aplicación Next: la UI
React sigue siendo la productiva hasta el corte, y ninguna capacidad se retira antes de que su
equivalente en Angular esté verificada.

| Dimensión          | Estado                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| Backend            | Sin cambios. La API canónica sigue en Next (`app/api/**`, `lib/db/**`). |
| UI productiva      | React/Next, congelada.                                                  |
| UI en construcción | Angular, en `angular/`, servida en el puerto 4200 con proxy a 3000.     |
| Criterio de corte  | Puertas G1–G5 de `DISENO_MIGRACION_ANGULAR.md:1424-1431`.               |

---

## 2 · Base técnica

| Elemento                  | Valor                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Angular                   | 22.3.0 exacto, sin rango (`angular/package.json:16-21`)                                                                                                                                                                |
| Arquitectura              | Standalone. `bootstrapApplication` en `src/main.ts`; sin `NgModule`.                                                                                                                                                   |
| Detección de cambios      | Zoneless. No se carga `zone.js`: no está en dependencias y `angular.json` no declara `polyfills`. Tampoco se registra `provideZonelessChangeDetection()`; el arranque no configura ninguna estrategia basada en zonas. |
| Estrategia por componente | `ChangeDetectionStrategy.OnPush` en todos los componentes.                                                                                                                                                             |
| Plantillas                | `templateUrl` con el `.html` aparte; los componentes de feature no usan plantillas inline.                                                                                                                             |
| Entradas y salidas        | `input()` / `output()`; sin decoradores `@Input` / `@Output`.                                                                                                                                                          |
| Control de flujo          | `@if` / `@for` con `track`.                                                                                                                                                                                            |
| Tailwind                  | Sólo utilidades de maquetación en plantillas; nunca en `styleUrl` de componentes.                                                                                                                                      |
| Acceso a datos            | Toda lectura pasa por la fachada `consulta<T>`; ningún componente importa `httpResource`.                                                                                                                              |
| SSR                       | No. Sólo existe la entrada `browser` (`angular.json:20`); no hay `@angular/ssr`.                                                                                                                                       |
| TypeScript                | 6.0.2, con `strict`, `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers` y `noPropertyAccessFromIndexSignature` (`tsconfig.json:5-23`)                                                        |
| Pruebas                   | Vitest 5.0.0 con el builder `@angular/build:unit-test` y `jsdom` 31. **Sin archivos de prueba todavía.**                                                                                                               |
| Builder                   | `@angular/build:application`; `defaultConfiguration: production`.                                                                                                                                                      |
| Presupuestos              | Inicial: 1,2 MB de aviso y 2 MB de error. Estilo de componente: 8 kB y 16 kB (`angular.json:33-44`).                                                                                                                   |
| Salida                    | `dist/avisa`, con `outputHashing: all`.                                                                                                                                                                                |

El presupuesto de `angular.json` es el tamaño bruto del bundle. Los 250 kB que aparecen en el
diseño son otra medida: la puerta G5, en gzip y sin mapa. No son el mismo umbral y no deben
compararse entre sí.

---

## 3 · Estilos y recursos estáticos

| Archivo                                                            | Origen                               | Estado                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/styles/global.css`                                            | `app/globals.css` (6 782 líneas)     | 6 781 líneas. Contenido portado íntegro, **reformateado por Prettier** (`.prettierrc` con `singleQuote: true` y ancho 100): comillas simples e indentación distinta. No es idéntico byte a byte. |
| `src/styles/theme-dark.generated.css`                              | `app/theme-dark.generated.css`       | 1 847 líneas, idéntico al origen.                                                                                                                                                                |
| `src/index.html`                                                   | `app/layout.tsx` y `app/globals.css` | `lang="es"`, script de tema antes del primer pintado, `env.js` de configuración de runtime, iconos de `public/`.                                                                                 |
| `public/{icon.svg, apple-icon.png, favicon.ico, icon-*-32x32.png}` | `public/` del proyecto Next          | Copiados.                                                                                                                                                                                        |

Decisiones de estilo que conviene tener presentes:

- **Tailwind 4.3.3 por PostCSS.** `angular/.postcssrc.json` registra `@tailwindcss/postcss` y
  `global.css:4-7` declara los orígenes con `@source "../app/**/*.{html,ts}"` y
  `@source "../index.html"`. Sin esas dos líneas el detector automático no encuentra las
  plantillas dentro del monorepo.
- **Se retiró `@import 'leaflet/dist/leaflet.css'`.** El CSS portado ya trae los estilos de
  Leaflet; importarlo de nuevo duplicaba reglas y alteraba el orden de cascada.
- **Se conserva el `@import` de Google Fonts** (`global.css:1`, DM Sans y Manrope). Sigue siendo
  una dependencia de red en tiempo de pintado; autoalojar las fuentes es un pendiente declarado.
- **El orden importa.** `angular.json:28` carga primero `global.css` y después
  `theme-dark.generated.css`, igual que en Next.
- El tema se resuelve antes del primer pintado leyendo `localStorage['avisa-theme']`
  (`src/index.html:13-35`), lo que evita el destello blanco al recargar en oscuro.

---

## 4 · Arranque, sesión y capacidades

### 4.1 · Configuración de runtime

`core/config/entorno.ts` lee `window.AVISA_ENTORNO` (servido desde `public/env.js`) y cae en
`apiBase = '/api'` y `version = '0.1.0'` si no existe. `urlApi()` une la base con la ruta relativa.
El mismo build puede apuntar a otro backend sin recompilar.

### 4.2 · Sesión

| Pieza                   | Comportamiento                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sesion.model.ts`       | Traduce el perfil de la API (`user`) al modelo de la UI.                                                                                                      |
| `sesion.store.ts`       | Fuente única. Estados `iniciando` / `anonimo` / `autenticado`. `restaurar()` consulta `GET /api/v1/session`; un **401 se trata como anónimo**, no como error. |
| `sesion.interceptor.ts` | Fuerza `withCredentials: true` y, ante un 401, limpia la sesión para que la UI vuelva al acceso.                                                              |
| `sesion.guard.ts`       | `sesionGuard` protege el área privada y recuerda el destino en `?volver=`; `visitanteGuard` impide ver el login con sesión abierta.                           |
| `provideAppInitializer` | `app.config.ts:34` hidrata la sesión antes del primer pintado. Sin esto habría un parpadeo de login al recargar en una ruta protegida.                        |

El login (`POST /api/auth/login`) recibe `{dni, password}` y devuelve el perfil, no un token: la
cookie es `httpOnly` y el cliente no puede leerla. El cierre de sesión local es inmediato y el
servidor limpia la cookie con `POST /api/auth/logout`.

### 4.3 · Capacidades

`core/permisos/capacidades.service.ts` deriva de los roles de la sesión:

| Pregunta                  | Regla                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Edita?                   | 7 roles: `administrador`, `direccion_oaipcs`, `alta_direccion`, `sectorista`, `servicio_agente`, `analista_cualitativo`, `curador_politica`.       |
| ¿Anula y restaura?        | 2 roles: `administrador`, `sectorista`.                                                                                                            |
| ¿Ve DNI y teléfonos?      | 4 roles: los tres anteriores más `sectorista`. La PII no viene en el listado: se pide bajo demanda al abrir la ficha, con motivo y queda auditada. |
| ¿Hasta qué clasificación? | Máximo por rol; `puedeModificar(nivel)` lo compara con la clasificación del registro.                                                              |

Admin acumula los diez roles, de modo que las comprobaciones por pertenencia funcionan sin una
rama especial. Los diez códigos están enumerados en `capacidades.service.ts:11-22`.

---

## 5 · Capa de datos HTTP

| Archivo                  | Responsabilidad                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/http/coleccion.ts` | Normaliza el sobre paginado: acepta arreglo suelto o `{elementos\|items\|data, total, pagina\|page, tamanoPagina\|pageSize}` y **siempre expone español**. `paramsDePagina` envía las dos grafías (`pagina/page`, `tamano/pageSize`) mientras conviva la UI React. |
| `core/http/consulta.ts`  | Fachada deliberada sobre `HttpClient` con señales y `effect`: estado `inactivo/cargando/listo/error`, cancelación de la petición anterior, guarda de turno para descartar respuestas tardías y `recargar()`. Ningún componente importa `httpResource`.             |
| `core/http/errores.ts`   | Un único punto de traducción de `{detail, code}` a un error de UI, con `esNoAutorizado` para el 401.                                                                                                                                                               |

`TAMANO_PAGINA = 25`. El tope de la API es 100 (`lib/db/repos/cases.ts:137-141`), así que la UI no
puede pedir más de lo que el servidor devuelve.

La paginación es de servidor en todas las listas: `paramsDePagina` envía `pagina` y `tamanoPagina`
(además de sus alias ingleses) y ninguna vista trae la colección completa. La API en español está
**decidida pero pendiente**: las rutas siguen en inglés (`/api/v1/cases`, `/api/v1/alerts`, …) y la
traducción vive en `coleccion.ts` y en los mapeos de cada feature.

Esta capa está probada contra el contrato actual: `GET /api/v1/cases?page=1&pageSize=2` responde
`items`, `total`, `page`, `pageSize`, y el adaptador lo entrega como `elementos`, `total`, `pagina`,
`tamanoPagina`.

---

## 6 · Vistas portadas

| Vista              | Ruta                         | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso             | `/acceso`                    | Login con el marcado y las clases originales. Tras autenticar, respeta `?volver=`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shell              | `/` (layout)                 | Cabecera (estado del sistema, búsqueda y notificaciones), barra lateral con Mapa / Mi espacio / Seguimiento / Directorio / Análisis, menú de perfil y cierre de sesión.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Resumen operativo  | `/resumen`                   | KPIs desde el `total` de los sobres paginados (`tamano=1`), últimas alertas y vista previa de compromisos vencidos o por vencer, con contador de cada cola. No pide colecciones completas.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Bandeja de trabajo | `/bandeja`                   | Colas de trabajo: alertas pendientes, compromisos vencidos o por vencer (con contador de cada cola) y demandas sin caso, todas paginadas en servidor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Búsqueda           | `/busqueda`                  | Búsqueda transversal paginada en servidor, filtros en la URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Notificaciones     | `/notificaciones`            | Bandeja de notificaciones paginada; estado vacío honesto cuando `core.notificaciones` no tiene filas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Casos              | `/casos`                     | Tarjetas y tabla; búsqueda, orden, página y tamaño viven en la URL; paginación de servidor con 25 / 50 / 100 filas; el riesgo se muestra como atributo del caso; acceso a demandas sin caso. Cinco filtros (temática, estado, riesgo, prioridad, alcance) se resuelven en SQL por FK y el servidor devuelve `422` si el valor no está en el catálogo.                                                                                                                                                                                                                                                                                        |
| Demandas sin caso  | `/casos/sin-caso`            | Demandas huérfanas paginadas, con búsqueda y vinculación a un caso (`PATCH /v1/demandas/{id}`); la búsqueda de casos también pagina en servidor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Ficha de caso      | `/casos/:codigo`             | Datos generales, actores y demandas en lectura. La cronología registra y edita hechos en panel lateral (`POST` / `PATCH …/events`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Alertas            | `/alertas`                   | Listado paginado en servidor, filtros en la URL y panel lateral con la ficha y el recorrido de la alerta. La alerta no tiene nivel de riesgo: el riesgo es del caso.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Compromisos        | `/compromisos`               | Listado paginado en servidor, filtros en la URL y panel lateral. Conmutador **Tabla · Calendario**: la rejilla mensual se pide al servidor con el rango del mes visible (`vencimiento_desde` / `vencimiento_hasta`) y muestra Vencido / Por vencer / En plazo. El vencimiento se resuelve como manual > próximo hito > aviso. Conmutador **Activos · Anulados**: el archivo lista lo anulado con su fecha y permite restaurar en la propia fila; el calendario se deshabilita en esa pestaña.                                                                                                                                                |
| Documentos         | `/documentos`                | Maestro-detalle con listado paginado, filtros en la URL y panel lateral del documento, con anulación por motivo. El menú de exportación JSON / Excel / PDF ya no es sólo de esta vista: está en 15 pantallas y ofrece «Esta vista» y «Base completa». Conmutador **Activos · Anulados** con archivo y restauración por fila.                                                                                                                                                                                                                                                                                                                 |
| Archivo            | `/archivo`                   | Vista dedicada a los registros anulados de las cinco entidades: con cinco pestañas (**Casos · Alertas · Demandas · Documentos · Compromisos**), cada una con `?anulados=true` y paginación de servidor. La tabla muestra registro, caso asociado, motivo, fecha de anulación, autor y `Restaurar`; la fila abre un panel lateral con detalle, motivo, fecha, autor y lote, y el botón de restaurar. Sólo se ofrece con `capacidades.puedeEliminar()`; sin ese rol la página muestra un estado «sin permiso» y no se pide el listado. En la pestaña Casos advierte que restaurar el caso devuelve también sus documentos, alertas y demandas. |
| Reportes           | `/reportes`                  | **Sólo lectura**: registro del Anexo N° 17 sobre `analytics.vw_anexo_17_registro_reportes`. Listado paginado, filtros (tipo, región, fechas, búsqueda) en la URL, enlace al caso y menú de exportación. Cierra el gap E4.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Actores            | `/directorio/actores`        | Listado paginado con filtros por naturaleza, tipo y región; panel lateral con la ficha. La PII se pide sólo desde el panel, con motivo auditado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Organizaciones     | `/directorio/organizaciones` | Listado paginado con filtros por texto, tipo y vigencia; panel lateral.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Instituciones      | `/directorio/instituciones`  | El mismo listado restringido a `Actor público`; panel lateral y la misma regla de PII bajo demanda.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Locales            | `/directorio/locales`        | Listado paginado de locales con filtro por texto y actividad. El `distrito_id` sigue nulo aunque el ubigeo ya está cargado (1 892 distritos): falta asignarlo, no el dataset (item 130).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Dirección          | `/direccion`                 | Agregados por `total` de sobres paginados. Sin desglose por región ni por nivel de conflicto: la API no los expone y no se estiman.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Ayuda y criterios  | `/ayuda`                     | Contenido normativo desde `ayuda.contenido.ts`, alineado al vocabulario congelado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Preferencias       | `/preferencias`              | Tema y densidad, que sí surten efecto. El tamaño de página aparece deshabilitado con nota: la API no expone esa preferencia.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Todos los componentes usan `OnPush` y las rutas cargan con `loadComponent` (lazy), lo que mantiene
pequeño el bundle inicial. Todas las vistas paginan en el servidor; ninguna trae una colección
completa para calcular contadores.

La cronología de la ficha (`/casos/:codigo`) ya registra y edita hechos en un panel lateral; el backend
expone `PATCH /api/v1/cases/:codigo/events/:id`.

La vista de Reportes (`/reportes`) cierra el gap estructural **E4** del Anexo 17: la vista
`analytics.vw_anexo_17_registro_reportes` ya existía y ahora tiene pantalla, API (`GET /api/v1/reportes`)
y exportación; además, `migration/23_vistas_anexos_security_invoker.sql` corrigió la fuga de RLS de las
vistas de los anexos 16 y 17. El detalle vive en `docs/01_requisitos/GAPS_GUIA_SQL_UI.md` §2.1 y §2.3.

El panel de anulación (`shared/ui/anular-panel`) está montado en **cuatro** vistas: ficha de caso,
alertas, compromisos y documentos. Es presentacional —no conoce HTTP—, tiene dos modos (`anular` y
`restaurar`), valida un motivo de al menos 10 caracteres con contador y error accesible, y no pide
motivo para restaurar. La petición la hace cada contenedor: `POST /v1/cases/{codigo}/anular` en casos
y `DELETE /v1/<entidad>/{id}` con `{ motivo }` en alertas, compromisos y documentos; restaurar va por
`POST …/restaurar` sin cuerpo. Al anular desde un listado se recarga la misma página, así que los
filtros y la página de la URL se conservan.

El **archivo** tiene dos formas. La de compromisos y documentos (`?ver=anulados`) sigue dentro de su
listado: la API devuelve los anulados con `anuladoEn` y la fila ofrece `Restaurar` sin abrir el panel de
detalle (su `GET …/{id}` responde 404 mientras el registro está anulado). La RLS la abre con
`app.ver_anulados` (migraciones 26 y 27) y sólo para quien puede anular.

La segunda es la **página dedicada `/archivo`** (`features/archivo/`, hija del shell y cargada con
`loadComponent`): cinco pestañas —Casos, Alertas, Demandas, Documentos y Compromisos—, cada una
consultando `GET /api/v1/{cases,alerts,demandas,documents,commitments}?anulados=true` con paginación de
servidor. La tabla comparte columnas —registro, caso asociado, motivo, fecha de anulación, autor y
`Restaurar`— porque los cinco repositorios exponen `anuladoEn`, `motivoAnulacion`, `anuladoPor`,
`anuladoPorNombre` y `anulacionId`, y `?anulados=true` devuelve **sólo** los anulados. `alerts` y
`demandas` ganaron ese modo en su ruta de listado con el mismo guard (`puedeAnularRegistros`) y
`withSession(..., { verAnulados })`; con un rol que no anula responden `403`. El panel lateral sigue el
patrón de `documento-panel` y `compromiso-panel`. Restaurar es un `POST` al endpoint de la entidad; al
volver 200 se cierra el panel, se recarga la página actual y se muestra el aviso, y `401` / `403` / `404`
se traducen a mensajes legibles. La entrada de navegación y la página dependen de
`capacidades.puedeEliminar()`.

El 2026-11-24 la sección pasó de llamarse _papelera_ a **Archivo**: el componente vive en
`features/archivo/` (`ArchivoPage`, `ArchivoPanelComponent`) y la ruta es `/archivo`. `/papelera`
sigue existiendo como redirección para no romper enlaces guardados.

Restaurar es **de fila, nunca en cascada**: desde `migration/29_restauracion_por_fila.sql`,
`core.restaurar_registro` escribe `where id = $1 using p_id` —antes `where anulacion_id = $1`, que
levantaba el lote— y cuenta con `GET DIAGNOSTICS` porque `EXECUTE` no actualiza `FOUND`. Un documento que
originó muchos compromisos o demandas se restaura solo, y sus vínculos n:m se tratan por separado. La
excepción es intencional: la pestaña Casos llama a `restaurar_caso`, que reabre el caso **con su lote
completo**, y el panel lo advierte. En compromisos, la restauración arrastra sus hitos, igual que la
anulación.

Dos defectos se corrigieron al probar el archivo de punta a punta. El primero: restaurar devolvía
**404 en las cinco entidades**, porque el prefetch de la ruta leía la fila a través de la RLS, que
esconde lo anulado; las cinco rutas `POST …/restaurar` abren ahora `{ verAnulados: true }` mientras
resuelven el registro y escriben por las funciones `SECURITY DEFINER`. El segundo: **anular por API no
funcionaba**, porque `core.anular_registro` comprobaba el resultado de un `EXECUTE` con `if not found`
y `EXECUTE` no actualiza `FOUND`; `migration/28_fix_anular_registro_found.sql` lo reemplaza por
`GET DIAGNOSTICS`, sin cambiar firma, permisos ni la semántica del lote.

Quién anula lo fija `core.roles.puede_eliminar` (parche 15): `administrador` y `sectorista`.
`direccion_oaipcs` edita pero no borra, así que la UI no le ofrece la acción —la RLS se la negaría—.
El conjunto de la SPA (`capacidades.service.ts`), el del guard de la API (`tenant.ts`) y esa matriz
son ahora el mismo.

El listado de casos proyecta los campos de anulación (`anuladoEn`, `motivoAnulacion`, `anuladoPor`,
`anuladoPorNombre`, `anulacionId`) cuando se consulta con `anulados=true`, igual que las otras cuatro
entidades. La migración 27 añade a `core.casos` la misma política `p_anulados` de la 26; sin ella la
columna «Caso» del archivo saldría vacía cuando el caso también está en el archivo.

El conmutador **Tabla · Calendario** de compromisos ya está portado y pide el rango del mes visible al
servidor, pero hoy el calendario no dibuja nada y **no es un defecto de la vista**: los **8**
compromisos tienen `fecha_vencimiento` nula y el único hito con fecha está `Cumplido`, de modo que el
vencimiento efectivo es nulo. `GET /v1/commitments?vencimiento_desde=…&vencimiento_hasta=…` responde
`200` con `total: 0`. Se llenará cuando existan fechas; la vista no las inventa.

---

## 7 · Pantallas en migración

Ninguna. Las **26 pantallas** —25 rutas hijas con componente más `/acceso`— cargan ya su página
real; la entrada `papelera` del router es sólo una redirección a `/archivo`, no una pantalla.
`shared/ui/en-migracion.component.ts` quedó sin uso: se conserva como marcador para rutas futuras,
pero ya no cuelga de ninguna entrada del router.

`/mapa` dejó de estar aplazado. `features/mapa/` monta Leaflet sobre
`mapa.page.html` con dos capas: un círculo por región en su centroide
referencial (`centroides.regiones.ts`) y los polígonos distritales reales de
`territorio.distrito` —**1 892 distritos** con `geom` (MultiPolygon 4326) y
`centroide`—, con coropleta por casos abiertos, control «Límites distritales»,
ficha territorial al pulsar un polígono y tasa por 100 000 habitantes. La carga
de esa capa se cerró el 2026-11-24 (item 128).

Lo que sigue sin dato es la nube de puntos del KML (item 125), las redes RADAR
con su estado de proyecto (126–127) y el `distrito_id` de los 27 auditorios
(130). El marcador no simula datos, no dibuja botones inactivos y no inventa
cifras: una pantalla que aparenta datos que no puede sostener es peor que una
que declara su estado.

---

## 8 · Riesgos técnicos abiertos

| #   | Riesgo                                                                                              | Consecuencia                                                                                                                                                                                                                                       | Mitigación / siguiente paso                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | ~~El contrato de escritura (`POST`, `PATCH`) **de la UI** no está portado.~~ **Cerrado en casos.**  | La ficha edita por campo (`PATCH /v1/cases/{codigo}`), registra y edita hechos y crea o vincula demandas; documentos, compromisos y alertas editan en su panel lateral.                                                                            | Queda la escritura del directorio: `PATCH /v1/actors/{uid}` existe en la API, pero la UI no lo usa y la PII exige su flujo con motivo auditado.                                                                                                                             |
| A2  | ~~No existen endpoints `anular` / `restaurar` (E2).~~ **Cerrado.**                                  | La anulación existe en casos, alertas, compromisos, demandas y documentos. En casos es `POST …/anular`; en el resto, `DELETE …/{id}` con `{ motivo }`. El `DELETE` rechaza la petición sin motivo (`400 MOTIVO_REQUERIDO`) y no borra físicamente. | **Cerrado en la UI** para las cinco entidades: `/archivo` lista los anulados de casos, alertas, demandas, documentos y compromisos y restaura por fila. Restaurar un caso sigue siendo la operación de lote (`restaurar_caso`) y el panel lo advierte.                      |
| A3  | `/api/dashboard` no existe.                                                                         | La sesión se restaura con `GET /api/v1/session` y los agregados salen de los totales de los listados paginados.                                                                                                                                    | No reintroducir esa ruta. Resumen y Dirección leen `tamano=1` + `total`; Bandeja suma además el rango de vencimiento.                                                                                                                                                       |
| A4  | ~~El mapa está aplazado hasta que exista el dataset de ubigeo/centroide.~~ **Cerrado.**             | `/mapa` es real: Leaflet con la capa distrital coroplética de `territorio.distrito` (1 892 distritos) y círculos regionales en su centroide.                                                                                                       | La capa llegó el 2026-11-24 (item 128). Sigue sin dato la nube del KML (125), las redes RADAR (126–127) y el `distrito_id` de los 27 auditorios (130): se declaran ausentes.                                                                                                |
| A5  | ~~El calendario de compromisos no está portado.~~ **Cerrado en código.**                            | `/compromisos` tiene conmutador Tabla · Calendario; la rejilla se pide al servidor por rango mensual.                                                                                                                                              | El calendario está vacío por falta de fechas, no por la vista (ver §6). No requiere escritura: el riesgo original de A1 no aplicaba.                                                                                                                                        |
| A6  | ~~Vitest está instalado y `ng test` configurado, pero **no hay archivos de prueba**.~~ **Cerrado.** | Hay 15 archivos `*.spec.ts` y **227 pruebas verdes** en 15 archivos; `npm run typecheck` pasa limpio.                                                                                                                                              | `npm test` y `npm run typecheck` son la puerta antes de cada entrega.                                                                                                                                                                                                       |
| A7  | ~~El mapeo de `origen_dato` enviaba `KAG` y `WORKFLOW` a `Manual`.~~ **Cerrado por D10.**           | `KAG` y `Workflow` tienen etiqueta explícita en `dominio/mapeo.ts`.                                                                                                                                                                                | Mantener el `CHECK` técnico (`MANUAL · KAG · WORKFLOW · AVISA_HISTORICO · WHATSAPP`) sin cambios.                                                                                                                                                                           |
| A10 | ~~La exportación PDF / Excel / JSON está decidida y no implementada (E5).~~ **Cerrado.**            | `GET /api/v1/export?formato=&entidad=` sirve JSON, XLSX y PDF; el menú está montado en **15** vistas.                                                                                                                                              | Ofrece dos grupos: «Esta vista» (respeta los filtros de la URL) y «Base completa» (`entidad=base`). Firmas XLSX `PK` y PDF `%PDF` verificadas.                                                                                                                              |
| A11 | ~~Los contadores de Resumen y Bandeja filtran «por vencer» sobre la página.~~ **Cerrado.**          | Ambas vistas piden el rango al servidor y leen su `total`. El servidor ordena por vencimiento efectivo ascendente cuando hay rango, y `excluir_terminales=true` deja fuera los compromisos cumplidos o desestimados.                               | Tres consultas por vista: contador de vencidos (`vencimiento_hasta` ayer), contador de por vencer (hoy … hoy+30) y cola combinada (hasta hoy+30, sin `desde`). El único límite que queda es que la API no ofrece orden descendente por vencimiento; la cola no lo necesita. |
| A12 | El catálogo de ciclos se ordena por `id`, así que «Prevención estratégica» aparece última.          | El orden de presentación no coincide con la Guía §8.                                                                                                                                                                                               | Añadir columna `orden` al catálogo cuando se reabra el tema; la Guía aclara que las etapas no son sucesivas.                                                                                                                                                                |
| A8  | Las fuentes se cargan desde Google Fonts.                                                           | Dependencia de red y de terceros en el primer pintado.                                                                                                                                                                                             | Autoalojar y eliminar el `@import`.                                                                                                                                                                                                                                         |
| A9  | `angular/README.md` sigue siendo el README genérico que genera el CLI, en inglés.                   | Confunde a quien llegue al workspace.                                                                                                                                                                                                              | Sustituirlo por las instrucciones de §10.                                                                                                                                                                                                                                   |

---

## 9 · Verificación ejecutada

> Resultados registrados el **2026-11-22**. Las filas de paginación, filtros, rango de vencimiento,
> anulación y exportación se ejecutaron contra el servidor en esa misma fecha; `ng build` es la última
> medición de producción disponible.

| Prueba                                                                         | Resultado                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ng build` (producción)                                                        | 441,60 kB iniciales · 100,19 kB de transferencia. Bajo el presupuesto de 1,2 MB / 2 MB y bajo la puerta de 250 kB en gzip. Chunk lazy `papelera-page` de 20,52 kB (5,81 kB de transferencia). |
| `npm run typecheck` (`tsc --noEmit`)                                           | pasa, sin errores                                                                                                                                                                             |
| `grep -rn "tamano: 100" src/app`                                               | sin coincidencias: no quedan lecturas de colección completa                                                                                                                                   |
| Recuento de rutas en `app.routes.ts`                                           | 29 entradas `path:` = **25 rutas hijas** + `/acceso` + layout `''` + redirect interno `''` + wildcard (`**`) → **26 pantallas**                                                               |
| `POST /api/auth/login`, DNI `11111111`                                         | 200                                                                                                                                                                                           |
| `POST /api/auth/login`, DNI `22222222`                                         | 200                                                                                                                                                                                           |
| `POST /api/auth/login`, DNI `41907320`                                         | 200                                                                                                                                                                                           |
| `POST /api/auth/login`, DNI `10654038`                                         | 200                                                                                                                                                                                           |
| `POST /api/auth/login`, DNI `46078289`                                         | 200                                                                                                                                                                                           |
| `GET /api/v1/session`                                                          | hidrata la sesión del perfil autenticado                                                                                                                                                      |
| `GET /api/v1/cases?pagina=1&tamano=2`                                          | sobre paginado con `items`, `total`, `page`, `pageSize`, `pagina`, `tamanoPagina`                                                                                                             |
| `GET /api/v1/cases?tematica=Infraestructura&tamano=1`                          | 200 · `total: 14`                                                                                                                                                                             |
| `GET /api/v1/cases?estado=No%20existe`                                         | **422** `FILTRO_INVALIDO`: el filtro se valida contra catálogo, no se ignora                                                                                                                  |
| `GET /api/v1/cases?prioridad=Urgente` · `?alcance=Sur`                         | 200 · `total: 6` · `total: 3`                                                                                                                                                                 |
| `GET /api/v1/cases?pagina=2&tamano=3`                                          | 200 · `total: 34` · 3 elementos: la paginación es de servidor                                                                                                                                 |
| `GET /api/v1/commitments?vencimiento_desde=2026-13-01`                         | **400**: fecha inválida                                                                                                                                                                       |
| `GET /api/v1/commitments?…desde=2026-12-31&hasta=2026-01-01`                   | **400**: rango invertido                                                                                                                                                                      |
| `GET /api/v1/commitments?…desde=2026-11-22&hasta=2026-12-22`                   | 200 · `total: 0` (hueco de datos, ver §6)                                                                                                                                                     |
| `GET /api/v1/commitments?excluir_terminales=true&vencimiento_hasta=2026-11-21` | 200 · `total: 0`: no hay vencidos con fecha efectiva (el único hito con fecha está `Cumplido`)                                                                                                |
| `GET /api/v1/documents?anulados=true&tamano=3`                                 | 200 · `total: 10`; las filas traen `casoCode` `CS-MI-ITE-2026-02` (antes salía `null`, corregido por `migration/27_papelera_tablas_anulables.sql`)                                            |
| `GET /api/v1/documents?anulados=true` con `41907320` / `10654038`              | **403** `direccion_oaipcs` · 200 `sectorista`: el conjunto de anulación coincide en base, API y SPA                                                                                           |
| `GET /api/v1/cases?anulados=true` (Admin)                                      | 200 · `total: 1` (`CS-MI-ITE-2026-02`, lote `35f6ccf9-649d-4275-915c-8051293c5b37`); `alerts` 200 · `total: 7`, `demandas` 200 · `total: 0` y `commitments` 200 · `total: 0`                  |
| `GET /api/v1/{alerts,demandas}?anulados=true` con `41907320`                   | **403** en ambas: el listado de la papelera exige `puedeAnularRegistros`                                                                                                                      |
| `migration/29` sobre el lote de `CS-MI-ITE-2026-02` (`begin`/`rollback`)       | `restaurar_registro('documentos', id)` devolvió `1`; el documento quedó activo, los otros **9** siguen anulados y el caso sigue anulado                                                       |
| Comprobación funcional de `migration/27` con `avisa_app`                       | cinco tablas con `p_anulados` y `p_clasificacion` intacta; `core.casos`: 34 visibles con `app.ver_anulados='off'`, 35 con `'on'`; 1 anulado                                                   |
| `POST /api/v1/documents/{id}/restaurar` (antes de la corrección)               | **404** `NOT_FOUND`: el prefetch no veía la fila anulada                                                                                                                                      |
| `POST /api/v1/documents/{id}/restaurar` sobre un documento **activo**          | **404** `El registro no existe o excede el nivel de acceso.` y 0 filas cambiadas: restaurar no toca lo que no está anulado                                                                    |
| `POST /api/v1/documents/{id}/restaurar` (después)                              | 200 · papelera `11 → 10` y activos `142 → 143`: la restauración es de fila                                                                                                                    |
| `DELETE /api/v1/documents/{id}` con motivo                                     | 200 (antes de `migration/28`, 404 en toda anulación); papelera `10 → 11`                                                                                                                      |
| `POST /api/v1/commitments/{id}/restaurar`                                      | 200 · papelera `1 → 0` y activos `7 → 8`, con `casoCode` resuelto en la papelera                                                                                                              |
| `POST /api/v1/alerts/{id}/restaurar`                                           | 200 · antes de `migration/29` restauraba el lote de 7 alertas del caso borrado; desde la 29 la restauración es de fila, y el listado `?anulados=true` de alertas ya existe                    |
| `DELETE` + `POST …/restaurar` sobre una demanda                                | 200 · `total: 325` antes y después; el anulado de la prueba no quedó en la tabla                                                                                                              |
| `core.restaurar_caso` con `app.ver_anulados='on'` (en `begin`/`rollback`)      | restaura el lote de 7 tablas del caso borrado; no se dejó aplicado                                                                                                                            |
| `DELETE /api/v1/commitments/{id}` sin cuerpo                                   | **400** `MOTIVO_REQUERIDO`: no se anula nada sin motivo                                                                                                                                       |
| `GET /api/v1/export?entidad=base&formato=excel` · `…=pdf`                      | 200 · firmas `PK` y `%PDF` verificadas                                                                                                                                                        |
| `pg_proc` sobre `siguiente_codigo_caso`                                        | una sola firma tras `migration/25`: `CS-<PA\|MI>-…-<AAAA>-NN`; la llamada sin argumentos ya no da `42725`                                                                                     |

Las rutas de la API siguen en inglés (la API en español está decidida y pendiente); la UI las envuelve
y traduce las claves en su capa HTTP.

Las cuentas y sus roles están en `../../01_requisitos/GAPS_GUIA_SQL_UI.md` §8. Todas usan la clave
`demo`.

---

## 10 · Cómo se ejecuta

```sh
cd angular
npm install
npm start      # ng serve --port 4200, con proxy /api → http://localhost:3000
npm run build  # ng build, configuración production por omisión
```

Requisitos: el backend Next tiene que estar escuchando en `localhost:3000`, porque
`angular/proxy.conf.json` redirige `/api` allí y reescribe el dominio de la cookie a `localhost`.
Sin ese backend, el login no funciona aunque la SPA arranque.

Pruebas: `npm test` (`ng test`, Vitest). Hoy no hay especificaciones que ejecutar.

---

## 11 · Convivencia con la UI React

- La UI React sigue siendo la productiva y la que atiende a los usuarios.
- La SPA Angular consume la misma API y la misma base; no hay migración de datos.
- No se retira ninguna capacidad de React antes de que su equivalente Angular esté verificada
  contra los criterios de la puerta correspondiente.
- El corte se decide con G5: checklist de `INVENTARIO_PARIDAD_UI.md` completa, 0 violaciones
  `serious/critical` en `axe`, bundle inicial dentro de la puerta, 0 errores no capturados en 24 h
  con tráfico interno y rollback ensayado.

---

## 12 · Siguiente en orden

1. **Portar la escritura que falta**: el directorio (`PATCH /v1/actors/{uid}`) y su flujo de PII
   con motivo auditado. La de casos y los paneles de documentos, compromisos y alertas ya están.
2. **Montar la anulación donde falta**: la UI la tiene en casos, alertas, compromisos, documentos
   y demandas. El **Archivo** (`/archivo`) restaura por fila las cinco entidades y sus listados
   proyectan `anuladoEn`; queda sólo el panel de Reportes, que es de solo lectura.
3. **Rellenar el hueco de datos de compromisos**: sin `fecha_vencimiento` ni hitos con fecha, el
   calendario y la cola «por vencer» están vacíos aunque funcionen. Es captura, no código.
4. **Mapa**: ya no está aplazado. Falta la nube de puntos del KML (item 125), las redes RADAR y
   el estado de proyecto de cada DPA (126–127) y el `distrito_id` de los 27 auditorios (130).
5. **Orden descendente por vencimiento en `/v1/commitments`** si alguna vista lo necesita: el filtro
   de estados terminales ya existe (`excluir_terminales=true`) y la cola de vencidos ya se sirve con él.
6. **Exportación específica del Anexo 14** y desglose por responsable y por nivel de gobierno: la
   API no los expone y no se estiman en la UI.
7. **Sustituir el `@import` de Google Fonts** por fuentes autoalojadas y añadir una comprobación de
   tamaño gzip en CI, además de los presupuestos de `angular.json`.
8. **Reemplazar `angular/README.md`** por las instrucciones de §10; este documento ya figura en
   `docs/README.md` §2.
9. **Unificar el nombre de la API en español** (decisión del usuario, pendiente): hoy las rutas son
   `/api/v1/*` en inglés y la UI traduce.
10. **Añadir columna `orden` a `core.cat_ciclos_intervencion`** para que la presentación siga el orden
    de la Guía §8.
