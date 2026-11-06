import { useEffect, useState, type ReactNode } from 'react'
import { MAX_SESSIONS_PER_PROJECT, type Environment, type Project, type SessionGroup, type Template } from '../../shared/types'
import { IconButton } from './icons'
import { errorMessage, ide } from './ide'

interface Row {
  checked: boolean
  claude: number
  terminals: number
}

/** Pasta nova: vira um projeto vazio quando o ambiente ou o template é criado. */
interface NewFolder {
  key: number
  name: string
  parent: string
  claude: number
  terminals: number
}

const clamp = (n: number): number => Math.max(0, Math.min(MAX_SESSIONS_PER_PROJECT, Math.floor(n) || 0))

/** As quantidades de um template, por projeto. */
export function templateGroups(template: Template): SessionGroup[] {
  const groups: SessionGroup[] = []
  for (const s of template.slots) {
    let g = groups.find((x) => x.projectId === s.projectId)
    if (!g) groups.push((g = { projectId: s.projectId, claude: 0, terminals: 0 }))
    if (s.adapterId === 'shell') g.terminals++
    else g.claude++
  }
  return groups
}

function Counts(props: { label: string; claude: number; terminals: number; disabled?: boolean; onChange(claude: number, terminals: number): void }): ReactNode {
  return (
    <>
      <input
        type="number"
        min={0}
        max={MAX_SESSIONS_PER_PROJECT}
        aria-label={`Sessões do Claude em ${props.label}`}
        disabled={props.disabled}
        value={props.claude}
        onChange={(e) => props.onChange(clamp(Number(e.target.value)), props.terminals)}
      />
      <input
        type="number"
        min={0}
        max={MAX_SESSIONS_PER_PROJECT}
        aria-label={`Terminais em ${props.label}`}
        disabled={props.disabled}
        value={props.terminals}
        onChange={(e) => props.onChange(props.claude, clamp(Number(e.target.value)))}
      />
    </>
  )
}

/**
 * Monta um ambiente ou um template: projetos marcados, quantas sessões do Claude e quantos
 * terminais em cada, e pastas novas, cada uma com nome e local próprios.
 */
export function NewEnvironment(props: {
  /** `template`: editando ou criando um template; não abre ambiente. */
  mode: 'environment' | 'template'
  /** Template de partida (ambiente) ou em edição (template). */
  template: Template | null
  templates: Template[]
  onOpen(env: Environment): void
  onSaved(template: Template): void
  toast(message: string): void
}): ReactNode {
  const [projects, setProjects] = useState<Project[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [folders, setFolders] = useState<NewFolder[]>([])
  const [templateId, setTemplateId] = useState(props.template?.id ?? '')
  const [templateName, setTemplateName] = useState(props.mode === 'template' ? (props.template?.name ?? '') : '')
  const [naming, setNaming] = useState(props.mode === 'template')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void ide.listProjects().then(setProjects)
  }, [])

  // Um template preenche as quantidades; trocar de template recomeça a escolha.
  useEffect(() => {
    const template = props.templates.find((t) => t.id === templateId) ?? (props.mode === 'template' ? props.template : null)
    if (!template) return
    const next: Record<string, Row> = {}
    for (const g of templateGroups(template)) next[g.projectId] = { checked: true, claude: g.claude, terminals: g.terminals }
    setRows(next)
  }, [templateId, props.templates, props.template, props.mode])

  const rowOf = (id: string): Row => rows[id] ?? { checked: false, claude: 1, terminals: 0 }
  const setRow = (id: string, patch: Partial<Row>): void => setRows((all) => ({ ...all, [id]: { ...rowOf(id), ...patch } }))

  const addExisting = async (): Promise<void> => {
    try {
      const project = await ide.addExistingProject()
      if (!project) return
      setProjects(await ide.listProjects())
      setRow(project.id, { checked: true })
    } catch (err) {
      props.toast(errorMessage(err))
    }
  }

  // Cada pasta nova pede primeiro o local; o nome é digitado na linha.
  const addFolder = async (): Promise<void> => {
    const parent = await ide.pickProjectParent()
    if (!parent) return
    setFolders((list) => [...list, { key: Date.now(), name: '', parent, claude: 1, terminals: 0 }])
  }

  const changeFolder = (key: number, patch: Partial<NewFolder>): void =>
    setFolders((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const moveFolder = async (key: number): Promise<void> => {
    const parent = await ide.pickProjectParent()
    if (parent) changeFolder(key, { parent })
  }

  const chosen = projects.filter((p) => rowOf(p.id).checked)
  const total = chosen.reduce((n, p) => n + rowOf(p.id).claude + rowOf(p.id).terminals, 0) + folders.reduce((n, f) => n + f.claude + f.terminals, 0)
  const ready = total > 0 && folders.every((f) => f.name.trim())

  /** Cria as pastas novas como projetos e devolve os grupos na ordem da tela. */
  const groups = async (): Promise<SessionGroup[]> => {
    const list: SessionGroup[] = chosen.map((p) => ({ projectId: p.id, claude: rowOf(p.id).claude, terminals: rowOf(p.id).terminals }))
    for (const f of folders) {
      const project = await ide.createProject(f.name, f.parent)
      if (!project) throw new Error(`A pasta ${f.name} não foi criada.`)
      list.push({ projectId: project.id, claude: f.claude, terminals: f.terminals })
      // Criada: sai das pastas novas e entra na lista, para não ser criada de novo num erro seguinte.
      setFolders((all) => all.filter((x) => x.key !== f.key))
      setRows((all) => ({ ...all, [project.id]: { checked: true, claude: f.claude, terminals: f.terminals } }))
    }
    if (folders.length > 0) setProjects(await ide.listProjects())
    return list.filter((g) => g.claude + g.terminals > 0)
  }

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
    } catch (err) {
      props.toast(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const open = (): Promise<void> => run(async () => props.onOpen(await ide.newEnvironment({ groups: await groups(), templateId: templateId || undefined })))

  /** Um clique no template abre o ambiente com as sessões e o layout dele, sem passar pela tabela. */
  const openTemplate = (t: Template): Promise<void> => run(async () => props.onOpen(await ide.newEnvironment({ groups: templateGroups(t), templateId: t.id })))

  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
  const summary = (t: Template): string =>
    templateGroups(t)
      .map((g) => {
        const parts = [g.claude > 0 && plural(g.claude, 'sessão', 'sessões'), g.terminals > 0 && plural(g.terminals, 'terminal', 'terminais')].filter(Boolean)
        return `${projects.find((p) => p.id === g.projectId)?.name ?? 'Projeto removido'} (${parts.join(', ')})`
      })
      .join(' · ')

  const saveTemplate = (): Promise<void> =>
    run(async () => {
      const editing = props.mode === 'template' ? props.template?.id : undefined
      props.onSaved(await ide.saveTemplate({ name: templateName, groups: await groups() }, editing))
    })

  return (
    <div className="new-env">
      {props.mode === 'environment' && props.templates.length > 0 && (
        <section aria-label="A partir de um template">
          <h2>A partir de um template</h2>
          {props.templates.map((t) => (
            <div key={t.id} className={`home-row ${t.id === templateId ? 'on' : ''}`}>
              <button type="button" disabled={busy} data-tip="Abre o ambiente com este template" onClick={() => void openTemplate(t)}>
                <strong>{t.name}</strong>
                <span>{summary(t)}</span>
              </button>
              <IconButton icon="settings" label={`Ajustar ${t.name} antes de abrir`} onClick={() => setTemplateId(t.id)} />
            </div>
          ))}
          <h2>{templateId ? `Ajustando ${props.templates.find((t) => t.id === templateId)?.name ?? ''}` : 'Ou monte do zero'}</h2>
        </section>
      )}

      <div className="new-env-table" role="group" aria-label="Projetos do ambiente">
        <div className="new-env-head">
          <span>Projetos</span>
          <span>Claude</span>
          <span>Terminais</span>
          <span />
        </div>
        {projects.map((p) => {
          const row = rowOf(p.id)
          return (
            <div key={p.id} className={`new-env-row ${row.checked ? 'on' : ''}`}>
              <label className="new-env-name" data-tip={p.path}>
                <input type="checkbox" checked={row.checked} onChange={(e) => setRow(p.id, { checked: e.target.checked })} />
                {p.name}
              </label>
              <Counts label={p.name} claude={row.claude} terminals={row.terminals} disabled={!row.checked} onChange={(claude, terminals) => setRow(p.id, { claude, terminals })} />
              <span />
            </div>
          )
        })}
        {folders.map((f) => (
          <div key={f.key} className="new-env-row on new-folder">
            <div className="new-env-name">
              <input type="text" autoFocus aria-label="Nome da pasta nova" placeholder="Nome da pasta nova" value={f.name} onChange={(e) => changeFolder(f.key, { name: e.target.value })} />
              <button type="button" className="new-env-where" data-tip="Trocar o local" onClick={() => void moveFolder(f.key)}>
                em {f.parent}
              </button>
            </div>
            <Counts label={f.name || 'pasta nova'} claude={f.claude} terminals={f.terminals} onChange={(claude, terminals) => changeFolder(f.key, { claude, terminals })} />
            <IconButton icon="close" label={`Remover ${f.name || 'pasta nova'}`} onClick={() => setFolders((list) => list.filter((x) => x.key !== f.key))} />
          </div>
        ))}
      </div>

      <div className="home-buttons">
        <button type="button" className="ghost" onClick={() => void addFolder()}>
          + Pasta nova
        </button>
        <button type="button" className="ghost" onClick={() => void addExisting()}>
          Adicionar pasta existente
        </button>
      </div>

      <div className="new-env-actions">
        {naming ? (
          <>
            <input type="text" aria-label="Nome do template" placeholder="Nome do template" value={templateName} autoFocus={props.mode === 'environment'} onChange={(e) => setTemplateName(e.target.value)} />
            <button type="button" className={props.mode === 'template' ? 'primary' : 'ghost'} disabled={busy || !ready || !templateName.trim()} onClick={() => void saveTemplate()}>
              Salvar template
            </button>
          </>
        ) : (
          <button type="button" className="ghost" disabled={busy || !ready} onClick={() => setNaming(true)}>
            Salvar como template
          </button>
        )}
        {props.mode === 'environment' && (
          <button type="button" className="primary" disabled={busy || !ready} onClick={() => void open()}>
            Abrir
          </button>
        )}
      </div>
    </div>
  )
}
