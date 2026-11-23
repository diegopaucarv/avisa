# Despliegue: Vercel, Neon y la SPA

**Estado (2026-11-22):** el repositorio es, en su raíz, un proyecto **Next.js 16**
(`package.json` con `next@16.4.3`, `next.config.mjs`, `app/` y `components/`).
Vercel lo detecta automáticamente y lo reconstruye en **cada push a `main`**,
incluidos los commits automáticos del entorno de trabajo (`ui`). Este documento
fija qué vive dónde, qué se hizo desde el repositorio para detener esos
despliegues y qué queda en manos del panel.

---

## 1 · Topología real

| Capa                       | Dónde vive hoy                                   | Cómo se levanta                                               | Quién la consume                                    |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| Base de datos (desarrollo) | contenedor `avisa-db`, PostgreSQL 16 + PostGIS   | `./scripts/db.sh up`, puerto `55433`                          | la API de Next en local                             |
| Base de datos (compartida) | Neon, base `neondb`                              | externa; DDL con `NEON_OWNER_URL`, aplicación con `avisa_api` | la API, cuando se ejecuta contra `APP_DATABASE_URL` |
| API + UI Next (local)      | contenedor `avisa-ui`, `pnpm dev` en `:3000`     | `docker compose up -d` (monta el repositorio en `/app`)       | la SPA mediante el proxy `/api`                     |
| SPA Angular (definitiva)   | `angular/`, servidor de desarrollo en `:4200`    | `cd angular && npm start`                                     | el usuario final                                    |
| API + UI Next (producción) | proyecto de Vercel (enlace **sólo** en el panel) | push a `main`… **ahora desactivado**, ver §3                  | nadie: la UI Next está congelada                    |

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

Ese despliegue **no es el que usa la SPA** y su UI está congelada: sólo generaba
tiempo de construcción y consumo en Neon. La prueba de que Vercel compila la
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
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

- **Desactiva los despliegues por git de la rama `main`.** Vercel sigue leyendo
  la configuración y el proyecto sigue existiendo, pero un push ya no dispara
  una construcción.
- **No borra nada.** El último despliegue de producción sigue en pie y sigue
  sirviendo su `/api`; no hay caída.
- **Es reversible sin tocar el panel:** basta cambiar `false` por `true` y
  empujar.
- **Sólo alcanza `main`.** Si en el futuro se abre otra rama, se añade su nombre
  al mismo objeto (`"rama": false`). Vercel no admite comodines aquí.

Si alguna vez hay que publicar un cambio en la API que aún vive en Vercel, se
pone `true`, se empuja ese commit y se vuelve a poner `false`. Los cambios de la
SPA o de la documentación **no** necesitan ese viaje: no se sirven desde Vercel.

El commit que introduce el archivo puede llegar a construir una vez; del
siguiente en adelante el push se marca como omitido.

---

## 4 · Lo que sólo se resuelve en el panel

Ninguna de estas acciones vive en el repositorio: el enlace del proyecto está en
Vercel y la integración de Neon, en el panel de Neon.

| #   | Acción                                                   | Dónde                                  | Efecto                                                                     |
| --- | -------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Revisar que ningún push genera despliegue                | Vercel → Deployments                   | los commits nuevos aparecen como _Skipped_                                 |
| 2   | Desconectar el repositorio Git del proyecto              | Vercel → Settings → Git                | cierra la vía por completo, sin depender de `vercel.json`                  |
| 3   | Borrar el deployment de producción, si ya no se necesita | Vercel → Settings → Advanced           | **apaga la URL pública**, y con ella `/api` para cualquier cliente externo |
| 4   | Revisar ramas creadas por la integración de Neon         | Neon → Branches (`neondb`)             | recupera espacio y cuota; las ramas de vista previa dejan de renovarse     |
| 5   | Revocar la integración Neon ↔ Vercel, si existe          | Neon → Integrations / Vercel → Storage | impide que el próximo despliegue clone la base                             |

El orden importa: **1 y 2 antes que 3**. `vercel.json` y la desconexión del
repositorio son los que retiran el disparador; borrar el proyecto es el último
paso y sólo tiene sentido cuando la URL pública ya no hace falta, porque es
irreversible desde el repositorio.

---

## 5 · Verificación

```bash
# el archivo existe y es JSON válido
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"

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
router. Ese proyecto necesita además decidir dónde vive `/api` (ver §7).

---

## 7 · Decisión abierta

`app/api/**` es hoy el único backend de la SPA. Mientras no exista un backend
propio para Angular, el código de Next **no puede retirarse del repositorio**:
eso dejaría la SPA sin datos incluso en local. Lo que se cerró aquí es sólo el
gasto de reconstruirlo en cada push; el retiro definitivo de Next exige primero
decidir a dónde se mueve la API.
