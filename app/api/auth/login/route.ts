import { NextResponse } from 'next/server'

const API_URL = process.env.AVISA_API_URL ?? 'http://127.0.0.1:8000'

export async function POST(request: Request) {
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
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
