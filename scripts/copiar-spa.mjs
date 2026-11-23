#!/usr/bin/env node
/**
 * Publica la SPA Angular en `public/` para que Next la sirva junto a la API.
 *
 * `public/` es artefacto de build: no se versiona y se regenera en cada
 * compilación. Los rewrites de `next.config.mjs` mapean `/` y las rutas
 * profundas de Angular a `index.html`, y dejan libres `/api/**`, `/_next/**` y
 * los archivos con extensión.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origen = join(raiz, "angular", "dist", "avisa", "browser");
const destino = join(raiz, "public");

try {
  await access(origen);
} catch {
  console.error(
    "[copiar-spa] No existe angular/dist/avisa/browser. Ejecutá 'npm --prefix angular run build' primero.",
  );
  process.exit(1);
}

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });
await cp(origen, destino, { recursive: true });

console.log("[copiar-spa] SPA publicada en public/");
