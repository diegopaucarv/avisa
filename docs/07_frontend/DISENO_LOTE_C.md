# Lote C · Contrato de datos y permisos antes de dibujar

**Estado:** diseño para el equipo de .NET · 2026-11-23
**Ámbito:** items 98, 99, 105, 113, 117 y 119–124 de
`docs/07_frontend/frontend.md` («Ampliación 2026-11-23», A1–A4), más el contrato
del KML del item 125.
**Regla:** nada de este documento autoriza a estimar un dato. Lo que no existe se
declara «no existe» con el nombre exacto del objeto que falta.

Este es el lote que **no se puede implementar dibujando**: cada item necesita una
columna, una tabla, un rol o una política antes de que la SPA pueda pintar el
primer píxel. Los artboards de la Ola 1 muestran el hueco y lo rotulan; este
documento dice qué tiene que existir para cerrarlo.

## 0 · Autoridad de rutas y de esquema

- **Rutas.** La fuente es el inventario verificado
  [`docs/07_frontend/angular/CONTRATO_API_SPA.md`](angular/CONTRATO_API_SPA.md)
  (34 rutas, §4). En la orden de trabajo se citó como
  `docs/07_frontend/CONTRATO_API_SPA.md`; ese archivo **no existe** en esa
  ruta y el inventario real es el enlazado. Aquí se usan las rutas tal como
  están publicadas, con el prefijo `/api` y las grafías de campo de la decisión
  **C1** (identidad y textos en inglés, dominio en español, campos nuevos en
  camelCase).
- **Esquema.** La fuente es `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` ya
  aplicado, complementado por los parches 15 a 24 y las migraciones 30–38.
  Cuando una columna existe pero no tiene carga, se dice «existe, sin carga
  declarada»; cuando no existe, se propone su DDL y se marca **propuesta**.
- **Vocabulario.** Se conserva el de la SPA: `Abierto · Resuelto · Archivado`
  para el caso; `Diferencia · Controversia · Conflicto social · Crisis social`
  para conflictividad; `Bajo · Moderado · Alto` para riesgo.

### Resumen del lote

| Item | Qué falta                                                  | Tipo de artefacto                                   | Rol que puede escribir                                    | Qué se ve hoy en la SPA                               | Dónde se declara el hueco                |
| ---- | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| 98   | Apellidos y nombres separados en el actor                  | 2 columnas en `core.actores`                        | `sectorista`, `direccion_oaipcs`, `administrador`         | `nombre_actual` concatenado; columnas vacías          | `casos-tarjetas.html` (tabla de actores) |
| 99   | Teléfono en el actor del caso y formato WhatsApp           | Campo en la respuesta + endpoint de PII             | Sólo roles con `puedeVerPii`                              | `correo`; el teléfono no viaja                        | `casos-tarjetas.html`                    |
| 104  | Filtro «Sin caso asignado» y filtro «Riesgo» en alertas    | Parámetros en `GET /api/v1/alerts`                  | Lectura (todos)                                           | `q, prioridad, nivel, estado, sort, anulados`         | `alertas-operativas.html`                |
| 105  | Flujo de aprobación de Alta Dirección y envío por WhatsApp | Endpoint + permiso (la tabla ya tiene las columnas) | `alta_direccion` y suplentes de `core.permiso_aprobacion` | Ninguna escritura: el rol no puede editar             | `alertas-operativas.html`                |
| 113  | Ámbito de subsector por rol                                | Columna, roles, `resolveDataScope` y RLS            | No aplica: es sesión, no pantalla                         | `resolveDataScope` devuelve siempre `{mode:"all"}`    | Este documento, §113                     |
| 117  | Carga de `legacy.dim_redaccion` (51 filas)                 | Carga + endpoint de reuniones                       | `sectorista`, `direccion_oaipcs`                          | `core.reuniones_dialogo` sin filas                    | Este documento, §117                     |
| 119  | Catálogo de artes de pesca y esloras                       | 2 catálogos                                         | `administrador`, `curador_politica`                       | No existe                                             | Este documento, §119                     |
| 120  | Actores por región × arte de pesca                         | Tabla de vínculo + contacto                         | `sectorista`, `direccion_oaipcs`                          | No existe el eje arte                                 | Este documento, §120                     |
| 121  | Marca OSPA y vínculo organización–caleta                   | 1 tabla de vínculo + maestro de caletas             | `administrador`                                           | Las columnas OSPA existen, el vínculo no              | Este documento, §121                     |
| 122  | Demandas atribuidas a su OSPA                              | Columna de solicitante                              | `sectorista`                                              | `core.demandas_actores` sin dimensión de organización | Este documento, §122                     |
| 123  | Compromisos «asumidos por» el Despacho Ministerial         | 1 columna + 1 dimensión de arte                     | `direccion_oaipcs`, `sectorista`                          | `unidad_responsable_id` sin «asumido por»             | Este documento, §123                     |
| 124  | Conflictos por región y recurso                            | Tabla puente caso–recurso                           | `sectorista`                                              | No existe; sólo 6 casos llegan por la alerta          | Este documento, §124                     |
| 125  | Parser del KML de infraestructuras                         | Parser + endpoint o GeoJSON estático                | No aplica: es ETL                                         | No existe                                             | Este documento, §KML                     |

---

## 98 · Apellidos y nombres separados en el actor del caso

**Qué cambia.** La tabla de actores del caso y el mapa de actores como tabla
(item 102) muestran una columna «Apellidos, Nombres». Hoy la interfaz ya
concatena, pero el dato no existe: `core.actores` guarda **sólo**
`nombre_actual VARCHAR(255) NOT NULL`, una caché derivada de
`kag.actor_name_history`.

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
ALTER TABLE core.actores
  ADD COLUMN IF NOT EXISTS apellidos VARCHAR(150),
  ADD COLUMN IF NOT EXISTS nombres  VARCHAR(150);
```

- `nombre_actual` **no se retira**: es la etiqueta de la caché y la fuente del
  trigger `kag.sync_nombre_actual()`. La columna nueva es la que se parte.
- **No se parte por espacios.** `nombre_actual` mezcla personas
  («Apellidos, Nombres»), organizaciones y nombres compuestos. Un `split` en
  SQL o en TypeScript inventaría apellidos. La carga debe venir de la fuente o
  de captura manual.
- La API no cambia de ruta: `GET /api/v1/cases/{codigo}` ya devuelve
  `actores[]`; sólo se añaden `apellidos` y `nombres` a cada elemento. El
  mapeo `ActorCaso` (`angular/src/app/dominio/mapeo.ts:215-236`) **ya declara**
  ambos campos como `string | null` y hoy llegan siempre nulos.

**Rol que puede escribir.** `sectorista`, `direccion_oaipcs` y `administrador`
(`core.roles.puede_editar`). `alta_direccion` no escribe. El alta y la edición
de actores tampoco tienen endpoint: el directorio es sólo lectura
(`CONTRATO_API_SPA.md` §4.6).

**Qué puede mostrar la SPA hoy.** La columna con el `nombre_actual`
concatenado y `CasoDetallePage.nombreActor()`; las dos columnas nuevas quedan
«—». El artboard `casos-tarjetas.html` lo declara celda a celda.

**Qué se declara faltante.** `core.actores.apellidos`, `core.actores.nombres`
y la captura que los llene. No hay `POST`/`PATCH` de actores.

---

## 99 · Teléfono en el actor del caso y «copiar para WhatsApp»

**Qué cambia.** La exportación del caso gana una tercera salida, «Copiar para
WhatsApp», que emite **una línea por actor**:

```
- Apellidos, Nombres - Organización - teléfono - correo
```

**Lo que debe existir.**

1. **El teléfono no viaja con el actor del caso.** `ActorCaso` expone `id`,
   `nombre`, `apellidos`, `nombres`, `naturaleza`, `tipo`, `funcion`,
   `posicionamiento` y `correo`; **no** `telefono`. El teléfono vive en
   `core.actor_datos_personales.telefono_contacto` (`VARCHAR(50)`), aislado por
   Ley 29733, y se sirve sólo por
   `GET /api/v1/actors/{uid}/pii?motivo=<texto>` → `{ pii: { dni, email, telefono } }`
   (`CONTRATO_API_SPA.md` §4.6). Ese endpoint **ya existe** y exige `motivo`
   (sin él responde `422`; un rol sin privilegio recibe `403`).
2. **La finalidad es el problema de diseño.** `GET /api/v1/cases/{codigo}` no
   tiene parámetro `motivo`, así que **no debe** añadir `telefono` a la ficha:
   expondría PII sin principio de finalidad y en un payload que cachea la
   pantalla. Dos salidas válidas, y sólo una recomendada:

   - **Recomendada:** `POST /api/v1/cases/{codigo}/exportar/whatsapp`
     con cuerpo `{ motivo }`, que valida `puedeVerPii`, registra la exportación
     en auditoría y devuelve `{ texto, actores, omitidos }`. Una sola llamada
     para toda la tabla, con el mismo motivo para todas las filas.
   - Alternativa sin endpoint nuevo: la SPA llama una vez por actor a
     `GET /api/v1/actors/{uid}/pii?motivo=…`. Es N llamadas y no deja un
     registro de exportación único; **no se recomienda**.

3. **Formato exacto.** Separador `" - "`, prefijo `"- "`, sin encabezado, sin
   numeración y sin línea en blanco entre filas. Si un campo falta, se imprime
   `—` para que el hueco se vea; **no se omite el campo ni se completa con el
   de otro actor**. Cuando `apellidos`/`nombres` son nulos se imprime
   `nombre_actual` y el hueco queda declarado en la interfaz, no en el texto.

```
- — - Asociación de pescadores de Cabo Blanco - — - —
```

4. **Organización.** No hay campo «organización» en `ActorCaso`. Se obtiene de
   `core.actor_membresia` (`organizacion_uid`, vigente `valid_to IS NULL`) o de
   `core.organizaciones.razon_social` cuando el actor es la organización. Ese
   join **no existe** en el repositorio de casos y hay que añadirlo.

**Rol que puede escribir.** Ninguno: es lectura. **Quién puede ver el
teléfono:** sólo `administrador`, `direccion_oaipcs`, `alta_direccion` y
`sectorista` (`VEN_PII` en `capacidades.service.ts`). El resto de roles no ve
la salida «Copiar para WhatsApp» ni el teléfono, aunque vea el resto de la
tabla.

**Qué puede mostrar la SPA hoy.** Excel y PDF desde el menú único
(`GET /api/v1/export`), sin teléfono y sin la tercera salida. El botón
«Exportar» de la tabla no conoce las filas: `exportar-menu.component` emite
desde el endpoint, y «copiar» necesita el contenido de la tabla.

**Qué se declara faltante.** El campo `telefono` en el payload del caso (por
diseño, no debe añadirse), la organización por actor y el endpoint de copia con
motivo auditado.

---

## 105 · Flujo de aprobación de Alta Dirección en alertas

**Qué cambia.** La columna «Acciones» de `/alertas` aparece sólo para Alta
Dirección, con **Aprobar · Solicitar modificación · Anular**, más un «Enviar»
cuya salida por WhatsApp lleva negritas.

**Lo que ya existe (y no es poco).** La base tiene el modelo completo, no así
la API:

| Objeto                                                      | Estado                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `core.alertas_tempranas.aprobada_por`                       | Existe (parche 21), FK a `core.usuarios` con `ON DELETE RESTRICT`              |
| `core.alertas_tempranas.aprobada_en`                        | Existe (parche 21), con `CHECK` que no admite fecha sin aprobador              |
| `core.alertas_tempranas.validada_por`                       | Existe (parche 23), con `CHECK` de cuatro ojos contra `aprobada_por`           |
| `core.alertas_tempranas.visibilidad`                        | Existe (parche 22): `interna · ejecutiva · sectorial`                          |
| Gate `core.tg_alerta_g21_visibilidad`                       | Existe: rechaza con `G21_SIN_APROBACION` una visibilidad sin las firmas        |
| `core.permiso_aprobacion` / `core.puede_aprobar(uuid,text)` | Existen; la tabla está vacía a propósito (la suplencia es acto administrativo) |
| `core.proceso_instancia`                                    | Existe; registra los pasos del flujo                                           |
| `core.envios_comunicacion`                                  | Existe; es el registro de la remisión                                          |

**Lo que falta.** Un endpoint que ejecute la aprobación, y el permiso para que
Alta Dirección escriba. Hoy `core.roles.puede_editar` es **falso** para
`alta_direccion`: la base le niega toda escritura, y la SPA replica esa
decisión en `ESCRIBEN` (`capacidades.service.ts`).

```text
POST /api/v1/alerts/{id}/aprobar
cuerpo: { decision: "aprobar" | "solicitar_modificacion" | "anular", motivo? }
```

Reglas de servidor, no de pantalla:

- `aprobar` escribe `aprobada_por = sesión.usuario_id` y
  `aprobada_en = now()` y registra el paso en `core.proceso_instancia`. Sólo
  procede si existe validación previa (`es_validado_humano`,
  `fecha_validacion`, `validada_por`) y **`validada_por <> aprobada_por`**
  (cuatro ojos, a nivel de persona).
- `solicitar_modificacion` **no** aprueba: devuelve la alerta al paso anterior
  y exige `motivo`.
- `anular` exige `motivo` de ≥10 caracteres, igual que la anulación actual de
  la SPA (`shared/ui/anular-panel.component.ts:136-162`), y usa el borrado
  lógico ya existente.
- `POST` falla con `409 G21_SIN_APROBACION` si el gate rechaza, y con `403`
  si quien llama no es `alta_direccion` ni suplente en `core.permiso_aprobacion`.

**Rol que puede escribir.** `alta_direccion`, y los suplentes nombrados en
`core.permiso_aprobacion` mediante `core.puede_aprobar()`. No se resuelve
poniendo `puede_editar = true` a todo el rol: eso autorizaría editar cualquier
tabla. La política RLS debe ser una **política de aprobación** específica sobre
`core.alertas_tempranas`, no una ampliación del permiso general.

**Envío por WhatsApp.** «Enviar» necesita su propio contrato:
`POST /api/v1/alerts/{id}/enviar` con `{ canal: "whatsapp" }`, que devuelve el
texto con negritas (`*texto*` en la sintaxis de WhatsApp), registra el envío en
`core.envios_comunicacion` y no confunde remisión con aprobación: la remisión
la ejecuta `servicio_agente`, no el ministerio.

**Qué puede mostrar la SPA hoy.** `GET /api/v1/alerts` y `PATCH` de campos
editoriales para los roles que editan. Alta Dirección sólo lee. La columna de
acciones **no puede pintarse habilitada**.

**Qué se declara faltante.** El endpoint de aprobación, el permiso de
escritura acotado para `alta_direccion`, la política RLS de aprobación y el
endpoint de envío. El artboard `alertas-operativas.html` dibuja la columna con
los tres botones deshabilitados y lo rotula «bloqueado por 105».

---

## 113 · Ámbito de subsector por rol

**Esto no es una pantalla.** Es modelo más política. No se dibuja un selector:
si aparece un filtro de subsector en la interfaz, la regla se está resolviendo
en el lugar equivocado.

**Qué cambia.** Dirección y Secretaría General ven **ambos** subsectores; cada
Vice-ministerio, **sólo el suyo**. Se resuelve en la sesión.

**Lo que debe existir.**

1. **Columna en el usuario.**

```sql
-- PROPUESTA · no aplicada
ALTER TABLE core.usuarios
  ADD COLUMN IF NOT EXISTS subsector_id SMALLINT REFERENCES core.cat_subsectores(id);
-- NULL = sin recorte (Dirección, Secretaría General, administración)
```

Hoy `core.cat_subsectores` tiene **3 filas**: `Pesca y Acuicultura` (1),
`Mype e Industria` (2) y `Gestión y Prevención de Conflictos` (3). Los dos
primeros corresponden a los vice-ministerios; el tercero es el área de la
propia OAIPCS y **no** es un ámbito de vice-ministerio.

2. **Roles de vice-ministerio.** Hoy `core.roles` tiene 10 códigos
   (`sectorista`, `administrador`, `consulta_lectura`, `alta_direccion`,
   `servicio_agente`, `auditor`, `externo_publico`, `analista_cualitativo`,
   `curador_politica`, `direccion_oaipcs`). No hay ninguno de vice-ministerio.
   Propuesta, con código explícito y `puede_editar = false`:

| Rol propuesto                   | `subsector_id` | Alcance                  |
| ------------------------------- | -------------- | ------------------------ |
| `viceministerio_pesca`          | 1              | Sólo Pesca y Acuicultura |
| `viceministerio_mype_industria` | 2              | Sólo Mype e Industria    |
| `secretaria_general`            | `NULL`         | Ambos                    |

Los códigos son **propuesta**, no inventario: hoy no existen. Si OAIPCS
prefiere un único rol `viceministerio` con el subsector en la sesión, el efecto
es el mismo y se documenta igual.

3. **`resolveDataScope`.** Hoy `lib/db/scope.ts` devuelve siempre
   `{ mode: "all", regiones: session.regs }`. Debe ampliarse el tipo y la
   función:

```ts
export type DataScope =
  | { mode: "all"; regiones: string[] }
  | { mode: "regions"; regiones: string[] }
  | { mode: "subsector"; subsectores: number[]; regiones: string[] };
```

`{mode:"subsector"}` se emite cuando la sesión tiene un rol de vice-ministerio;
`subsectores` sale de `core.usuarios.subsector_id` (nunca de la URL). El
recorte por región y el de subsector se combinan: el más restrictivo manda.

4. **Política RLS.** No basta con filtrar en el repositorio: la política debe
   ir en la base y aplicarse a `core.casos`, `core.alertas_tempranas`,
   `core.compromisos`, `core.demandas` y `core.documentos`, con el subsector
   de la sesión publicado por `set_config('avisa.subsector', …, true)`. Las
   vistas `security_invoker` (por ejemplo
   `analytics.vw_anexo_15_matriz_conflictividad`) heredan el recorte sin
   cambio. `core.casos.subsector_id` ya existe; las demás tablas lo alcanzan
   por el caso o por su propio `subsector_id` cuando lo tengan.

**Rol que puede escribir.** Nadie: el ámbito no se edita desde la SPA. Lo
administra quien administra usuarios.

**Qué puede mostrar la SPA hoy.** Todo, porque `resolveDataScope` devuelve
`all`. No hay recorte y por eso no se dibuja.

**Qué se declara faltante.** `core.usuarios.subsector_id`, los roles de
vice-ministerio, la rama `subsector` de `resolveDataScope` y las políticas RLS.

---

## 117 · Carga de `legacy.dim_redaccion` en la capa de reuniones

**Qué cambia.** La capa de reuniones del item 72 incorpora los documentos tipo
**10 (Ayuda Memoria)** y **11 (Relatoría)** como enlaces, con su casilla de
cumplimiento.

**Lo que existe.** `core.cat_tipos_documento` ya tiene los dos códigos
(`10 ayuda_memoria`, `11 relatoria`, anexos 12 y 13). `core.documentos` ya
tiene `reunion_id`, `url_pdf` y `caso_id`. `core.reuniones_dialogo` existe con
`codigo_reunion`, `fecha`, `lugar`, `convocante_unidad_id` y
`responsable_usuario_id`.

**Lo que falta.**

1. **La carga.** `legacy.dim_redaccion` tiene **51 filas** sin cargar. No es un
   problema de dibujo: es un cargador. El mapeo ya está identificado en
   `docs/05_datos/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md:205`: hay que llevar
   `tipo_documento` a uno de los 12 códigos del catálogo y conservar el resto
   en `contenido_json`.
2. **Las reuniones.** `core.reuniones_dialogo` no tiene filas. Sin reunión no
   hay capa: los 51 documentos se vinculan a un `reunion_id` que todavía no
   existe, o quedan con `reunion_id` nulo y no se pueden mostrar «por reunión».
3. **La casilla de cumplimiento.** No hay columna. Propuesta:

```sql
-- PROPUESTA · no aplicada
CREATE TABLE core.reunion_documento (
  reunion_id        UUID NOT NULL REFERENCES core.reuniones_dialogo(id) ON DELETE CASCADE,
  tipo_documento_id SMALLINT NOT NULL REFERENCES core.cat_tipos_documento(id),
  documento_id      UUID REFERENCES core.documentos(id),
  cumple            BOOLEAN NOT NULL DEFAULT FALSE,
  verificado_por    UUID REFERENCES core.usuarios(id),
  verificado_en     TIMESTAMPTZ,
  PRIMARY KEY (reunion_id, tipo_documento_id),
  CHECK (cumple OR documento_id IS NULL)  -- no se marca cumplido sin documento
);
```

La casilla no se deriva de que exista un documento: se marca. Así el hueco
«reunión sin ayuda memoria» es visible y no se confunde con «no revisado».

4. **Endpoint.** No hay `GET /api/v1/reuniones`. La capa necesita su listado y
   su detalle; `GET /api/v1/documents?tipo=ayuda_memoria` existe, pero no une
   por reunión ni devuelve la casilla de cumplimiento.

**Rol que puede escribir.** `sectorista` y `direccion_oaipcs` (carga de
documentos y vínculo); `administrador` para el catálogo de tipos.

**Qué puede mostrar la SPA hoy.** Nada de la capa: 0 reuniones. Los 51
documentos del legado no están en `core.documentos`.

**Qué se declara faltante.** La carga de `legacy.dim_redaccion`, la carga de
`core.reuniones_dialogo`, la tabla de cumplimiento y el endpoint de reuniones.

---

## 119 · Catálogo de artes de pesca y rango de eslora

**Qué cambia.** Una jerarquía por grupo (selectivos, cerco, buzos) con
precisiones dentro (pinta, macaco…), atributos de tipo pasiva/activa, para qué
se usa, dónde y nivel de impacto; y el rango de eslora 0–10, 10–20 y 20–32 m
como **dimensión aparte**.

**Lo que existe.** Nada. No hay columna ni tabla que mencione arte de pesca ni
eslora en el esquema (`core`, `legacy` ni `territorio`).

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
CREATE TABLE core.cat_artes_pesca (
  id                SMALLINT PRIMARY KEY,
  padre_id          SMALLINT REFERENCES core.cat_artes_pesca(id),  -- grupo → precisión
  codigo            VARCHAR(40) NOT NULL UNIQUE,
  nombre            VARCHAR(120) NOT NULL,
  tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('pasiva','activa')),
  uso               TEXT,
  zona              VARCHAR(120),
  nivel_impacto     SMALLINT CHECK (nivel_impacto BETWEEN 1 AND 3),
  orden             SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE core.cat_esloras (
  id      SMALLINT PRIMARY KEY,
  codigo  VARCHAR(20) NOT NULL UNIQUE,
  desde_m NUMERIC(4,1) NOT NULL,
  hasta_m NUMERIC(4,1) NOT NULL,
  orden   SMALLINT NOT NULL DEFAULT 0,
  CHECK (desde_m < hasta_m)
);
-- Semilla exacta: (1,'0-10',0,10),(2,'10-20',10,20),(3,'20-32',20,32)
```

- El rango **no** cuelga del arte: es una segunda dimensión y se cruza con ella.
- Los valores del catálogo (grupos, precisiones, impacto) **no se inventan en
  este documento**: los ratifica OAIPCS. La tabla se crea vacía y con
  `orden` para que la interfaz no dependa del `id`.
- La API los expone por `GET /api/v1/catalogs` como `artesPesca` y `esloras`
  (hoy el servidor expone 14 claves y ninguna de estas dos; `catalogs.ts:16-32`).

**Rol que puede escribir.** `administrador` y `curador_politica` (catálogos).
Nadie más.

**Qué puede mostrar la SPA hoy.** Nada: el perfil territorial no tiene eje.

**Qué se declara faltante.** Ambas tablas, su semilla ratificada y las dos
claves nuevas de `/api/v1/catalogs`.

---

## 120 · Actores por región × arte de pesca

**Qué cambia.** Un filtro compartido por región y arte, y columnas de contacto,
perfil de diálogo y foto.

**Lo que existe.** `core.actores` tiene `region_id` (119 de 224 organizaciones
con región desde la migración 38; las personas, 236), `foto_url` (columna
existente), `perfil_id → core.cat_perfiles_actor` y
`rol_actor_id → core.cat_roles_actor`. El contacto (correo y teléfono) está
repartido: `core.actores.email_contacto` y la PII en
`core.actor_datos_personales.telefono_contacto`.

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
CREATE TABLE core.actor_arte_pesca (
  actor_uid  UUID NOT NULL REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
  arte_id    SMALLINT NOT NULL REFERENCES core.cat_artes_pesca(id),
  eslora_id  SMALLINT REFERENCES core.cat_esloras(id),
  desde      DATE,
  hasta      DATE,
  PRIMARY KEY (actor_uid, arte_id),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta >= desde)
);
```

- **«Perfil de diálogo» no tiene campo ratificado.** Lo más cercano son
  `perfil_id` y `rol_actor_id`; el documento **no** afirma que sean lo mismo.
  Se declara como decisión pendiente de OAIPCS, no se dibuja una columna nueva
  con ese nombre.
- El filtro por arte exige que `GET /api/v1/actors` acepte `arte` y `eslora`;
  hoy acepta `q, naturaleza, tipo, region` (`CONTRATO_API_SPA.md` §4.6).
- **Sin el catálogo 119 no hay eje**: este item depende del anterior y no se
  puede adelantar.

**Rol que puede escribir.** `sectorista` y `direccion_oaipcs` para el vínculo;
el contacto sigue la regla de PII (sólo `puedeVerPii`).

**Qué puede mostrar la SPA hoy.** Actores con región y tipo; nada por arte.

**Qué se declara faltante.** `core.actor_arte_pesca`, el filtro por arte y la
definición de «perfil de diálogo».

---

## 121 · OSPA por región y caleta

**Qué cambia.** Marca de OSPA sobre la organización, maestro de caletas y
vínculo organización–caleta.

**Lo que ya existe.** `core.organizaciones` tiene `expediente_ospa VARCHAR(50)`
y `estado_ospa VARCHAR(50)`, más `vigencia_desde`/`vigencia_hasta`. El maestro
de lugares existe: `territorio.lugares` + `territorio.caleta_detalle`, con
`tipo_id = 4` para caleta y `nivel_organizacion`. **Las columnas están; la
carga y el vínculo no.**

**Lo que debe existir.**

1. **Marca OSPA.** Se deriva de `expediente_ospa IS NOT NULL` y
   `estado_ospa = 'Vigente'`; no hace falta columna nueva. Sí hace falta cargar
   el expediente: hoy no hay constancia de que esté poblado, y no se estima.
2. **Vínculo organización–caleta.**

```sql
-- PROPUESTA · no aplicada
CREATE TABLE core.organizacion_caleta (
  organizacion_uid UUID NOT NULL REFERENCES core.organizaciones(actor_uid) ON DELETE CASCADE,
  caleta_id        UUID NOT NULL REFERENCES territorio.caleta_detalle(lugar_id),
  desde            DATE,
  hasta            DATE,
  PRIMARY KEY (organizacion_uid, caleta_id),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta >= desde)
);
```

Hoy no hay ninguna tabla que una organización con una caleta; las que tocan
`caleta_id` son `community.encuestas_percepcion` y
`territorio.patrones_seguridad_caleta`, que son otra cosa.

3. **Maestro de caletas.** `territorio.lugares` exige `distrito_id INT NOT NULL`
   y el ubigeo distrital está incompleto (698 de 1 874 distritos, P10). Una
   caleta sin distrito **no se puede cargar** con el esquema actual: es el
   mismo bloqueo del ubigeo, no un campo que falte.
4. **Endpoint.** `GET /api/v1/organizaciones` no acepta `ospa`, `region` ni
   `caleta`. Se necesitan esos parámetros (los tres, o al menos `ospa` y
   `caleta`).

**Rol que puede escribir.** `administrador` (maestro y vínculo).
`direccion_oaipcs` puede, si OAIPCS lo ratifica, pero hoy el directorio es de
sólo lectura.

**Qué puede mostrar la SPA hoy.** Organizaciones sin marca OSPA y sin caleta.
La marca se puede pintar si `expediente_ospa` viene en `GET /api/v1/actors`;
hoy no se sirve como campo de filtro.

**Qué se declara faltante.** La carga del expediente OSPA, la tabla de vínculo,
la carga del maestro de caletas (bloqueada por el ubigeo distrital) y los
filtros del endpoint.

---

## 122 · Demandas por OSPA

**Qué cambia.** Atribuir la demanda a su solicitante para poder cortar por
organización, región y arte.

**Lo que existe.** `core.demandas_actores (demanda_id, actor_id, rol_en_demanda)`
con `rol_en_demanda IN ('Formulador','Coadyuvante','Opositor','Afectado')`.
`core.demandas` ya admite `caso_id` nulo (migración del 2026-11-22) y tiene
`alerta_id`, `tematica_id` y `documento_origen_id`. Es decir: el **vínculo con
un actor** existe; la **dimensión de organización** no.

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
ALTER TABLE core.demandas
  ADD COLUMN IF NOT EXISTS solicitante_uid UUID REFERENCES core.actores(actor_uid);
```

- `solicitante_uid` apunta al actor que formula; si es una OSPA, es la
  organización. Se mantiene `demandas_actores` para los demás roles.
- Región y arte **no** se copian a la demanda: se derivan. La región, de
  `core.actores.region_id` del solicitante o de `core.caso_regiones`; el arte,
  de `core.actor_arte_pesca` (item 120). Copiarlas crearía dos verdades.
- Endpoint: `GET /api/v1/demandas?organizacion=&region=&arte=`; hoy acepta
  `q, estado, sinCaso, sort` (`CONTRATO_API_SPA.md` §4.4).

**Rol que puede escribir.** `sectorista` (es quien registra demandas y vincula
casos). `direccion_oaipcs` también edita.

**Qué puede mostrar la SPA hoy.** Las 123 demandas sin caso (97 con alerta, 26
sin alerta) y las 202 con caso, sin atribución a organización. El corte por
OSPA no existe.

**Qué se declara faltante.** `core.demandas.solicitante_uid`, los filtros y la
regla de derivación región/arte.

---

## 123 · Compromisos asumidos por el Señor Ministro

**Qué cambia.** Una dimensión de «asumido por» (Despacho Ministerial) separada
de la unidad responsable, por región y arte.

**Lo que existe.** `core.compromisos` tiene `unidad_responsable_id` (la que
ejecuta) y `documento_origen_id`, `alcance_id`, `tematica_id`. **No** tiene
«asumido por». La región se alcanza por `core.compromiso_distritos` o por el
caso (`core.caso_regiones`); el arte no existe hasta el item 119.

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
ALTER TABLE core.compromisos
  ADD COLUMN IF NOT EXISTS asumido_por_unidad_id INT REFERENCES core.cat_unidades_organicas(id),
  ADD COLUMN IF NOT EXISTS asumido_por_usuario_id UUID REFERENCES core.usuarios(id),
  ADD COLUMN IF NOT EXISTS arte_id SMALLINT REFERENCES core.cat_artes_pesca(id);
-- Exactamente uno de los dos «asumido_por»; el Despacho Ministerial se
-- identifica por unidad, no por persona, para que el cambio de ministro no
-- borre la historia.
CHECK (num_nonnulls(asumido_por_unidad_id, asumido_por_usuario_id) <= 1)
```

- «Despacho Ministerial» es una **unidad**, no una persona: se marca por
  `asumido_por_unidad_id` y se conserva la firma por
  `asumido_por_usuario_id` cuando corresponda.
- El campo va **separado** de `unidad_responsable_id`: asumir y ejecutar son
  dos responsabilidades y confundirlas haría que el reporte ministerial
  atribuyera a la OAIPCS compromisos que asumió el Ministro.
- Endpoint: `GET /api/v1/commitments?asumidoPor=&region=&arte=`. El `PATCH`
  existente debe aceptar `asumidoPorUnidad` y `arte`, con las mismas reglas de
  rol que el resto del compromiso.

**Rol que puede escribir.** `direccion_oaipcs` y `sectorista` (hoy
`PATCH /api/v1/commitments/{id}` ya existe para esos roles). `alta_direccion`
no escribe; si el Ministro dicta el compromiso, lo registra la Dirección.

**Qué puede mostrar la SPA hoy.** Compromisos con unidad responsable y sin
«asumido por». Los 8 compromisos no tienen `fecha_vencimiento` (el hueco se
declara).

**Qué se declara faltante.** Las tres columnas, la restricción de exclusividad,
los filtros y la dimensión de arte (dependiente de 119).

---

## 124 · Conflictos por región y recurso

**Qué cambia.** Cerrar el puente caso–recurso del legado.

**Lo que hay, medido.** `legacy.bridge_caso_recurso` tiene **0 filas**: no hay
puente que cerrar. El único corte por recurso que existe hoy es
`core.alerta_especies` (30 filas) y alcanza **6 casos**. Es decir: **6 de 35
casos** tienen especie, y siempre por la alerta, nunca por el caso.

**Lo que debe existir.**

```sql
-- PROPUESTA · no aplicada
CREATE TABLE core.caso_especie (
  caso_id    UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
  especie_id SMALLINT NOT NULL REFERENCES core.cat_especies(id),
  fuente     VARCHAR(20) NOT NULL CHECK (fuente IN ('caso','alerta','manual')),
  PRIMARY KEY (caso_id, especie_id)
);
```

- La carga inicial se hace **sólo** desde `core.alerta_especies` y se marca
  `fuente = 'alerta'`. No se rellena el resto: no hay dato.
- El corte por región sale de `core.caso_regiones`; por recurso, de esta
  tabla. La vista de análisis, si se quiere, es `security_invoker` para no
  saltarse la RLS del caso.
- Endpoint: `GET /api/v1/cases?especie=` o una vista de agregados; hoy
  `GET /api/v1/cases` no acepta `especie`.

**Rol que puede escribir.** `sectorista` (vínculo manual cuando lo haya);
`administrador` para el catálogo `core.cat_especies` (39 filas).

**Qué puede mostrar la SPA hoy.** Nada por recurso. El artboard del perfil
territorial (Ola 2) dibuja el corte con su estado vacío y dice «6 casos».

**Qué se declara faltante.** `core.caso_especie`, la carga desde la alerta y el
filtro por especie. **No se promete un corte completo**: 29 casos no tienen
especie en ninguna fuente.

---

## Contrato del KML de infraestructuras (item 125)

**Archivo.** `gis/Infraestructuras.kml` — KML, **no KMZ**. Verificado el
2026-11-23 sobre el archivo del repositorio:

| Hecho                                                     | Valor  |
| --------------------------------------------------------- | ------ |
| `<Placemark>`                                             | 13 456 |
| `<Polygon>`                                               | 0      |
| Puntos con `DEPARTAMEN`, `PROVINCIA`, `DISTRITO`          | 13 456 |
| Puntos con `DIRECCION`                                    | 150    |
| Puntos con `IDENTI` (institución)                         | 227    |
| Distritos distintos, por nombre y sin código              | 836    |
| Desembarcaderos con nombre propio (`IDENTI = DPA - GORE`) | 30     |

`IDENTI` se reparte así: ITP 34, DPA-GORE 30, PNACP 27, FONDEPES 27,
DIREPRO 26, SANIPES 18, IMARPE 17, INACAL 5.

**Los atributos no son `ExtendedData`.** Van dentro del HTML de
`<description>`, así que **hay que escribir un parser**. No es un dato que haya
que pedir: es trabajo de extracción. Lo que sí hay que pedir es el **CSV de
ubigeo**, porque los distritos vienen por nombre y sin código, y sin código no
se pueden unir a `core.distritos` (698 de 1 874 cargados).

**Forma de salida propuesta para el parser.**

```json
{
  "id": "kml-000123",
  "nombre": "DPA La Islilla",
  "institucion": "DPA - GORE",
  "departamento": "PIURA",
  "provincia": "PAITA",
  "distrito": "LA ISLILLA",
  "direccion": null,
  "lat": -5.123456,
  "lon": -81.234567
}
```

- Un endpoint `GET /api/v1/gis/infraestructuras` o un GeoJSON estático
  generado en el ETL; la SPA no debe parsear KML en el navegador.
- **No hay polígonos**: el requisito de áreas del item 125 no se cumple con
  este archivo. Se declara.
- Los **30 desembarcaderos con nombre propio** ya salen del mismo archivo:
  no hay que cargarlos aparte. Lo que falta para el item 126 son las redes
  RADAR y el símbolo/filtro de capa.
- El estado de proyecto de cada DPA (item 127) **no tiene fuente**: no está en
  el KML ni en la base. Se dibuja con datos de ejemplo y se declara.

**Rol que puede escribir.** Ninguno: es capa de lectura. El parser es ETL.

---

## Lista de verificación para el equipo de .NET

1. **No ampliar `puede_editar` para Alta Dirección**: el 105 necesita una
   política de aprobación propia.
2. **No añadir `telefono` a `GET /api/v1/cases/{codigo}`**: la PII exige
   `motivo` y registro de finalidad. Usar el endpoint de copia o el de PII por
   actor.
3. **Aceptar las dos grafías de paginación** y conservar las rutas del
   `CONTRATO_API_SPA.md`, incluidas las decisiones C1–C3.
4. **No filtrar el subsector en el cliente**: `resolveDataScope` y la RLS
   resuelven lo mismo, y el cliente no es autoridad.
5. **Cargar antes de prometer**: 117 es carga real (`dim_redaccion` 51);
   114, 116 y 127 no tienen fuente; 124 no tiene puente.
6. **Declarar los vacíos en la respuesta**, no rellenarlos: un `null` con
   significado es contrato (booleans tri-estado de local, campos anulables de
   documento).
7. **Exportación**: `GET /api/v1/export` debe respetar los filtros de la vista
   (F1) y registrar quién exportó qué (F7).

---

_Este documento no modifica la SPA ni la API. Es el contrato que ambas partes
leen antes de escribir código. Cualquier cambio de ruta se hace primero en
`app/api/**` y se refleja el mismo día en
`docs/07_frontend/angular/CONTRATO_API_SPA.md`._
