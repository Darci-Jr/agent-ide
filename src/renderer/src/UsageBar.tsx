import { useEffect, useState, type ReactNode } from 'react'
import type { ClaudeUsage, SessionContext, UsageWindow } from '../../shared/types'

const BLOCKS = 5

const time = (ms: number): string => {
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? `hoje às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const tokens = (n: number): string => (n >= 1_000_000 ? `${n / 1_000_000} mi` : `${Math.round(n / 1000)} mil`)

/** Um indicador: rótulo, blocos e porcentagem. Sem valor, mostra os blocos vazios e um traço. */
function Meter(props: { label: string; percent: number | null; text?: string; tip?: string }): ReactNode {
  if (props.percent === null) {
    return (
      <span className="usage-meter" data-tip={props.tip}>
        {props.label} <span className="usage-blocks">{'▱'.repeat(BLOCKS)}</span> {props.text ?? '—'}
      </span>
    )
  }
  const pct = Math.max(0, Math.min(100, props.percent))
  const filled = Math.round(pct / (100 / BLOCKS))
  const level = pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : ''
  return (
    <span className={`usage-meter ${level}`} data-tip={props.tip}>
      {props.label} <span className="usage-blocks">{'▰'.repeat(filled) + '▱'.repeat(BLOCKS - filled)}</span> {Math.round(pct)}%
    </span>
  )
}

function LimitMeter(props: { label: string; window: UsageWindow | null }): ReactNode {
  const w = props.window
  if (!w) return <Meter label={props.label} percent={null} />
  if (w.resetsAt <= Date.now()) return <Meter label={props.label} percent={null} text="renovado" />
  return <Meter label={props.label} percent={w.usedPercentage} tip={`Renova ${time(w.resetsAt)}`} />
}

/** Rodapé da IDE: limites da conta e o contexto da sessão do Claude que está em uso. */
export function UsageBar(props: {
  usage: ClaudeUsage | null
  /** Nulo quando não há sessão do Claude à vista. */
  context: { title: string; data: SessionContext | null } | null
  showUsage: boolean
  showContext: boolean
}): ReactNode {
  // Redesenha a cada minuto para "renovado" não ficar parado.
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(timer)
  }, [])
  const { usage, context } = props
  const contextTip = context?.data?.size ? `${context.title}, janela de ${tokens(context.data.size)} tokens` : context?.title
  return (
    <footer className="usage-bar" aria-label="Uso do Claude">
      {props.showUsage && (
        <>
          <LimitMeter label="5h" window={usage?.fiveHour ?? null} />
          <LimitMeter label="Semana" window={usage?.sevenDay ?? null} />
        </>
      )}
      {props.showContext && context && <Meter label="Contexto" percent={context.data?.usedPercentage ?? null} tip={contextTip} />}
    </footer>
  )
}
