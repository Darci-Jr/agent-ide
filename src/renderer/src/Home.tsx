import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Environment, HistoryEntry, Project } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'

type Intent = 'session' | 'history' | 'environment' | 'import'
type Step = { name: 'menu' } | { name: 'environments' } | { name: 'project'; intent: Intent } | { name: 'history'; project: Project } | { name: 'template'; project: Project }

const INTENT_TITLE: Record<Intent, string> = {
  session: 'Criar sessão em qual projeto?',
  history: 'Carregar sessão de qual projeto?',
  environment: 'Criar ambiente em qual projeto?',
  import: 'Importar para qual projeto?'
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const ACTION_ICONS: Record<string, ReactNode> = {
  session: <path d="M4 5l6 6-6 6M13 18h7" />,
  resume: <path d="M4 12a8 8 0 1 0 3-6L4 9M4 4v5h5" />,
  history: <path d="M4 12a8 8 0 1 0 3-6L4 9M4 4v5h5M12 8v4l3 2" />,
  environment: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 14v6M13.5 17h6" />,
  load: <path d="M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5L12 16l2.5-2.5" />
}

function Action(props: { icon: string; label: string; onClick(): void }): ReactNode {
  return (
    <button type="button" className="home-action" onClick={props.onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {ACTION_ICONS[props.icon]}
      </svg>
      {props.label}
    </button>
  )
}

export function Home(props: {
  environments: Environment[]
  onOpen(env: Environment): void
  onResume(id: string): Promise<void>
  showOpenSession(sessionId: string): boolean
  onDeleted(id: string): void
  toast(message: string): void
  /** Ambientes com aba aberta: no histórico aparecem como abertos. */
  openIds: string[]
  /** Abre direto em um passo, como o + da barra de abas, que começa em "Criar ambiente". */
  start?: Step
}): ReactNode {
  const { environments, onOpen, onResume, showOpenSession, onDeleted, toast } = props
  const [step, setStep] = useState<Step>(props.start ?? { name: 'menu' })
  const [search, setSearch] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [newName, setNewName] = useState('')
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)

  const refreshProjects = useCallback(() => void ide.listProjects().then(setProjects), [])
  useEffect(refreshProjects, [refreshProjects, step])

  const guard = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const open = (env: Environment): void => {
    setStep({ name: 'menu' })
    onOpen(env)
  }

  const resume = (env: Environment): Promise<void> =>
    guard(async () => {
      await onResume(env.id)
      setStep({ name: 'menu' })
    })

  const restore = (project: Project, entry: HistoryEntry): Promise<void> =>
    guard(async () => {
      if (showOpenSession(entry.sessionId)) {
        setStep({ name: 'menu' })
        return
      }
      // A conversa pode já pertencer a um ambiente fechado: reabre esse, sem criar outro.
      const holder = environments.find((env) => env.sessions.some((s) => s.id === entry.sessionId))
      if (holder) {
        await ide.startSession(holder.id, entry.sessionId)
        await resume(holder)
        return
      }
      open(await ide.openFromHistory(project.id, entry))
    })

  const saved = environments.filter((e) => !e.draft)

  const projectChosen = (project: Project, intent: Intent): Promise<void> =>
    guard(async () => {
      if (intent === 'session') {
        open(await ide.createEnvironment({ projectId: project.id, draft: true }))
      } else if (intent === 'history') {
        setHistory(null)
        setStep({ name: 'history', project })
        setHistory(await ide.listHistory(project.id))
      } else if (intent === 'environment') {
        // Sem ambiente salvo para copiar, não há o que escolher.
        if (saved.length > 0) setStep({ name: 'template', project })
        else open(await ide.createEnvironment({ projectId: project.id }))
      } else {
        const env = await ide.importEnvironment(project.id)
        if (env) open(env)
      }
    })

  const nameOf = (id: string): string => projects.find((p) => p.id === id)?.name ?? 'Projeto removido'
  const [last, ...others] = [...environments].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const recent = others.slice(0, 5)
  const lastAttention = last?.sessions.filter((s) => s.interrupted).length ?? 0

  const head = (title: string, back: Step): ReactNode => (
    <div className="home-head">
      <IconButton icon="back" label="Voltar" onClick={() => setStep(back)} />
      <h1>{title}</h1>
    </div>
  )

  // Histórico: abertos e fechados, do mais recente para o mais antigo. Reabrir retoma as sessões.
  const fold = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const lastSeen = (env: Environment): number => (props.openIds.includes(env.id) ? Date.now() : Math.max(env.closedAt ?? 0, env.lastOpenedAt))
  const terms = fold(search).split(/\s+/).filter(Boolean)
  const found = [...environments]
    .filter((env) => {
      const haystack = fold([env.name, nameOf(env.projectId), ...env.sessions.map((s) => s.title)].join(' '))
      return terms.every((t) => haystack.includes(t))
    })
    .sort((a, b) => lastSeen(b) - lastSeen(a))

  const historyRow = (env: Environment): ReactNode => {
    const open = props.openIds.includes(env.id)
    const count = `${env.sessions.length} ${env.sessions.length === 1 ? 'sessão' : 'sessões'}`
    return (
      <div key={env.id} className="home-row">
        <button type="button" onClick={() => void resume(env)}>
          <strong>
            {env.name}
            {env.draft && <em className="home-tag">temporário</em>}
            {open && <em className="home-tag">aberto</em>}
          </strong>
          <span>
            {nameOf(env.projectId)} · {count} · {open ? 'aberto agora' : `fechado em ${when(env.closedAt ?? env.lastOpenedAt)}`}
          </span>
        </button>
        <IconButton
          icon="trash"
          label={`Apagar ${env.name}`}
          onClick={() => {
            if (!window.confirm(`Apagar o ambiente ${env.name}? O projeto e as conversas continuam.`)) return
            void guard(async () => {
              await ide.deleteEnvironment(env.id)
              onDeleted(env.id)
            })
          }}
        />
      </div>
    )
  }

  const environmentRow = (env: Environment, removable: boolean): ReactNode => (
    <div key={env.id} className="home-row">
      <button type="button" onClick={() => void resume(env)}>
        <strong>{env.name}</strong>
        <span>
          {nameOf(env.projectId)}, {when(env.lastOpenedAt)}
        </span>
      </button>
      {removable && (
        <IconButton
          icon="trash"
          label={`Apagar ${env.name}`}
          onClick={() => {
            if (!window.confirm(`Apagar o ambiente ${env.name}? O projeto e as conversas continuam.`)) return
            void guard(async () => {
              await ide.deleteEnvironment(env.id)
              onDeleted(env.id)
            })
          }}
        />
      )}
    </div>
  )

  return (
    <div className="home">
      <div className="home-inner">
        {step.name === 'menu' && (
          <>
            <div className="home-head">
              <h1>O que vamos fazer?</h1>
            </div>
            {last && (
              <button type="button" className="home-action home-resume" onClick={() => void resume(last)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {ACTION_ICONS.resume}
                </svg>
                <span>
                  Retomar
                  <small>
                    {last.name} · {nameOf(last.projectId)} · {last.sessions.length} {last.sessions.length === 1 ? 'sessão' : 'sessões'} · {when(last.lastOpenedAt)}
                    {lastAttention > 0 && <em> · ! {lastAttention} {lastAttention === 1 ? 'pede' : 'pedem'} atenção</em>}
                  </small>
                </span>
              </button>
            )}
            <div className="home-actions">
              <Action icon="session" label="Criar sessão" onClick={() => setStep({ name: 'project', intent: 'session' })} />
              <Action icon="history" label="Carregar sessão" onClick={() => setStep({ name: 'project', intent: 'history' })} />
              <Action icon="environment" label="Criar ambiente" onClick={() => setStep({ name: 'project', intent: 'environment' })} />
              <Action icon="load" label="Histórico de ambientes" onClick={() => setStep({ name: 'environments' })} />
            </div>
            {recent.length > 0 && (
              <>
                <h2>Abertos recentemente</h2>
                {recent.map((env) => environmentRow(env, false))}
              </>
            )}
          </>
        )}

        {step.name === 'project' && (
          <>
            {head(INTENT_TITLE[step.intent], { name: 'menu' })}
            <form
              className="home-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void guard(async () => {
                  // Cancelar o seletor de pasta mantém o nome digitado.
                  const project = await ide.createProject(newName)
                  if (!project) return
                  setNewName('')
                  await projectChosen(project, step.intent)
                })
              }}
            >
              <input aria-label="Nome do novo projeto" placeholder="Nome do novo projeto" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="submit" className="primary">
                Criar projeto
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  void guard(async () => {
                    const project = await ide.addExistingProject()
                    if (project) await projectChosen(project, step.intent)
                  })
                }
              >
                Adicionar pasta existente
              </button>
            </form>
            {projects.length > 0 && <h2>Seus projetos</h2>}
            {projects.map((project) => (
              <div key={project.id} className="home-row">
                <button type="button" onClick={() => void projectChosen(project, step.intent)}>
                  <strong>{project.name}</strong>
                  <span>{project.path}</span>
                </button>
                <IconButton
                  icon="close"
                  label={`Tirar ${project.name} da lista`}
                  onClick={() => {
                    if (!window.confirm(`Tirar ${project.name} da lista? A pasta e os arquivos não são apagados.`)) return
                    void guard(async () => {
                      await ide.removeProject(project.id)
                      refreshProjects()
                    })
                  }}
                />
              </div>
            ))}
          </>
        )}

        {step.name === 'history' && (
          <>
            {head(step.project.name, { name: 'project', intent: 'history' })}
            {history === null && <p className="home-note">Lendo o histórico…</p>}
            {history?.length === 0 && (
              <p className="home-note">Nenhuma conversa do Claude Code neste projeto ainda.</p>
            )}
            {history && history.length > 0 && (
              <>
                <div className="home-buttons">
                  <button type="button" className="primary" onClick={() => void restore(step.project, history[0]!)}>
                    Restaurar última
                  </button>
                </div>
                <h2>Histórico</h2>
                {history.map((entry) => (
                  <div key={entry.sessionId} className="home-row">
                    <button type="button" onClick={() => void restore(step.project, entry)}>
                      <strong>{entry.title}</strong>
                      <span>
                        {when(entry.updatedAt)}, {entry.messages} {entry.messages === 1 ? 'mensagem' : 'mensagens'}
                      </span>
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {step.name === 'template' && (
          <>
            {head(`Novo ambiente em ${step.project.name}`, { name: 'project', intent: 'environment' })}
            <div className="home-buttons">
              <button type="button" className="primary" onClick={() => void guard(async () => open(await ide.createEnvironment({ projectId: step.project.id })))}>
                Novo
              </button>
            </div>
            <h2>A partir de um ambiente salvo</h2>
            {saved.map((env) => (
              <div key={env.id} className="home-row">
                <button
                  type="button"
                  onClick={() =>
                    void guard(async () =>
                      open(await ide.createEnvironment({ projectId: step.project.id, fromEnvironmentId: env.id }))
                    )
                  }
                >
                  <strong>{env.name}</strong>
                  <span>Copia o layout e os painéis, sem as conversas</span>
                </button>
              </div>
            ))}
          </>
        )}

        {step.name === 'environments' && (
          <>
            {head('Histórico de ambientes', { name: 'menu' })}
            <div className="home-form">
              <input
                type="search"
                autoFocus
                aria-label="Buscar ambiente"
                placeholder="Buscar por ambiente, projeto ou sessão"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="button" className="ghost" onClick={() => setStep({ name: 'project', intent: 'import' })}>
                Importar de um arquivo
              </button>
            </div>
            {environments.length === 0 && <p className="home-note">Nenhum ambiente ainda.</p>}
            {environments.length > 0 && found.length === 0 && <p className="home-note">Nada encontrado para "{search.trim()}".</p>}
            {found.map((env) => historyRow(env))}
          </>
        )}
      </div>
    </div>
  )
}
