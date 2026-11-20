# =============================================================================
#  AVISA · API (FastAPI)
#
#  Hoy es el servicio de demostración que vive en `backups/backend/`: sirve
#  el login y el tablero con datos de ejemplo, sin tocar la base. Cuando la
#  API real reemplace los datos de ejemplo, basta con cambiar la carpeta de
#  origen de los `COPY`.
#
#  Contexto de construcción: la RAÍZ del repositorio (ver compose.yaml).
# =============================================================================
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY backups/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backups/backend/main.py backups/backend/db.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
