# =============================================================================
#  AVISA / OAIPCS · PostgreSQL 16 + pgvector + PostGIS
#
#  Base: pgvector/pgvector:pg16 (Debian 12 "bookworm", PostgreSQL 16 desde el
#  repositorio PGDG, con pgvector ya compilado). La imagen ya trae configurado
#  apt.postgresql.org, así que PostGIS se instala desde el mismo origen.
#
#  Por qué ambas extensiones y no sólo pgvector:
#    * la DDL v9 exige `vector` para kag.embedding;
#    * y exige `postgis` para las columnas GEOGRAPHY(POLYGON) de
#      territorio.parque_industrial, territorio.cuadricula_sismica y
#      territorio.zona_pesca.
#  En el entorno de pruebas (sólo pgvector) el CREATE EXTENSION postgis falló y
#  esas tres tablas nunca se crearon. Esta imagen existe para que eso no ocurra.
# =============================================================================
FROM pgvector/pgvector:pg16

LABEL org.opencontainers.image.title="avisa-postgres" \
    org.opencontainers.image.description="PostgreSQL 16 + pgvector + PostGIS para AVISA/OAIPCS"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    postgresql-16-postgis-3 \
    postgresql-16-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*

# Comprobación en tiempo de construcción: si PostGIS no queda disponible, la
# imagen no debe construirse. Se valida el binario y el script de extensión.
RUN test -f /usr/share/postgresql/16/extension/postgis.control \
    && gosu postgres test -x /usr/lib/postgresql/16/bin/postgres

# Destino de los bind mounts del DDL y de los parches (ver compose.yaml).
RUN mkdir -p /opt/avisa/sql

# Los scripts de /docker-entrypoint-initdb.d NO se copian aquí: se montan desde
# ./docker/postgres/initdb en compose.yaml, junto con el DDL y los parches del
# repositorio, para que no haya copias divergentes del esquema.
