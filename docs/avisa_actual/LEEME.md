# `avisa_actual` — qué es cada archivo

Material del **sistema en producción** (Google Sheets + Apps Script, 2026). No es
documentación de diseño: es evidencia y fuente para la migración. Se conserva
porque es la única copia del sistema que v10 reemplaza.

| Archivo | Qué es | Estado |
| --- | --- | --- |
| `Código.txt` | Volcado del `Code.gs` completo (244 funciones): backend de Apps Script | fuente primaria |
| `js_content.html` | Variante de `Code.gs` con los «9 fixes integrados» (1 190 de sus 1 280 líneas están en `Código.txt`; 90 son propias) | fuente primaria |
| `AppJs.txt` | Volcado del frontend (`getAppJS()`, 158 funciones) | fuente primaria |
| `AppFixes.txt` | Volcado de parches y módulos añadidos (`getAppFixes()`, 292 funciones) | fuente primaria |
| `legacy_bundle.js` | **Consolidado.** El JS que el HTML servía realmente al navegador: 1 125 289 bytes, 1 290 funciones | derivado |
| `index.html`, `appsscript.json` | Shell de la SPA y manifiesto del proyecto Apps Script | fuente primaria |
| `Catálogo de funciones — Code.gs …` | Índice de funciones del backend | derivado |
| `Catálogo de funciones — Frontend …` | Índice de funciones del frontend | derivado |
| `clases.puml` · `clases.svg` | Diagrama de clases del sistema completo (P1 frontend, P2 backend, P3 86 tablas) | derivado |
| `clasesAvisa_fixed.gaphor` | Fuente editable del diagrama (Gaphor) | derivado |
| `CLASIFICACION_INPUT_PROCESO_OUTPUT.md` | Clasificación de las 694 funciones del código por función (I/P/O/INF) | vigente |

## Qué se retiró el 2026-11-18 y por qué

1. **`js1.html` … `js7.html`.** No eran siete archivos de JavaScript: eran **siete
   trozos de un único flujo base64** (`Code.gs` servía el JS en 7 partes). Sumaban
   1 500 388 caracteres de base64 que decodificaban a 1 125 289 bytes. Se
   decodificaron y concatenaron en `legacy_bundle.js`; el contenido es idéntico y
   ahora es legible y `grep`-eable. Ningún documento los citaba.
2. **`CLASIFICACION_BASE_V9_EN_VIVO.md`.** Estaba marcado como «absorbido» y su
   contenido vivía ya en `docs/BRECHA_CAPA_DATOS_V9.md` §12 (clasificación
   funcional) y §13 (defecto de migración y cobertura). Se eliminó para no
   mantener dos copias de los mismos conteos.

Regla: un archivo de este directorio solo se retira si su contenido **completo**
existe en otro sitio verificable, o si es una codificación redundante de algo que
ya está en claro aquí. Ninguna cifra de la migración depende de estos archivos:
depende de `legacy.*` en la base (D21).
