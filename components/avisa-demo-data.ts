export type WorkspaceView = 'overview' | 'inbox' | 'cases' | 'case-detail' | 'alerts' | 'commitments' | 'executive'

export type DemoCase = {
  code: string
  title: string
  region: string
  subject: string
  risk: 'Alto' | 'Moderado' | 'Bajo'
  stage: string
  updated: string
  progress: number
  summary: string
  actors: string[]
  events: { date: string; title: string; description: string; kind: 'validated' | 'pending' | 'system' }[]
}

export type DemoAlert = {
  id: string
  title: string
  location: string
  source: string
  published: string
  priority: 'Crítica' | 'Alta' | 'Media'
  status: 'Pendiente de revisión' | 'Aprobada' | 'Descartada'
  quote: string
  note: string
  reviewNote?: string
}

export type DemoCommitment = {
  id: string
  title: string
  caseCode: string
  owner: string
  due: string
  status: 'Vencido' | 'Por vencer' | 'En curso' | 'Cumplido'
  progress: number
}

export const demoCases: DemoCase[] = [
  {
    code: 'DEMO-2026-041', title: 'Acceso a zona de desembarque', region: 'Piura · Paita', subject: 'Pesca artesanal', risk: 'Alto', stage: 'Diálogo activo', updated: 'Hace 18 min', progress: 68,
    summary: 'Representantes de organizaciones locales solicitaron una mesa de trabajo sobre el acceso a infraestructura de desembarque. La ficha y sus datos son ilustrativos; no representan un caso real.',
    actors: ['Organización local (alias)', 'Gobierno regional', 'Entidad sectorial'],
    events: [
      { date: '19 nov · 10:42', title: 'Nueva alerta en revisión', description: 'Se detectó una publicación en fuente autorizada. Aún no es visible fuera de la bandeja.', kind: 'pending' },
      { date: '19 nov · 09:10', title: 'Reunión de coordinación', description: 'Se registró un acta de coordinación como evidencia pendiente de validación.', kind: 'validated' },
      { date: '18 nov · 16:30', title: 'Compromiso actualizado', description: 'La entidad responsable informó avance en la propuesta de agenda.', kind: 'system' },
    ],
  },
  {
    code: 'DEMO-2026-038', title: 'Continuidad de actividad acuícola', region: 'Áncash · Huarmey', subject: 'Acuicultura', risk: 'Moderado', stage: 'Seguimiento', updated: 'Hace 2 h', progress: 42,
    summary: 'Solicitud ilustrativa de coordinación sobre continuidad de una actividad acuícola y monitoreo de calidad de agua. La evidencia de este prototipo es ficticia.',
    actors: ['Asociación productiva (alias)', 'Autoridad local', 'Equipo técnico'],
    events: [{ date: '19 nov · 08:35', title: 'Muestra registrada', description: 'Resultado ingresado a revisión técnica; no constituye una conclusión validada.', kind: 'pending' }],
  },
  {
    code: 'DEMO-2026-032', title: 'Coordinación por mantenimiento vial', region: 'Junín · Chanchamayo', subject: 'Infraestructura', risk: 'Bajo', stage: 'Acuerdos en seguimiento', updated: 'Ayer', progress: 84,
    summary: 'Caso demostrativo de coordinación entre actores locales para el seguimiento de acuerdos de mantenimiento.',
    actors: ['Comité local (alias)', 'Gobierno local', 'Sector competente'],
    events: [{ date: '18 nov · 15:20', title: 'Hito reportado', description: 'Se añadió evidencia de avance; pendiente de confirmación por el responsable.', kind: 'pending' }],
  },
]

export const demoAlerts: DemoAlert[] = [
  { id: 'ALT-DEMO-018', title: 'Solicitud de reunión difundida en canal local', location: 'Paita · Piura', source: 'Medio regional de ejemplo', published: '19 nov · 10:24', priority: 'Crítica', status: 'Pendiente de revisión', quote: '“Solicitamos una reunión para revisar el acceso a la zona de desembarque.”', note: 'Cita y fuente ficticias para demostrar el control de coincidencia textual. Verificar antes de cualquier uso institucional.' },
  { id: 'ALT-DEMO-017', title: 'Convocatoria a mesa técnica', location: 'Huarmey · Áncash', source: 'Boletín de ejemplo', published: '19 nov · 08:40', priority: 'Alta', status: 'Pendiente de revisión', quote: '“Proponemos instalar una mesa técnica con participación de las autoridades.”', note: 'Registro ilustrativo sin vínculo a una persona identificada.' },
  { id: 'ALT-DEMO-014', title: 'Actualización de compromiso local', location: 'Chanchamayo · Junín', source: 'Acta simulada', published: '18 nov · 15:12', priority: 'Media', status: 'Aprobada', quote: '“Se coordinará una nueva fecha para la inspección conjunta.”', note: 'Aprobación demostrativa: no corresponde a un acto administrativo real.' },
]

export const demoCommitments: DemoCommitment[] = [
  { id: 'COM-DEMO-009', title: 'Presentar propuesta de agenda para la mesa', caseCode: 'DEMO-2026-041', owner: 'Equipo sectorial', due: '19 nov 2026', status: 'Vencido', progress: 70 },
  { id: 'COM-DEMO-008', title: 'Confirmar fecha de reunión técnica', caseCode: 'DEMO-2026-038', owner: 'Coordinación territorial', due: '20 nov 2026', status: 'Por vencer', progress: 45 },
  { id: 'COM-DEMO-006', title: 'Compartir acta de coordinación', caseCode: 'DEMO-2026-032', owner: 'Gobierno local (demo)', due: '24 nov 2026', status: 'En curso', progress: 60 },
  { id: 'COM-DEMO-003', title: 'Remitir nota de seguimiento', caseCode: 'DEMO-2026-032', owner: 'Equipo técnico', due: '17 nov 2026', status: 'Cumplido', progress: 100 },
]

export const isDemoData = true
