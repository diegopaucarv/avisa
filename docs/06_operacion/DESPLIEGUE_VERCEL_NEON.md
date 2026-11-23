# Despliegue: Vercel, Neon y la consola Angular

**Estado (2026-11-22).** El repositorio se despliega como **un solo proyecto** de
Vercel que sirve dos cosas desde el mismo origen: la **API** (`app/api/**`, Next 16) y la **consola Angular** (SPA estática publicada en `public/`). La interfaz
React/Next que acompañaba a la API **se retiró**; no queda ninguna ruta de
página en `app/`, sólo rutas de API.

Este documento fija qué vive dónde, cómo se construye el sitio, qué decide
Vercel desde el panel y cuál es el destino del backend: **.NET en un servidor de
PRODUCE** (§8), una migración que ejecuta otro equipo.

---

## 1 · Topología real

| Capa                       | Dónde vive hoy                                 | Cómo se levanta                                             | Quién la consume            |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Base de datos (desarrollo) | contenedor `avisa-db`, PostgreSQL 16 + PostGIS | `./scripts/db.sh up`, puerto `55433`                        | la API, en local            |
| Base de datos (compartida) | Neon, base `avisa`                             | externa; DDL con `neondb_owner`, aplicación con `avisa_api` | la API desplegada           |
| API + consola (local)      | contenedor `avisa-ui`, `pnpm dev` en `:3000`   | `docker compose up -d` (monta el repositorio en `/app`)     | navegador del equipo        |
| Consola en desarrollo      | `angular/`, servidor de desarrollo en `:4200`  | `npm --prefix angular start` (proxy `/api` → `:3000`)       | navegador del equipo        |
| API + consola (producción) | proyecto Vercel `orchestra`, dominio público   | push a `main`, ver §2 y §3                                  | navegador del usuario final |

**Un solo origen.** La consola llama a `/api` de forma relativa
(`angular/src/app/core/config/entorno.ts`, `env.js`). Al servirse desde el mismo
dominio que la API no hay CORS y la cookie de sesión `avisa_session`
(`HttpOnly`, `SameSite=Lax`, host-only) funciona sin trucos. Por eso la SPA se
publica dentro del proyecto de la API, y no como un proyecto de Vercel aparte:
un segundo dominio obligaría a CORS y a relajar la cookie.

`next.config.mjs` devuelve `index.html` para `/` y para las rutas profundas del
router de Angular, sin tocar `/api/**`, `/_next/**` ni los archivos con
extensión. No hay ningún proxy entre dominios: la regla vive en la propia app.

---

## 2 · Cómo se construye el sitio

`pnpm build` (raíz) encadena cuatro pasos:

```json
"build": "npm --prefix angular ci --include=dev --no-audit --no-fund && npm --prefix angular run build && node scripts/copiar-spa.mjs && next build"
```

| Paso                                    | Qué hace                                                            |
| --------------------------------------- | ------------------------------------------------------------------- |
| `npm --prefix angular ci --include=dev` | instala la consola con su propio `package-lock.json` (npm, no pnpm) |
| `npm --prefix angular run build`        | compila la SPA en `angular/dist/avisa/browser`                      |
| `node scripts/copiar-spa.mjs`           | borra `public/` y la copia allí; sin dist, falla con mensaje claro  |
| `next build`                            | compila las rutas de API; el resultado incluye `public/`            |

**`--include=dev` no es decorativo.** Vercel construye con `NODE_ENV=production`,
y con eso npm omite las `devDependencies`… entre ellas `@angular/cli`, que es
quien aporta el binario `ng`. Sin la bandera el paso instala 12 paquetes y el
siguiente falla con `sh: line 1: ng: command not found` (exit 127). Para
comprobarlo: `NODE_ENV=production npm --prefix angular ci --dry-run` reporta
«removed 297 packages»; con `--include=dev`, «up to date».

`ng build` no depende de `NODE_ENV`: `angular.json` fija
`defaultConfiguration: "production"`.

Consecuencias que hay que tener presentes:

- **`public/` es artefacto**, no fuente: está en `.gitignore` y se regenera en
  cada build. Lo que sí se versiona es `angular/public/` (`env.js`, iconos), que
  Angular copia a su salida. El nombre `public/` en la raíz es de Next.
- **`angular/` y `scripts/` son fuente del despliegue.** Un cambio en la consola
  o en el script de copia debe construir, aunque no toque Next (§3).
- **`engines.node` es `>=22.12`** en `package.json`. Angular 22 exige Node
  `^20.19 || ^22.12 || >=24`; el rango deja mandar al panel de Vercel (hoy
  `26.x`) y evita cambiar de runtime sin motivo.
- El `tsconfig.json` de la raíz **excluye `angular/`**: la consola tipa con su
  propio `tsconfig.app.json` y sus propias dependencias. Si entra al programa de
  Next, el build aborta con `TS2307` en todo `angular/src/**`.

Un clon limpio **no** tiene `public/` hasta que se corre `pnpm build:spa` (o el
build completo). `pnpm dev` sobre un clon limpio responde `404` en `/` hasta
entonces; es esperado, no un defecto.

---

## 3 · Qué construye y qué se omite

`vercel.json` en la raíz:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)migration' ':(exclude)backups' ':(exclude)docker' ':(exclude)sql_server' ':(exclude)next-env.d.ts' ':(exclude)vercel.json' ':(exclude)*.md'"
}
```

- **Vercel ejecuta el comando en la raíz; si sale con 0, omite el despliegue**
  y el push aparece como _Skipped_ (el último deployment sigue sirviendo).
- **La lista es de exclusiones, no de inclusiones.** Lo que no está excluido
  construye. Sólo se excluyen rutas que **no** producen el sitio: `docs/`,
  `migration/`, `backups/`, `docker/`, `sql_server/`, `next-env.d.ts` (lo
  reescribe `next dev`), `vercel.json` y los `.md` de la raíz.
- **`angular/` y `scripts/` NO se excluyen.** Son la fuente de la SPA que se
  publica; excluirlos dejaría la consola congelada en la última versión
  compilada. Un cambio de interfaz debe desplegar.
- **Falla hacia construir.** Si `HEAD^` no existe (primer push, force push), git
  devuelve error, el comando sale distinto de 0 y Vercel construye en vez de
  omitir en silencio.

Efecto práctico: commits de documentación, migraciones SQL, DDL y runbooks no
gastan build. Todo lo que toca `app/`, `lib/`, `angular/`, `scripts/` o
`package.json` sí.

**Para congelar del todo** —cuando .NET ya reemplace la API y la consola se
sirva desde el servidor de PRODUCE (§8)— se sustituye el objeto por
`{"git":{"deploymentEnabled":{"main":false}}}`. Con eso el push no construye
nunca más y el último despliegue queda en pie hasta que se borre el proyecto.

---

## 4 · Levantar el entorno local

### 4.1 API y consola en un solo puerto

```bash
npm --prefix angular ci --include=dev   # una vez, o cuando cambie angular/package-lock.json
pnpm build:spa              # cada cambio de la consola
docker compose up -d        # API + consola en http://localhost:3000
```

`pnpm build:spa` instala nada: sólo compila Angular y copia el resultado a
`public/`, que el montaje `.:/app` deja visible dentro del contenedor.

`.dockerignore` **excluye `angular/`** a propósito: la consola se compila en el
host, no en la imagen. Construirla dentro del contenedor no serviría, porque el
montaje del repositorio tapa el `public/` que trajera la imagen.

### 4.2 Consola con recarga rápida

```bash
docker compose up -d          # API en :3000
npm --prefix angular start    # SPA en http://localhost:4200
```

`angular/proxy.conf.json` reenvía `/api` a `http://localhost:3000` y reescribe
el dominio de la cookie a `localhost`; `ng serve` recompila al vuelo y no hace
falta `pnpm build:spa` hasta que se quiera ver el sitio completo en `:3000`.

### 4.3 Variables de entorno

`compose.yaml` pasa al contenedor, desde `.env` (ignorado por git):

| Variable             | Para qué                                                       |
| -------------------- | -------------------------------------------------------------- |
| `APP_DATABASE_URL`   | cadena de Neon con el rol `avisa_api` (nunca `neondb_owner`)   |
| `APP_SESSION_SECRET` | firma HMAC de la cookie `avisa_session` (mínimo 32 caracteres) |
| `APP_CRYPTO_KEY`     | descifrado de PII, 32 bytes en base64                          |

---

## 5 · Lo que sólo se resuelve en el panel

| #   | Acción                                                                | Dónde                                       | Efecto                                                                          |
| --- | --------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Confirmar las tres variables en Production, Preview y Development     | Vercel → Settings → Environment Variables   | sin `APP_SESSION_SECRET` el login responde `503`; sin `APP_DATABASE_URL`, `500` |
| 2   | Root Directory = **raíz del repositorio** (vacío)                     | Vercel → Settings → General                 | la consola se sirve desde `public/`; apuntar a `angular/` rompe la API          |
| 3   | No crear un segundo proyecto para Angular                             | Vercel → Add New Project                    | dos dominios = CORS + cookie `SameSite` relajada                                |
| 4   | Limpiar la caché de build si un despliegue repite el bundle viejo     | Vercel → Deployments → Redeploy (sin caché) | `public/` se regenera en cada build; la caché no debe traerlo viejo             |
| 5   | Revisar ramas creadas por la integración de Neon                      | Neon → Branches                             | recupera cuota; las ramas de vista previa dejan de renovarse                    |
| 6   | Borrar el deployment de producción, **sólo cuando .NET sirva `/api`** | Vercel → Settings → Advanced                | apaga la URL pública, y con ella la consola y la API                            |

El orden importa: el paso 6 es el último y es irreversible desde el
repositorio.

### Rol de base de datos

La API se conecta con **`avisa_api`**, nunca con `neondb_owner`: en Neon ese rol
tiene `rolbypassrls = true` y se salta las 561 políticas RLS. La cadena
(`sslmode=verify-full`, host `-pooler`) y los detalles de roles están en
`docs/neon/README.md` §3. Dos cosas que se rompen si se tocan:

- **No cambiar el dueño de `core.autenticar_usuario`.** Es `SECURITY DEFINER`
  de `neondb_owner`; si pasa a `avisa_api`, la función deja de poder leer
  `core.usuarios` bajo RLS y el login falla.
- **No usar el host directo en la app** ni el pooler en scripts de migración:
  el pooler no conserva la sesión (`app.rol_codigo`) entre sentencias.

---

## 6 · Verificación

### 6.1 Local

```bash
npx tsc -p tsconfig.json --noEmit     # tipa la API
npm --prefix angular run typecheck    # tipa la consola (opcional)

pnpm build                            # reproduce el build de Vercel completo
pnpm build:spa && npx next start -p 3100

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3100/
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3100/casos
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3100/api/v1/health/db

curl -s -X POST http://localhost:3100/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"dni":"11111111","password":"demo"}'
```

Esperado: `/` y `/casos` devuelven `text/html` con el `index.html` de Angular;
`/api/v1/health/db` devuelve JSON `{"ok":true,"role":"avisa_api",...}`; el login
devuelve `200` con el perfil, no un token.

### 6.2 Producción

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://orchestra-chi-three.vercel.app/
curl -s https://orchestra-chi-three.vercel.app/api/v1/health/db
```

Un `200` en `/` con HTML de Angular y `"role":"avisa_api"` en el health
confirman las dos mitades. Si el HTML sigue siendo el de la consola React, el
deployment en pie es anterior al retiro de la UI: mirar el commit del
deployment y volver a desplegar.

### 6.3 Gate

```bash
# 0 = se omite el despliegue · 1 = se construye
git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)migration' \
  ':(exclude)backups' ':(exclude)docker' ':(exclude)sql_server' \
  ':(exclude)next-env.d.ts' ':(exclude)vercel.json' ':(exclude)*.md' \
  && echo OMITIR || echo CONSTRUIR
```

Si un push que sólo tocó `docs/` no aparece omitido, el proyecto tiene un
_Ignored Build Step_ propio (Vercel → Settings → Build & Development Settings) y
prevalece sobre el archivo.

---

## 7 · Dónde vive la API

**Angular sustituye la interfaz, no el backend.** El diseño de la migración lo
fija en su alcance («conservando el backend actual») y dibuja el destino con
nginx: un único origen público que sirve el build de Angular en `/` y hace
`proxy_pass /api/` al BFF.

```
navegador ──▶ mismo origen ──▶ /        → SPA Angular (index.html + chunks)
                          └──▶ /api/*   → API Next (:3000 en local, Vercel hoy)
                                            └──▶ PostgreSQL (Neon / PRODUCE)
```

Consecuencias:

1. **El contrato es la costura.** La SPA no conoce Next: conoce `/api/v1/**` y
   las formas JSON de `dominio/mapeo.ts` y los `*.mapeo.ts` de cada feature. El
   inventario verificado está en
   [`docs/07_frontend/angular/CONTRATO_API_SPA.md`](../07_frontend/angular/CONTRATO_API_SPA.md).
2. **`app/api/**` y `lib/db/**` siguen siendo necesarios** aunque Vercel
   desaparezca: son la implementación de referencia del contrato, también en
   local. Lo que se retira el día de la migración es el _hosting_, no el código.
3. **Cada cambio de contrato se hace primero en `app/api/**`** y se refleja el
   mismo día en el documento del contrato; la SPA no se toca si el contrato se
   respeta.

---

## 8 · Destino: API en .NET sobre un servidor de PRODUCE

La migración del backend a **.NET sobre un servidor de PRODUCE** no la ejecuta
este equipo. Eso fija tres cosas:

| Hoy                                                          | Después                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Vercel: Next sirve `/api/*` y la SPA Angular desde `public/` | Servidor PRODUCE: .NET sirve `/api/*`; nginx sirve Angular       |
| Neon (`avisa_api`, por el pooler)                            | La base que decida esa migración; la SPA nunca la ve             |
| `vercel.json` acota qué se reconstruye (§3)                  | El proyecto de Vercel se borra; este runbook queda como historia |

**Lo que hay que entregar al equipo de .NET**, en este orden:

1. [`docs/07_frontend/angular/CONTRATO_API_SPA.md`](../07_frontend/angular/CONTRATO_API_SPA.md):
   ruta, método, parámetros, cuerpo y forma de respuesta, pantalla por pantalla,
   con lo que la API nueva debe preservar y las divergencias abiertas.
2. Las formas de respuesta (`dominio/mapeo.ts` y los mapeos por feature).
3. El contrato de sesión: cookie `avisa_session`, `HttpOnly`, `SameSite=Lax`,
   `Path=/`, `Secure` en producción, `exp` **en milisegundos** y cuerpo
   `{uid, rol, roles[], nom, cod, dn, area, cargo, regs[], exp}`.
4. La regla del riesgo: se calcula en el servidor, no en el cliente. La SPA no
   debe promediar señales ni recalcularla.

---

## 9 · Qué se retiró y qué quedó

La UI React/Next se retiró cuando la consola Angular alcanzó paridad de lectura.
Lo que había y ya no está:

| Ruta                                                                  | Qué era                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `app/page.tsx`, `app/layout.tsx`, `app/error*.tsx`, `app/globals.css` | la única página React, su layout y su tema                                               |
| `components/`                                                         | dashboard, login, CRUD, mapa, calendario, exportación, glosario, etc.                    |
| `frontend/`                                                           | `Role` y `Session` del cliente, más el helper de login                                   |
| `lib/api-client.ts`, `lib/api-mappers.ts`                             | cliente HTTP y mapeos de la UI React                                                     |
| `lib/avisa-store.tsx`, `lib/theme.tsx`                                | estado global React y proveedor de tema                                                  |
| `postcss.config.mjs`, `components.json`                               | cadena de estilos de la UI React                                                         |
| dependencias React de `package.json`                                  | `leaflet`, `react-leaflet`, `lucide-react`, `@base-ui/react`, `tailwindcss`, `shadcn`, … |

Lo que **quedó** de Next es exactamente la API:

| Ruta               | Qué es                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| `app/api/**`       | las 30 rutas de `/api/auth/**` y `/api/v1/**`                             |
| `lib/db/**`        | pool, sesión, RLS por petición (`app.rol_codigo`), repositorios y errores |
| `lib/api/roles.ts` | vocabulario de rol que publica el login (`UI_ROLE`), antes en `frontend/` |

La consola **no** depende de React ni de Tailwind del proyecto raíz: trae sus
propias dependencias (Angular 22, Tailwind 4, Leaflet) en `angular/package.json`
y su propio lockfile.

---

## 10 · Trampas ya vistas

| Síntoma                                                             | Causa                                                                                           | Arreglo                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TS2307: Cannot find module '@angular/core'` en el build de Vercel  | el `tsconfig.json` raíz incluía `angular/`, sin sus dependencias                                | `"exclude": ["node_modules", "angular"]` (ya aplicado)                       |
| `/` devuelve 404 en local                                           | clon limpio sin `public/`                                                                       | `pnpm build:spa`                                                             |
| `/` devuelve el HTML de la consola React vieja                      | el deployment en pie es anterior al retiro de la UI                                             | redeploy desde `main` y comprobar el commit                                  |
| Login `500` con `Error interno.`                                    | falta `APP_DATABASE_URL` o el rol es `neondb_owner` con una cadena del pooler mal armada        | revisar variables (§5) y que el rol sea `avisa_api`                          |
| Login `503`                                                         | falta `APP_SESSION_SECRET` (mínimo 32 caracteres)                                               | definirla en Production, Preview y Development                               |
| `sh: line 1: ng: command not found` en el build de Vercel           | `NODE_ENV=production` hace que `npm ci` omita `devDependencies`; `@angular/cli` es una de ellas | `--include=dev` en el `npm ci` de `angular/` (ya aplicado)                   |
| `npm ci` falla en `angular/` con «lock file's X does not satisfy Y» | `package.json` pinneado y lockfile viejo                                                        | `npm --prefix angular install` y versionar el lockfile                       |
| Los datos desaparecen con `avisa_api`                               | RLS activo sin `app.rol_codigo` en la sesión                                                    | la API lo fija por petición (`lib/db/tenant.ts`); no consultar a mano sin él |
