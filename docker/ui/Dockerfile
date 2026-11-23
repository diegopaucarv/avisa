# =============================================================================
#  AVISA · API (Next.js 16) y consola Angular
#
#  Contexto de construcción: la RAÍZ del repositorio (ver compose.yaml).
#  Las dependencias de la API se instalan en la imagen; en tiempo de ejecución
#  el código se monta desde el disco y `node_modules` vive en un volumen que
#  Docker siembra con lo ya instalado. Así se edita con recarga en caliente
#  sin reinstalar en cada arranque.
#
#  La consola Angular NO se construye aquí: `angular/` queda fuera del contexto
#  (`.dockerignore`) y el montaje de `.:/app` taparía cualquier `public/` de la
#  imagen. Se compila en el host y Next la sirve desde el `public/` montado:
#      npm --prefix angular ci      # una vez
#      pnpm build:spa               # cada cambio de Angular
#
#  Reconstruir la imagen sólo hace falta cuando cambia `package.json` o el
#  candado de la API:
#      docker compose build ui
#  Y, si el volumen ya existía, hay que vaciarlo para que se vuelva a
#  sembrar:  docker volume rm avisa_node_modules
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# La versión de pnpm la fija `packageManager` en package.json (12.3.4).
RUN corepack enable

# Sólo los manifiestos: si el código cambia, esta capa no se invalida.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# El resto del proyecto. `.dockerignore` deja fuera node_modules, .next, docs…
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
