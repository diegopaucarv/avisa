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
| ¿Anula y restaura?        | 3 roles: `administrador`, `direccion_oaipcs`, `alta_direccion`.                                                                                    |
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

| Vista              | Ruta                         | Qué hace                                                                                                                                                                                                                  |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso             | `/acceso`                    | Login con el marcado y las clases originales. Tras autenticar, respeta `?volver=`.                                                                                                                                        |
| Shell              | `/` (layout)                 | Cabecera (estado del sistema, búsqueda y notificaciones), barra lateral con Mapa / Mi espacio / Seguimiento / Directorio / Análisis, menú de perfil y cierre de sesión.                                                   |
| Resumen operativo  | `/resumen`                   | KPIs desde el `total` de los sobres paginados (`tamano=1`), últimas alertas y vista previa de compromisos. No pide colecciones completas.                                                                                 |
| Bandeja de trabajo | `/bandeja`                   | Colas de trabajo: alertas pendientes, compromisos por vencer y demandas sin caso, todas paginadas en servidor.                                                                                                            |
| Búsqueda           | `/busqueda`                  | Búsqueda transversal paginada en servidor, filtros en la URL.                                                                                                                                                             |
| Notificaciones     | `/notificaciones`            | Bandeja de notificaciones paginada; estado vacío honesto cuando `core.notificaciones` no tiene filas.                                                                                                                     |
| Casos              | `/casos`                     | Tarjetas y tabla; búsqueda, orden, página y tamaño viven en la URL; paginación de servidor con 25 / 50 / 100 filas; el riesgo se muestra como atributo del caso; acceso a demandas sin caso.                              |
| Demandas sin caso  | `/casos/sin-caso`            | Demandas huérfanas paginadas, con búsqueda y vinculación a un caso (`PATCH /v1/demandas/{id}`); la búsqueda de casos también pagina en servidor.                                                                          |
| Ficha de caso      | `/casos/:codigo`             | Datos generales, actores y demandas en lectura. La cronología registra y edita hechos en panel lateral (`POST` / `PATCH …/events`).                                                                                       |
| Alertas            | `/alertas`                   | Listado paginado en servidor, filtros en la URL y panel lateral con la ficha y el recorrido de la alerta. La alerta no tiene nivel de riesgo: el riesgo es del caso.                                                      |
| Compromisos        | `/compromisos`               | Listado paginado en servidor, filtros en la URL y panel lateral. El vencimiento se resuelve como manual > próximo hito > aviso.                                                                                           |
| Documentos         | `/documentos`                | Maestro-detalle con listado paginado, filtros en la URL y panel lateral del documento. Incluye el menú de exportación JSON / Excel / PDF como implementación de referencia.                                               |
| Reportes           | `/reportes`                  | **Sólo lectura**: registro del Anexo N° 17 sobre `analytics.vw_anexo_17_registro_reportes`. Listado paginado, filtros (tipo, región, fechas, búsqueda) en la URL, enlace al caso y menú de exportación. Cierra el gap E4. |
| Actores            | `/directorio/actores`        | Listado paginado con filtros por naturaleza, tipo y región; panel lateral con la ficha. La PII se pide sólo desde el panel, con motivo auditado.                                                                          |
| Organizaciones     | `/directorio/organizaciones` | Listado paginado con filtros por texto, tipo y vigencia; panel lateral.                                                                                                                                                   |
| Instituciones      | `/directorio/instituciones`  | El mismo listado restringido a `Actor público`; panel lateral y la misma regla de PII bajo demanda.                                                                                                                       |
| Locales            | `/directorio/locales`        | Listado paginado de locales con filtro por texto y actividad. El `distrito_id` sigue nulo: el ubigeo está aplazado.                                                                                                       |
| Dirección          | `/direccion`                 | Agregados por `total` de sobres paginados. Sin desglose por región ni por nivel de conflicto: la API no los expone y no se estiman.                                                                                       |
| Ayuda y criterios  | `/ayuda`                     | Contenido normativo desde `ayuda.contenido.ts`, alineado al vocabulario congelado.                                                                                                                                        |
| Preferencias       | `/preferencias`              | Tema y densidad, que sí surten efecto. El tamaño de página aparece deshabilitado con nota: la API no expone esa preferencia.                                                                                              |

Todos los componentes usan `OnPush` y las rutas cargan con `loadComponent` (lazy), lo que mantiene
pequeño el bundle inicial. Todas las vistas paginan en el servidor; ninguna trae una colección
completa para calcular contadores.

La cronología de la ficha (`/casos/:codigo`) ya registra y edita hechos en un panel lateral; el backend
expone `PATCH /api/v1/cases/:codigo/events/:id`.

La vista de Reportes (`/reportes`) cierra el gap estructural **E4** del Anexo 17: la vista
`analytics.vw_anexo_17_registro_reportes` ya existía y ahora tiene pantalla, API (`GET /api/v1/reportes`)
y exportación; además, `migration/23_vistas_anexos_security_invoker.sql` corrigió la fuga de RLS de las
vistas de los anexos 16 y 17. El detalle vive en `docs/01_requisitos/GAPS_GUIA_SQL_UI.md` §2.1 y §2.3.

---

## 7 · Pantallas en migración

Sólo queda una ruta con marcador `EnMigracionComponent`
(`src/app/shared/ui/en-migracion.component.ts`):

| Sección  | Ruta    | Motivo                                                                             |
| -------- | ------- | ---------------------------------------------------------------------------------- |
| Aplazado | `/mapa` | Aplazado por decisión del usuario hasta que exista el dataset de ubigeo/centroide. |

El resto de rutas carga ya su página real. El marcador no simula datos, no dibuja botones
inactivos y no inventa cifras: una pantalla que aparenta datos que no puede sostener es peor que
una que declara su estado.

---

## 8 · Riesgos técnicos abiertos

| #   | Riesgo                                                                                           | Consecuencia                                                                                                    | Mitigación / siguiente paso                                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A1  | El contrato de escritura (`POST`, `PATCH`) **de la UI** no está portado.                         | Las vistas siguen siendo de lectura y la ficha no edita. El backend sí acepta escritura.                        | Portar primero casos; el adaptador de errores ya está.                                                       |
| A2  | ~~No existen endpoints `anular` / `restaurar` (E2).~~ **Cerrado.**                               | Ya existen `POST …/anular` y `POST …/restaurar` para casos, alertas, compromisos, demandas y documentos.        | Falta cablear los botones en la UI; el `DELETE` ahora exige `motivo` y no borra físicamente.                 |
| A3  | `/api/dashboard` no existe.                                                                      | La sesión se restaura con `GET /api/v1/session` y los agregados salen de los totales de los listados paginados. | No reintroducir esa ruta. Resumen, Bandeja y Dirección ya usan `tamano=1` + `total`.                         |
| A4  | El mapa está aplazado por decisión del usuario hasta que exista el dataset de ubigeo/centroide.  | La ruta `/mapa` sigue en marcador; no se documentan coordenadas ni una fórmula de calibración de riesgo.        | No portar Leaflet hasta que se reabra el aplazamiento.                                                       |
| A5  | El calendario de compromisos no está portado.                                                    | La vista `/compromisos` funciona con listado y panel, pero el calendario queda pendiente.                       | Resolver junto con A1, porque el calendario necesita escribir.                                               |
| A6  | Vitest está instalado y `ng test` configurado, pero **no hay archivos de prueba**.               | Las puertas G1–G5 no se pueden automatizar todavía.                                                             | Empezar por el adaptador de colecciones y por el store de sesión, que son lógica pura.                       |
| A7  | ~~El mapeo de `origen_dato` enviaba `KAG` y `WORKFLOW` a `Manual`.~~ **Cerrado por D10.**        | `KAG` y `Workflow` tienen etiqueta explícita en `dominio/mapeo.ts`.                                             | Mantener el `CHECK` técnico (`MANUAL · KAG · WORKFLOW · AVISA_HISTORICO · WHATSAPP`) sin cambios.            |
| A10 | ~~La exportación PDF / Excel / JSON está decidida y no implementada (E5).~~ **Cerrado.**         | `GET /api/v1/export?formato=&entidad=` sirve JSON, XLSX y PDF; el menú está cableado en Documentos.             | Replicar el menú en las demás vistas cuando el usuario lo pida (mismo componente `exportar-menu`).           |
| A11 | Los contadores de Resumen y Bandeja filtran «por vencer» sobre la página, no sobre la colección. | El pie muestra el `total` real del servidor; el aviso explica que el recorte es de página.                      | Añadir orden/filtro por vencimiento en `/v1/commitments` para que el listado sea exacto.                     |
| A12 | El catálogo de ciclos se ordena por `id`, así que «Prevención estratégica» aparece última.       | El orden de presentación no coincide con la Guía §8.                                                            | Añadir columna `orden` al catálogo cuando se reabra el tema; la Guía aclara que las etapas no son sucesivas. |
| A8  | Las fuentes se cargan desde Google Fonts.                                                        | Dependencia de red y de terceros en el primer pintado.                                                          | Autoalojar y eliminar el `@import`.                                                                          |
| A9  | `angular/README.md` sigue siendo el README genérico que genera el CLI, en inglés.                | Confunde a quien llegue al workspace.                                                                           | Sustituirlo por las instrucciones de §10.                                                                    |

---

## 9 · Verificación ejecutada

> Resultados registrados el **2026-11-22**. No se repitieron al escribir este documento.

| Prueba                                 | Resultado                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ng build` (producción)                | 437,09 kB iniciales · 99,61 kB de transferencia. Bajo el presupuesto de 1,2 MB / 2 MB y bajo la puerta de 250 kB en gzip. |
| `npm run typecheck` (`tsc --noEmit`)   | pasa, sin errores                                                                                                         |
| `grep -rn "tamano: 100" src/app`       | sin coincidencias: no quedan lecturas de colección completa                                                               |
| Recuento de rutas en `app.routes.ts`   | 21 rutas hijas reales + `/mapa` en marcador                                                                               |
| `POST /api/auth/login`, DNI `11111111` | 200                                                                                                                       |
| `POST /api/auth/login`, DNI `22222222` | 200                                                                                                                       |
| `POST /api/auth/login`, DNI `41907320` | 200                                                                                                                       |
| `POST /api/auth/login`, DNI `10654038` | 200                                                                                                                       |
| `POST /api/auth/login`, DNI `46078289` | 200                                                                                                                       |
| `GET /api/v1/session`                  | hidrata la sesión del perfil autenticado                                                                                  |
| `GET /api/v1/cases?pagina=1&tamano=2`  | sobre paginado con `items`, `total`, `page`, `pageSize`, `pagina`, `tamanoPagina`                                         |

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

1. **Portar el contrato de escritura en la UI** (`POST`, `PATCH`) con Vitest, y conectar la edición de
   la ficha. El backend ya lo acepta; falta la capa de formularios.
2. **Ofrecer la anulación en la UI**: ya existen `POST …/anular` y `POST …/restaurar`, y el `DELETE`
   exige `motivo`. Falta el diálogo con motivo obligatorio en la ficha del caso y en los paneles
   laterales de alertas, compromisos y documentos.
3. **Replicar el menú de exportación** (`shared/ui/exportar-menu`) en Casos, Alertas, Compromisos y en
   cada panel lateral. La implementación de referencia está en Documentos.
4. **No portar el mapa**: queda aplazado hasta que exista el dataset de ubigeo/centroide.
5. **Portar compromisos** (calendario e hitos) después de (1), porque el calendario necesita
   escritura. El vencimiento ya se resuelve como manual > próximo hito > aviso.
6. **Añadir orden y filtro por vencimiento en `/v1/commitments`** para que los recortes de Resumen,
   Bandeja y Dirección no dependan de la página.
7. **Sustituir el `@import` de Google Fonts** por fuentes autoalojadas y añadir una comprobación de
   tamaño gzip en CI, además de los presupuestos de `angular.json`.
8. **Reemplazar `angular/README.md`** por las instrucciones de §10; este documento ya figura en
   `docs/README.md` §2.
9. **Unificar el nombre de la API en español** (decisión del usuario, pendiente): hoy las rutas son
   `/api/v1/*` en inglés y la UI traduce.
10. **Añadir columna `orden` a `core.cat_ciclos_intervencion`** para que la presentación siga el orden
    de la Guía §8.
