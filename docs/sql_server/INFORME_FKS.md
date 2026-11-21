# Informe de claves ajenas

> Generado por `migration/extraer_fks.py` a partir de
> `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`. Cifras medidas sobre el archivo, no estimadas.

## Qué se generó

| Archivo | Contenido |
|---|---|
| `docs/sql_server/AVISA_V10_ESQUEMA_SIN_FK.sql` | Esquema completo sin claves ajenas |
| `docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql` | Las 532 claves ajenas como `ALTER TABLE … ADD CONSTRAINT` |

## Cuántas y de dónde salieron

| Origen en el SQL | Claves ajenas |
|---|---:|
| `CREATE TABLE` · en la definición de la columna | 483 |
| `CREATE TABLE` · a nivel de tabla | 10 |
| `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` | 11 |
| `ALTER TABLE … ADD COLUMN … REFERENCES` | 28 |
| **Total único** | **532** |

El DDL corre dos veces en el archivo unificado, así que **452** claves ajenas estaban repetidas y se descartaron.

## Por esquema

| Esquema | Claves ajenas |
|---|---:|
| `agent` | 13 |
| `analisis` | 8 |
| `avisa` | 3 |
| `chat` | 48 |
| `community` | 2 |
| `config` | 5 |
| `consultation` | 6 |
| `core` | 214 |
| `ctx` | 19 |
| `domain` | 16 |
| `economic` | 3 |
| `forecast` | 2 |
| `impact` | 7 |
| `ind` | 21 |
| `kag` | 61 |
| `lex` | 18 |
| `model` | 2 |
| `mype` | 4 |
| `pesca` | 8 |
| `policy` | 16 |
| `proteccion` | 4 |
| `qda` | 25 |
| `ref` | 3 |
| `staging` | 6 |
| `territorio` | 18 |

## Claves ajenas que cruzan la frontera del MVP

`42` claves ajenas salen de una tabla del MVP (capas T0 y T1 de
`docs/03_ejecucion/mvp_prioridad_tablas.csv`) y apuntan a una tabla que no lo es. Son las
que obligan a arrastrar **31 tablas padre** al alcance de la migración:
sin ellas la columna quedaría apuntando a una tabla inexistente.

| Tabla padre | Capa | Claves ajenas que la necesitan |
|---|---|---:|
| `analisis.plan_paso` | T4 | 1 |
| `analisis.punto_ingesta` | T2 | 1 |
| `chat.commit` | T4 | 1 |
| `core.cat_alcances_geograficos` | T2 | 2 |
| `core.cat_ciclos_intervencion` | T2 | 1 |
| `core.cat_niveles_alerta` | T2 | 1 |
| `core.cat_perfiles_actor` | T2 | 1 |
| `core.cat_prioridades_atencion` | T2 | 1 |
| `core.cat_roles_actor` | T2 | 1 |
| `core.cat_roles_funcionales` | T2 | 1 |
| `core.cat_subsectores` | T2 | 2 |
| `core.cat_tematicas` | T2 | 2 |
| `core.cat_tipos_cambio_caso` | T2 | 1 |
| `core.cat_tipos_organizacion` | T2 | 1 |
| `core.cat_unidades_organicas` | T2 | 3 |
| `core.documentos` | T2 | 3 |
| `core.entidades` | T2 | 1 |
| `core.integraciones` | T2 | 1 |
| `core.mesas_dialogo` | T2 | 1 |
| `core.provincias` | T2 | 2 |
| `core.regiones` | T2 | 2 |
| `core.reuniones_dialogo` | T3 | 2 |
| `ctx.snapshot` | T4 | 1 |
| `ind.variante` | T3 | 1 |
| `kag.cat_corpus` | T2 | 1 |
| `kag.cat_tipos_arista` | T2 | 1 |
| `kag.nodos` | T2 | 2 |
| `policy.escenario` | T4 | 1 |
| `policy.regla` | T2 | 1 |
| `policy.snapshot` | T4 | 1 |
| `qda.proyecto` | T4 | 1 |

## Comprobaciones

- Todas las tablas padre existen en el archivo: el bloque de claves ajenas se puede aplicar tal cual.
- Conteo bruto: 496 `CREATE TABLE` revisadas y 984 ediciones aplicadas al texto.
