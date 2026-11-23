# Despliegue: Vercel, Neon y la SPA

**Estado (2026-11-22):** el repositorio es, en su raíz, un proyecto **Next.js 16**
(`package.json` con `next@16.4.3`, `next.config.mjs`, `app/` y `components/`).
Vercel lo detecta automáticamente y hoy **es el único sitio donde corre la API**.
Este documento fija qué vive dónde, qué se hizo desde el repositorio para que los
commits que no tocan Next no lo reconstruyan, qué queda en manos del panel y cuál
es el destino decidido: la API pasa a **.NET en un servidor de PRODUCE**, en una
migración que ejecuta otro equipo (§8).

---

## 1 · Topología real

| Capa                       | Dónde vive hoy                                   | Cómo se levanta                                               | Quién la consume                                      |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| Base de datos (desarrollo) | contenedor `avisa-db`, PostgreSQL 16 + PostGIS   | `./scripts/db.sh up`, puerto `55433`                          | la API de Next en local                               |
| Base de datos (compartida) | Neon, base `neondb`                              | externa; DDL con `NEON_OWNER_URL`, aplicación con `avisa_api` | la API, cuando se ejecuta contra `APP_DATABASE_URL`   |
| API + UI Next (local)      | contenedor `avisa-ui`, `pnpm dev` en `:3000`     | `docker compose up -d` (monta el repositorio en `/app`)       | la SPA mediante el proxy `/api`                       |
| SPA Angular (definitiva)   | `angular/`, servidor de desarrollo en `:4200`    | `cd angular && npm start`                                     | el usuario final                                      |
| API + UI Next (producción) | proyecto de Vercel (enlace **sólo** en el panel) | push a `main` que toque el código de Next, ver §3             | la SPA, en cuanto se publique; hoy, ningún consumidor |

La SPA no tiene backend propio: `angular/proxy.conf.json` reenvía `/api` a
`http://localhost:3000`, y `core/config/entorno.ts` usa `apiBase: "/api"` por
defecto. **`app/api/**` es el backend de la SPA**, también en local. Por eso
`app/` y `components/` no se tocan: allí conviven la referencia de diseño
congelada y las rutas que la SPA consume.

---

## 2 · Por qué Vercel reconstruía Next en cada push

1. La raíz del repositorio **es** un proyecto Next: Vercel no necesita
   configuración para detectarlo.
2. El entorno de trabajo hace commits automáticos (`ui y neon` en el historial
   reciente) y los empuja a `main`.
3. Cada push abría un despliegue de producción: instalación de dependencias,
   `next build` y, si el proyecto tiene vinculada la integración de Neon, una
   rama de base de datos por despliegue de vista previa.

Ese despliegue **es la única API pública que existe hoy**: la SPA todavía no
está publicada en ninguna parte, así que nadie la consume. Lo que sí está
congelado es la mitad de interfaz de ese deployment: la UI React. Sólo generaba
tiempo de construcción y consumo en Neon, y la prueba de que Vercel compila la
raíz está en `tsconfig.json`, que excluye `angular` con esta nota:

> «La SPA de `angular/` tiene su propio tsconfig y sus propias dependencias
> (npm, no pnpm). Si entra al programa de `tsc` del proyecto Next, el build de
> Vercel aborta con TS2307 en todo `angular/src/**`.»

---

## 3 · Qué se hizo desde el repositorio

`vercel.json` en la raíz:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)angular' ':(exclude)migration' ':(exclude)scripts' ':(exclude)backups' ':(exclude)docker' ':(exclude)sql_server' ':(exclude)next-env.d.ts' ':(exclude)vercel.json' ':(exclude)*.md'"
}
```

- **`ignoreCommand` decide si hay algo que construir.** Vercel ejecuta el
  comando en la raíz del proyecto; si sale con 0, **omite** el despliegue y el
  push aparece como _Skipped_.
- **La lista es de exclusiones, no de inclusiones.** Lo que no está excluido
  construye: un archivo nuevo en la raíz que sí importe no se queda sin publicar.
  Quedan fuera de la comparación `docs/`, `angular/`, `migration/`, `scripts/`,
  `backups/`, `docker/`, `sql_server/`, `next-env.d.ts` (lo reescribe `next dev`),
  `vercel.json` (este mismo gate) y los `.md` de la raíz.
- **No apaga la producción.** Vercel sigue sirviendo la API: un arreglo de
  `app/api/**` o `lib/db/**` se publica como siempre.
- **Falla hacia construir.** Si `HEAD^` no existe (primer push de la rama, force
  push), git devuelve error, el comando sale distinto de 0 y Vercel construye en
  vez de omitir en silencio.

El efecto práctico: los commits de documentación, de migraciones SQL y de la SPA
dejan de disparar `next build`. Los de la API lo siguen disparando.

**Para congelar del todo** —cuando .NET ya reemplace la API (§8)— se sustituye el
objeto por `{"git":{"deploymentEnabled":{"main":false}}}`. Con eso el push no
construye nunca más y el último despliegue sigue en pie hasta que se borre el
proyecto en el panel.

---

## 4 · Lo que sólo se resuelve en el panel

Ninguna de estas acciones vive en el repositorio: el enlace del proyecto está en
Vercel y la integración de Neon, en el panel de Neon.

| #   | Acción                                                                   | Dónde                                  | Efecto                                                                     |
| --- | ------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Revisar que los commits que no tocan Next aparezcan como _Skipped_       | Vercel → Deployments                   | confirma que `ignoreCommand` está leyéndose                                |
| 2   | Desconectar el repositorio Git del proyecto                              | Vercel → Settings → Git                | cierra la vía por completo, sin depender de `vercel.json`                  |
| 3   | Borrar el deployment de producción, **sólo cuando .NET ya sirva `/api`** | Vercel → Settings → Advanced           | **apaga la URL pública**, y con ella `/api` para cualquier cliente externo |
| 4   | Revisar ramas creadas por la integración de Neon                         | Neon → Branches (`neondb`)             | recupera espacio y cuota; las ramas de vista previa dejan de renovarse     |
| 5   | Revocar la integración Neon ↔ Vercel, si existe                          | Neon → Integrations / Vercel → Storage | impide que el próximo despliegue clone la base                             |

El orden importa: **1 y 2 antes que 3**, y **3 sólo después de que .NET esté
sirviendo la API** (§8). `vercel.json` y la desconexión del repositorio son los
que retiran el disparador; borrar el proyecto es el último paso y es irreversible
desde el repositorio.

---

## 5 · Verificación

```bash
# el archivo existe y es JSON válido
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"

# simula el comando sobre los dos últimos commits
#   0 = se omite el despliegue · 1 = se construye
git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)angular' \
  ':(exclude)migration' ':(exclude)scripts' ':(exclude)backups' \
  ':(exclude)docker' ':(exclude)sql_server' ':(exclude)next-env.d.ts' \
  ':(exclude)vercel.json' ':(exclude)*.md' && echo OMITIR || echo CONSTRUIR

# qué rutas harían construir: ninguna de las excluidas debe aparecer
git --no-pager diff --name-only HEAD^ HEAD -- . ':(exclude)docs' \
  ':(exclude)angular' ':(exclude)migration' ':(exclude)scripts' \
  ':(exclude)backups' ':(exclude)docker' ':(exclude)sql_server' \
  ':(exclude)next-env.d.ts' ':(exclude)vercel.json' ':(exclude)*.md'

# no hay enlaces de Vercel versionados (están en .gitignore)
git --no-pager ls-files | grep -E '^\.vercel/' || echo 'sin .vercel versionado'

# artefactos de construcción locales fuera del árbol
ls -a | grep -E '^\.next|tsbuildinfo' || echo 'sin artefactos locales'
```

Después del commit que añade `vercel.json`, el panel debe mostrar el push como
omitido. Si no ocurre, el proyecto tiene el despliegue forzado desde su propia
configuración (Vercel → Settings → Build & Development Settings) y prevalece
sobre el archivo.

---

## 6 · Cómo desplegar la SPA más adelante

El día que la SPA se publique, **no** debe colgar del mismo proyecto: la raíz del
repositorio seguirá siendo Next y Vercel volverá a detectarlo. La forma limpia es
un proyecto nuevo con **Root Directory = `angular/`**, salida
`dist/avisa/browser` y una regla de reescritura a `index.html` para las rutas del
router. Ese proyecto necesita además que `/api` tenga un host; hoy lo tiene en
Vercel y mañana en .NET (§7 y §8).

---

## 7 · Dónde vive la API

**Angular sustituye la interfaz, no el backend.** `DISENO_MIGRACION_ANGULAR.md`
lo fija en su alcance («conservando el backend actual») y lo dibuja en §1.3: un
único origen público con nginx que sirve el build de Angular en `/` y hace
`proxy_pass /api/` al BFF de Next. La UI React **no se publica** por nginx
(§1.3), así que no hay dos shells ni doble login.

```
navegador ──▶ nginx :443 ──▶ /        → Angular estático
                        └──▶ /api/*  → BFF Next (:3000) ──▶ PostgreSQL
```

Consecuencias para este documento:

1. **En Vercel no tiene que sobrevivir nada**, porque Vercel no aparece en ese
   diagrama: la SPA no se sirve desde ahí y el BFF tampoco.
2. **El código de Next sigue siendo necesario** aunque Vercel desaparezca:
   `app/api/**` y `lib/db/**` son el `/api` de la SPA, también en local. Lo que
   se retira es el _hosting_, no el código. `§5.7` del diseño ya anota que el
   upstream será «mañana, la API de OAGTI»; esa migración es la de §8.
3. **Lo que falta no es la decisión, es la migración a .NET.** El destino está
   decidido (§8); mientras no aterrice, borrar el proyecto de Vercel deja la
   aplicación sin ningún `/api` público — y hoy tampoco hay SPA publicada, así que
   no se cae un servicio en uso: se pierde la única instancia desplegada que existía.

---

## 8 · Destino: API en .NET sobre un servidor de PRODUCE

La migración del backend a **.NET sobre un servidor de PRODUCE** no la ejecuta
este equipo: está en manos de otro. Eso fija tres cosas:

| Hoy                                               | Después                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Vercel: Next sirve `/api/*` y también la UI React | Servidor PRODUCE: .NET sirve `/api/*`; nginx sirve Angular       |
| Neon (`avisa_api`, por el pooler)                 | La base que decida esa migración; la SPA nunca la ve             |
| `vercel.json` acota qué se reconstruye (§3)       | El proyecto de Vercel se borra; este runbook queda como historia |

**El contrato es la costura.** La SPA no conoce Next: conoce `/api/v1/**` y las
formas JSON que traducen `dominio/mapeo.ts` y los `*.mapeo.ts` de cada feature.
El .NET debe reproducir esas rutas y esas formas; si cambia alguna, el ajuste se
hace en los mapeos, en un solo sitio. Por eso `app/api/**` **no se retira antes**:
es la implementación de referencia del contrato, con sus códigos `{detail, code}`
y sus estados ya probados desde la SPA.

**Lo que hay que entregar al equipo de .NET**, en este orden:

1. Las rutas que la SPA llama (`urlApi(` en `angular/src/app`), con su método.
2. Las formas de respuesta (`dominio/mapeo.ts` y los mapeos por feature).
3. El contrato de sesión: cookie `avisa_session`, `HttpOnly`, `SameSite=Lax`,
   `Path=/`, `Secure` en producción, `exp` **en milisegundos** y cuerpo
   `{uid, rol, roles[], nom, cod, dn, area, cargo, regs[], exp}`.
4. La regla del riesgo: se calcula en el servidor, no en el cliente. La SPA no
   debe promediar señales ni recalcularla.

Mientras .NET no exista, cada cambio de contrato se hace en `app/api/**` y la SPA
lo consume igual: el reemplazo no debe obligar a tocar `angular/`.
