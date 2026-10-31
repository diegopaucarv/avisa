import type { DashboardData, Session } from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function login(dni: string, password: string): Promise<Session> {
  const response = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dni, password }) })
  if (!response.ok) throw new Error('DNI o clave incorrectos. Verifique sus credenciales.')
  return response.json()
}

export async function getDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_URL}/api/dashboard`, { cache: 'no-store' })
  if (!response.ok) throw new Error('No se pudo cargar el dashboard')
  return response.json()
}
