import { NextResponse } from 'next/server'

const API_URL = process.env.AVISA_API_URL

const demoUsers = {
  '12345678': {
    password: 'demo',
    nombre: 'Edith Bautista',
    rol: 'Directora',
    id: 'USR-001',
    area: 'OAIPCS',
    email: 'maria@produce.gob.pe',
    cargo: 'Directora',
    regiones: [],
  },
  '87654321': {
    password: 'demo',
    nombre: 'Rosa Quispe',
    rol: 'Sectorista',
    id: 'USR-002',
    area: 'OAIPCS',
    email: 'rosa@produce.gob.pe',
    cargo: 'Sectorista',
    regiones: ['Piura', 'Áncash'],
  },
  '11223344': {
    password: 'demo',
    nombre: 'Luis Ramírez',
    rol: 'Sectorista',
    id: 'USR-003',
    area: 'OAIPCS',
    email: 'luis@produce.gob.pe',
    cargo: 'Sectorista',
    regiones: ['Junín'],
  },
} as const

export async function POST(request: Request) {
  let payload: { dni?: unknown; password?: unknown }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Solicitud inválida.' }, { status: 400 })
  }

  if (typeof payload.dni !== 'string' || typeof payload.password !== 'string' || payload.dni.length < 8 || payload.dni.length > 12 || payload.password.length < 1 || payload.password.length > 128) {
    return NextResponse.json({ detail: 'DNI o clave incorrectos.' }, { status: 401 })
  }

  if (API_URL) {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      })
      return new NextResponse(await response.text(), {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
      })
    } catch {
      return NextResponse.json({ detail: 'No se pudo conectar con el servicio de acceso.' }, { status: 503 })
    }
  }

  const dni = payload.dni.padStart(8, '0')
  const user = demoUsers[dni as keyof typeof demoUsers]
  if (!user || user.password !== payload.password) {
    return NextResponse.json({ detail: 'Credenciales inválidas.' }, { status: 401 })
  }

  const { password: _password, ...session } = user
  return NextResponse.json({ ...session, dni })
}
