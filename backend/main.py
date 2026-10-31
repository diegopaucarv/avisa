from datetime import datetime
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

Role = Literal['Admin', 'Sectorista', 'Directora', 'PuntoFocal', 'Autoridad']

class LoginRequest(BaseModel):
    dni: str = Field(min_length=8, max_length=12)
    password: str = Field(min_length=1, max_length=128)

class Session(BaseModel):
    dni: str; nombre: str; rol: Role; id: str; area: str; email: str; cargo: str

app = FastAPI(title='AVISA API', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:3000'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

# Repository boundary: replace these fixtures with parameterized asyncpg/SQLAlchemy queries.
USERS = {'12345678': {'password': 'demo', 'nombre': 'María García', 'rol': 'Directora', 'id': 'USR-001', 'area': 'OAIPCS', 'email': 'maria@produce.gob.pe', 'cargo': 'Directora'}}
CASES = [
    {'code': 'CS-PES-2026-002', 'name': 'Ordenamiento pesquero artesanal', 'sector': 'Pesca y Acuicultura', 'department': 'Piura', 'priority': 'Urgente', 'risk': 'Alto', 'progress': 68, 'status': 'En atención'},
    {'code': 'CS-MYP-2026-014', 'name': 'Mesa productiva regional', 'sector': 'MYPE e Industria', 'department': 'Arequipa', 'priority': 'Moderado', 'risk': 'Moderado', 'progress': 42, 'status': 'Activo'},
]
ALERTS = [{'id': 'ALT-2026-018', 'title': 'Movilización anunciada por gremio', 'location': 'Sechura, Piura', 'level': 'Crítico', 'updatedAt': 'Hoy, 09:42'}, {'id': 'ALT-2026-017', 'title': 'Solicitud de diálogo sectorial', 'location': 'Arequipa', 'level': 'Inminente', 'updatedAt': 'Ayer, 16:20'}]

@app.get('/health')
def health(): return {'status': 'ok', 'service': 'avisa-api'}

@app.post('/api/auth/login', response_model=Session)
def login(payload: LoginRequest):
    user = USERS.get(payload.dni.zfill(8))
    if not user or user['password'] != payload.password: raise HTTPException(401, 'Credenciales inválidas')
    return Session(dni=payload.dni, nombre=user['nombre'], rol=user['rol'], id=user['id'], area=user['area'], email=user['email'], cargo=user['cargo'])

@app.get('/api/dashboard')
def dashboard():
    return {'cases': CASES, 'alerts': ALERTS, 'kpis': [{'label': 'Casos activos', 'value': '24', 'tone': 'blue'}, {'label': 'Alertas críticas', 'value': '03', 'tone': 'red'}, {'label': 'Intervenciones', 'value': '18', 'tone': 'green'}, {'label': 'Pendientes', 'value': '07', 'tone': 'orange'}], 'generatedAt': datetime.now().isoformat()}
