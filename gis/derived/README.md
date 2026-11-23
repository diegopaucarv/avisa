# Infraestructuras PRODUCE · datos derivados

Salida de `python scripts/kml_infraestructuras.py`, que parsea `gis/Infraestructuras.kml`
y resuelve el ubigeo con el mismo flujo de nombres que `scripts/alcaldes_a_df.py`
(`scripts/toponimos.json` + `canonizar_ubigeo` sobre la columna INEI de
`gis/equivalencia-ubigeos-oti-concytec.csv`).

| Archivo                           | Qué es                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| `infraestructuras_puntos.csv`     | 13 456 filas, una por `<Placemark>`, con atributos tabulares y ubigeo |
| `infraestructuras_puntos.geojson` | Los mismos puntos como `FeatureCollection` (WGS84, `Point`)           |
| `resumen.txt`                     | Cifras de cobertura, instituciones y lista de distritos sin ubigeo    |

## Qué contiene la capa

El KML **no** son 13 456 instalaciones de PRODUCE. La columna `tipo_registro`
separa dos poblaciones muy distintas:

| `tipo_registro`    | Filas  | Qué es                                                                                    |
| ------------------ | ------ | ----------------------------------------------------------------------------------------- |
| `derecho_acuicola` | 13 229 | Un derecho acuícola por fila (`CODIGO` único): titular, resolución, área, especie, estado |
| `institucional`    | 227    | Sedes y dependencias identificadas por `IDENTI` (ITP, SANIPES, IMARPE, DIREPRO, DPA…)     |

Reparto institucional (227): ITP 34, `DPA - GORE` 30 (+1 con la errata `DPA -GORE`),
TUEMPRESA 29, PNACP 27, FONDEPES 27, DIREPRO 26, SANIPES 18, IMARPE 17, `anexas` 9,
INACAL 5, y RACSO / PROINNOVATE / PNDP / COMP MY PERU con 1 cada una.

Derechos acuícolas (13 229), todos `VIGENTE`:

- `ambito`: CONTINENTAL 12 696 · MARICULTURA 533.
- `tipo_derecho`: AUTORIZACION 11 823 · CONCESION 1 386 · CONCESION ESPECIAL 20.
- `categoria_codigo`: AREL 10 057 · AMYPE 2 996 · AMYGE 176.
- Área total: 30 030,85 ha sumadas (mínimo 0,0 · máximo 559,8).

## Columnas del CSV (35)

| Columna                                 | Origen                               | Notas                                                                               |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                                    | `id` del `<Placemark>`               | `ID_140000`, `ID_80000`…                                                            |
| `tipo_registro`                         | derivado                             | `derecho_acuicola` · `institucional`                                                |
| `nombre`                                | `<name>` del placemark               | **PII** en derechos y PNACP: repite el titular                                      |
| `identi`                                | `IDENTI` del globo                   | Institución dueña; vacía en los 13 229 derechos                                     |
| `sede`                                  | `SEDE`                               | 133 filas (DIREPRO, IMARPE, FONDEPES, SANIPES, INACAL, PNACP…)                      |
| `nombre_infraestructura`                | `NOMBRE_INF`, `NAME` (DPA), `NOMBRE` | 66 filas                                                                            |
| `direccion`                             | `DIRECCION`                          | 168 filas                                                                           |
| `direccion_predio`                      | `DIREC_PRED`                         | 16 filas con valor (la clave aparece en 27 globos FONDEPES)                         |
| `departamento`, `provincia`, `distrito` | ubigeo                               | Nombres **oficiales** cuando se resolvió; si no, el texto del globo                 |
| `ubigeo`                                | INEI                                 | Seis dígitos; vacío en 52 puntos                                                    |
| `metodo_ubigeo`                         | derivado                             | Cómo se llegó al nombre (ver abajo)                                                 |
| `latitud`, `longitud`                   | `<Point>`                            | WGS84                                                                               |
| `coincide_coords`                       | derivado                             | `si`/`no`/vacío: la coordenada del globo vs. el `<Point>` (10 no coinciden)         |
| `codigo`                                | `CODIGO`                             | 13 229 derechos, todos únicos                                                       |
| `ambito`                                | `AMBITO`                             | CONTINENTAL · MARICULTURA                                                           |
| `tipo_derecho`                          | `TIPO_DEREC`                         | AUTORIZACION · CONCESION · CONCESION ESPECIAL                                       |
| `categoria_productiva`                  | `CATEGORIA_`                         | Texto completo del globo                                                            |
| `categoria_codigo`                      | derivado                             | AREL · AMYPE · AMYGE (siglón entre paréntesis)                                      |
| `especie`                               | `ESPECIE`                            | Puede traer varias separadas por coma                                               |
| `tipo_recurso`                          | `TIPO_RECUR`                         | MANANTIAL, RÍO, LAGUNA…                                                             |
| `nombre_recurso`                        | `NOMBRE_REC`                         | Nombre del cuerpo de agua                                                           |
| `estado`                                | `ESTADO`                             | `VIGENTE` en los 13 229 derechos                                                    |
| `area_total_ha`                         | `AREA_TOTAL`                         | Hectáreas                                                                           |
| `fecha_emision`                         | `FECHA_EMIS`                         | Normalizada a ISO (`3/03/2015` → `2015-03-03`)                                      |
| `fecha_vigencia`                        | `FECHA_VIGE`                         | Normalizada a ISO                                                                   |
| `resolucion`                            | `RESOLUCION`                         | Ej. `R.D.R. Nº 024-2015-DIREPRO/GR-PUNO`                                            |
| `zona`                                  | `ZONA`                               | 12 384 filas con valor                                                              |
| `tipo_coord`                            | `TIPO_COORD`                         | Normalizado a mayúsculas: `UBICACIÓN RD`, `UBICACIÓN REFERENCIAL`, `GRÁFICA MANUAL` |
| `titular`                               | `TITULAR` / `NAME` (PNACP)           | **PII** (Ley 29733). 13 256 filas                                                   |
| `fid_origen`                            | `FID`                                | Entero 0–13 228                                                                     |
| `tipo_geometria`                        | del KML                              | `Point` en las 13 456                                                               |
| `otros`                                 | resto del globo                      | JSON: `DATUM`, `FLAG`, `OBJECTID_1`, `TIPO`, `RESOLU_1`, `OBS_MODIFI`, `FECHA_MODI` |

## Datos personales (Ley 29733)

`titular` y `nombre` son nombres de personas naturales: 13 229 titulares de
derechos acuícolas y 27 beneficiarios PNACP (cuyo `NAME` se copia a `titular`).
El CSV los conserva para uso interno; **el GeoJSON no los incluye**. En su lugar
expone `etiqueta` («Derecho acuícola 7241», la sede del PNACP o el nombre de la
instalación), de modo que el mapa sigue siendo legible sin exponer nombres. Si
la capa se publica, hay que decidir entre agregar por distrito o aplicar RLS.

## `metodo_ubigeo`

| Valor                  | Puntos | Significado                                                                                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exacto`               | 13 372 | El nombre del globo coincide con el del ubigeo                                                                                                    |
| `provincia aproximada` | 21     | La provincia venía con errata o truncada (`LMABAYEQUE`, `NAZCA`, `CONTR. VILLAR`) y se resolvió dentro de la lista de provincias del departamento |
| `distrito corregido`   | 10     | Corrección declarada en `toponimos.json` (`TARAPOTO`→`SAN MARTIN`, `PUERTO MALDONADO`→`TAMBOPATA`)                                                |
| `truncado`             | 1      | Nombre incompleto (`QUISQUI` → `QUISQUI (KICHKI)`)                                                                                                |
| `fuera del ubigeo`     | 51     | El distrito no existe en la tabla de equivalencias (ver abajo)                                                                                    |
| `parecido descartado`  | 1      | El parecido ortográfico apuntaba a otro distrito: se deja sin ubigeo                                                                              |

Regla: el parecido ortográfico **no** se acepta si no está respaldado por
`toponimos.json`. En esta fuente bastan dos tokens en común (`SAN ANTONIO` /
`SAN CRISTOBAL`) para emparejar distritos distintos, y un ubigeo inventado es peor
que un hueco.

## Reglas de normalización aplicadas

Los nombres de salida son los **oficiales** del ubigeo INEI, no los del KML:

| En el KML                       | Nombre oficial                        | Casos       |
| ------------------------------- | ------------------------------------- | ----------- |
| `CALLAO` (departamento)         | provincia `PROV. CONST. DEL CALLAO`   | 4 distritos |
| `PUERTO MALDONADO` (distrito)   | `TAMBOPATA` (170101)                  | 1 distrito  |
| `TARAPOTO` (provincia)          | `SAN MARTIN` (distrito 220901)        | 1           |
| `QUILLCA`                       | `QUILCA`                              | 1           |
| `CALETA CARQUIN`                | `CALETA DE CARQUIN`                   | 1           |
| `CERCADO DE LIMA`               | `LIMA`                                | 1           |
| `VENTISEIS DE OCTUBRE`          | `VEINTISEIS DE OCTUBRE`               | 1           |
| `BANDA DE SHILCAYO`             | `LA BANDA DE SHILCAYO`                | 1           |
| `CAJAMRCA`                      | `CAJAMARCA`                           | 1           |
| `SAN FCO.DE ASIS DE YARUSYACAN` | `SAN FRANCISCO DE ASIS DE YARUSYACAN` | 1           |
| `SAN FRANCISCO DEL YESO`        | `SAN FRANCISCO DE YESO`               | 1           |
| `PUERTO SUPE`                   | `SUPE PUERTO`                         | 1           |
| `CONTR. VILLAR` (provincia)     | `CONTRALMIRANTE VILLAR`               | 1           |
| `LMABAYEQUE` (provincia)        | `LAMBAYEQUE`                          | 1           |
| `NAZCA` (provincia)             | `NASCA`                               | 1           |

Otras normalizaciones:

- `FECHA_EMIS` y `FECHA_VIGE` se emiten en ISO; el KML las trae como `d/m/yyyy`.
- `TIPO_COORD` se unifica a mayúsculas (el KML alterna 4 variantes de caja).
- `categoria_codigo` extrae el siglón de `categoria_productiva`; se conserva el
  texto completo para no perder la redacción del globo.
- `identi` conserva la errata `DPA -GORE` (1 fila) para no alterar la fuente;
  al filtrar desembarcaderos conviene usar `identi LIKE 'DPA%'`.

## Los 52 puntos sin ubigeo

| Distrito en el KML                        | Puntos | Motivo                                                               |
| ----------------------------------------- | ------ | -------------------------------------------------------------------- |
| `UCAYALI / PADRE ABAD / BOQUERON`         | 25     | El distrito no existe en la tabla de equivalencias                   |
| `UCAYALI / PADRE ABAD / HUIPOCA`          | 22     | El distrito no existe en la tabla de equivalencias                   |
| `MOQUEGUA / MARISCAL NIETO / SAN ANTONIO` | 1      | No es distrito de esa provincia (Mariscal Nieto tiene San Cristóbal) |
| `AREQUIPA / MATARANI / MATARANI`          | 1      | `MATARANI` no es provincia ni distrito; es un puerto de Islay        |
| `JUNIN / SATIPO / MAZAMARI - PANGOA`      | 1      | Dos distritos en una celda                                           |
| `AYACUCHO / VICTOR FAJARDO / HUALLA`      | 1      | El distrito de esa provincia es `HUAYA`                              |
| `AYACUCHO / LA MAR / UNION PROGRESO`      | 1      | No aparece en la tabla                                               |

**Actualizado 2026-11-23.** Los cinco códigos ya existen en
`gis/Poblacion Censo 2025 geogpsperu/` (capa distrital con 1 892 polígonos,
`UBIGEO` de 6 dígitos y nombre oficial). Basta agregar la fila a
`toponimos.json` o al CSV y regenerar:

| Distrito en el KML                        | UBIGEO   | Cómo se resuelve                                  |
| ----------------------------------------- | -------- | ------------------------------------------------- |
| `UCAYALI / PADRE ABAD / BOQUERON`         | `250307` | Distrito creado en 2015; falta la fila en el CSV  |
| `UCAYALI / PADRE ABAD / HUIPOCA`          | `250306` | Distrito creado en 2016; falta la fila en el CSV  |
| `MOQUEGUA / MARISCAL NIETO / SAN ANTONIO` | `180107` | Es distrito; la tabla de equivalencias lo omite   |
| `AYACUCHO / VICTOR FAJARDO / HUALLA`      | `051010` | La capa y el KML dicen `HUALLA`; OTI dice `HUAYA` |
| `AYACUCHO / LA MAR / UNION PROGRESO`      | `050512` | Nombre ausente en la tabla de equivalencias       |

Quedan sin ubigeo **dos** puntos, y ninguno es un distrito: `MATARANI` es un
puerto del distrito de Islay y `MAZAMARI - PANGOA` mete dos distritos en una
celda del KML. Se resuelven a mano, no por nombre.

**No resolver por nombre en Tayacaja (`0907`).** La capa tiene un desfase de
una fila entre `090708` y `090712`: los nombres de `090709`–`090721` están
corridos respecto de su `UBIGEO`, así que la búsqueda por nombre atribuye la
población al distrito vecino. Ahí, y en general, la clave es el `UBIGEO`.

Procedencia de la capa: proveedor `geogpsperu`, rotulada «Censo 2025»; no es
una publicación del INEI. El `.dbf` viene en UTF-8 con un `.cpg` que declara
latin-1, y trae campos de contacto de terceros (`descargar`, `contacto`,
`whatsapp`) que conviene descartar al derivar.

## Regenerar

```sh
python scripts/kml_infraestructuras.py
python scripts/kml_infraestructuras.py --sin-ubigeo        # sin pandas
python scripts/kml_infraestructuras.py --ubigeo otro.csv --out-dir /tmp/salida
```
