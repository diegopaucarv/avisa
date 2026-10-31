#!/usr/bin/env bash
# =============================================================================
#  AVISA · operación del PostgreSQL local
#
#    ./scripts/db.sh up       construye la imagen, arranca y verifica
#    ./scripts/db.sh status   estado del contenedor y de la salud
#    ./scripts/db.sh verify   re-ejecuta las comprobaciones del esquema
# ./scripts/db.sh apply    re-aplica DDL (2 pasadas) + parches 1-5
#    ./scripts/db.sh psql     consola psql interactiva
#    ./scripts/db.sh logs     logs del contenedor (initdb incluido)
#    ./scripts/db.sh down     detiene y elimina el contenedor (conserva datos)
#    ./scripts/db.sh reset    elimina también el volumen y vuelve a levantar
#    ./scripts/db.sh snapshot congela el esquema actual como avisa_template
#    ./scripts/db.sh fresh    recrea la base desde la plantilla + parches 1-5
#    ./scripts/db.sh uri      imprime la cadena de conexión
#
#  Requiere: docker + docker compose v2. Pensado para Git Bash en Windows.
# =============================================================================
set -euo pipefail

# Git Bash (MSYS) reescribe los argumentos que empiezan por "/" y convertiría
# `-f /opt/avisa/sql/...` en una ruta de Windows. Con esto los paths de dentro
# del contenedor viajan intactos.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

CONTAINER="avisa-db"

# .env es obligatorio: sin POSTGRES_PASSWORD, compose se niega a arrancar.
if [ ! -f .env ]; then
    echo "ERROR: falta .env. Copiá .env.example y cambiá POSTGRES_PASSWORD:" >&2
    echo "  cp .env.example .env" >&2
    exit 1
fi

env_get() {
    # Lee una clave de .env sin exportar el archivo completo.
    grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-
}

wait_healthy() {
    echo -n "esperando a que $CONTAINER esté healthy"
    for _ in $(seq 1 120); do
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
        case "$status" in
            healthy) echo " OK"; return 0 ;;
            unhealthy)
                echo
                echo "ERROR: el contenedor quedó unhealthy. Revisá ./scripts/db.sh logs" >&2
                return 1
                ;;
            missing)
                echo
                echo "ERROR: el contenedor $CONTAINER no existe" >&2
                return 1
                ;;
        esac
        echo -n "."
        sleep 5
    done
    echo
    echo "ERROR: timeout esperando healthy" >&2
    return 1
}

psql_do() {
    # Ejecuta un archivo contra la base, como el rol de la aplicación.
    docker exec -i "$CONTAINER" \
        psql -v ON_ERROR_STOP=1 \
             -U "$(env_get POSTGRES_USER)" \
             -d "$(env_get POSTGRES_DB)" \
             -f "$1"
}

case "${1:-}" in
    up)
        docker compose up -d --build
        wait_healthy
        echo
        echo "AVISA listo en localhost:$(env_get POSTGRES_PORT)"
        echo "  base: $(env_get POSTGRES_DB)   rol: $(env_get POSTGRES_USER)"
        echo "  logs de inicialización: ./scripts/db.sh logs"
        ;;

    status)
        docker compose ps
        docker inspect -f 'salud: {{if .State.Health}}{{.State.Health.Status}}{{else}}sin healthcheck{{end}}' "$CONTAINER" 2>/dev/null || true
        ;;

    verify)
        # Las mismas comprobaciones del initdb, contra el contenedor en marcha.
        docker exec -i "$CONTAINER" \
            psql -v ON_ERROR_STOP=1 \
                 -U "$(env_get POSTGRES_USER)" \
                 -d "$(env_get POSTGRES_DB)" \
                 -f /docker-entrypoint-initdb.d/20_verify.sql
        ;;

    apply)
        echo "re-aplicando DDL (2 pasadas tolerantes) + parches (estrictos)"
        docker exec -i "$CONTAINER" \
            psql -q -v ON_ERROR_STOP=0 \
                 -U "$(env_get POSTGRES_USER)" \
                 -d "$(env_get POSTGRES_DB)" \
                 -f /opt/avisa/sql/90_ddl_v9.sql >/dev/null 2>&1 || true
        docker exec -i "$CONTAINER" \
            psql -q -v ON_ERROR_STOP=0 \
                 -U "$(env_get POSTGRES_USER)" \
                 -d "$(env_get POSTGRES_DB)" \
                 -f /opt/avisa/sql/90_ddl_v9.sql >/dev/null 2>&1 || true
        psql_do /opt/avisa/sql/91_patch_01.sql >/dev/null
        psql_do /opt/avisa/sql/92_patch_02.sql >/dev/null
        psql_do /opt/avisa/sql/93_patch_03.sql >/dev/null
        psql_do /opt/avisa/sql/94_patch_04.sql >/dev/null
        psql_do /opt/avisa/sql/95_patch_05.sql >/dev/null
        echo "parches aplicados; verificando"
        "$0" verify
        ;;

    psql)
        shift || true
        docker exec -it "$CONTAINER" \
            psql -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" "$@"
        ;;

    logs)
        docker compose logs -f db
        ;;

    down)
        docker compose down
        ;;

    reset)
        echo "esto ELIMINA el volumen avisa_pgdata y vuelve a aplicar el esquema"
        if [ "${2:-}" != "--force" ] && [ "${2:-}" != "-y" ]; then
            read -r -p "¿continuar? [s/N] " ok
            [ "$ok" = "s" ] || { echo "cancelado"; exit 1; }
        fi
        docker compose down -v
        "$0" up
        ;;

    snapshot)
        # Congela el esquema actual como plantilla. Permite volver a un estado
        # limpio en segundos en lugar de re-ejecutar el initdb (2-3 min).
        # La plantilla debe ser el esquema VACÍO: con el legado cargado, `fresh`
        # dejaría de reproducir la carga desde cero.
        if [ "${2:-}" != "--force" ] && [ "${2:-}" != "-y" ]; then
            legado="$(docker exec "$CONTAINER" psql -t -A -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" \
                -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='legacy'")"
            if [ "${legado:-0}" -gt 0 ]; then
                echo "ERROR: la base tiene el schema legacy ($legado tablas): el legado ya está cargado." >&2
                echo "       La plantilla tiene que congelarse ANTES de la carga." >&2
                echo "       Reconstruí con ./scripts/db.sh reset --force y volvé a congelar." >&2
                exit 1
            fi
        fi
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='avisa_template' AND pid <> pg_backend_pid()" >/dev/null
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "DROP DATABASE IF EXISTS avisa_template" >/dev/null
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "CREATE DATABASE avisa_template TEMPLATE $(env_get POSTGRES_DB)"
        echo "plantilla avisa_template creada desde $(env_get POSTGRES_DB)"
        ;;

    fresh)
        # Recrea la base de trabajo desde la plantilla (segundos, no minutos).
        # No borra el volumen: el esquema viene de avisa_template.
        if ! docker exec "$CONTAINER" psql -t -A -U "$(env_get POSTGRES_USER)" -d postgres \
                -c "SELECT 1 FROM pg_database WHERE datname='avisa_template'" | grep -q 1; then
            echo "ERROR: no existe avisa_template. Corré ./scripts/db.sh snapshot primero." >&2
            exit 1
        fi
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$(env_get POSTGRES_DB)' AND pid <> pg_backend_pid()" >/dev/null
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "DROP DATABASE IF EXISTS $(env_get POSTGRES_DB)" >/dev/null
        docker exec "$CONTAINER" psql -q -U "$(env_get POSTGRES_USER)" -d postgres \
            -c "CREATE DATABASE $(env_get POSTGRES_DB) TEMPLATE avisa_template"
        # La plantilla se congela a mano y puede ser anterior al último parche.
        # Los parches son idempotentes, así que re-aplicarlos es barato y deja
        # la base recién clonada siempre al día.
        for p in /opt/avisa/sql/91_patch_01.sql /opt/avisa/sql/92_patch_02.sql \
                 /opt/avisa/sql/93_patch_03.sql /opt/avisa/sql/94_patch_04.sql \
                 /opt/avisa/sql/95_patch_05.sql; do
            # Los NOTICE de "already exists, skipping" son la norma al re-aplicar
            # sobre una plantilla ya parcheada; solo interesa el fallo real.
            if ! psql_do "$p" >/dev/null 2>&1; then
                echo "ERROR: falló $p al re-aplicarlo sobre la base recién clonada." >&2
                echo "       Revisá la plantilla con ./scripts/db.sh psql y volvé a intentar." >&2
                exit 1
            fi
        done
        echo "$(env_get POSTGRES_DB) recreada desde avisa_template (parches 1-5 re-aplicados)"
        ;;

    uri)
        echo "postgresql://$(env_get POSTGRES_USER):$(env_get POSTGRES_PASSWORD)@localhost:$(env_get POSTGRES_PORT)/$(env_get POSTGRES_DB)"
        ;;

    *)
        sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
