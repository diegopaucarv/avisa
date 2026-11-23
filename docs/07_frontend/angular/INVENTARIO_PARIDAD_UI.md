# Inventario de paridad de la interfaz — AVISA (Next.js/React → Angular)

> **Tipo de documento:** diagnóstico de solo lectura (no modifica código).
> **Objetivo:** servir de checklist de porting para una reescritura en Angular.
> **Base analizada:** `C:\Users\Julia\Downloads\avisa` — Next.js 16.4.3 (App Router), React 19,
> TypeScript 5.7 estricto, Tailwind v4, shadcn + `@base-ui/react`, `lucide-react`,
> `leaflet` 1.9.4 + `react-leaflet` 5.0.0 (`package.json:11-26`).
> **Fecha del inventario:** 2026-11-21.
> **Regla de evidencia:** cada afirmación cita `ruta:línea`. Cuando algo no se pudo
> verificar se marca **«no verificado»** en lugar de suponerlo.

---

## Resumen ejecutivo

- **Vistas de área (`WorkspaceView`)**: 13 (`components/avisa-demo-data.ts:1-13`) + pantalla de login = **14 pantallas**.
- **Pestañas de ficha de caso**: 6 (`components/avisa-workspace.tsx:2204-2211`).
- **Paneles / drawers / modales / overlays**: ~14 (búsqueda, notificaciones, perfil, preferencias, ayuda, ámbito, sidebar móvil, 6 formularios de alta/edición, confirmación de borrado).
- **Total aproximado de superficies navegables**: **≈34**.
- **Endpoints consumidos por el cliente**: 9 (2 de sesión/auth + 7 de datos) — tabla en §3.
- **Mutaciones**: **todas en memoria**; el cliente **no** hace `POST/PUT/PATCH/DELETE` sobre `/api/v1/**`
  (`lib/avisa-store.tsx` — las acciones `create*/update*/delete*` solo llaman a `setState`).
- **Riesgo principal del porting**: `components/avisa-workspace.tsx` (3881 líneas) concentra
  ~13 vistas y decenas de sub-componentes en un solo archivo, con estado local compartido.

---

## 0. Leyenda

| Símbolo           | Significado                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **S**             | Cambio pequeño (< 1 día).                                                                      |
| **M**             | Cambio medio (1–3 días).                                                                       |
| **L**             | Cambio grande (> 3 días) o con dependencia de librería React.                                  |
| `path:line`       | Ubicación exacta en el repositorio.                                                            |
| **React-only**    | Depende de `react`, `react-dom`, `next/*`, `@base-ui/react`, `react-leaflet` o `lucide-react`. |
| **No verificado** | No se pudo confirmar en el código; debe validarse antes de estimar.                            |

---

# 1. Mapa de vistas

## 1.1 Pantalla de acceso — «Bienvenido al aplicativo» (login)

- **Ubicación:** `components/avisa-login.tsx:8-10` (componente en una sola línea compacta);
  montada desde `app/page.tsx`.
- **Datos:** formulario DNI (`maxLength=12`, solo dígitos) + contraseña. Marca «AVISA»,
  «PRODUCE · OAIPCS», panel lateral «AVISA · 2026».
- **Acciones:** «Ingresar al aplicativo» → `login(dni, password)` (`frontend/api.ts:3-12`),
  que hace `POST /api/auth/login` (`frontend/api.ts:4`). Éxito → `onSuccess(session)`.
- **Estados:** error inline `role="alert"` («DNI o clave incorrectos. Verifique sus credenciales.»),
  botón deshabilitado mientras valida (`loading ? 'Validando...'`).
- **Dependencias:** `react` (`useState`, `FormEvent`), `lucide-react`
  (`LockKeyhole`, `ShieldCheck`), `@/frontend/api`, `@/frontend/types`.
- **Restauración de sesión:** `app/page.tsx:21` llama `GET /api/v1/session`; 401 se trata como
  «sin sesión» (`app/page.tsx:26-31`). Logout: `POST /api/auth/logout` (`app/page.tsx:47-52`).
- **Observación:** el guard `if (event.nativeEvent instanceof SubmitEvent === false) return;`
  (`components/avisa-login.tsx:9`) depende de `SubmitEvent` nativo; es frágil fuera de navegadores
  modernos y no debe portarse tal cual.

## 1.2 Shell de la aplicación — `components/avisa-dashboard.tsx`

- **Estructura:** sidebar con grupos de navegación + cabecera (búsqueda, notificaciones, perfil)
  - contenido + footer con descargo de responsabilidad (`components/avisa-dashboard.tsx:543-551`).
- **Grupos de navegación** (`components/avisa-dashboard.tsx:61-76`):
  - MI ESPACIO: «Resumen operativo» (`overview`), «Bandeja de trabajo» (`inbox`).
  - SEGUIMIENTO: «Casos» (`cases`), «Alertas tempranas» (`alerts`), «Compromisos» (`commitments`),
    «Documentos» (`documents`).
  - DIRECTORIO: «Actores», «Organizaciones», «Instituciones», «Locales`.
  - Mapa territorial (`map`) en su propia `nav` (`components/avisa-dashboard.tsx:368-371`).
  - ANÁLISIS: «Resumen de Dirección» (`executive`) (`components/avisa-dashboard.tsx:378-388`).
- **Selector de ámbito**: `ScopePopover` región + ventana temporal (`components/avisa-dashboard.tsx:340-367`),
  con rango personalizado y mensaje de validación (`:458-493`).
- **Cabecera**: buscador (abre overlay), campana de notificaciones, menú de perfil con «Cerrar sesión»
  (`components/avisa-dashboard.tsx:301-318`). En móvil, botón de sidebar + scrim (`:419-425`).
- **Avisos inline**: `rangeMessage`, `systemNotice`, `storeNotice` (`:495-518`).
- **Estado de carga** del shell: `components/avisa-dashboard.tsx:520-524`.
- **Contenido** conmutable: `<WorkspaceViewContent key={view} …>` (`:527`).
- **Drawers globales**: `PreferencesDrawer` y `HelpDrawer` montados siempre (`:554-558`).
- **Dependencias:** todo `react`, `lucide-react`, `@/lib/avisa-store`, `@/lib/theme`,
  `avisa-search`, `avisa-notifications`, `avisa-preferences`, `avisa-glossary`, `avisa-scope-filter`.

## 1.3 Vistas de área (dispatch en `WorkspaceViewContent`)

Cadena de despacho en `components/avisa-workspace.tsx:420-1528`. Todas comparten props
`regionScope`, `timeScope`, `timeRange`, `assignedRegions`, `unrestricted` y el store `useAvisa()`.

| #   | Nombre en UI (ES)    | `view`                    | Código                                                          | Datos que muestra                                                                        | Acciones expuestas                                                                                     |
| --- | -------------------- | ------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Resumen operativo    | `overview`                | `avisa-workspace.tsx:1942-2202`                                 | StatCards, superficie de prioridad, señales, tabla de casos                              | navegar a vistas, abrir ficha; **KPIs demo hardcodeados** (`:2016-2029`)                               |
| 2   | Bandeja de trabajo   | `inbox`                   | `avisa-workspace.tsx:434-655`, tarjeta `InboxCard` `:1531-1819` | Entradas derivadas de compromisos/alertas/casos de riesgo alto; ranking 1–4 (`:520-525`) | filtros tipo/visor/búsqueda; asignar, posponer, completar (paneles inline)                             |
| 3   | Casos                | `cases`                   | `avisa-workspace.tsx:656-1079`                                  | Rejilla/tabla de casos; filtros Riesgo/Estado/Prioridad/Alcance/Temática/Unidad          | cambiar vista, orden, paginar, limpiar filtros, exportar CSV (`:747-781`), abrir ficha                 |
| 4   | Ficha de caso        | `case-detail`             | `CaseDetail` `:2503-3297`                                       | Resumen, actores (PII), demanda, cronología, documentos, alertas, compromisos            | 6 pestañas, archivar caso (`:2606-2616`), alta de demanda/hito/documento                               |
| 5   | Actores              | `directory-actors`        | `avisa-directory.tsx:25-49` vía `:1088-1096`                    | Tabla de 6 registros sintéticos hardcodeados                                             | búsqueda local                                                                                         |
| 6   | Organizaciones       | `directory-organizations` | `:1097-1105`                                                    | idem (filtrado por `kind`)                                                               | búsqueda local                                                                                         |
| 7   | Instituciones        | `directory-institutions`  | `:1106-1114`                                                    | idem                                                                                     | búsqueda local                                                                                         |
| 8   | Locales              | `directory-locals`        | `:1115-1123`                                                    | idem                                                                                     | búsqueda local                                                                                         |
| 9   | Mapa territorial     | `map`                     | `avisa-map.tsx:209-855` vía `:1124-1145`                        | Mapa Leaflet + leyenda + listado + cronología espacial                                   | 3 modos, capas, «Ver todos», abrir ficha                                                               |
| 10  | Alertas tempranas    | `alerts`                  | `:1146-1228`, tarjeta `AlertReviewCard` `:3299-3770`            | Cola de alertas, SLA derivado (`:245-269`)                                               | aprobar, descartar (motivo obligatorio), editar cita, atender, reabrir, deshacer, derivar área/fecha   |
| 11  | Compromisos          | `commitments`             | `:1229-1514`, `CommitmentCard` `:2416-2501`                     | Tabla/calendario/resumen de compromisos                                                  | cambiar vista, archivar/restaurar (motivo), hitos, evidencia, exportar «Anexo 14 (CSV)» (`:1249-1298`) |
| 12  | Documentos           | `documents`               | `avisa-documents.tsx:49-532`                                    | Maestro-detalle de documentos y revisión                                                 | filtrar, extraer, re-extraer, validar/rechazar, borrar, fragmentos, versiones                          |
| 13  | Resumen de Dirección | `executive`               | `ExecutiveView` `:3772-3881`                                    | KPIs y narrativa **hardcodeados** («12», «1», «19 nov 2026»)                             | `window.print()`                                                                                       |

**Dependencias React-only comunes a todas:** `react`, `lucide-react`. El mapa añade
`react-leaflet` y `next/dynamic` (`components/avisa-workspace.tsx:80-90`, `ssr:false`).
El tamaño y complejidad de cada vista se detalla en §6.

## 1.4 Pestañas de la ficha de caso

Definidas en `components/avisa-workspace.tsx:2204-2211`:

| Pestaña     | Contenido principal                                                                                   | Acciones                               |
| ----------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Resumen     | Identidad del caso, riesgo derivado, próximo paso (`riskNextStep` `:2228-2232`), ruta de intervención | abrir paneles                          |
| Demandas    | Tabla de demandas                                                                                     | alta (`DemandaForm`)                   |
| Cronología  | `events` del caso                                                                                     | alta de hito (`CaseEventForm`)         |
| Documentos  | Documentos vinculados al caso                                                                         | carga (`DocumentUploadForm`), revisión |
| Alertas     | Alertas del caso                                                                                      | revisión (`AlertReviewCard`)           |
| Compromisos | Compromisos del caso                                                                                  | hitos, evidencia                       |

> El riesgo del caso es **derivado** de la última alerta aprobada (`latestApprovedRisk`
> `components/avisa-workspace.tsx:229`), no un campo directo del caso. Es el comportamiento heredado:
> la Guía y la decisión de producto fijan el riesgo como **atributo del caso** (Bajo · Moderado ·
> Alto); la alerta no tiene un nivel de riesgo propio.

## 1.5 Paneles, drawers, modales y overlays

| Superficie                 | Código                                            | Qué hace                                                                   | React-only                         |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| Búsqueda global            | `avisa-search.tsx:1-418`                          | Búsqueda transversal local, agrupada, máximo 12 resultados (`MAX_RESULTS`) | `react`, `lucide-react`            |
| Notificaciones             | `avisa-notifications.tsx:1-217`                   | Campana, contador no leídas, marcar leída/todas                            | `react`                            |
| Menú de perfil             | `avisa-dashboard.tsx:301-318`                     | Datos de sesión, «Cerrar sesión»                                           | `react`                            |
| Ajustes / Preferencias     | `avisa-preferences.tsx:1-540`                     | Tema, densidad, notificaciones; `localStorage` `avisa-preferences-v1`      | `useSyncExternalStore`, focus trap |
| Ayuda / Glosario           | `avisa-glossary.tsx:1-487`                        | 10 términos + ayuda contextual (evento `openHelp`)                         | `react`                            |
| Selector de ámbito         | `avisa-scope-filter.tsx:225-266`                  | Región + ventana temporal, popover con `createPortal`                      | `react-dom` portal                 |
| Sidebar móvil              | `avisa-dashboard.tsx:419-425`                     | Navegación en móvil + scrim                                                | `react`                            |
| Alta/edición de caso       | `avisa-crud.tsx:172-472` (`CaseForm`)             | Formulario con validación UBIGEO y duplicado                               | `react`                            |
| Alta/edición de alerta     | `avisa-crud.tsx:474-726` (`AlertForm`)            | SLA 24/48/72 por prioridad (`:499-500`)                                    | `react`                            |
| Alta/edición de compromiso | `avisa-crud.tsx:728-1179` (`CommitmentForm`)      | Formulario largo                                                           | `react`                            |
| Alta/edición de demanda    | `avisa-crud.tsx:1233-1418` (`DemandaForm`)        | Selector de fuente (`DemandaFuentePicker` `:1183`)                         | `react`                            |
| Hito de caso               | `avisa-crud.tsx:1420-1523` (`CaseEventForm`)      | Cronología                                                                 | `react`                            |
| Carga de documento         | `avisa-crud.tsx:1525-1654` (`DocumentUploadForm`) | Subida/registro                                                            | `react`                            |
| Confirmación de borrado    | `avisa-crud.tsx:137-170` (`DeleteButton`)         | Confirmación «armada» de dos pasos                                         | `react`                            |

Contenedor común de formularios: `FormDrawer` (`avisa-crud.tsx:44-117`) y `Field` (`:119`),
con `lockDismiss` para evitar cierre accidental.

## 1.6 Sub-paneles embebidos (fáciles de olvidar)

- **Bandeja:** paneles inline «asignar / posponer / completar» dentro de `InboxCard`
  (`components/avisa-workspace.tsx:1531-1819`).
- **Alertas:** sub-paneles de `AlertReviewCard` — aprobar, descartar con motivo, editar cita,
  atender, reabrir, deshacer última acción y derivación (`derivarArea`, `derivarFecha` con
  fecha por defecto +2 días, `:3320-3323`).
- **Compromisos:** editor de hitos (`:2276-2359`), formulario de evidencia (`:2361-2414`),
  control de archivado con motivo obligatorio (`CommitmentArchiveControl` `:1821-1887`),
  desglose (`CommitmentBreakdown` `:1889-1940`).
- **Documentos:** maestro-detalle + validación de fragmentos + historial de versiones
  (`avisa-documents.tsx:230-532`, `DocumentReview`).
- **Mapa:** barra de modos, toggles de capas, leyenda, listado agrupado, cronología
  (`avisa-map.tsx:458-852`).

---

# 2. Inventario de interacción

## 2.1 Estado local de `avisa-workspace.tsx` (state → efecto)

Bloque exacto en `components/avisa-workspace.tsx:338-359`:

| `useState`         | Valores                                | Controla                                                                        |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| `search`           | texto                                  | búsqueda en la vista activa (bandeja/casos/alertas/compromisos/docs según rama) |
| `filter`           | `"Todos"` + niveles                    | filtro de **Riesgo** en Casos                                                   |
| `inboxType`        | `"Todos"` + tipos                      | tipo de entrada en Bandeja                                                      |
| `notice`           | texto                                  | aviso inline de acciones                                                        |
| `caseViewMode`     | `"grid" \| "table"`                    | presentación de Casos                                                           |
| `caseSort`         | `"recent" \| "risk" \| "priority"`     | orden de Casos                                                                  |
| `casePage`         | número                                 | paginación de Casos (`CASE_PAGE_SIZE = 6`, `:204`)                              |
| `caseEstado`       | `"Todos"` + estados                    | filtro Estado                                                                   |
| `casePrioridad`    | `"Todos"` + prioridades                | filtro Prioridad                                                                |
| `caseAlcance`      | `"Todos"` + alcances                   | filtro Alcance                                                                  |
| `caseTematica`     | `"Todos"` + temáticas                  | filtro Temática                                                                 |
| `caseUnidad`       | `"Todos"` + unidades                   | filtro Unidad responsable                                                       |
| `inboxViewer`      | `"equipo" \| "mio"`                    | visor de Bandeja (`demoViewer` `:207-211`)                                      |
| `inboxAssignments` | `Record<string,string>`                | asignaciones **solo en sesión**                                                 |
| `alertStatus`      | `"Todos"` + estados                    | filtro de Alertas                                                               |
| `commitmentStatus` | `"Todos"` + estados                    | filtro de Compromisos                                                           |
| `commitmentView`   | `"tabla" \| "calendario" \| "resumen"` | presentación de Compromisos                                                     |
| `showArchived`     | booleano                               | mostrar archivados (soft-delete)                                                |

> **Nota de paridad:** este estado vive en el componente; al cambiar de `view` el contenido se
> remonta (`key={view}`, `avisa-dashboard.tsx:527`), por lo que **los filtros se reinician** al
> navegar. Un port ingenuo que use un servicio singleton cambiaría ese comportamiento.

## 2.2 Estado del shell (`avisa-dashboard.tsx:96-143`)

`view`, `selectedCode`, `sidebarOpen`, `scopeOpen`, `profileOpen`, `settingsOpen`,
`regionScope` (por defecto desde `preferences.defaultRegion`), `timeScope`
(`7/30/90 días` | `Personalizado`), `customFrom`, `customTo`, `systemNotice`.

Derivados: `assignedRegions` (`normalizeAssignedRegions`), `unrestricted`
(sin asignación explícita **y** rol en Admin/Directora/Autoridad, `:109-111`),
`pendingAlerts`, `scopedCaseCount`, `scopedOverdueCommitments`.

## 2.3 Filtros

- **Ámbito regional** (`regionScope`): valores `REGION_SCOPES = ["Piura","Áncash","Junín"]`
  más «Todo el Perú» (`avisa-scope-filter.tsx`). Filtrado por `isTerritoryVisible(...)`.
- **Ventana temporal** (`timeScope` / rango personalizado): `isWithinDemoWindow(...)`,
  validación con `isValidTimeRange(...)` y descripción con `describeTimeScope(...)`.
- **Por vista:** Casos (6 filtros), Bandeja (tipo + visor), Alertas (estado), Compromisos
  (estado + archivados), Documentos (consulta/estado/tipo), Directorio (búsqueda local).
- **«Limpiar filtros»** en Casos (`components/avisa-workspace.tsx:656-1079`).

## 2.4 Paginación y orden

- Paginación: **solo Casos**, cliente, `CASE_PAGE_SIZE = 6` (`:204`), con `casePage`.
- Orden: `caseSort` con `recent | risk | priority`.
- El resto de vistas lista todo lo filtrado, sin paginación.
- **Contrato:** los endpoints aceptan `page/pageSize/sort/filter` (`app/api/v1/cases/route.ts:13-23`),
  pero **el cliente no los envía**; todo se pagina/ordena en el navegador.
- **Destino Angular:** paginación de servidor en todas las listas; la fachada `consulta<T>` ya envía
  `pagina`/`tamanoPagina` (`angular/src/app/core/http/coleccion.ts`).

## 2.5 Búsqueda

- **Búsqueda global** (`avisa-search.tsx`): local sobre casos/alertas/compromisos/documentos,
  agrupada por entidad, `MAX_RESULTS = 12`; combobox con `ArrowUp/ArrowDown/Enter/Escape`.
- **Búsquedas por vista:** campo local en Bandeja, Casos, Alertas, Compromisos, Documentos,
  Directorio.
- **No existe** búsqueda contra `/api/v1/search` aunque el endpoint exista (§3.2).

## 2.6 Selección y acciones masivas

- Selección de fila/punto para abrir ficha (casos, mapa, notificaciones).
- **No se encontró selección múltiple con barra de acciones masivas** (no verificado en el resto;
  grep de `checkbox` masivo no arrojó un patrón de bulk en las vistas principales).
- Lo más cercano: «marcar todas como leídas» en Notificaciones (`avisa-notifications.tsx`).

## 2.7 Atajos de teclado

- **No hay command palette ni `Cmd/Ctrl+K`.** Verificado: no hay usos de `metaKey`/`ctrlKey`
  en el código de UI. El único teclado es el combobox de búsqueda
  (`ArrowUp/Down/Enter/Escape`, `avisa-search.tsx`).
- Focus trap en Preferencias (`avisa-preferences.tsx`) y cierre con `Escape` en drawers/modales.

## 2.8 Toasts y avisos

- **No hay librería de toasts.** Se usan avisos inline:
  - `notice` dentro del workspace (`:341`) y `setNotice(...)` en mutaciones del store,
  - `systemNotice` y `storeNotice` en el shell (`avisa-dashboard.tsx:495-518`),
  - `demo-notice` / `form-error` / `role="alert"` en componentes.

## 2.9 Confirmaciones

- `DeleteButton` en dos pasos («armar» → confirmar) (`avisa-crud.tsx:137-170`).
- Descarte de alerta y archivado de compromiso exigen **motivo obligatorio**.
- Validación de documento exige confirmación (`avisa-documents.tsx:230-532`).
- «Archivar caso» es soft-delete vía `updateCase({estado:"Archivado", stage:"Archivado"})`
  (`components/avisa-workspace.tsx:2606-2616`).

## 2.10 Estados vacío / carga / error

- Compartidos en `components/avisa-view-state.tsx:1-152`: `LoadingState`, `EmptyState`,
  `ErrorState` y `ViewErrorBoundary` (componente de clase).
- El mapa se envuelve en `ViewErrorBoundary` (`components/avisa-workspace.tsx:1124-1145`).
- El shell muestra `LoadingState` mientras hidrata (`avisa-dashboard.tsx:520-524`).
- **No se encontraron skeletons** (placeholders de forma); se usa spinner + texto
  (`LoadingState`). En Angular, decidir si se replica el spinner o se mejora a skeleton (cambio de paridad).

---

# 3. Superficie de API consumida

## 3.1 Endpoints → llamador → campos leídos

Todos los mapeos están en `lib/api-mappers.ts`. La tabla indica qué campos del payload
consume el mapper y si son claves **EN** (inglés) o **ES** (español).

> **Estado del contrato:** hoy las rutas siguen en inglés (`/api/v1/cases`, `/api/v1/alerts`, …);
> la API en español está **decidida y pendiente**. La normalización EN/ES vive en los mapeos, no en
> las plantillas.

| Endpoint                          | Llamador                                       | Entidad / mapper            | Campos leídos del payload                                                                                                                                                                                                    | Idioma       |
| --------------------------------- | ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `GET /api/v1/session`             | `app/page.tsx:21`                              | `mapSessionUser`            | `user` (nombre, rol, regiones)                                                                                                                                                                                               | mixto        |
| `POST /api/auth/login`            | `frontend/api.ts:4`                            | devuelve `Session` directo  | credenciales → `Session`                                                                                                                                                                                                     | —            |
| `POST /api/auth/logout`           | `app/page.tsx:47`                              | — (fire & forget)           | —                                                                                                                                                                                                                            | —            |
| `GET /api/v1/cases?page&pageSize` | `lib/avisa-store.tsx:240` vía `apiGetAllPages` | `ApiCaseListItem`           | `code, title, region, risk, stage, updated, progress, summary` (EN) + `alcance, estado, nivelConflicto, prioridad, subsector, unidadResponsable, tematica, origen` (ES)                                                      | **mixto**    |
| `GET /api/v1/cases/{code}`        | `lib/avisa-store.tsx:243`                      | `ApiCaseDetail` → `mapCase` | `actors, events, demandas` (EN)                                                                                                                                                                                              | mixto        |
| `GET /api/v1/alerts`              | `lib/avisa-store.tsx:264`                      | `mapAlert`                  | `codigo?/id, titulo, distrito, fuenteDescripcion, fuenteTipo, fechaReporte, prioridad, grave, estado, descripcionRiesgo, situacionActual, hechosRecientes, casoCode, slaHoras, origen, validado, riesgos, accionesSugeridas` | ES dominante |
| `GET /api/v1/commitments`         | `lib/avisa-store.tsx:268`                      | `mapCommitment`             | `codigo, id, accion, casoCode, unidad, fechaVencimientoEfectiva, fechaVencimiento, tipo, nivelGobierno, documentoOrigenId, evidenciaUri, atiendeGenero, fechaInicio, origen, validado, hitos[]`                              | ES dominante |
| `GET /api/v1/documents`           | `lib/avisa-store.tsx:272`                      | `mapDocument`               | `codigo, titulo, archivo, origen, estadoUi, confianza, resumen, casoCode, fecha`                                                                                                                                             | ES dominante |
| `GET /api/v1/notifications`       | `lib/avisa-store.tsx:276` (página única)       | `mapNotification`           | `id, tipo, entidadTipo, entidadId, venceEn, estado, createdAt`                                                                                                                                                               | ES           |

Detalle de selectores y mapeos: `lib/api-mappers.ts:615-643` (`mapCase`), `:645-660`
(`mapAlert`), `:670-699` (`mapCommitment`), `:702-721` (`mapDocument`), `:723-736`
(`mapNotification`), `:577-590` (`mapActor`).

## 3.2 Endpoints que existen y la UI no consume

Verificado por listado de `app/api/v1/`:

- `actors`, `catalogs`, `demandas`, `search`, `health`.
- La UI **no** consulta `actors` (el directorio es estático, `avisa-directory.tsx:9-18`;
  el store expone `actors: []` hardcodeado, `lib/avisa-store.tsx:365`).
- `search` existe pero el buscador global es local (`avisa-search.tsx`).
- `catalogs` existe pero los catálogos están duplicados en `components/avisa-catalogs.ts`.

> **Riesgo latente:** el formulario manual de caso crea registros con `actors: []`
> (`lib/avisa-store.tsx:362-366`) y nunca consulta `actors`, por lo que la ficha de un caso
> nuevo siempre aparece sin actores.

## 3.3 Discrepancias de contrato (verificadas)

1. **`refCode` es UUID, no código de caso.** `mapNotification` asigna
   `refCode: item.entidadId` (`lib/api-mappers.ts:734`), y el repo entrega `entidad_id::text`
   (UUID, `lib/db/repos/notifications.ts:39`). Pero `openNotificationTarget`
   (`components/avisa-dashboard.tsx:206-209`) pasa ese valor a `openCaseByCode`, que compara
   con `row.code` (`:203`). Como consecuencia, **«Abrir registro» desde una notificación
   no abre el caso correcto**.
2. **El riesgo derivado nunca se activa con datos reales.** `latestApprovedRisk` exige
   `alert.status === "Aprobada"` (`components/avisa-workspace.tsx:229`), pero
   `pickAlertStatus` mapea `Validada`/`En revisión` a `"Pendiente de revisión"`
   (`lib/api-mappers.ts:453-465`) y nada produce `"Aprobada"`. Además `mapAlert` **no** mapea
   `risk` (`:654`). (Las etiquetas quedan **congeladas**: el cliente no debe normalizar variantes
   legadas; la etiqueta canónica del catálogo es la única que se muestra.)
3. **Alertas sin tipo ni riesgo.** `mapAlert` deja `risk` y `alertType` sin definir
   (`lib/api-mappers.ts:654-655`): `RiskBadge` cae en «Inactivo» y `alertTypeLabel` siempre
   devuelve el valor por defecto `AT`. En el modelo canónico la alerta **no** tiene nivel de riesgo:
   describir el escenario es su función y el riesgo es del caso.
4. **Compromisos degradados.** `progress` fijado en `0` (`:687`), `owner = unidad` (`:683`),
   `clasificacion` numérica sin mapear (`:693`) y estado colapsado a
   `Cumplido/Paralizado/En curso` (`:467-475`); **«Por vencer» nunca se produce**. (En la Guía,
   `Paralizado` es estado de hito; el compromiso usa `Por iniciar` · `En proceso` · `Cumplido` ·
   `Redefinido` · `Desestimado`.)
5. **Documentos incompletos en listado.** `subidoPor: ""` (`:717`), `fragmentos: []` y
   `extracciones: []` (`:718-720`); `tipo` solo distingue `relatoria|acta` (`pickDocKind` `:519-534`).
6. **Casos con campos ausentes.** `subject: ""` (`:622-623`), y `documentacionNormativa`,
   `puntoFocal`, `validado` sin dato (`:636-641`).
7. **Actores con nombre partido mal.** `apellidos: ""` y todo el nombre en `nombres`
   (`:577-580`); `teléfono` nunca llega por API (la consulta de detalle no lo trae).
8. **Notificaciones sin título/detalle/leída.** El repo no expone esos campos
   (`lib/db/repos/notifications.ts:23-27`); el mapper usa `tipo` como título y `entidadId`
   como detalle (`lib/api-mappers.ts:728-735`), y fuerza `leida: false`.
9. **Nomenclatura bilingüe.** Los payloads mezclan claves EN (`code, title, region, risk, stage,
updated, progress, summary, actors, events, demandas`) con claves ES (`prioridad, alcance,
nivelConflicto, tematica, subsector, unidadResponsable, origen, slaHoras, fechaReporte,
descripcionRiesgo, estadoUi, tipoNombre, fechaVencimientoEfectiva, estadoCategoria`).
   Cualquier capa de tipos Angular debe reflejar **ambas** formas.

> Todo lo anterior es **client-side** y sobrevive al port salvo que se corrija el contrato o el
> mapper. Recomendación: decidir explícitamente si el rewrite **arregla** o **replica** estas
> discrepancias (ver §6, ítems marcados «fidelidad»).

---

# 4. Activos agnósticos de framework (alto valor para el rewrite)

| Activo                                             | Qué es exactamente portable                                                                                                                                                                                                                                                             | Qué hay que reescribir                                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/api-mappers.ts` (`:1-736`)                    | Tipos `Api*`, selectores `pick*`, `mapCase/mapAlert/mapCommitment/mapDocument/mapNotification/mapSessionUser` y helpers de fecha: TS puro.                                                                                                                                              | Solo el `import` de `@/components/avisa-demo-data` (relocalizar) y renombrar tipos `Demo*` si se quiere.                                                                                                                     |
| `components/avisa-catalogs.ts` (`:3-266`)          | Catálogos (`conflictLevels`, `themes`, `subsectors`, `priorities`, `geographicScopes`), `macroRegions`, `deriveGeographicScope`, `territoryMatchesScope`, parser tolerante `parseDemoDate/parseDemoDateTime`, `toDateInputValue`, `deriveCommitmentStatus`, `deriveCommitmentDueState`. | `demoReferenceDate` (`:126`) es un **ancla fija** (21 nov 2026) que en producción debe ser «hoy» real.                                                                                                                       |
| `components/avisa-ubigeo.ts` (`:1-88`)             | Catálogo curado de 38 distritos.                                                                                                                                                                                                                                                        | Nada (es data); validar contra fuente oficial RENIEC si se requiere.                                                                                                                                                         |
| `components/avisa-export.ts` (`:1-67`)             | `downloadCsv` (BOM UTF-8, CRLF, escape) + `demoExportNote`.                                                                                                                                                                                                                             | Solo el DOM (`Blob`, `document.createElement`); en Angular se puede mantener o mover a un servicio.                                                                                                                          |
| `components/avisa-scope-filter.tsx` (partes puras) | `isValidTimeRange`, `describeTimeScope`, `isWithinDemoWindow`, `normalizeAssignedRegions`, `isTerritoryVisible`, `REGION_SCOPES`.                                                                                                                                                       | El componente/popover y el `createPortal` (`:225-266`) se reescriben.                                                                                                                                                        |
| `components/avisa-demo-data.ts:1-211`              | **Solo tipos** (`WorkspaceView`, `RiskLevel`, `DemoCase`, `DemoAlert`, `DemoCommitment`, `DemoDocument`, `DemoNotification`, `DemoActor`…) y `docKindLabels`.                                                                                                                           | Las ~430 líneas de **datos demo** no deben sobrevivir.                                                                                                                                                                       |
| `scripts/generate_dark_theme.mjs` (`:1-18`)        | Script Node que transforma `globals.css` → `theme-dark.generated.css`; framework-agnóstico.                                                                                                                                                                                             | Solo actualizar `SOURCE`/`TARGET` si cambian rutas; idealmente adaptarlo a SCSS/tokens Angular.                                                                                                                              |
| `app/globals.css:5-25`                             | Tokens CSS: `--ink, --ink-2, --muted, --line, --paper, --canvas, --blue, --blue-dark, --blue-pale, --teal, --amber, --amber-pale, --red, --red-pale, --green, --green-pale, --font-sans, --font-display`.                                                                               | El resto del archivo (6782 líneas) son clases planas con **muchos colores literales** (según el propio script, `scripts/generate_dark_theme.mjs:1-5`); reutilizable si se conserva el CSS, pero conviene convertir a tokens. |
| `app/theme-dark.generated.css:7-24`                | Bloque de tokens del tema oscuro (`html[data-theme="dark"]`), regenerable.                                                                                                                                                                                                              | Regenerar con el script tras cualquier cambio.                                                                                                                                                                               |
| `lib/api-client.ts` (`:1-120`)                     | `ApiClientError`, `apiGet`, `apiGetAllPages` (pageSize 100, máx. 50 páginas).                                                                                                                                                                                                           | Reescribir como fachada de `HttpClient` + interceptor (credenciales, errores).                                                                                                                                               |
| `app/layout.tsx:38-52`                             | Bootstrap del tema en `<script>` inline (vanilla JS).                                                                                                                                                                                                                                   | Portar como script `index.html` o `APP_INITIALIZER` equivalente.                                                                                                                                                             |
| `components/avisa-glossary.tsx`                    | Datos del glosario (10 términos) y textos de ayuda.                                                                                                                                                                                                                                     | El drawer y el evento `openHelp` se reescriben.                                                                                                                                                                              |
| `lib/utils.ts`                                     | `cn()` (combinación de clases con `clsx`/`tailwind-merge`).                                                                                                                                                                                                                             | Sustituir por `ngClass`/helpers; solo relevante si se mantiene Tailwind.                                                                                                                                                     |
| `frontend/types.ts`                                | `Session`, `Role`.                                                                                                                                                                                                                                                                      | **Ojo:** `CaseRecord`, `AlertRecord`, `DashboardData` parecen **no usarse** (no verificado por completo); no portar a ciegas.                                                                                                |

**No verificado:** no se leyó íntegro `app/globals.css` (6782 líneas), por lo que no se puede
afirmar cuántas clases son reutilizables sin conflicto; solo se confirmaron los tokens y el
mecanismo del generador.

---

# 5. Dependencias exclusivas de React

## 5.1 Importaciones y equivalente Angular

| Paquete          | Dónde se usa                                                                                     | Patrón                                                                | Equivalente Angular                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `react`          | Prácticamente todos los componentes (`"use client"` en la cabecera)                              | `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, contexto | Componentes standalone + signals/RxJS; `OnPush`                                       |
| `react-dom`      | `createPortal` en `avisa-scope-filter.tsx:225-266`                                               | Portal con posicionamiento manual y «abrir hacia arriba»              | `cdkOverlay` (CDK) o portal a `body`                                                  |
| `next/dynamic`   | `avisa-workspace.tsx:80-90` (`ssr:false`)                                                        | Carga diferida del mapa                                               | `@defer` / carga lazy de componente Leaflet                                           |
| `@base-ui/react` | **Solo** `components/ui/button.tsx` (archivo **muerto**, no importado)                           | —                                                                     | Eliminar; no portar                                                                   |
| `react-leaflet`  | `avisa-map.tsx:4-11` (`MapContainer`, `TileLayer`, `CircleMarker`, `Popup`, `Tooltip`, `useMap`) | Mapas declarativos                                                    | **`leaflet` directo** dentro de un componente Angular (no hay wrapper oficial maduro) |
| `lucide-react`   | Todo el UI (iconos)                                                                              | Componentes SVG                                                       | `lucide-angular` (existe y es 1:1)                                                    |

**Contexto / estado global:** `lib/avisa-store.tsx` usa `React.Context` (`AvisaProvider`,
`useAvisa`), con `Promise.allSettled` para hidratar 5 fuentes. En Angular → servicio
`providedIn: 'root'` con signals, o un store (NgRx/Elf) si se quiere reactividad fina.

**`useSyncExternalStore`** + caché a nivel de módulo en `avisa-preferences.tsx` →
servicio Angular + `localStorage`, con valor inicial seguro para SSR.

**Error boundary de clase** (`avisa-view-state.tsx`) → no hay equivalente exacto; usar
`ErrorHandler` global + `*ngIf` de respaldo, o un componente que capture errores del hijo vía
`try/catch` en el servicio.

## 5.2 Los 5 puntos más duros de portar

1. **`components/avisa-workspace.tsx` (3881 líneas)** — 13 vistas + ~12 sub-componentes +
   estado compartido de 18 variables + lógica derivada (SLA, riesgo, conteos). Es un monolito;
   hay que descomponerlo en módulos/rutas antes de portar. **L**.
2. **`components/avisa-crud.tsx` (1654 líneas)** — 6 formularios con validaciones cruzadas
   (UBIGEO, duplicado título+región, SLA por prioridad) y un `FormDrawer` con `lockDismiss`.
   Requiere `ReactiveForms` con validadores custom y un `Dialog` reutilizable. **L**.
3. **`components/avisa-map.tsx` (855 líneas)** — clusters manuales, offsets por índice,
   `AutoFit`/`FocusOnPoint`/`FitAllButton` monkey-patched sobre `useMap`, popups y tooltips
   declarativos. Se reescribe casi entero con `leaflet` imperativo + `ngZone.runOutsideAngular`.
   **L**.
4. **`lib/avisa-store.tsx` (1117 líneas)** — contexto con hidratación parcial tolerante a fallos,
   _fallback_ a datos demo si fallan las 5 fuentes, y mutaciones **en memoria** que simulan
   persistencia. Definir el contrato real de escritura antes de portar; si no, se replica el
   comportamiento falso. **L**.
5. **Búsqueda global + popover de ámbito + preferencias** — combobox accesible con teclado,
   portal con posicionamiento y _focus trap_. Son 3 patrones interactivos a reimplementar con
   CDK (`cdkOverlay`, `cdkTrapFocus`, `cdkListbox`). **M–L**.

---

# 6. Checklist de paridad

> Marcar solo cuando el comportamiento exista **y** se vea igual. Tamaño: S/M/L.

## 6.1 Acceso y shell

- [ ] Login con validación de DNI (mín. 8) y contraseña, error inline `role="alert"` — **S**
- [ ] Botón en estado «Validando...» y deshabilitado — **S**
- [ ] Restauración de sesión con `GET /api/v1/session` y 401 silencioso — **S**
- [ ] Logout con `POST /api/auth/logout` — **S**
- [ ] Sidebar con los 4 grupos + «Mapa territorial» + «Resumen de Dirección» — **M**
- [ ] Sidebar móvil con scrim y cierre — **M**
- [ ] Selector de ámbito región + ventana (7/30/90/personalizado) con **mensaje de validación** — **L**
- [ ] Avisos inline de ámbito, sistema y store — **S**
- [ ] Footer de descargo de responsabilidad — **S**
- [ ] Contadores de navegación (alertas pendientes, casos, compromisos vencidos) — **M**
- [ ] **Fidelidad:** los filtros se reinician al cambiar de vista — **S**

## 6.2 Resumen operativo

- [ ] Tarjetas de estadísticas desde datos reales — **M**
- [ ] Superficie de prioridad y señales — **M**
- [ ] Tabla de casos con navegación a ficha — **M**
- [ ] **Fidelidad:** KPIs demo «78%» / «18» con etiqueta «Cifra demo · sin regla definida» (`avisa-workspace.tsx:2016-2029`): se **retiran**, no se replican cifras de demostración — **S**

## 6.3 Bandeja de trabajo

- [ ] Entradas derivadas de compromisos/alertas/casos de riesgo alto — **L**
- [ ] Ranking 1–4 y criterio visible — **M**
- [ ] Filtros tipo y visor (equipo / mío) — **M**
- [ ] Paneles inline asignar / posponer / completar — **L**
- [ ] Aviso de que la asignación «solo afecta a esta sesión» — **S**
- [ ] Estado vacío — **S**

## 6.4 Casos

- [ ] Rejilla y tabla conmutable — **M**
- [ ] Filtros: búsqueda, Riesgo, Estado, Prioridad, Alcance, Temática, Unidad — **L**
- [ ] «Limpiar filtros» — **S**
- [ ] Orden reciente / riesgo / prioridad — **M**
- [ ] Paginación en servidor con navegación (`?pagina&tamanoPagina`, `total` en la respuesta) — **M**
- [ ] «Exportar PDF/Excel/JSON» — **M**; decidido, pendiente de implementación (E5: hoy no existe)
- [ ] Demandas sin caso dentro de Casos, con la ruta `casos/sin-caso` declarada **antes** de `casos/:codigo` — **M**
- [ ] Abrir ficha — **S**
- [ ] Estado vacío y de carga — **S**

## 6.5 Ficha de caso

- [ ] 6 pestañas: Resumen, Demandas, Cronología, Documentos, Alertas, Compromisos — **L**
- [ ] Riesgo del caso como **atributo** (Bajo/Moderado/Alto); la alerta no lleva nivel de riesgo — **M**
- [ ] «Próximo paso» según riesgo — **M**
- [ ] Tabla de actores con PII (**correo/teléfono**), «No registrado» cuando falta — **M**
- [ ] **DNI y teléfonos visibles para los perfiles autorizados** (sectoristas, dirección OAIPCS, alta dirección), **bajo demanda al abrir la ficha, con motivo y auditados**: lo que cambian son las reglas de acceso — **M**
- [ ] Documentos normativos — **M**
- [ ] Ruta de intervención — **M**
- [ ] Anulación lógica con restauración: decidida; sin endpoint `anular`/`restaurar`, la UI **no** ofrece el botón (E2) — **M**
- [ ] Alta de demanda / hito / documento desde la ficha — **L**

## 6.6 Alertas tempranas

- [ ] Cola con filtro de estado — **M**
- [ ] **SLA derivado** (24/48/72 h y sin plazo por prioridad) visible — **L**
- [ ] Aprobar — **M**
- [ ] Descartar con **motivo obligatorio** — **M**
- [ ] Editar cita — **S**
- [ ] Atender / Reabrir — **M**
- [ ] Deshacer última acción — **M**
- [ ] Derivar con área y fecha por defecto +2 días — **M**
- [ ] **Fidelidad:** `risk`/`alertType` llegan vacíos por contrato — **S**

## 6.7 Compromisos

- [ ] Vistas tabla / calendario / resumen — **L**
- [ ] Calendario mensual con «Hoy (demo)» y bloque sin fecha — **M**
- [ ] Filtro de estado y búsqueda — **M**
- [ ] Mostrar/ocultar archivados — **S**
- [ ] Archivar con motivo obligatorio y restaurar — **M**; la restauración depende de E2 (sin endpoint, no se ofrece)
- [ ] Vencimiento: `fecha_vencimiento` manual > próximo hito > aviso para registrarla a mano — **M**
- [ ] Editor de hitos — **M**
- [ ] Registro de evidencia — **M**
- [ ] Exportar «Anexo 14» en PDF/Excel/JSON — **M**; decidido, pendiente de implementación (E5)
- [ ] Desglose por estado — **M**
- [ ] **Fidelidad:** progreso siempre 0 y estado colapsado a 3 valores — **S**

## 6.8 Documentos

- [ ] Maestro-detalle con filtros consulta/estado/tipo — **L**
- [ ] Extraer / re-extraer — **M**
- [ ] Validar (con confirmación) / rechazar (con motivo) — **M**
- [ ] Eliminar (confirmación) — **S**
- [ ] Validación de fragmentos (aceptar/rechazar extracciones) — **L**
- [ ] Historial de versiones — **M**
- [ ] Estado vacío y de error — **S**

## 6.9 Directorio (4 vistas)

- [ ] Tabla con búsqueda local — **M**
- [ ] Contacto (DNI/teléfonos) visible para los perfiles autorizados, **bajo demanda, con motivo y auditado** — **S**
- [ ] Filtrado por ámbito regional — **M**
- [ ] **Fidelidad:** los 6 registros sintéticos se retiran; el directorio se alimenta de datos reales — **S**

## 6.10 Mapa territorial

> **Aplazado por decisión del usuario (2026-11-22)** hasta que exista el dataset de ubigeo/centroide.
> La ruta `/mapa` sigue en marcador; no se documentan coordenadas ni una fórmula de calibración de
> riesgo. La checklist queda como referencia para cuando se reabra.

- [ ] 3 modos (M_MAPA / M_ZONA / M_ACERVO) con capas por defecto — **L**
- [ ] Toggles de capas casos/documentos/compromisos — **M**
- [ ] Clusters por departamento expandibles — **L**
- [ ] «Ver todos» y auto-ajuste — **M**
- [ ] Selección de punto, centrado y apertura de ficha — **M**
- [ ] Leyenda y listado agrupado — **M**
- [ ] Cronología espacial — **M**
- [ ] Overlay de vacío — **S**
- [ ] Aviso «Mapa demostrativo» — **S**
- [ ] **Observación:** el mapa queda aplazado hasta que exista el dataset de ubigeo/centroide; no se fija aquí ninguna coordenada — **S**

## 6.11 Resumen de Dirección

- [ ] KPIs y narrativa — **M**
- [ ] Botón de impresión (`window.print()`) — **S**
- [ ] **Fidelidad:** las cifras cableadas («12», «1», «19 nov 2026») se retiran; métricas desde agregados reales — **S**

## 6.12 Transversales (fáciles de olvidar)

- [ ] Acentos y etiquetas en **español** en toda la UI — **M**
- [ ] Formato de fecha local y locale `es` — **S**
- [ ] Anulación lógica con restauración: decidida; sin endpoint `anular`/`restaurar`, la UI no ofrece el botón (E2) — **M**
- [ ] Estados deshabilitados por **rol/permiso** (`unrestricted`, Admin/Directora/Autoridad) — **M**
- [ ] Búsqueda global agrupada con teclado — **M**
- [ ] Vocabulario de los doce ejes del glosario en las etiquetas, con el mapeo D9 del ciclo y la correspondencia D10 de `origen_dato` **declarada** (nunca por descarte) — **M**
- [ ] Notificaciones: contador, marcar leída/todas, respeto de preferencias — **M**
- [ ] Preferencias persistentes (tema/densidad/notificaciones) y tema oscuro — **L**
- [ ] Glosario/ayuda contextual — **M**
- [ ] Exportaciones PDF/Excel/JSON, más el JSON de respaldo de una entidad y de la base completa — **M**; decididas, pendientes de implementación (E5)
- [ ] Estados vacío/carga/error en **todas** las vistas — **L**
- [ ] Sin `Cmd/Ctrl+K` hoy: **decidir** si el rewrite lo añade (cambio de alcance) — **S**

---

# 7. Observaciones y olores

## 7.1 Código muerto

- `conflict-resolution-journey.tsx` (**33 líneas**) **nunca se importa**.
- `components/ui/button.tsx` **nunca se importa** y es el **único** archivo que usa
  `@base-ui/react`. Todo el stack shadcn/CVA/Tailwind queda prácticamente sin uso real en el UI.
- Acciones del store `deleteCase`, `deleteAlert`, `deleteCommitment` **no se usan** en
  `components/` (verificado por grep; definidas en `lib/avisa-store.tsx`).
- `frontend/types.ts`: `CaseRecord`, `AlertRecord`, `DashboardData` parecen no usarse
  (**no verificado** exhaustivamente).

## 7.2 Lógica duplicada

- Catálogos: existen en `components/avisa-catalogs.ts` **y** como endpoint `/api/v1/catalogs`
  (no consumido).
- Etiquetas de estado/prioridad repetidas entre `avisa-catalogs.ts`, `api-mappers.ts` y
  `avisa-demo-data.ts`.
- Filtrado por territorio implementado en varios puntos (`isTerritoryVisible` se usa en mapa,
  directorio y workspace), con normalización de tildes repetida (`avisa-map.tsx:107-112`).
- Tres formas de «buscar»: global (`avisa-search`), por vista y por directorio, cada una con su
  propio `toLocaleLowerCase("es")` inline.

## 7.3 Fallbacks de demo que **no** deben sobrevivir

- `lib/avisa-store.tsx:319-331`: si fallan las **5** fuentes, carga `demoCases/demoAlerts/...`
  y avisa «Sin conexión a la base de datos. Se muestran datos de demostración.».
- `lib/avisa-store.tsx:362-366`: crear caso genera código `DEMO-2026-...` y `updated: "Hace un momento"`.
- `components/avisa-catalogs.ts:126`: `demoReferenceDate` fija el «hoy» en 2026-11-21.
- `components/avisa-demo-data.ts`: ~430 líneas de datos ficticios.
- `components/avisa-directory.tsx:9-18`: 6 registros sintéticos.
- Hardcodes de KPI: `components/avisa-workspace.tsx:2016-2029` (Resumen) y
  `:3772-3881` (Dirección).
- Textos «Mapa demostrativo», «datos simulados», «Cifra demo» diseminados.

## 7.4 Cadenas hardcodeadas que deberían ser catálogo

- `REGION_SCOPES` y las coordenadas `ZONE_COORDS` (`avisa-map.tsx:95-102`).
- Colores por riesgo/estado en TS (`avisa-map.tsx:80-93`) en lugar de tokens CSS.
- Umbrales de SLA (24/48/72) en `avisa-crud.tsx:499-500` y `alertSlaState`
  (`avisa-workspace.tsx:245-269`).
- Listas de estados en filtros (`caseEstado`, `alertStatus`, `commitmentStatus`) repetidas.

## 7.5 Qué rompe un port ingenuo

1. **Reinicio de filtros al navegar**: depende de `key={view}` (`avisa-dashboard.tsx:527`);
   un servicio singleton cambiaría la UX.
2. **Estado solo en memoria**: si el rewrite conecta escrituras reales, la UX cambia
   (avisos «solo en esta sesión» dejan de ser ciertos).
3. **Formato de región con `·`**: `departmentKey` parte por «·» (`avisa-map.tsx:114-116`);
   datos sin ese separador pierden el punto en el mapa.
4. **Mapa**: solo 3 departamentos; cualquier región nueva **no se dibuja**.
5. **Riesgo/SLA derivados**: cualquier cambio de contrato (p. ej. mapear `risk`) altera
   insignias, conteos y el próximo paso.
6. **`refCode` UUID**: el enlace notificación → caso está roto hoy; un port fiel lo replica.
7. **Login con `SubmitEvent`**: guard frágil; no portar literal.
8. **Sin toasts ni skeletons**: si Angular introduce un sistema de toasts, hay que decidir
   si se mantiene la paridad de avisos inline.
9. **CSS**: 6782 líneas con colores literales y un generador de tema oscuro; migrar a
   encapsulación Angular (`ViewEncapsulation`) puede romper selectores globales.
10. **`next/dynamic ssr:false`** del mapa: en Angular el equivalente es `@defer`/lazy, pero
    Leaflet necesita el DOM listo (`afterNextRender`).

---

## Anexo A — Cifras y cobertura

| Métrica                               | Valor                                            |
| ------------------------------------- | ------------------------------------------------ |
| Vistas `WorkspaceView`                | 13                                               |
| Pantallas (con login)                 | 14                                               |
| Pestañas de ficha                     | 6                                                |
| Paneles/drawers/modales               | ~14                                              |
| Archivos de UI inventariados          | 22 + `lib/*` y `app/*`                           |
| Endpoints consumidos                  | 9                                                |
| Endpoints existentes no consumidos    | 5 (`actors, catalogs, demandas, search, health`) |
| Discrepancias de contrato verificadas | 9 (§3.3)                                         |

## Anexo B — Lo que quedó «no verificado»

- `app/globals.css` completo (solo tokens y mecanismo).
- `package.json` de `lib/db/**` fuera de los repos citados (no se auditó todo el backend).
- Existencia de enmascarado de PII con revelado en la UI (no se encontró patrón; podría no existir).
- Uso real de `CaseRecord`/`AlertRecord`/`DashboardData` en `frontend/types.ts`.
- Acciones masivas por checkbox (no se encontró patrón en las vistas principales).
