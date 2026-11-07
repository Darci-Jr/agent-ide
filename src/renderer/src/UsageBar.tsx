import { useEffect, useState, type ReactNode } from 'react'
import type { CacheInfo, ClaudeUsage, TokenTotals, GitStatus, SessionContext, UsageWindow } from '../../shared/types'

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

const clock = (ms: number): string => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Tempo até o cache vencer. Perto do fim fica em aviso: a próxima mensagem sairia mais cara. */
function CacheState({ data }: { data: CacheInfo | null }): ReactNode {
  if (!data) return <span className="usage-meter" data-tip="Aparece depois da primeira resposta">Cache —</span>
  const left = data.expiresAt - Date.now()
  if (left <= 0) {
    return (
      <span className="usage-meter critical" data-tip={`Venceu às ${clock(data.expiresAt)}`}>
        Cache expirado
      </span>
    )
  }
  const warnAt = data.ttlMs >= 60 * 60 * 1000 ? 5 * 60 * 1000 : 60 * 1000
  const text = left >= 60 * 1000 ? `${Math.floor(left / 60000)}min` : `${Math.ceil(left / 1000)}s`
  return (
    <span className={`usage-meter ${left <= warnAt ? 'warning' : ''}`} data-tip={`Vence às ${clock(data.expiresAt)}; cada resposta renova por ${data.ttlMs >= 3600000 ? '1 hora' : '5 minutos'}`}>
      Cache {text}
    </span>
  )
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

/** Tokens da conversa inteira; a dica separa o que é entrada, cache e saída. */
function TokensState({ data }: { data: TokenTotals | null }): ReactNode {
  if (!data) return <span className="usage-meter" data-tip="Aparece depois da primeira resposta">Tokens —</span>
  const tip = [
    `Conversa inteira, ${data.responses} ${data.responses === 1 ? 'resposta' : 'respostas'}`,
    `entrada ${compact.format(data.input)} · cache gravado ${compact.format(data.cacheWrite)}`,
    `cache lido ${compact.format(data.cacheRead)} · saída ${compact.format(data.output)}`
  ].join('\n')
  return (
    <span className="usage-meter" data-tip={tip}>
      Tokens {compact.format(data.total)}
    </span>
  )
}

/** Só o estado: as ações de Git ficam no ícone da barra lateral. */
function GitState({ git }: { git: GitStatus }): ReactNode {
  return (
    <span className="git-state">
      <span className="git-branch" data-tip={git.detached ? 'Sem branch: commit avulso' : git.root}>
        ⑂ {git.branch}
      </span>
      {git.upstream && (
        <span data-tip={`${git.ahead} à frente e ${git.behind} atrás do remoto, desde a última busca`}>
          ↑{git.ahead} ↓{git.behind}
        </span>
      )}
      {git.changed > 0 && (
        <span className="git-dirty" data-tip={`${git.changed} ${git.changed === 1 ? 'arquivo alterado' : 'arquivos alterados'}`}>
          ●{git.changed}
        </span>
      )}
      {git.worktree && <span data-tip={git.root}>worktree: {git.worktree}</span>}
    </span>
  )
}

/** Rodapé da IDE: limites da conta, o contexto e o Git da sessão em uso. */
export function UsageBar(props: {
  usage: ClaudeUsage | null
  /** Nulo quando não há sessão do Claude à vista. */
  context: { title: string; data: SessionContext | null } | null
  showUsage: boolean
  showContext: boolean
  /** Nulo quando o cache está desligado ou não há sessão do Claude em uso. */
  cache: { data: CacheInfo | null } | null
  /** Nulo quando desligado ou sem sessão do Claude em uso. */
  tokens: { data: TokenTotals | null } | null
  /** Nulo quando o Git está desligado ou a pasta não é um repositório. */
  git: GitStatus | null
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
      {props.cache && <CacheState data={props.cache.data} />}
      {props.tokens && <TokensState data={props.tokens.data} />}
      {props.git && <GitState git={props.git} />}
    </footer>
  )
}
