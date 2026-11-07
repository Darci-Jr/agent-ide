import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Environment, HistoryEntry, Project, Template } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'
import { NewEnvironment, templateGroups } from './NewEnvironment'

type Intent = 'session' | 'history'
export type HomeStep =
  | { name: 'menu' }
  | { name: 'environments' }
  | { name: 'project'; intent: Intent }
  | { name: 'history'; project: Project }
  | { name: 'new'; template: Template | null }
  | { name: 'templates' }
  | { name: 'edit-template'; template: Template | null }

const INTENT_TITLE: Record<Intent, string> = {
  session: 'Criar sessão em qual projeto?',
  history: 'Carregar sessão de qual projeto?'
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const ACTION_ICONS: Record<string, ReactNode> = {
  session: <path d="M4 5l6 6-6 6M13 18h7" />,
  resume: <path d="M4 12a8 8 0 1 0 3-6L4 9M4 4v5h5" />,
  history: <path d="M4 12a8 8 0 1 0 3-6L4 9M4 4v5h5M12 8v4l3 2" />,
  environment: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 14v6M13.5 17h6" />,
  load: <path d="M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5L12 16l2.5-2.5" />,
  template: <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5" />
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
  /** Leva à aba do ambiente, se ele estiver aberto. */
  showOpenEnvironment(environmentId: string): boolean
  onDeleted(id: string): void
  toast(message: string): void
  /** Ambientes com aba aberta: no histórico aparecem como abertos. */
  openIds: string[]
  /** Abre direto em um passo, como o + da barra de abas, que começa no novo ambiente. */
  start?: HomeStep
}): ReactNode {
  const { environments, onOpen, onResume, showOpenEnvironment, onDeleted, toast } = props
  const [step, setStep] = useState<HomeStep>(props.start ?? { name: 'menu' })
  const [search, setSearch] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [newName, setNewName] = useState('')
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)

  const refreshProjects = useCallback(() => void ide.listProjects().then(setProjects), [])
  const refreshTemplates = useCallback(() => void ide.listTemplates().then(setTemplates), [])
  useEffect(refreshProjects, [refreshProjects, step])
  useEffect(refreshTemplates, [refreshTemplates, step])

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
      // A conversa já está numa sessão: leva a ela em vez de rodá-la duas vezes.
      const holder = entry.holder && environments.find((env) => env.id === entry.holder?.environmentId)
      if (holder && showOpenEnvironment(holder.id)) {
        setStep({ name: 'menu' })
        return
      }
      // Num ambiente fechado: reabre esse, sem criar outro.
      if (holder && entry.holder) {
        await ide.startSession(holder.id, entry.holder.sessionId)
        await resume(holder)
        return
      }
      open(await ide.openFromHistory(project.id, entry))
    })

  const projectChosen = (project: Project, intent: Intent): Promise<void> =>
    guard(async () => {
      if (intent === 'session') {
        open(await ide.createEnvironment({ projectId: project.id }))
      } else {
        setHistory(null)
        setStep({ name: 'history', project })
        setHistory(await ide.listHistory(project.id))
      }
    })

  const nameOf = (id: string): string => projects.find((p) => p.id === id)?.name ?? 'Projeto removido'
  /** Projetos de um ambiente: o principal e os das sessões. */
  const projectsOf = (env: Environment): string => [...new Set([env.projectId, ...env.sessions.map((s) => s.projectId ?? env.projectId)])].map(nameOf).join(', ')
  const [last, ...others] = [...environments].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const recent = others.slice(0, 5)
  const lastAttention = last?.sessions.filter((s) => s.interrupted).length ?? 0

  const head = (title: string, back: HomeStep): ReactNode => (
    <div className="home-head">
      <IconButton icon="back" label="Voltar" onClick={() => setStep(back)} />
      <h1>{title}</h1>
    </div>
  )

  // Histórico: abertos e fechados, do mais recente para o mais antigo. Reabrir retoma as sessões.
  const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const lastSeen = (env: Environment): number => (props.openIds.includes(env.id) ? Date.now() : Math.max(env.closedAt ?? 0, env.lastOpenedAt))
  const terms = fold(search).split(/\s+/).filter(Boolean)
  const found = [...environments]
    .filter((env) => {
      const haystack = fold([env.name, projectsOf(env), ...env.sessions.map((s) => s.title)].join(' '))
      return terms.every((t) => haystack.includes(t))
    })
    .sort((a, b) => lastSeen(b) - lastSeen(a))

  const removeEnvironment = (env: Environment): void => {
    if (!window.confirm(`Apagar o ambiente ${env.name}? Os projetos e as conversas continuam.`)) return
    void guard(async () => {
      await ide.deleteEnvironment(env.id)
      onDeleted(env.id)
    })
  }

  const historyRow = (env: Environment): ReactNode => {
    const isOpen = props.openIds.includes(env.id)
    return (
      <div key={env.id} className="home-row">
        <button type="button" onClick={() => void resume(env)}>
          <strong>
            {env.name}
            {isOpen && <em className="home-tag">aberto</em>}
          </strong>
          <span>
            {projectsOf(env)} · {plural(env.sessions.length, 'sessão', 'sessões')} · {isOpen ? 'aberto agora' : `fechado em ${when(env.closedAt ?? env.lastOpenedAt)}`}
          </span>
        </button>
        <IconButton icon="trash" label={`Apagar ${env.name}`} onClick={() => removeEnvironment(env)} />
      </div>
    )
  }

  const environmentRow = (env: Environment): ReactNode => (
    <div key={env.id} className="home-row">
      <button type="button" onClick={() => void resume(env)}>
        <strong>{env.name}</strong>
        <span>
          {projectsOf(env)}, {when(env.lastOpenedAt)}
        </span>
      </button>
    </div>
  )

  const templateSummary = (t: Template): string =>
    templateGroups(t)
      .map((g) => {
        const parts = [g.claude > 0 && plural(g.claude, 'sessão', 'sessões'), g.terminals > 0 && plural(g.terminals, 'terminal', 'terminais')].filter(Boolean)
        return `${nameOf(g.projectId)} (${parts.join(', ')})`
      })
      .join(' · ')

  const templateRow = (t: Template): ReactNode => (
    <div key={t.id} className="home-row">
      <button
        type="button"
        data-tip="Abre um ambiente novo com este template"
        onClick={() => void guard(async () => open(await ide.newEnvironment({ groups: templateGroups(t), templateId: t.id })))}
      >
        <strong>{t.name}</strong>
        <span>{templateSummary(t)}</span>
      </button>
      <IconButton icon="pencil" label={`Editar ${t.name}`} onClick={() => setStep({ name: 'edit-template', template: t })} />
      <IconButton icon="upload" label={`Exportar ${t.name}`} onClick={() => void guard(async () => void (await ide.exportTemplate(t.id)))} />
      <IconButton
        icon="trash"
        label={`Apagar ${t.name}`}
        onClick={() => {
          if (!window.confirm(`Apagar o template ${t.name}? Os ambientes criados com ele continuam.`)) return
          void guard(async () => {
            await ide.deleteTemplate(t.id)
            refreshTemplates()
          })
        }}
      />
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
                    {last.name} · {projectsOf(last)} · {plural(last.sessions.length, 'sessão', 'sessões')} · {when(last.lastOpenedAt)}
                    {lastAttention > 0 && <em> · ! {lastAttention} {lastAttention === 1 ? 'pede' : 'pedem'} atenção</em>}
                  </small>
                </span>
              </button>
            )}
            <div className="home-actions">
              <Action icon="session" label="Criar sessão" onClick={() => setStep({ name: 'project', intent: 'session' })} />
              <Action icon="history" label="Carregar sessão" onClick={() => setStep({ name: 'project', intent: 'history' })} />
              <Action icon="environment" label="Criar ambiente" onClick={() => setStep({ name: 'new', template: null })} />
              <Action icon="load" label="Histórico de ambientes" onClick={() => setStep({ name: 'environments' })} />
              <Action icon="template" label="Templates" onClick={() => setStep({ name: 'templates' })} />
            </div>
            {recent.length > 0 && (
              <>
                <h2>Abertos recentemente</h2>
                {recent.map((env) => environmentRow(env))}
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
            {history?.length === 0 && <p className="home-note">Nenhuma conversa do Claude Code neste projeto ainda.</p>}
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
                        {when(entry.updatedAt)}, {plural(entry.messages, 'mensagem', 'mensagens')}
                      </span>
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {step.name === 'new' && (
          <>
            {head('Novo ambiente', { name: 'menu' })}
            <NewEnvironment mode="environment" template={step.template} templates={templates} onOpen={open} onSaved={() => setStep({ name: 'templates' })} toast={toast} />
          </>
        )}

        {step.name === 'edit-template' && (
          <>
            {head(step.template ? `Editar ${step.template.name}` : 'Novo template', { name: 'templates' })}
            <NewEnvironment mode="template" template={step.template} templates={templates} onOpen={open} onSaved={() => setStep({ name: 'templates' })} toast={toast} />
          </>
        )}

        {step.name === 'templates' && (
          <>
            {head('Templates', { name: 'menu' })}
            <p className="home-note">Moldes de ambiente: projetos, quantas sessões e terminais e o layout. Abrir um cria um ambiente novo.</p>
            <div className="home-buttons">
              <button type="button" className="primary" onClick={() => setStep({ name: 'edit-template', template: null })}>
                Novo template
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  void guard(async () => {
                    if (await ide.importTemplate()) refreshTemplates()
                  })
                }
              >
                Importar de um arquivo
              </button>
            </div>
            {templates.length === 0 && <p className="home-note">Nenhum template ainda.</p>}
            {templates.map(templateRow)}
          </>
        )}

        {step.name === 'environments' && (
          <>
            {head('Histórico de ambientes', { name: 'menu' })}
            <div className="home-form">
              <input type="search" autoFocus aria-label="Buscar ambiente" placeholder="Buscar por ambiente, projeto ou sessão" value={search} onChange={(e) => setSearch(e.target.value)} />
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
