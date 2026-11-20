'use client'

import { useState } from 'react'
import { ArrowRight, Check, CircleDot, Compass, Handshake, MessageSquareText, SearchCheck, Timer } from 'lucide-react'

const stages = [
  { title: 'Detectar', detail: 'Señal registrada', icon: Compass },
  { title: 'Verificar', detail: 'Contrastar evidencia', icon: SearchCheck },
  { title: 'Convocar', detail: 'Coordinar actores', icon: MessageSquareText },
  { title: 'Acordar', detail: 'Registrar compromisos', icon: Handshake },
  { title: 'Seguir', detail: 'Revisar avances', icon: Timer },
]

export function ConflictResolutionJourney({ caseCode }: { caseCode: string }) {
  const [activeStep, setActiveStep] = useState(1)
  const current = stages[activeStep]
  const Icon = current.icon

  return <section className="surface resolution-journey" aria-labelledby="resolution-title">
    <div className="journey-heading"><div><p className="section-eyebrow">RUTA DE ATENCIÓN · {caseCode}</p><h3 id="resolution-title">De la señal al seguimiento</h3><p>Un flujo guiado mantiene contexto, evidencia y acuerdos en un solo lugar.</p></div><span className="journey-demo-tag">Flujo de demostración</span></div>
    <ol className="journey-steps" aria-label="Etapas del proceso">
      {stages.map((stage, index) => {
        const StepIcon = stage.icon
        const complete = index < activeStep
        return <li className={`journey-step ${index === activeStep ? 'is-current' : ''} ${complete ? 'is-complete' : ''}`} key={stage.title} aria-current={index === activeStep ? 'step' : undefined}>
          <span className="journey-step-icon">{complete ? <Check size={14} /> : <StepIcon size={14} />}</span><span className="journey-step-copy"><strong>{stage.title}</strong><small>{stage.detail}</small></span>
        </li>
      })}
    </ol>
    <div className="journey-next" key={activeStep} aria-live="polite"><span className="journey-next-icon"><Icon size={17} /></span><span><strong>Siguiente paso sugerido: {current.title.toLowerCase()}</strong><small>{activeStep === 0 ? 'Registrar una señal con territorio y fecha.' : current.detail + ' antes de avanzar a ' + (stages[activeStep + 1]?.title.toLowerCase() ?? 'cierre') + '.'}</small></span><button className="button-secondary" onClick={() => setActiveStep((step) => (step + 1) % stages.length)}>{activeStep === stages.length - 1 ? 'Reiniciar ruta' : 'Ver paso'} <ArrowRight size={14} /></button></div>
    <p className="journey-disclaimer"><CircleDot size={12} /> La ruta ayuda a organizar el trabajo; no recomienda ni ejecuta decisiones por el equipo.</p>
  </section>
}
