from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

Role = Literal["Admin", "Sectorista", "Directora", "PuntoFocal", "Autoridad"]


class LoginRequest(BaseModel):
    dni: str = Field(min_length=8, max_length=12)
    password: str = Field(min_length=1, max_length=128)


class Session(BaseModel):
    dni: str
    nombre: str
    rol: Role
    id: str
    area: str
    email: str
    cargo: str
    # core.usuario_territorio: regiones que el usuario puede consultar.
    # Sin filas = sin restricción territorial (p. ej. Alta Dirección).
    regiones: list[str] = Field(default_factory=list)


app = FastAPI(title="AVISA API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Repository boundary: replace these fixtures with parameterized asyncpg/SQLAlchemy queries.
# `regiones` replica core.usuario_territorio, que en el legado se carga desde
# BRIDGE_Sectorista_Departamento (una fila por región del sectorista).
USERS = {
    "12345678": {
        "password": "demo",
        "nombre": "Dirección de demostración",
        "rol": "Directora",
        "id": "USR-001",
        "area": "OAIPCS",
        "email": "demo-directora@example.invalid",
        "cargo": "Directora",
        "regiones": [],
    },
    "87654321": {
        "password": "demo",
        "nombre": "Sectorista Norte Demo",
        "rol": "Sectorista",
        "id": "USR-002",
        "area": "OAIPCS",
        "email": "demo-sectorista-norte@example.invalid",
        "cargo": "Sectorista",
        "regiones": ["Piura", "Áncash"],
    },
    "11223344": {
        "password": "demo",
        "nombre": "Sectorista Centro Demo",
        "rol": "Sectorista",
        "id": "USR-003",
        "area": "OAIPCS",
        "email": "demo-sectorista-centro@example.invalid",
        "cargo": "Sectorista",
        "regiones": ["Junín"],
    },
}
CASES = [
    {
        "code": "CS-PES-2026-002",
        "name": "Ordenamiento pesquero artesanal",
        "sector": "Pesca y Acuicultura",
        "department": "Piura",
        "priority": "Urgente",
        "risk": "Alto",
        "progress": 68,
        "status": "En atención",
    },
    {
        "code": "CS-MYP-2026-014",
        "name": "Mesa productiva regional",
        "sector": "MYPE e Industria",
        "department": "Arequipa",
        "priority": "Moderado",
        "risk": "Moderado",
        "progress": 42,
        "status": "Activo",
    },
]
ALERTS = [
    {
        "id": "ALT-2026-018",
        "title": "Movilización anunciada por gremio",
        "location": "Sechura, Piura",
        "level": "Crítico",
        "updatedAt": "Hoy, 09:42",
    },
    {
        "id": "ALT-2026-017",
        "title": "Solicitud de diálogo sectorial",
        "location": "Arequipa",
        "level": "Inminente",
        "updatedAt": "Ayer, 16:20",
    },
]


@app.get("/health")
def health():
    return {"status": "ok", "service": "avisa-api"}


@app.post("/api/auth/login", response_model=Session)
def login(payload: LoginRequest):
    user = USERS.get(payload.dni.zfill(8))
    if not user or user["password"] != payload.password:
        raise HTTPException(401, "Credenciales inválidas")
    return Session(
        dni=payload.dni,
        nombre=user["nombre"],
        rol=user["rol"],
        id=user["id"],
        area=user["area"],
        email=user["email"],
        cargo=user["cargo"],
        regiones=user.get("regiones", []),
    )


@app.get("/api/dashboard")
def dashboard():
    return {
        "cases": CASES,
        "alerts": ALERTS,
        "kpis": [
            {"label": "Casos activos", "value": "24", "tone": "blue"},
            {"label": "Alertas críticas", "value": "03", "tone": "red"},
            {"label": "Intervenciones", "value": "18", "tone": "green"},
            {"label": "Pendientes", "value": "07", "tone": "orange"},
        ],
        "generatedAt": datetime.now().isoformat(),
    }
