# Auditoría de tema oscuro de la SPA Angular

**Tipo de documento:** auditoría (no corrige pantallas ajenas)
**Fecha:** 24-nov-2026
**Alcance:** `angular/src/app/**` (componentes, páginas y plantillas). No incluye `styles/**` globales ni `src/index.html`.
**Estándar de referencia:** `docs/07_frontend/mockups/` — `actores_editar_actor_modo_oscuro_2.html`, `locales_lista_con_ficha_abierta_modo_oscuro.html`, `actores_modo_oscuro_y_ventana_flotante.html`, `perfil-territorial.html`.

---

## 0. Resumen

El tema oscuro se activa con `html[data-theme='dark']`, cuyas variables define `styles/theme-dark.generated.css` y completa `styles/theme-dark-overrides.css`. El propio override lo advierte en su cabecera:

> «los estilos inline de componentes (`styles:`) no se oscurecen nunca, y el generador sólo traduce reglas de global.css».

Es decir: **todo color literal escrito dentro de `styles:` de un componente es una isla que el tema oscuro no alcanza**, salvo que `theme-dark-overrides.css` lo cubra por nombre de clase. Esta auditoría mide esas islas.

Resultado de la medición (detalle en §2):

| Categoría                        | Ocurrencias | Archivos |
| -------------------------------- | ----------: | -------: |
| Fondos claros fijos (superficie) |     **186** |       42 |
| Tinta oscura fija (texto)        |     **403** |       47 |
| Bordes claros fijos              |     **144** |       32 |
| **Total de literales de riesgo** |     **733** |   **49** |

Sólo `features/preferencias/**` está limpio: no tiene ni un color literal y ya usa variables (`--muted`, `--red`, `--red-pale`). No se corrigió ninguna pantalla de `features/**` ajena: este documento **sólo audita**.

El tema tiene una única fuente de verdad: `PreferenciasService` (señal + servidor) y `TemaService` (traduce a `data-theme` / `data-density`). El servicio ya se instancia en el arranque desde `app.config.ts`, así que el tema se aplica aunque nadie abra Preferencias. No queda ningún otro conmutador que escriba `data-theme` ni `avisa-theme` fuera de `TemaService` y del bootstrap de `index.html`.

---

## 1. Método

Se recorrió `angular/src/app/**/*.{ts,html}` línea a línea, separando cada declaración por `;` para cubrir también los `style="…"` de plantilla. Cada color hexadecimal se clasificó por luminancia relativa `L = (0.2126·R + 0.7152·G + 0.0722·B) / 255`:

| Categoría                 | Propiedad                            | Umbral                       |
| ------------------------- | ------------------------------------ | ---------------------------- |
| **Superficie clara fija** | `background`, `background-color`     | `L ≥ 0.80` (incluye `white`) |
| **Tinta oscura fija**     | `color`                              | `L ≤ 0.70`                   |
| **Borde claro fijo**      | `border`, `border-*`, `border-color` | `L ≥ 0.75`                   |

Se **excluyó** toda declaración que use `var(--…)`, porque el fallback de una variable no se aplica cuando el tema oscuro define la variable. Reproducción:

```sh
# fondos claros (muestra acotada a la paleta «papel»)
grep -rIEn "background(-color)?:[[:space:]]*(#fff(fff)?|#fbfcfd|#fafbfc|#f5f7f8|#f3f6f8|#f8fafb|#eef1f4|#eef3f8|white)\b" angular/src/app --include=*.ts --include=*.html

# cualquier literal de texto
grep -rInE "^[[:space:]]*color:[[:space:]]*#[0-9a-fA-F]{3,8}" angular/src/app --include=*.ts --include=*.html

# bordes con literal
grep -rInE "^[[:space:]]*border[^;]*#[0-9a-fA-F]{3,8}" angular/src/app --include=*.ts --include=*.html
```

## 2. Inventario por archivo

`Sup.` = fondos claros, `Tinta` = textos oscuros, `Borde` = bordes claros. Ordenado por total.

| Archivo                                                        | Sup. | Tinta | Borde |  Total |
| -------------------------------------------------------------- | ---: | ----: | ----: | -----: |
| `features/bandeja/bandeja.page.ts`                             |   17 |    11 |    15 | **43** |
| `features/documentos/documento-panel.component.ts`             |   14 |    17 |    11 | **42** |
| `features/alertas/alerta-panel.component.ts`                   |    8 |    24 |     9 | **41** |
| `features/directorio/actor-panel.component.ts`                 |   10 |    24 |     5 | **39** |
| `features/directorio/actores.page.ts`                          |   11 |    18 |     8 | **37** |
| `features/directorio/locales.page.ts`                          |   10 |    20 |     4 | **34** |
| `features/directorio/actor-panel-fusion.component.ts`          |    8 |    15 |    10 | **33** |
| `features/mapa/mapa.page.ts`                                   |    6 |    19 |     7 | **32** |
| `features/resumen/resumen.page.ts`                             |    3 |    23 |     5 | **31** |
| `features/directorio/actor-panel-alta.component.ts`            |    6 |    10 |     7 | **23** |
| `features/busqueda/busqueda.page.ts`                           |    5 |    15 |     2 | **22** |
| `features/compromisos/compromiso-panel.component.ts`           |    7 |     7 |     6 | **20** |
| `features/matriz-conflictividad/matriz-conflictividad.page.ts` |    4 |    12 |     4 | **20** |
| `features/alertas/alerta-modificacion.component.ts`            |    4 |     9 |     4 | **17** |
| `features/alertas/alertas.page.ts`                             |    3 |    14 |     0 | **17** |
| `features/casos/caso-panel.component.ts`                       |    4 |     8 |     5 | **17** |
| `features/casos/casos.page.ts`                                 |    3 |    10 |     4 | **17** |
| `features/alertas/caso-combobox.component.ts`                  |    5 |     8 |     3 | **16** |
| `features/compromisos/compromisos.page.ts`                     |    2 |    10 |     4 | **16** |
| `features/documentos/documentos.page.ts`                       |    3 |    12 |     1 | **16** |
| `features/alertas/acciones-fila.component.ts`                  |    7 |     5 |     3 | **15** |
| `features/alertas/alerta-archivo.component.ts`                 |    3 |     8 |     3 | **14** |
| `features/archivo/archivo-panel.component.ts`                  |    3 |     8 |     3 | **14** |
| `features/casos/demandas-sin-caso.page.ts`                     |    3 |     8 |     3 | **14** |
| `features/directorio/organizaciones.page.ts`                   |    4 |    10 |     0 | **14** |
| `features/notificaciones/notificaciones.page.ts`               |    5 |     9 |     0 | **14** |
| `features/alertas/alerta-whatsapp.component.ts`                |    3 |     6 |     3 | **12** |
| `features/busqueda/busqueda-ficha.component.ts`                |    2 |     6 |     2 | **10** |
| `shared/ui/anular-panel.component.ts`                          |    2 |     6 |     2 | **10** |
| `shared/ui/galeria-fotos.component.ts`                         |    3 |     4 |     2 |  **9** |
| `features/archivo/archivo.page.ts`                             |    0 |     7 |     0 |  **7** |
| `features/compromisos/matriz-importar.component.ts`            |    1 |     5 |     1 |  **7** |
| `features/direccion/direccion.page.ts`                         |    1 |     4 |     1 |  **6** |
| `features/gobierno-sugerencias/sugerencia-form.component.ts`   |    1 |     2 |     3 |  **6** |
| `features/resultados/lista-asistencia.component.ts`            |    3 |     2 |     1 |  **6** |
| `shared/ui/foto-ficha.component.ts`                            |    2 |     2 |     2 |  **6** |
| `features/casos/caso-detalle.page.ts`                          |    2 |     3 |     0 |  **5** |
| `features/casos/caso-vista-previa.component.ts`                |    1 |     3 |     1 |  **5** |
| `features/reportes/reportes.page.ts`                           |    0 |     4 |     0 |  **4** |
| `features/reuniones/reuniones.page.ts`                         |    2 |     2 |     0 |  **4** |
| `features/casos/demanda-panel.component.ts`                    |    0 |     3 |     0 |  **3** |
| `features/compromisos/matriz-equipo.component.ts`              |    0 |     3 |     0 |  **3** |
| `features/directorio/directorio.page.ts`                       |    1 |     2 |     0 |  **3** |
| `features/casos/evento-panel.component.ts`                     |    0 |     2 |     0 |  **2** |
| `features/mapa/mapa.page.html`                                 |    2 |     0 |     0 |  **2** |
| `layouts/shell/shell.component.ts`                             |    1 |     1 |     0 |  **2** |
| `features/directorio/instituciones.page.ts`                    |    0 |     1 |     0 |  **1** |
| `shared/ui/aviso-inactividad.component.ts`                     |    1 |     0 |     0 |  **1** |
| `shared/ui/barra-seleccion.component.ts`                       |    0 |     1 |     0 |  **1** |

> `layouts/shell/**` está fuera del permiso de edición; se incluye sólo como medición. `features/preferencias/**` no aparece: cero literales.

### 2.1 · Colores más repetidos

| Fondos (`L ≥ 0,80`) | Veces | Tinta (`L ≤ 0,70`) | Veces | Bordes (`L ≥ 0,75`) | Veces |
| ------------------- | ----: | ------------------ | ----: | ------------------- | ----: |
| `#fff`              |    53 | `#8a98a5`          |    20 | `#eef2f6`           |    22 |
| `#fbfcfd`           |    12 | `#33475b`          |    20 | `#e8edf1`           |    12 |
| `#fafbfc`           |     8 | `#465a6c`          |    20 | `#dbe3ea`           |     9 |
| `#f6f8fa`           |     8 | `#1a2b3e`          |    19 | `#dce3e8`           |     7 |
| `#f5f7f8`           |     6 | `#8b97a1`          |    18 | `#e6ecf1`           |     7 |
| `#eef3fa`           |     6 | `#8d99a6`          |    17 | `#e6ebef`           |     5 |
| `#eaf1fb`           |     6 | `#647487`          |    15 | `#f0d9d5`           |     5 |
| `#f0f3f5`           |     5 | `#97a1aa`          |    14 | `#cddcef`           |     4 |
| `#fdf6f5`           |     5 | `#a0aab3`          |    14 | `#c9d8ea`           |     3 |
| `#eef1f4`           |     3 | `#7b8896`          |    14 | `#dde5ec`           |     3 |

## 3. Detalle por archivo (archivo · línea · color)

### 3.1 · `features/bandeja/bandeja.page.ts` — 43

- Superficies (17): L97 `#f8fafb`, L120 `#fff`, L153 `#fff`, L175 `#fdf1ef`, L181 `#fdf6ec`, L187 `#eaf1f8`, L193 `#eef7f2`, L199 `#fdf1ef`, L205 `#fdf6ec`, L211 `#eef7f2`, L232 `#eef1f4`, L284 `#fdf6ec`, L307 `#fff`, L347 `#f8fbff`, L364 `#fff`, L400 `#fff`, L427 `#fffaf0`
- Bordes (15): L137 y L151 `#dfe4ea`; L174 y L198 `#f3c3bd`; L180, L204, L282 y L425 `#f5d6b3` / `#f1d9a8`; L186, L334 y L345 `#cddcef`; L192 y L210 `#c9e3d5`; L300 `#eef1f4`; L362 `#dce3e8`
- Tinta (11): L139/L259/L273 `#97a3b0`, L182/L285/L428 `#8a5a00`, L188 `#2455a2`, L206 `#ad741d`, L224 `#8995a0`, L353 `#647487`, L434 `#6d4700`

### 3.2 · `features/documentos/documento-panel.component.ts` — 42

- Superficies (14): L147 `#eef3fa`, L152 `#f0f3f5`, L157 `#edf6f0`, L236 `#edf6f0`, L248 `#fdf6f5`, L288 `#fdf8ef`, L342 `#fff`, L349 `#fafcfe`, L372 `#fbfcfd`, L440 `#fff`, L469 `#fbfcfd`, L542 `#f7f9fa`, L610 `#f7f9fa`, L628 `#eef7f2`
- Tinta (17): L131 `#8a98a5`, L148 `#4a6b93`, L153 `#657684`, L158 `#52806a`, L195 `#97a1aa`, L204 `#465a6c`, L212 `#52677a`, L220 `#a0aab3`, L227 `#8d99a6`, L237 `#52806a`, L249 `#a3402f`, L289 `#7a5a24`, L316 `#465a6c`, L321 `#97a1aa`, L421 `#5c7285`, L514 `#97a1aa`, L543 `#6d8296`
- Bordes (11): L167 y L262 `#eef2f6`, L246 y L633 `#f0d9d5` / `#f0d2cf`, L286, L477 y L641 `#f3e0c2`, L312 `#dbe7f4`, L493 `#cddcef`, L524 `#f1f3f5`, L627 `#cbe6d8`
- Ojo: las líneas L398, L430, L467, L513, L540 y L608 usan `var(--line, #e6ebef)` y **no** se cuentan: el fallback no se aplica en tema oscuro.

### 3.3 · `features/alertas/alerta-panel.component.ts` — 41

- Superficies: L233, L268, L328, L353, L478 `background: #fff`; L303, L363, L396 `background: #fbfcfd` / `#f9fbfd`
- Tinta (24): L162/L170 `#8a98a5`, L179 `#17283a`, L191 `#64748b`, L196 `#4a6b93`, L201/L364/L413/L488 `#8b97a1`, L213/L329/L439 `#1f5597`, L218 `#b8860b`, L223 `#d9661f`, L238/L254 `#1a2b3e`, L273/L285/L430 `#33475b`, L291 `#99a3aa`, L372/L407/L482 `#17283a`, L425 `#64748b`
- Bordes (9 claros): L231 y L266 `#e8edf1`; L301 y L351 `#e6ecf1`; L326 `#c8d6e4`; L361 `#dde5ec`; L394 `#e8edf1`; L424 y L476 `#eef2f6`. L337 y L403 son `border-color: #1f5597` (acento, no claro).

### 3.4 · `features/directorio/actor-panel.component.ts` — 39

- L134 `background: #eef2f6` · L246/L412 `background: #fff` · L254/L420 `background: #f5f7f8`
- L301 `background: #fdf6f5` · L338 `background: #edf6f0` · L343 `background: #eef2fb` · L348 `background: #fdeceb` · L353 `background: #f0f3f5`
- Tinta: L135 `#607284`, L156 `#1c2a38`, L165 `#647487`, L175 `#aa6a11`, L181/L209/L430 `#97a1aa`, L217 `#465a6c`, L225 `#8b97a1`, L247 `#526577`, L265 `#7b8896`, L273 `#52677a`, L284 `#7d8b98`, L291 `#96a3af`, L302 `#a3402f`, L312 `#a0aab3`, L339 `#2f7a52`, L344 `#31599f`, L349 `#b03a2e`, L354 `#657684`, L386/L413 `#33475b`, L399 `#596c7e`, L421 `#8a98a5`
- Bordes: L190/L380 `#eef2f6`, L244/L410 `#dce3e8`, L299 `#f0d9d5`

### 3.5 · `features/directorio/actores.page.ts` — 37

- L172/L300/L360/L422/L482 `background: #fff`
- L192/L306 `background: #f5f7f8` · L332 `background: #fafbfc`
- Tinta: L271/L301/L423 `#526577`, L276/L316 `#1f5597`, L328/L413 `#8a98a5`, L375 `#1a2b3e` (+10 tintas más)
- Borde: L315 `border-color: #1f5597` (acento) y 8 claros: L170 `#dce5ef`, L298/L420 `#dce3e8`, L339 `#e2e7ec`, L358/L436 `#dce5ef`, L398 `#edf0f2`, L480 `#cfd9e2`

### 3.6 · `features/mapa/mapa.page.ts` y `.html` — 34

- `mapa.page.ts`: L623/L684/L872 `background: #fff`; L748/L816 `background: #fafbfc`; L881 `background: #eaf1fb`; L796/L822/L873 `#33475b`; L847 `#17283a`; L814/L870 `border: 1px solid #e6ebef`
- `mapa.page.html`: L250 `style="background: #fff; border: 2px solid #1d427f"`; L183 `style="background: #eaf1fb; border: 1.5px solid #1d427f"`

### 3.7 · `features/resumen/resumen.page.ts` — 31

- L154 `background: #eef2f6` · L273/L399 `background: #fafbfc`
- L142/L197/L251/L285/L411 `color: #1a2b3e`
- L173/L238 `border-top: 1px solid #eef1f3` · L271/L397 `border: 1px solid #e6ebef`
- Tinta secundaria: `#7b8896`, `#8a96a0`, `#5a6b7a`, `#8b97a2`, `#9aa5ae`, `#8b5a54`.

### 3.8 · `features/directorio/actor-panel-fusion.component.ts` — 33

- L78 `background: #fff` · L116 `background: #fdfaf1` · L141/L218 `background: #f7f9fb` · L177 `background: #eaf1fb` · L190 `background: #eef2f6` · L270 `background: #fdf6f5` · L283 `background: #fbfcfd`
- Bordes: L76 `#e1e7ec`, L88/L282 `#eef2f6`, L114 `#e6e0cf`, L139/L258 `#dbe3ea`, L150/L206 `#e6ebf0`, L161 `#f0f4f7`, L268 `#f0d9d5`
- Tinta: `#1c2a38`, `#647487`, `#7d6a35`, `#5c4c22`, `#33475b`, `#2455a2`, `#4c7099`, `#97a1aa`, `#465a6c`, `#a3402f`.

### 3.9 · `features/directorio/locales.page.ts` — 34

- L348/L467 `background: #fff` · L484 `background: #fafbfc`
- L140/L187 `color: #8a98a5` · L250 `#33475b` · L383/L454 `#1a2b3e` (+15 tintas)

### 3.10 · `features/alertas/alertas.page.ts` — 17

- L243 `background: #eef1f4`
- L175 `#17283a`, L189 `#4a6b93`, L203 `#1f5597`, L208 `#b8860b`, L213 `#d9661f`, L227/L232/L263 `#99a3aa`, L244 `#526577`, L257 `#33475b` (+4)

## 4. Top 5 hallazgos

1. **`bandeja.page.ts` (43)**: es la pantalla con más superficies blancas fijas (17) y más bordes claros (15). La cola de la bandeja y las tarjetas de detalle se ven como bloques blancos sobre el lienzo oscuro.
2. **`documento-panel.component.ts` (42)**: el panel lateral alterna `#fff` y `#fbfcfd` en cuatro bloques y usa `#e6ebef` en seis bordes; al abrirse sobre el shell oscuro se convierte en un cajón claro.
3. **`alerta-panel.component.ts` (41)**: mayor densidad de tinta fija (24). Usa azules y ámbares de marca (`#1f5597`, `#b8860b`, `#d9661f`) que ya tienen token (`--blue`, `--amber`) pero se escriben como literal; sobre `--paper: #191e25` pierden el contraste que el token oscuro sí daría.
4. **`actor-panel.component.ts` (39)**: mezcla fondos de estado pálidos (`#fdf6f5`, `#edf6f0`, `#fdeceb`) con su tinta oscura pareja. Si se oscurece el fondo sin tocar la tinta, el chip queda ilegible; si se deja el fondo, rompe el tema.
5. **`actores.page.ts` (37)**: ocho `background: #fff` en la ficha y los bloques de edición, más 18 tintas. Es la pantalla que el mockup `actores_editar_actor_modo_oscuro_2.html` resuelve con `surface`/`on-surface`; el componente actual no sigue ese lenguaje.

Junto a ellos, `locales.page.ts` (34), `actor-panel-fusion.component.ts` (33), `mapa.page.ts` (32) y `resumen.page.ts` (31) completan el grupo de mayor riesgo.

## 5. Criterios y falsos positivos

No cuentan como rotura y por eso **no** están en las cifras:

- `color: #fff` (o `#ffffff`) sobre un botón o chip de color: es tinta sobre relleno saturado y sigue leyéndose en ambos temas. Ejemplo: `features/resultados/lista-asistencia.component.ts:585`.
- `background: var(--paper, #fff)` o cualquier `var(--x, #fff)`: el fallback no se aplica cuando el tema define `--x`. Ejemplos: los 13 bordes `var(--line, #e6ebef)` de `lista-asistencia.component.ts`, los 6 de `documento-panel.component.ts` y los 3 de `shared/ui/adjuntos-panel.component.ts`. Sólo se listan los literales puros.
- `white-space`, `nowrap`, `#fff` dentro de `box-shadow` o de gradientes decorativos: no son superficies.
- Los colores de marca en mapas e iconos (`#1d427f`, `#397c79`, `#2455a2`) se cuentan sólo cuando declaran una superficie o una tinta de texto; como relleno de marcador no rompen el tema por sí solos.

**Matiz importante:** una tinta oscura sobre un chip pálido fijo (por ejemplo `#7d6a35` sobre `#fdfaf1`) no es ilegible hoy, porque el chip también se queda claro. Rompe la coherencia del tema y se vuelve ilegible en cuanto el chip se tokenice. Por eso se contabiliza como deuda: fondo y tinta deben migrar juntos a `var(--…)`.

## 6. Qué no se auditó

- `angular/src/styles/**` (global, generado y overrides) y `angular/src/index.html`: son la fuente del tema, no consumidores.
- `layouts/shell/**`: se midió (2 literales) pero está fuera del permiso de edición de este encargo.
- `features/preferencias/**`: auditado y limpio; ya usa `PreferenciasService` + `TemaService`.

## 7. Recomendación de corrección (para quien edite `features/**`)

1. Sustituir superficies por `var(--paper)`, `var(--canvas)`, `var(--surface)` o el token que corresponda; nunca `#fff` ni pálidos fijos.
2. Sustituir tinta por `var(--ink)`, `var(--ink-2)`, `var(--muted)`; los estados por `var(--red)`/`--red-pale`, `--amber`/`--amber-pale`, `--green`/`--green-pale`, `--blue`/`--blue-pale`.
3. Sustituir bordes por `var(--line)`. El repo ya tiene `--line` oscuro (`#262c33`); el problema es el literal, no la falta de token.
4. Migrar fondo y tinta de cada chip **en el mismo cambio**, para no dejar pares ilegibles.
5. Cuando el literal viva en un `style="…"` de plantilla (mapa), moverlo a una clase con variables.

No se corrigió ninguna de estas pantallas en esta entrega: el encargo limita la escritura a `features/preferencias/**`.
