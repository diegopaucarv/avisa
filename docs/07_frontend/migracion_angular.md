# Migración del frontend AVISA a Angular

**Tipo de documento:** diagnóstico y diseño (no implementación)
**Fecha:** 21-nov-2026
**Alcance:** frontend (`app/`, `components/`, `lib/` de navegador) y su relación con el BFF (`app/api/`, `lib/db/`)
**Estado del código auditado:** rama `main`, commit `ca9288e`, árbol de trabajo con cambios locales sin confirmar

---

## 0. Método y cifras medidas

Todas las cifras de este documento se midieron sobre el repositorio con `wc -l` y `grep` el 21-nov-2026. **Sustituyen a estimaciones previas que estaban desactualizadas**: el archivo más grande de la interfaz no tiene ~2 600 líneas sino **3 881**, y la hoja de estilos no tiene ~2 400 sino **6 782**. Sobre esas medidas se construye la recomendación.

| Medición                                                                       | Valor real               | Cómo se obtuvo                                            |
| ------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------- |
| Archivos en `components/` (raíz)                                               | 19                       | `components/*.tsx`, `components/*.ts`                     |
| Líneas en esos 19 archivos                                                     | 11 071                   | `cat components/*.tsx components/*.ts \| wc -l`           |
| `components/ui/button.tsx`                                                     | 58                       | archivo huérfano (ver §7)                                 |
| Estado de navegador (`lib/avisa-store.tsx` + `lib/theme.tsx` + `lib/utils.ts`) | 1 072                    | `cat ... \| wc -l`                                        |
| Capa de datos de servidor (`lib/db/**`)                                        | 2 577                    | `find lib/db -name "*.ts"`                                |
| Repositorios SQL (`lib/db/repos/**`)                                           | 2 201                    | suma de 10 archivos                                       |
| Route handlers (`app/api/**/route.ts`)                                         | 19 archivos · 725 líneas | 16 en `v1/`, 2 en `auth/`, 1 `dashboard`                  |
| Shell de aplicación (`app/*.tsx`)                                              | 236                      | `page` 21, `layout` 70, `error` 35, `global-error` 110    |
| `app/globals.css`                                                              | 6 782                    | `wc -l`                                                   |
| `app/theme-dark.generated.css`                                                 | 1 847                    | `wc -l`                                                   |
| Selectores de clase distintos                                                  | 543                      | `grep -oE` sobre las clases y `sort -u`                   |
| Literales de color (`#rrggbb`)                                                 | 1 006                    | `grep -oE "#[0-9a-fA-F]{3,8}"`                            |
| Usos de `var(--…)`                                                             | 66                       | `grep -c "var(--"`                                        |
| Reglas del tema oscuro                                                         | 546                      | `grep -c '^html\[data-theme="dark"\]'`                    |
| Iconos distintos de `lucide-react`                                             | 53                       | extracción de los `import`                                |
| Archivos de prueba existentes                                                  | 0                        | no hay `*.test.*`, `*.spec.*`, Playwright, Vitest ni Jest |

**Totales aproximados del código:** ≈ 15 700 líneas TS/TSX (interfaz + servidor) y 8 629 líneas de CSS.

**Hallazgo que condiciona todo el documento:** la interfaz **no consume la API real**. Solo `components/avisa-login.tsx` llama a `frontend/api.ts` (`login`). El resto del producto se alimenta de `lib/avisa-store.tsx`, sembrado con `components/avisa-demo-data.ts` (`useState(demoCases)`, etc.). Los 16 endpoints de `app/api/v1/**` **no tienen consumidor en la interfaz**. Por tanto, "migrar a Angular" es en realidad **dos trabajos distintos**:

1. **Portar la interfaz** (mecánico, medible, es lo que se estima aquí).
2. **Conectar la interfaz a los datos reales** (trabajo funcional que hace falta con React o con Angular, y que **no** se resuelve por cambiar de framework). Ver §10 y §13.

---

## 1. Resumen ejecutivo

### ¿Conviene migrar?

**Sí, pero no por las razones habituales.** La migración se justifica por el contexto institucional, no por una deuda técnica del frontend actual:

- El ERS (`docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`, R8) fija el destino **Angular + .NET + SQL Server**, con **≈ 4 desarrolladores de OGTI** y arranque el **24-nov-2026**.
- El propio ERS advierte en **D-6** que si el prototipo no se diseña "pensando en componentes estándar de Angular" habrá **recodificación por OGTI**. Un prototipo en React garantiza esa recodificación.
- **CT-05 "Pantallas de trabajo" está confirmado como Angular** (ERS, tabla de contenedores).
- El frontend actual es, en la práctica, **una SPA pura**: no hay Server Components con fetching, no hay `next/image`, `next/font`, `next/link` ni `next/navigation`; el único uso de `next/dynamic` es el mapa (`ssr: false`). Es decir, **se está pagando Next.js para servir una SPA**.

### Qué se gana

| Ganancia                                   | Evidencia                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alineación con el stack que OGTI mantendrá | ERS R8, CT-05, OBJ-07                                                                                                                                                                                 |
| Menos traducción prototipo → producción    | ERS D-6                                                                                                                                                                                               |
| Eliminación de dependencias muertas        | `@base-ui/react`, `shadcn`, `cva`, `clsx`, `tailwind-merge` y `tw-animate-css` **no se usan** en ningún componente renderizado; Tailwind solo aporta `antialiased`, que ya está en `globals.css` (§7) |
| Un solo runtime en el navegador            | hoy conviven React 19 + Next 16 para una SPA                                                                                                                                                          |
| Formularios y tablas con patrones estándar | 57 `onChange` y 59 controles solo en `avisa-crud.tsx`; Angular tiene Reactive Forms y CDK Table                                                                                                       |
| Separación limpia UI / BFF                 | el BFF ya está aislado en `app/api` + `lib/db`                                                                                                                                                        |

### Qué se pierde

| Pérdida                             | Comentario                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| 95–133 días-persona                 | §10                                                                            |
| Velocidad del prototipo             | React permite iterar más rápido con menos ceremonia; Angular impone estructura |
| Dos runtimes durante la convivencia | Next (BFF + UI vieja) y Angular (UI nueva)                                     |
| Riesgo de divergencia visual        | 543 clases CSS propias y 546 reglas de tema oscuro generadas                   |
| **No se gana funcionalidad real**   | la app sigue siendo demostrativa hasta conectar el BFF (§0)                    |

### Recomendación

> **Migrar la interfaz a Angular y dejar el backend donde está.**
>
> 1. **Congelar paridad** con una batería E2E sobre la app actual (fase 0). Hoy no existe ni una prueba.
> 2. Construir una **SPA Angular standalone con signals**, servida por un **proxy inverso** que mantiene `/api/*` en el BFF Next actual (y después en .NET). Es la opción (a) del §2, no el strangler clásico, por las razones medidas allí.
> 3. Portar por **grupos de vistas**, no archivo por archivo: el archivo `avisa-workspace.tsx` (3 881 líneas, 13 vistas) y `avisa-crud.tsx` (1 654 líneas, 6 formularios) deben **descomponerse**, no transcribirse.
> 4. **No portar el backend a Angular.** La RLS por `set_config`, la firma HMAC de la cookie y la clave de PII (`APP_CRYPTO_KEY`) son de servidor (§5, §11).
> 5. El destino del backend es **.NET** según el ERS; Angular solo consume HTTP. Un servicio Node intermedio (opción B del §5) **no es destino** y no se recomienda.

**Decisión de negocio previa (bloqueante):** si OGTI va a construir desde el ERS + Figma, el valor de migrar el prototipo es _reducir la traducción_; si el prototipo Angular va a ser la semilla del entregable de diciembre, la migración es _obligatoria_. Conviene resolver esto antes de la fase 1 (§13).

---

## 2. Estrategia: reescritura paralela vs. strangler fig

### Contexto medido que decide la comparación

| Hecho                                                                                | Consecuencia                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Una sola ruta (`app/page.tsx`, 21 líneas) que alterna login/dashboard con `useState` | no hay URLs que "estrangular"                         |
| 13 vistas internas conmutadas por `useState<WorkspaceView>`                          | la granularidad de migración es _vista_, no _ruta_    |
| 0 Server Components con datos                                                        | no hay nada que "quedarse" del lado servidor de la UI |
| 19 route handlers ya aislados                                                        | el único punto de convivencia natural es `/api/*`     |
| 20 archivos de UI, 11 129 líneas                                                     | tamaño mediano: una reescritura es asumible           |

### Comparación

| Criterio                     | (a) Reescritura paralela SPA                | (b) Strangler fig detrás de proxy                                              |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Unidad de migración          | grupo de vistas entregado tras feature flag | ruta/URL                                                                       |
| Requisito previo             | ninguno                                     | **introducir rutas que hoy no existen** en ambas apps                          |
| Coste de convivencia         | un proxy + un flag                          | dos shells completos (React y Angular), dos navegaciones, doble inicialización |
| Sesión durante convivencia   | una cookie, un origen                       | dos orígenes o dos shells → riesgo de doble login                              |
| Riesgo de big bang           | mitigado con fase 0 E2E + flag              | bajo por diseño… **si hubiera rutas**                                          |
| Aplicabilidad aquí           | alta                                        | baja: degenera en (a) con sobrecoste                                           |
| Coste estimado del andamiaje | 3–5 d-p                                     | 8–12 d-p (dos shells + routing en ambos + proxy por ruta)                      |

### Recomendación

**Opción (a): reescritura paralela de la SPA, con el proxy como costura permanente.**

Justificación con datos:

1. **El strangler exige una superficie de URLs que no existe.** Hoy todo el producto vive en `/`. Para estrangular por ruta habría que añadir router a React _y_ a Angular, más dos layouts y dos estados de sesión, para una app interna con una sola pantalla de login. El andamiaje (8–12 d-p) supera lo que ahorra.
2. **Lo que sí conviene estrangular es la API, no la UI.** El proxy mantiene `/api/*` en Next desde el día 1, y ese mismo proxy es el que después apuntará a .NET sin tocar Angular. Es el único punto de convivencia que aporta valor.
3. **La app cabe en una reescritura.** 20 archivos y 11 129 líneas, sin RSC ni routing, es un tamaño manejable para 2 desarrolladores en 6–8 semanas.
4. **La red de seguridad no es el strangler, son las E2E.** Con paridad congelada (fase 0), el corte puede hacerse de golpe por grupo funcional detrás de un flag, sin dos shells.

**Regla de corte propuesta:** el proxy sirve Angular en `/` y Next en `/api/`; la app Angular arranca en `/beta` con un flag por vista. Cuando un grupo de vistas alcanza paridad E2E, se activa por defecto; al terminar, `/beta` desaparece y solo queda Angular.

---

## 3. Inventario de migración

### 3.1 Design system / UI

| Archivo                              | Líneas    | Qué es                                                                                                               | Destino en Angular                                                                  | Días-persona  | Riesgo                                            |
| ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- | ------------------------------------------------- |
| `components/ui/button.tsx`           | 58        | Botón con `cva` + `@base-ui/react`; **nunca importado**                                                              | Eliminar; el botón real son clases CSS (`.login-button`, `.button-secondary`, etc.) | 0,5–1         | Bajo                                              |
| `components/avisa-view-state.tsx`    | 152       | `LoadingState`, `EmptyState`, `ErrorState`                                                                           | `ViewStateComponent` standalone                                                     | 1–1,5         | Bajo                                              |
| `components/avisa-glossary.tsx`      | 487       | Glosario, `GlossaryTerm`, `HelpDrawer` y bus `openHelp` por `CustomEvent`                                            | `GlossaryService` con signal + `HelpDrawerComponent` (CDK Dialog)                   | 2,5–3,5       | Medio                                             |
| `components/avisa-scope-filter.tsx`  | 360       | Popover de ámbito territorial + helpers puros (`isValidTimeRange`, `isWithinDemoWindow`, `normalizeAssignedRegions`) | `ScopeFilterComponent` con **CDK Overlay**; helpers copiados tal cual               | 3,5–4,5       | **Alto** (posicionamiento, portal, scroll/resize) |
| `components/avisa-notifications.tsx` | 217       | Campana y panel de notificaciones                                                                                    | `NotificationsComponent` (CDK Overlay)                                              | 1,5–2         | Bajo-medio                                        |
| `components/avisa-search.tsx`        | 418       | Búsqueda global tipo _command palette_                                                                               | `GlobalSearchComponent` (CDK Dialog + foco)                                         | 3–4           | Medio                                             |
| `components/avisa-preferences.tsx`   | 540       | Preferencias en `localStorage` (`useSyncExternalStore`) + drawer                                                     | `PreferencesService` con signals + drawer                                           | 3–4           | Medio                                             |
| `components/avisa-calendar.tsx`      | 279       | Calendario de compromisos                                                                                            | `CommitmentCalendarComponent`                                                       | 3–4           | Medio                                             |
| **Subtotal**                         | **2 511** |                                                                                                                      |                                                                                     | **18,5–24,5** |                                                   |

### 3.2 Features

| Archivo                                      | Líneas    | Qué es                                                                                                                                                           | Destino en Angular                                        | Días-persona | Riesgo   |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------ | -------- |
| `components/avisa-login.tsx`                 | 10        | Login en una sola línea densa; hoy sí llama a la API                                                                                                             | `LoginComponent` + Reactive Form                          | 1,5–2        | Bajo     |
| `components/avisa-dashboard.tsx`             | 552       | Shell: sidebar, header, perfil, navegación, filtros de alcance                                                                                                   | `ShellComponent` + layout + rutas hijas                   | 4–5          | Medio    |
| `components/avisa-workspace.tsx`             | **3 881** | 13 vistas (`overview`, `inbox`, `cases`, `case-detail`, `alerts`, `commitments`, `documents`, `map`, 4 de directorio, `executive`) + ~1 000 líneas de derivación | **Descomponer** en 4–6 componentes de vista + pipes puros | 18–24        | **Alto** |
| `components/avisa-crud.tsx`                  | 1 654     | 6 formularios/drawers: caso, alerta, compromiso, demanda, evento, documento                                                                                      | 6 componentes de formulario con Reactive Forms            | 8–11         | **Alto** |
| `components/avisa-documents.tsx`             | 532       | Bandeja de documentos, validación/rechazo, fragmentos                                                                                                            | `DocumentsComponent`                                      | 3–4          | Medio    |
| `components/avisa-map.tsx`                   | 855       | Leaflet: 3 modos, 3 capas, filtros, popups                                                                                                                       | `MapComponent` + envoltorio Leaflet propio                | 6–8          | **Alto** |
| `components/avisa-demo-data.ts`              | 642       | Tipos + fixtures de demostración                                                                                                                                 | `models/` + `data/fixtures`                               | 0,5–1        | Bajo     |
| `components/avisa-directory.tsx`             | 38        | Wrapper de directorio                                                                                                                                            | `DirectoryComponent`                                      | 0,5–1        | Bajo     |
| `components/conflict-resolution-journey.tsx` | 33        | Línea de tiempo del caso                                                                                                                                         | `JourneyComponent`                                        | 0,5–1        | Bajo     |
| **Subtotal**                                 | **8 197** |                                                                                                                                                                  |                                                           | **42–57**    |          |

### 3.3 Estado y utilidades

| Archivo                        | Líneas    | Qué es                                                                 | Destino en Angular                                             | Días-persona | Riesgo   |
| ------------------------------ | --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ------------ | -------- |
| `lib/avisa-store.tsx`          | 945       | Context + **30 acciones** y `setNotice`, en memoria, sembrado con demo | `AvisaFacade` + servicios por agregado con `signal`/`computed` | 5–7          | **Alto** |
| `lib/theme.tsx`                | 121       | Tema claro/oscuro/sistema, `localStorage`, `matchMedia`                | `ThemeService` + script de arranque en `index.html`            | 1–1,5        | Bajo     |
| `components/avisa-catalogs.ts` | 266       | Constantes de catálogo (niveles, temas, subsectores, prioridades)      | Copiar (`as const`)                                            | 0,25–0,5     | Muy bajo |
| `components/avisa-ubigeo.ts`   | 88        | Catálogo UBIGEO + `isValidUbigeo`, `findDistrict`                      | Copiar tal cual                                                | 0,25–0,5     | Muy bajo |
| `components/avisa-export.ts`   | 67        | CSV con BOM/CRLF y descarga por `<a>`                                  | `CsvService` (DOM)                                             | 0,5–1        | Bajo     |
| **Subtotal**                   | **1 487** |                                                                        |                                                                | **7–10,5**   |          |

### 3.4 Shell de aplicación

| Archivo                                  | Líneas   | Qué es                                          | Destino en Angular                                                  | Días-persona    | Riesgo |
| ---------------------------------------- | -------- | ----------------------------------------------- | ------------------------------------------------------------------- | --------------- | ------ |
| `app/page.tsx`                           | 21       | Alterna login/dashboard con `useState<Session>` | Router + `authGuard` (incluido en fase 2)                           | —               | —      |
| `app/layout.tsx`                         | 70       | `metadata`, script de tema pre-paint, Analytics | `index.html` + `ThemeService`; Analytics se descarta o se sustituye | incluido arriba | Bajo   |
| `app/error.tsx` + `app/global-error.tsx` | 35 + 110 | Error boundaries de React                       | `ErrorHandler` global + componente de error de ruta                 | 1–2             | Bajo   |

### 3.5 Totales

| Grupo                                                     | Líneas     | Días-persona |
| --------------------------------------------------------- | ---------- | ------------ |
| Design system / UI                                        | 2 511      | 18,5–24,5    |
| Features                                                  | 8 197      | 42–57        |
| Estado y utilidades                                       | 1 487      | 7–10,5       |
| Shell                                                     | 236        | 1–2          |
| **Port neto**                                             | **12 431** | **68,5–94**  |
| Transversales (andamiaje, CSS, E2E, a11y, endurecimiento) | —          | 26,5–39      |
| **Total**                                                 |            | **95–133**   |

**No incluido en esta estimación:** conectar las vistas a los 16 endpoints reales (15–25 d-p), portar el backend a .NET (35–50 d-p, frente de OGTI) y los tableros de Power BI.

---

## 4. Mapeo de conceptos React → Angular

| Hoy (React/Next)                                                     | Angular moderno                                                   | Nota de migración                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createContext` + `useContext` (`AvisaContext`)                      | `@Injectable({ providedIn: 'root' })`                             | la DI reemplaza al Provider; no hace falta envolver la app                                                   |
| `useState` en el store (4 arreglos + `notice` + `readNotifications`) | `signal<T>()`                                                     | escritura con `.set()`/`.update()`                                                                           |
| `useMemo` (cálculos derivados)                                       | `computed()`                                                      | memoización real y perezosa                                                                                  |
| `useCallback`                                                        | métodos de clase                                                  | innecesario: las referencias no cambian por render                                                           |
| `useEffect` (suscribirse a eventos)                                  | `effect()` con `DestroyRef`, o `fromEvent` + `takeUntilDestroyed` | `avisa-glossary`, `-scope-filter`, `-notifications`, `-search`, `-preferences` registran `document`/`window` |
| `useEffect` (cargar datos)                                           | `resource()` / `httpResource()`                                   | **verificar estabilidad en la versión elegida**; si no, `HttpClient` + señales `loading/error/data`          |
| `useSyncExternalStore` (preferencias)                                | `signal` + servicio + `effect`                                    | un solo servicio, sin store externo                                                                          |
| Props (`session`, `onLogout`, `onNavigate`)                          | `input()` / `input.required()`                                    |                                                                                                              |
| Callbacks (`onSuccess`, `onSelectCase`)                              | `output<T>()`                                                     |                                                                                                              |
| `next/dynamic(() => import(...), { ssr:false })`                     | `@defer (on viewport)` + `loadComponent`                          | único uso: el mapa                                                                                           |
| Formularios controlados (57 `onChange` en `avisa-crud.tsx`)          | **Reactive Forms** (recomendado)                                  | Signal Forms aún es experimental; no usarlo para el corte de diciembre                                       |
| `fetch` (`frontend/api.ts`)                                          | `HttpClient` + `HttpInterceptorFn` con `withCredentials`          |                                                                                                              |
| `React.Component` error boundary (`avisa-view-state`, `app/error`)   | `ErrorHandler` global + ruta/componente de error                  | `withComponentInputBinding` es del router, no del manejo de errores                                          |
| `className` condicional                                              | `[class.x]` / `[ngClass]`                                         |                                                                                                              |
| `dangerouslySetInnerHTML` (bootstrap de tema)                        | `<script>` en `index.html`                                        | debe ejecutarse **antes del primer pintado**                                                                 |
| `createPortal` (`avisa-scope-filter`)                                | `CdkOverlay` / `CdkPortal`                                        |                                                                                                              |
| `CustomEvent` `avisa:help`                                           | `signal` en `HelpService`                                         | elimina acoplamiento global                                                                                  |
| `window.print()` (`avisa-workspace` L3792)                           | igual, pero vía `DOCUMENT.defaultView`                            |                                                                                                              |

**Nota sobre `zoneless`:** con `provideZonelessChangeDetection()` los cambios se propagan por signals, no por zone.js. Esto **rompe** cualquier librería que mute estado fuera de Angular (Leaflet, listeners nativos). Todo evento de Leaflet debe escribir una `signal`. Es la razón principal para envolver Leaflet a mano (§9).

---

## 5. Backend: tres opciones

| Criterio            | (A) Mantener Next como BFF               | (B) Extraer a Node (Express/Fastify)                                          | (C) Portar a .NET                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Qué implica         | Angular consume `/api/*` del Next actual | mover `lib/db` (2 577 líneas) + 19 handlers (725 líneas) a un servicio propio | reescribir en ASP.NET Core sobre SQL Server          |
| Cambios en servidor | **ninguno**                              | reescritura de rutas, middleware de cookie, despliegue                        | traducción de SQL a T-SQL, RLS a _security policies_ |
| Beneficio           | cero riesgo funcional; sale en días      | deploy independiente de la UI; mismo lenguaje                                 | **destino institucional** (ERS R8, H-01)             |
| Costo               | 1–2 d-p (proxy)                          | 8–14 d-p + pruebas                                                            | 35–50 d-p (o el frente L1/L3 de OGTI)                |
| Deuda               | se mantiene Next y `pg`                  | infraestructura nueva que no es destino                                       | alto esfuerzo inicial                                |
| Alineación ERS      | parcial (transitoria)                    | **ninguna** (camino intermedio)                                               | total                                                |
| Recomendación       | **ahora**                                | no                                                                            | **después, por OGTI**                                |

### Recomendación

**A ahora, C después. B no.** El BFF actual ya resuelve lo difícil y con criterio de seguridad: pool único, `statement_timeout`, transacción por petición, GUC de RLS y traducción de errores de PostgreSQL a respuestas estables (`lib/db/errors.ts`). Reescribirlo en Node no aporta nada que .NET no vaya a reemplazar después. Angular solo necesita que `/api/*` exista en el mismo origen.

### Impacto de la cookie `httpOnly`

La cookie real es `avisa_session`: HMAC-SHA256 en `base64url` (`payload.mac`), `httpOnly`, `sameSite=lax`, `path=/`, `maxAge` 8 h, `secure` en producción. `APP_SESSION_SECRET` debe tener ≥ 32 caracteres.

| Escenario                                | Qué hay que hacer                                                                               | Riesgo                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Mismo origen vía proxy** (recomendado) | nada: la cookie viaja sola; `withCredentials` es redundante pero inocuo                         | **ninguno**                                       |
| Orígenes distintos                       | `withCredentials: true`, `Access-Control-Allow-Credentials: true`, origen explícito (nunca `*`) | alto                                              |
| Con `SameSite=None` (cross-site)         | además `Secure` obligatorio y **protección CSRF** (token u origen)                              | alto: navegadores bloquean cookies de terceros    |
| Desarrollo local                         | `proxy.conf.json` de Angular: `/api` → `http://localhost:3000`                                  | el navegador ve un solo origen (`localhost:4200`) |

**Consecuencias explícitas:**

- `httpOnly` significa que **Angular no puede leer la cookie**. Por eso existe `GET /api/v1/session`: hidrata el perfil al recargar. El perfil devuelto por el login (`dni`, `nombre`, `rol`, `regiones`, `roles`) se guarda en un `signal`, **nunca un token**.
- Con `sameSite=lax` y mismo origen no hace falta token CSRF: `lax` no envía la cookie en POST cross-site. Si alguien despliega cross-origin, el CSRF pasa a ser obligatorio.
- El logout (`POST /api/auth/logout`, 16 líneas) limpia la cookie con `maxAge: 0`; Angular solo debe limpiar su señal.
- Los **headers de seguridad** de `next.config.mjs` (`nosniff`, `Referrer-Policy`, HSTS, `X-Frame-Options`, `Permissions-Policy`) hoy solo existen porque Next los emite. Al servir Angular desde otro servidor hay que **replicarlos en el proxy**.

### Impacto de la RLS por `set_config`

`withSession` (`lib/db/tenant.ts`, 62 líneas) abre transacción y fija:

```
app.rol_codigo, app.usuario_id, app.user_id,
app.staff_bypass_subject_rls = 'false',
app.crypto_key, app.p9_origen
```

con `set_config(..., true)` (= `SET LOCAL`, dura la transacción). Además:

- `app.rol_codigo` alimenta `core.clasificacion_max()`; sin él, las tablas con `FORCE ROW LEVEL SECURITY` **no devuelven filas ni aceptan escrituras**.
- `app.crypto_key` descifra PII y **vive fuera de la base** (`APP_CRYPTO_KEY`).
- `app.p9_origen` queda en `audit.datos_personales_acceso`.

**Regla no negociable:** todo esto debe ocurrir en el servidor, en la **misma transacción** que la consulta. No se puede mover a Angular, ni a un interceptor, ni a un worker del navegador. Angular nunca debe recibir `APP_DATABASE_URL`, `APP_CRYPTO_KEY` ni acceso a `pg`. Un `set_config` en una conexión suelta del pool no sirve: se filtra a la siguiente petición.

**Consecuencia para el diseño:** Angular solo puede hablar con endpoints que reciben la cookie y derivan el rol **del token firmado**, nunca de un parámetro. Esto ya está bien resuelto (`requireSession` en `lib/db/http.ts`).

---

## 6. Autenticación y sesión

### Flujo actual (verificado)

1. `POST /api/auth/login` con `{dni, password}` → `core.autenticar_usuario` → respuesta JSON con el perfil **y** `Set-Cookie: avisa_session`.
2. El rol de interfaz se traduce con `UI_ROLE` (`direccion_oaipcs → Directora`, `administrador → Admin`, `alta_direccion → Autoridad`, `sectorista → Sectorista`, `consulta_lectura → PuntoFocal`). **La base manda**; el cliente no envía rol.
3. `GET /api/v1/session` devuelve `{user, scope, expiresAt}`.
4. `POST /api/auth/logout` limpia la cookie.

### Convivencia Next ↔ Angular

| Aspecto         | Decisión                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| Cookie          | una sola, `path=/`, mismo host: **la comparten** Next y Angular sin cambios           |
| Origen          | mismo origen vía proxy (evita CORS, CSRF y cookies de terceros)                       |
| Perfil          | `SessionStore` con `signal`; se hidrata con `/api/v1/session` al arrancar             |
| Sesión expirada | el interceptor detecta `401` y navega a `/login`; la cookie de 8 h no se renueva sola |
| Login duplicado | no ocurre: el formulario de login vive en Angular desde la fase 2                     |
| Rollback        | el flag devuelve a la UI de Next; la cookie sigue siendo válida (misma firma)         |

### Guard de rutas

```ts
// core/auth/auth.guard.ts
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if (session.user()) return true;
  const restored = await session.restore(); // GET /api/v1/session
  return restored ? true : router.createUrlTree(["/login"]);
};
```

```ts
// core/session/session.store.ts (resumen)
@Injectable({ providedIn: "root" })
export class SessionStore {
  private readonly http = inject(HttpClient);
  readonly user = signal<Session | null>(null);
  readonly role = computed(() => this.user()?.rol ?? null);
  readonly regions = computed(() => this.user()?.regiones ?? []);

  async restore(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.get<SessionResponse>("/api/v1/session"),
      );
      this.user.set(res.user);
      return true;
    } catch {
      return false;
    }
  }
}
```

**Detalle importante:** el guard debe ser idempotente y cachear la restauración. Sin caché, cada navegación dispara una petición a la base. Con `resource()` o una promesa memoizada se resuelve en 2 líneas.

---

## 7. UI: reemplazo de librerías

### Hallazgo que cambia el problema

| Dependencia                                          | ¿Se usa?         | Evidencia                                                                                                                                               |
| ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@base-ui/react`                                     | **No**           | solo `components/ui/button.tsx`, que **no se importa en ningún sitio**                                                                                  |
| `shadcn`                                             | **No**           | no hay componentes generados; solo un `components.json`                                                                                                 |
| `class-variance-authority`, `clsx`, `tailwind-merge` | **No** en UI     | solo `button.tsx` y `lib/utils.ts` (usado por `button.tsx`)                                                                                             |
| `tw-animate-css`                                     | **No**           | —                                                                                                                                                       |
| Tailwind v4                                          | **Casi sin uso** | 0 utilidades de layout en 792 `className`; `.sr-only` está definida en `globals.css` y `antialiased` es redundante; 0 `@apply`, 0 `@layer`, 0 `theme()` |
| `lucide-react`                                       | **Sí**           | 53 iconos en 15 componentes                                                                                                                             |
| `leaflet` + `react-leaflet`                          | **Sí**           | `avisa-map.tsx`                                                                                                                                         |

**Conclusión:** no hay que "reemplazar shadcn". Hay que **eliminarlo**. El design system real son **543 clases CSS propias**. Por tanto, el trabajo de UI es portar widgets hechos a mano, no adaptar una librería.

### Opciones para lo nuevo

| Librería         | Rol                                                              | Veredicto                                                                                                   |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Angular CDK**  | primitivas: Overlay, Dialog, Portal, a11y, Virtual Scroll, Table | **Recomendado**: cubre exactamente los patrones del código (popover, drawer, focus trap) sin imponer estilo |
| Angular Material | componentes completos + theming                                  | útil para fecha/autocomplete; su theming pelea con el CSS propio                                            |
| Angular Aria     | patrones WAI-ARIA sin estilo                                     | interesante, pero **developer preview**: no para el corte de diciembre                                      |
| Spartan UI       | "shadcn para Angular", basado en Tailwind                        | pre-1.0 y reintroduce Tailwind, que aquí no se usa: **no**                                                  |
| PrimeNG          | suite amplia de widgets                                          | sobredimensionado; theming propio                                                                           |

**Recomendación:** **CDK para comportamiento + el CSS existente para la apariencia.** Material solo donde aporte un widget difícil (calendario, autocompletar) y aceptando su theming aislado.

### Iconos

`lucide-angular` expone el mismo conjunto. Son **53 iconos**; conviene un registro explícito (tree-shaking) o un componente `<avisa-icon name="...">` que mapea a los 53 usados. El tamaño (`size={16}`, `size={28}`) se traduce a un `input()`.

### Leaflet

| Opción                          | Ventaja                                                                             | Riesgo                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Envoltorio propio (recomendado) | control total del ciclo de vida; funciona con zoneless; sin dependencias de versión | hay que reimplementar popups/tooltips (hoy usa `<Popup>`, `<Tooltip>`, `<CircleMarker>`) |
| `@bluehalo/ngx-leaflet`         | envoltorio mantenido del original `ngx-leaflet`                                     | API con directivas; puede quedar atrás respecto de Leaflet 1.9                           |
| `ngx-leaflet` original          | conocido                                                                            | mantenimiento lento: evitar                                                              |

**Riesgos concretos de Leaflet:**

- El CSS de Leaflet se importa hoy desde `globals.css` (`@import "leaflet/dist/leaflet.css"`): debe seguir siendo global.
- El tema oscuro invierte las teselas con un filtro CSS (`.leaflet-tile-pane`) que vive en el archivo **generado**: si se mueve el mapa a otro scope, el filtro deja de aplicar.
- `useMap()` de React no existe: los controles que dependen del mapa (zoom, capa activa) deben implementarse con la instancia de `L.Map`.
- Con zoneless, cada evento de Leaflet (`moveend`, `zoomend`, clic en marcador) debe escribir una `signal`.
- Sin SSR el problema de `window` desaparece, pero el mapa **igual** debe cargarse de forma diferida (`@defer`) para no arrastrar ~150 KB sin comprimir de Leaflet al arranque: hoy eso lo hace `next/dynamic` con `ssr:false`.

---

## 8. Estilos

### Estado real

| Elemento                  | Medida                                  | Consecuencia                                                          |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `app/globals.css`         | 6 782 líneas, CSS plano                 | es **framework-agnóstico**: se copia tal cual                         |
| Selectores de clase       | 543 distintos                           | no usar encapsulación por componente; son clases globales compartidas |
| Literales de color        | 1 006                                   | el tema oscuro se genera por transformación automática                |
| `var(--…)`                | 66 usos                                 | hay un sistema de tokens parcial (`--ink`, `--paper`, `--blue`…)      |
| Media queries             | 18                                      | responsive propio, no Tailwind                                        |
| Keyframes                 | 4                                       | animaciones propias                                                   |
| Tailwind v4               | importado, **sin utilidades de layout** | se puede retirar                                                      |
| `@import` de Google Fonts | DM Sans + Manrope                       | dependencia externa en tiempo de ejecución (privacidad, CSP, offline) |
| `@import` de Leaflet CSS  | sí                                      | debe permanecer global                                                |

### Plan para conservar la identidad visual

1. **Copiar `globals.css` como `src/styles.css`** y declararlo en `angular.json > styles`. No reescribir clases: la identidad visual es el activo más valioso del prototipo.
2. **`encapsulation: ViewEncapsulation.None`** para los componentes que usan clases compartidas, o simplemente dejar el CSS global. La encapsulación emulada de Angular añade atributos `_ngcontent` y **rompería** selectores como `.case-table-row:hover` que hoy cruzan componentes.
3. **Mantener `theme-dark.generated.css`** tal cual y seguir generándolo con `scripts/generate_dark_theme.mjs`: el script solo lee y escribe CSS, así que **es independiente del framework**. Añadirlo al array `styles` y ejecutar `--check` en CI para que no se desfase (546 reglas).
4. **Tema pre-paint:** mover el script inline de `app/layout.tsx` a `src/index.html`, en `<head>`. Sin él hay destello blanco al cargar con tema oscuro (`localStorage` + `matchMedia`).
5. **Tipografías:** autoalojar DM Sans y Manrope (woff2) y sustituir el `@import` remoto. Mantener `--font-sans` y `--font-display` para no tocar el CSS.
6. **Reset:** Tailwind aporta _preflight_ (márgenes de `h1`–`h6`, listas, imágenes). `globals.css` **no** redefine esos elementos a nivel global: solo estiliza `h1` dentro de clases concretas (`.login-copy h1`, `.workspace-greeting h1`…). Al retirar Tailwind hay que **añadir un reset mínimo** y compararlo con las capturas de la fase 0. Riesgo visual bajo pero real.
7. **Atributos de tema:** conservar `data-theme`, `data-theme-preference` y `data-density` en `<html>`; el CSS y las preferencias dependen de ellos.
8. **Tailwind:** retirarlo del todo es lo más limpio (0 utilidades de layout; `sr-only` ya está en el CSS propio y `antialiased` lo repite una regla de `body`). Si se quiere conservar por si acaso, hay que registrar `@tailwindcss/postcss` en la configuración de build de Angular y verificar que el builder lo aplique; **no vale la pena**.
9. **`tw-animate-css`:** descartar; las 4 animaciones son `@keyframes` propios.

**Riesgo de regresión visual:** medio. Mitigación: capturas doradas en la fase 0 (§10) y comparación por vista, no por archivo.

---

## 9. Riesgos y trampas

| Riesgo                                                            | Dónde ocurre hoy                                                                                                                                                                | Mitigación en Angular                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Acceso directo a `window`/`document`                              | `avisa-glossary` (7), `avisa-scope-filter` (10), `avisa-preferences` (4), `avisa-search` (2), `avisa-notifications` (2), `avisa-export` (2), `avisa-workspace` (`window.print`) | `DOCUMENT` de `@angular/common` y `afterNextRender`; nunca en constructor                    |
| `localStorage` en inicialización                                  | `lib/theme.tsx`, `avisa-preferences.tsx`                                                                                                                                        | `afterNextRender` + `try/catch` (ya hay tolerancia a modo privado)                           |
| `matchMedia`                                                      | tema y preferencias                                                                                                                                                             | servicio con `signal` y limpieza en `DestroyRef`                                             |
| Listeners globales (`pointerdown`, `keydown`, `scroll`, `resize`) | glosario, alcance, preferencias, búsqueda y notificaciones                                                                                                                      | `takeUntilDestroyed()` o `DestroyRef.onDestroy`; con zoneless no hay que forzar detección    |
| `next/dynamic` con `ssr:false`                                    | único uso: el mapa                                                                                                                                                              | `@defer (on viewport)` + `loadComponent`; el mapa no debe entrar en el bundle inicial        |
| `next/image`                                                      | **no se usa** (`images.unoptimized: true`)                                                                                                                                      | ninguno                                                                                      |
| `next/font`                                                       | **no se usa** (fuentes por `@import`)                                                                                                                                           | autoalojar y precargar                                                                       |
| `next/link`, `next/navigation`                                    | **no se usan**                                                                                                                                                                  | el router de Angular es nuevo, no una traducción                                             |
| SSR / hidratación                                                 | no hay fetching de servidor                                                                                                                                                     | **SPA pura**: no configurar `provideClientHydration`; ahorra una clase entera de bugs        |
| `createPortal`                                                    | `avisa-scope-filter` (popover de alcance)                                                                                                                                       | `CdkOverlay`; el popover mide `getBoundingClientRect` y escucha `scroll` con `capture: true` |
| Focus trap en drawers                                             | glosario, preferencias, búsqueda, notificaciones                                                                                                                                | `CdkTrapFocus`; hoy está hecho a mano con `document.activeElement`                           |
| Accesibilidad                                                     | **56 atributos `aria-*`** solo en `avisa-workspace`, 25 en el mapa                                                                                                              | no perder `role`, `aria-live`, `aria-expanded`, `aria-controls` al descomponer               |
| Componentes gigantes                                              | workspace 3 881, crud 1 654                                                                                                                                                     | **descomponer**, no transcribir; si se copia tal cual, se hereda el problema                 |
| Eventos de Leaflet + zoneless                                     | `avisa-map`                                                                                                                                                                     | escribir `signal` en cada evento; `runOutsideAngular` si se usa zone                         |
| Descarga de CSV                                                   | `avisa-export` crea `<a>` y revoca el `objectURL`                                                                                                                               | igual, pero con `DOCUMENT`; probar en Safari                                                 |
| Impresión                                                         | `window.print()`                                                                                                                                                                | `DOCUMENT.defaultView?.print()`                                                              |
| Analítica                                                         | `@vercel/analytics` en `layout.tsx`                                                                                                                                             | descartar (app interna) o sustituir; no bloquea                                              |
| Headers de seguridad                                              | `next.config.mjs`                                                                                                                                                               | replicar en el proxy (HSTS, `nosniff`, `X-Frame-Options`, `Permissions-Policy`)              |
| Regresión funcional                                               | **no hay ninguna prueba**                                                                                                                                                       | fase 0 obligatoria: E2E + capturas antes de tocar código                                     |

---

## 10. Plan por fases

### Fase 0 · Paridad congelada (E2E sobre la app actual)

| Aspecto                 | Detalle                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entregables             | Playwright configurado; flujos: login, 13 vistas, 6 formularios, filtros de alcance, preferencias, tema claro/oscuro, glosario, búsqueda, mapa, descarga CSV; capturas por vista y por tema |
| Por qué ahora           | **no existe ninguna prueba** en el repo; y los datos son de demostración, por lo que es determinista y fácil de congelar                                                                    |
| Criterios de aceptación | la suite corre en CI contra `pnpm dev`; 100 % verde; las capturas quedan versionadas como referencia                                                                                        |
| Días-persona            | 4–6                                                                                                                                                                                         |

> Truco: la app ya fija `demoReferenceDate` en `components/avisa-catalogs.ts` (21-nov-2026, 12:00) y usa textos como "Hace un momento", así que es casi determinista. Congelar la fecha y el locale en el entorno de prueba para evitar _flakes_.

### Fase 1 · Andamiaje y design system base

| Aspecto                 | Detalle                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entregables             | `ng new` standalone, zoneless, estructura de carpetas; `styles.css` + tema generado + fuentes autoalojadas + reset; `ViewStateComponent`; `CsvService`; catálogos y UBIGEO copiados |
| Criterios de aceptación | build de producción < 250 KB inicial (sin mapa); tema claro/oscuro idéntico a las capturas de fase 0; `generate_dark_theme.mjs --check` en CI                                       |
| Días-persona            | 9–13                                                                                                                                                                                |

### Fase 2 · Shell, routing, autenticación y estado

| Aspecto                 | Detalle                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entregables             | `ShellComponent` (sidebar, header, perfil, navegación), `app.routes.ts` con lazy loading, `authGuard`, `authInterceptor`, `SessionStore`, `ThemeService`, `AvisaFacade` con signals y las 30 acciones |
| Criterios de aceptación | login/logout/restauración funcionan contra el BFF real; recargar en una ruta protegida no pierde sesión; guard no dispara más de una petición por navegación                                          |
| Días-persona            | 13–18                                                                                                                                                                                                 |

### Fase 3 · Vistas de lectura

| Aspecto                 | Detalle                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Entregables             | `overview`, `inbox`, `cases`, `case-detail`, `alerts`, `commitments`, `documents`, 4 de directorio, `executive`; mapa diferido; calendario |
| Criterios de aceptación | paridad E2E de lectura en ambos temas; el mapa no aparece en el bundle inicial; 0 `any` nuevos con `strict`                                |
| Días-persona            | 22–30                                                                                                                                      |

### Fase 4 · Formularios y escritura

| Aspecto                 | Detalle                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entregables             | 6 formularios (caso, alerta, compromiso, demanda, evento, documento) con Reactive Forms; validaciones equivalentes; `DeleteButton` con confirmación en dos pasos |
| Criterios de aceptación | mismas reglas y mensajes que React (comparados con fase 0); estado inválido bloquea envío; sin pérdida de datos al cerrar/abrir drawer                           |
| Días-persona            | 17–23                                                                                                                                                            |

### Fase 5 · UI transversal

| Aspecto                 | Detalle                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Entregables             | búsqueda global, preferencias, glosario/ayuda, notificaciones, filtro de alcance con Overlay        |
| Criterios de aceptación | foco atrapado y devuelto; `Esc` cierra; `aria-*` equivalente; preferencias persisten entre recargas |
| Días-persona            | 13–18                                                                                               |

### Fase 6 · Endurecimiento y paridad

| Aspecto                 | Detalle                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Entregables             | suite E2E de Angular; comparación de capturas; revisión de accesibilidad (teclado, lector); manejo global de errores; presupuestos de bundle |
| Criterios de aceptación | E2E verde en CI; diff visual aceptado por OAIPCS; sin regresiones de contraste                                                               |
| Días-persona            | 13–19                                                                                                                                        |

### Fase 7 · Corte y retiro

| Aspecto                 | Detalle                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Entregables             | proxy en producción (Angular en `/`, Next en `/api/`); headers de seguridad; rollback por flag; apagado de la UI React |
| Criterios de aceptación | 0 errores 5xx en el primer día; rollback probado; documentación de operación actualizada                               |
| Días-persona            | 4–6                                                                                                                    |

### Total

| Fase                           | Días-persona           |
| ------------------------------ | ---------------------- |
| 0 · Paridad congelada          | 4–6                    |
| 1 · Andamiaje y design system  | 9–13                   |
| 2 · Shell, rutas, auth, estado | 13–18                  |
| 3 · Vistas de lectura          | 22–30                  |
| 4 · Formularios                | 17–23                  |
| 5 · UI transversal             | 13–18                  |
| 6 · Endurecimiento             | 13–19                  |
| 7 · Corte y retiro             | 4–6                    |
| **Total**                      | **95–133**             |
| **Cifra de planificación**     | **≈ 115 días-persona** |

**Calendario indicativo:** 1 desarrollador ≈ 5–6,5 meses; 2 desarrolladores ≈ 3–3,5 meses; los 4 de OGTI no bajan de 7–9 semanas por las dependencias entre fases. **Los 20 días de diciembre no alcanzan para el port completo**: por eso el corte debe limitarse al subconjunto del alcance de diciembre (PAN-01 a PAN-10) y no a las 13 vistas.

**Trabajo adicional necesario en cualquier framework (no incluido):** conectar las vistas a los 16 endpoints de `v1` (15–25 d-p). Sin esto, la app Angular será tan demostrativa como la actual.

---

## 11. Qué NO migrar y qué copiar tal cual

### Debe quedarse en el servidor

| Elemento                                                   | Líneas | Motivo                                                                  |
| ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `lib/db/tenant.ts` (`withSession`, GUC de RLS)             | 62     | `set_config(..., true)` debe ir en la misma transacción que la consulta |
| `lib/db/auth.ts` (HMAC, `SESSION_COOKIE`, `verifySession`) | 78     | el secreto y la firma nunca llegan al navegador                         |
| `lib/db/pool.ts` (`pg`, `statement_timeout`, pool único)   | 37     | credenciales de base y timeouts                                         |
| `lib/db/errors.ts` (traducción de errores PostgreSQL)      | 73     | no filtrar SQL ni mensajes crudos                                       |
| `lib/db/repos/**` (consultas con RLS y PII)                | 2 201  | acceso a datos, cifrado de PII                                          |
| `lib/db/audit.ts`, `codes.ts`, `scope.ts`, `http.ts`       | 126    | auditoría, códigos, alcance, sesión                                     |
| `app/api/**/route.ts` (19 handlers)                        | 725    | borde HTTP y cookies                                                    |
| `APP_SESSION_SECRET`, `APP_CRYPTO_KEY`, `APP_DATABASE_URL` | —      | secretos                                                                |

### Se puede copiar tal cual (lógica pura / tipos)

| Elemento                                                                   | Líneas          | Acción                                                                                     |
| -------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `components/avisa-catalogs.ts`                                             | 266             | copiar constantes; renombrar a `models/catalogs.ts`                                        |
| `components/avisa-ubigeo.ts`                                               | 88              | copiar; `as const` y helpers puros                                                         |
| `components/avisa-demo-data.ts` (tipos)                                    | —               | copiar tipos a `models/`; las fixtures solo si se mantiene el modo demostración            |
| `frontend/types.ts`                                                        | 38              | copiar (`Session`, `Role`, `CaseRecord`, `DashboardData`)                                  |
| `lib/db/scope.ts` (`DataScope`)                                            | 22              | copiar el tipo; la función es de servidor                                                  |
| Helpers de `avisa-scope-filter.ts`                                         | ~120 de 360     | `isValidTimeRange`, `isWithinDemoWindow`, `normalizeAssignedRegions`, `isTerritoryVisible` |
| Derivaciones de `avisa-workspace.tsx`                                      | ~1 000 de 3 881 | pasar a funciones puras / `computed()`; es la parte más reutilizable del archivo           |
| `avisa-export.ts`                                                          | 67              | portar a servicio (usa DOM, no React)                                                      |
| `app/globals.css` + `theme-dark.generated.css` + `generate_dark_theme.mjs` | 8 629 + 437     | copiar sin cambios                                                                         |

**Criterio:** si un archivo no importa `react` ni `next`, es candidato a copia. Si importa `pg`, `node:crypto` o `next/server`, se queda.

---

## 12. Anexo: checklist de arranque

### 12.1 Crear el proyecto

```bash
ng new avisa-ui --standalone --style=css --routing --ssr=false --package-manager=pnpm
cd avisa-ui
ng add @angular/cdk
npm i lucide-angular leaflet
npm i -D @types/leaflet
```

> Elegir la **última versión estable** de Angular disponible al arrancar y verificar en su documentación el estado de `httpResource`, `resource` y Signal Forms: si alguno sigue en _developer preview_, no usarlo en el corte de diciembre.

### 12.2 Estructura de carpetas propuesta

```
src/
  app/
    core/
      auth/          auth.service.ts · auth.guard.ts · auth.interceptor.ts
      session/       session.store.ts
      theme/         theme.service.ts
      http/          error.interceptor.ts
      config/        api.config.ts
    data/
      models/        case.ts · alert.ts · commitment.ts · document.ts · session.ts
      catalogs/      catalogs.ts · ubigeo.ts
      fixtures/      demo-data.ts            (solo modo demostración)
      services/      cases.api.ts · alerts.api.ts · commitments.api.ts ·
                     documents.api.ts · search.api.ts · catalogs.api.ts
    state/
      avisa.facade.ts                       (signals + acciones)
      preferences.service.ts
      notifications.store.ts
    shared/
      ui/            view-state/ · button/ · drawer/ · popover/ · icon/
      pipes/         relative-time.pipe.ts · risk-label.pipe.ts
      layout/        shell.component.ts · sidebar/ · header/
    features/
      login/ · overview/ · inbox/ · cases/ · alerts/ · commitments/
      documents/ · map/ · directory/ · executive/ · search/ ·
      preferences/ · glossary/ · calendar/
  styles.css
  theme-dark.generated.css
  index.html
```

### 12.3 `app.routes.ts` de ejemplo

```ts
import { Routes } from "@angular/router";
import { authGuard } from "./core/auth/auth.guard";

export const routes: Routes = [
  {
    path: "login",
    loadComponent: () =>
      import("./features/login/login.component").then((m) => m.LoginComponent),
  },
  {
    path: "",
    canActivate: [authGuard],
    loadComponent: () =>
      import("./shared/layout/shell.component").then((m) => m.ShellComponent),
    children: [
      { path: "", pathMatch: "full", redirectTo: "resumen" },
      {
        path: "resumen",
        loadComponent: () =>
          import("./features/overview/overview.component").then(
            (m) => m.OverviewComponent,
          ),
      },
      {
        path: "casos",
        loadComponent: () =>
          import("./features/cases/cases.component").then(
            (m) => m.CasesComponent,
          ),
      },
      {
        path: "casos/:code",
        loadComponent: () =>
          import("./features/cases/case-detail.component").then(
            (m) => m.CaseDetailComponent,
          ),
      },
      {
        path: "alertas",
        loadComponent: () =>
          import("./features/alerts/alerts.component").then(
            (m) => m.AlertsComponent,
          ),
      },
      {
        path: "compromisos",
        loadComponent: () =>
          import("./features/commitments/commitments.component").then(
            (m) => m.CommitmentsComponent,
          ),
      },
      {
        path: "documentos",
        loadComponent: () =>
          import("./features/documents/documents.component").then(
            (m) => m.DocumentsComponent,
          ),
      },
      {
        path: "mapa",
        loadComponent: () =>
          import("./features/map/map.component").then((m) => m.MapComponent),
      },
      {
        path: "directorio/:kind",
        loadComponent: () =>
          import("./features/directory/directory.component").then(
            (m) => m.DirectoryComponent,
          ),
      },
      { path: "**", redirectTo: "resumen" },
    ],
  },
];
```

### 12.4 `auth.interceptor.ts` de ejemplo

```ts
import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, throwError } from "rxjs";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  // Mismo origen vía proxy: la cookie httpOnly viaja sola. Se declara igual
  // para que funcione si algún día se sirve desde otro origen.
  const request = req.clone({ withCredentials: true });

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        void router.navigate(["/login"]);
      }
      const detail =
        error.error?.detail ?? "No se pudo completar la operación.";
      // Se conserva el status para que la vista pueda distinguir 403 de 503.
      return throwError(() =>
        Object.assign(new Error(detail), { status: error.status }),
      );
    }),
  );
};
```

Registro en `app.config.ts`:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

### 12.5 `proxy.conf.json` para desarrollo (mantiene el mismo origen)

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": false
  }
}
```

### 12.6 Proxy de producción (idea)

```nginx
location /api/ { proxy_pass http://bff:3000; }
location /     { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; }
```

Replicar en este servidor los headers de `next.config.mjs`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

### 12.7 Checklist de arranque

- [ ] Leer `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md` §18.1 y D-6 antes de escribir código.
- [ ] Confirmar con OAIPCS/OGTI si el prototipo Angular será semilla de diciembre (§13).
- [ ] Congelar E2E y capturas de la app React (fase 0) **antes** de crear el proyecto Angular.
- [ ] Decidir idioma de UI (español) y locale (`es-PE`) desde `app.config.ts`.
- [ ] Copiar `globals.css`, `theme-dark.generated.css` y `generate_dark_theme.mjs`; verificar `--check`.
- [ ] Autoalojar DM Sans y Manrope; eliminar el `@import` remoto.
- [ ] Añadir un reset mínimo y comparar con las capturas.
- [ ] Definir `SessionStore` + `authGuard` + interceptor antes de la primera vista.
- [ ] Decidir si se conserva el modo demostración con fixtures o se conecta a `v1` desde el inicio.
- [ ] Estimar el mapa como tarea aparte (6–8 d-p) y cargarlo con `@defer`.
- [ ] Configurar presupuesto de bundle y fallar el build si el mapa entra en el inicial.

---

## 13. Decisiones abiertas antes de implementar

| ID   | Decisión                                                                               | Impacto si no se resuelve                           |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| M-01 | ¿El prototipo Angular será el entregable de diciembre o solo una referencia para OGTI? | define si se migran 13 vistas o solo PAN-01…PAN-10  |
| M-02 | ¿Se conserva el modo demostración con `demo-data` o se conecta a `v1` desde el inicio? | +15–25 d-p y cambia el orden de las fases           |
| M-03 | Librería de widgets: CDK puro vs. Material puntual                                     | afecta al theming y al CSS propio                   |
| M-04 | ¿Se retira Tailwind por completo?                                                      | reset y verificación visual                         |
| M-05 | ¿El BFF migra a .NET en diciembre o en 2027?                                           | determina si el proxy apunta a Next o a .NET        |
| M-06 | Versión de Angular objetivo y estado de `httpResource`/Signal Forms                    | puede obligar a usar `HttpClient` + signals         |
| M-07 | ¿Quién mantiene la suite E2E?                                                          | sin dueño, la red de seguridad se degrada en un mes |

---

**Resumen de la decisión:** migrar la **interfaz** a Angular (95–133 d-p, planificar ≈ 115) conservando el **BFF** en servidor y la **RLS/PII/HMAC** fuera del navegador; descomponer los dos archivos gigantes en lugar de transcribirlos; y no confundir esta migración con el trabajo, aún pendiente, de conectar la app a los datos reales.
