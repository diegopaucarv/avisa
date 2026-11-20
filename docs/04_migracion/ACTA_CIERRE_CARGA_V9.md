# Acta de cierre — carga del legado AVISA 2026 en v9

Estado: **carga completa y verificada**. Todo el workbook
`backend/BASE_CONFLICTOS_SOCIALES_2026.xlsx` (86 hojas, 4 643 filas) está
cargado en el esquema v9 de PostgreSQL 16, sin un solo dato inventado salvo los
dos casos documentados (unidad `OAIPCS`, D26; y el nivel de conflicto de la
fila sin `ID_Tipo`, que queda NULL).

Este documento resume **qué se cargó, con qué cifras y qué quedó pendiente de
revisión humana**. La especificación está en `PLAN_PORTE_LEGADO_V9.md` y las
decisiones en `DECISIONES_CARGA_LEGADO_V9.md`.

---

## 1. Cómo reproducir la carga

```bash
./scripts/db.sh reset --force          # clúster limpio: DDL (2 pasadas) + parches 1–5
python -m migration.loader.run         # fases 00..13 en UNA transacción
python -m migration.loader.run --verify  # 64 comprobaciones; exit 0
```

Para iterar sin reconstruir el clúster:

```bash
./scripts/db.sh fresh                  # recrea `avisa` desde `avisa_template` + re-aplica parches 1–5
python -m migration.loader.run --to N  # 0..N
```

`fresh` vuelve a aplicar los parches 1–5 después del clonado: la plantilla solo
se refresca con `./scripts/db.sh snapshot` y, por diseño, **nunca** se toma con
el legado cargado (si no, la carga dejaría de reproducirse desde cero).

La carga **no es idempotente**: siempre se parte de `db.sh fresh` o
`db.sh reset --force`.

---

## 2. Fases implementadas

| #   | Módulo                      | Qué carga                                          |
| --- | --------------------------- | -------------------------------------------------- |
| 00  | `p00_staging`               | 75 hojas → `legacy.*` (4 643 filas)                |
| 01  | `p01_geografia`             | 25 regiones, 70 provincias, 698 distritos          |
| 02  | `p02_catalogos`             | 24 catálogos `core.cat_*` + especies               |
| 03  | `p03_entidades`             | 23 entidades, 66 unidades orgánicas                |
| 04  | `p04_usuarios`              | 31 usuarios, roles, territorio                     |
| 05  | `p05_actores`               | 1 160 actores, PII, 224 organizaciones, membresías |
| 06  | `p06_casos`                 | 35 casos, territorios y actores del caso           |
| 07  | `p07_cronologia_documentos` | 80 hechos y 153 documentos                         |
| 08  | `p08_alertas`               | 83 alertas, actores, especies y vínculos           |
| 09  | `p09_demandas`              | 325 demandas, 77 evidencias, 98 actores            |
| 10  | `p10_compromisos`           | 8 compromisos y 12 hitos                           |
| 11  | `p11_mesas_capacitaciones`  | 21 mesas, 62 miembros, 1 curso, 27 locales         |
| 12  | `p12_envios`                | 17 envíos y 4 suscripciones                        |
| 13  | `p13_log_accesos`           | 857 accesos                                        |

Orden no negociable: alertas **antes** de demandas (`demandas.alerta_id` tiene
FK real a `alertas_tempranas`).

---

## 3. Cifras finales verificadas

Todas comprobadas con `--verify` sobre la base recién cargada.

| Tabla                    |        Filas | Tabla                        | Filas |
| ------------------------ | -----------: | ---------------------------- | ----: |
| `regiones`               |           25 | `demandas`                   |   325 |
| `provincias`             |           70 | `demandas_evidencias`        |    77 |
| `distritos`              |          698 | `demandas_actores`           |    98 |
| `cat_especies`           |           39 | `alertas_tempranas`          |    83 |
| `entidades`              |           23 | `alertas_actores`            |   161 |
| `cat_unidades_organicas` |           66 | `alerta_especies`            |    30 |
| `usuarios`               |  32 (31+adm) | `compromisos`                |     8 |
| `usuario_roles`          |           34 | `hitos_compromiso`           |    12 |
| `usuario_territorio`     |           25 | `mesas_dialogo`              |    21 |
| `actores`                |        1 160 | `mesa_miembros`              |    62 |
| `actor_datos_personales` |          847 | `locales`                    |    27 |
| `organizaciones`         |          224 | `capacitaciones`             |     1 |
| `actor_membresia`        |          292 | `capacitacion_participantes` |     9 |
| `casos`                  |           35 | `envios_comunicacion`        |    17 |
| `caso_regiones`          |           81 | `suscripcion_notificacion`   |     4 |
| `caso_distritos`         |           23 | `log_accesos`                |   857 |
| `casos_actores`          |           60 | `cronologia_vinculos`        |     5 |
| `caso_estado_historial`  | 35 (trigger) | `migracion_conflicto`        |   498 |
| `caso_cronologia`        |           80 | `documentos`                 |   153 |

Cifras que el plan estimaba distinto y quedaron corregidas tras medir:

| Dato                                |  Plan | Real | Causa                                                        |
| ----------------------------------- | ----: | ---: | ------------------------------------------------------------ |
| `caso_regiones`                     |    85 |   81 | 2 casos fantasma (037/038) + 4 colapsos Lima (DEP-15/16)     |
| `casos_actores`                     | 62–80 |   60 | pares únicos, no filas de bridge                             |
| `alertas_actores`                   |  ≤150 |  161 | 167 filas de bridge − 5 alertas fantasma                     |
| `alerta_especies`                   |    32 |   30 | 2 filas citan alertas inexistentes (AT-2026-34/35)           |
| `demandas` sin caso pero con alerta |   222 |  200 | 222 es el total con alerta, no las que además no tienen caso |

---

## 4. Decisiones de esquema añadidas en esta etapa

| #   | Cambio (parche 4)                                      | Motivo                                                                 |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| D50 | `actor_membresia.valid_from` → NULL-able               | 254 de 292 membresías no tienen fecha en el origen; perderlas era peor |
| D51 | `caso_estado_historial.nivel_conflicto_id` → NULL-able | El trigger copia el NULL del caso `CS-PRODUCE-2026-024` y abortaba     |

Ambas están en `docs/PREPARACION_V9_CARGA_LEGADO_4.sql`, montado en el initdb y
aplicado por `scripts/db.sh apply`.

---

## 5. Cola de revisión humana (`core.migracion_conflicto`)

498 filas. Nada se descartó en silencio: lo que no se pudo resolver sin inventar
está aquí.

| Categoría                              | Filas | Qué significa / qué revisar                                      |
| -------------------------------------- | ----: | ---------------------------------------------------------------- |
| `MEMBRESIA_SIN_MATCH`                  |   368 | `DIM_Actores.Id_organizacion` no resuelve a ninguna organización |
| `DNI_DUPLICADO`                        |   100 | 45 DNI repetidos (no siempre la misma persona, ver D43)          |
| `ALERTA_INEXISTENTE`                   |    21 | Vínculos que citan alertas que no existen (fases 8 y 9)          |
| `ORGANIZACION_SIN_ACTOR`               |     4 | Organización sin representante válido (`Cod_Actor` vacío)        |
| `PERSONA_HOMONIMA`                     |     3 | Posibles duplicados de persona por nombre                        |
| `ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE` |     1 | `RECU-009` (`Sphyrna zygaena`) enlazada a la semilla `lewini`    |
| `TERRITORIO_NO_RESUELTO`               |     1 | `DEP-20` ("Más de Uno") no es una región                         |

Sugerencia de operación: revisar primero `DNI_DUPLICADO` y
`ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE` (afectan identidad y taxonomía), luego
`MEMBRESIA_SIN_MATCH` (requiere trabajo de campo con las organizaciones).

---

## 6. Pendientes de política y de producto (no bloquean la carga)

1. **Datos personales (Ley 29733).** La base contiene 642 DNI, 606 teléfonos y
   141 correos, más 857 accesos con DNI. `base_legal = 'LEGADO_AVISA_2026'` es un
   marcador heredado: **OAIPCS debe sustituirlo** por la base legal formal y
   definir retención antes de exponer la tabla fuera de `administrador`.
2. **Hojas sin destino (160 filas).** `FACT_Proceso_*`, `DIM_Paso_Proceso*`,
   RADAR (`FACT_RED_RADAR`, `FACT_NODO`, bridges) y `DIM_Responsable` quedan en
   `legacy.*`: v9 no tiene workflow ni RADAR todavía (D17/D18).
3. **Nombres de columna del legado.** `FACT_Historial_Estado` (27) no se carga:
   sus columnas vienen intercambiadas y el trigger genera el historial correcto.
4. **`DIM_Envios`.** `url_pdf` no tiene fuente real: queda NULL en los 17 envíos.

---

## 7. Pruebas

| Prueba                                    | Resultado                               |
| ----------------------------------------- | --------------------------------------- |
| `python -m pytest migration/ -q`          | 14 passed                               |
| `python migration/test_decisions.py`      | 122 ok                                  |
| `python -m migration.loader.run`          | exit 0                                  |
| `python -m migration.loader.run --verify` | 64 ok, exit 0                           |
| `./scripts/db.sh reset --force`           | initdb completo (parches 1–5) y healthy |

---

## 8. Parche 5 — seeds de cierre (2026-10-31)

La carga del legado ya estaba cerrada; faltaba el contenido que el documento v9
exige y que no proviene del legado. Se aplicó
`docs/PREPARACION_V9_CARGA_LEGADO_5.sql` (idempotente, montado en el initdb como
`95_patch_05.sql`):

| Objeto                     | Filas | Nota                                                         |
| -------------------------- | ----: | ------------------------------------------------------------ |
| `core.cat_pip_etapas`      |    12 | Las 12 etapas de §1.2.b                                      |
| `config.schema_registry`   |     2 | `avisa.raw_ingest` v1 (JSON de §4.2) y v2                    |
| `agent.cat_detalle_schema` |     1 | v1 **provisional** (permisivo): falta la versión real de T66 |
| `ind.plantilla`            |     3 | Anexo 2, Anexo 15 y Minister View, sin slots                 |

`ind.indicador` sigue en 0 a propósito: la Tabla 3 de la Guía y el inventario de
54 indicadores no están en el repositorio, y el legado no trae catálogo de
indicadores. Sembrarlos sería inventar el contenido que alimenta toda la capa
`ind`. Detalle y decisiones abiertas: `docs/05_datos/BRECHA_CAPA_DATOS_V9.md` §10.

Además, `docker/postgres/initdb/20_verify.sql` dejó de comparar los catálogos
contra valores exactos (comparaba `cat_especies = 5` y fallaba con el legado
ya cargado, 39 filas) y ahora compara contra mínimos. Con eso,
`./scripts/db.sh verify` vuelve a ser válido **antes y después** de la carga.
