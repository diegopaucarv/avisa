export type Role = 'Admin' | 'Sectorista' | 'Directora' | 'PuntoFocal' | 'Autoridad'

export interface Session { dni: string; nombre: string; rol: Role; id: string; area: string; email: string; cargo: string }
export interface CaseRecord { code: string; name: string; sector: string; department: string; priority: 'Urgente' | 'Moderado' | 'Bajo'; risk: 'Alto' | 'Moderado' | 'Bajo'; progress: number; status: string }
export interface AlertRecord { id: string; title: string; location: string; level: 'Crítico' | 'Inminente' | 'Intermedio'; updatedAt: string }
export interface DashboardData { cases: CaseRecord[]; alerts: AlertRecord[]; kpis: { label: string; value: string; tone: string }[] }
