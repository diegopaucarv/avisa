'use client'

import { useState } from 'react'
import { AvisaDashboard } from '@/components/avisa-dashboard'
import { AvisaLogin } from '@/components/avisa-login'
import type { Session } from '@/frontend/types'

export default function Page() { const [session, setSession] = useState<Session | null>(null); return session ? <AvisaDashboard session={session} onLogout={() => setSession(null)} /> : <AvisaLogin onSuccess={setSession} /> }
