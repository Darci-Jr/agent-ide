import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Environment } from '../shared/types'
import { worktreeSlug } from '../shared/worktreeName'
import { listHistory } from './history'
import { templateLayout } from './exchange'
import { EnvironmentStore } from './store'
import { validateProjectName, Workspace } from './workspace'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const env = (over: Partial<Environment> = {}): Environment => ({
  id: 'aaaaaaaa-1111',
  name: 'Sem título',
  projectId: 'p1',
  lastOpenedAt: 1,
  cwd: dir,
  sessions: [],
  layout: null,
  ...over
})

describe('nome da worktree', () => {
  it('vira um nome seguro para branch e pasta', () => {
    expect(worktreeSlug('Corrigir Login')).toBe('corrigir-login')
    expect(worktreeSlug('  Ação: ../../fora  ')).toBe('acao-fora')
    expect(worktreeSlug('con')).toBe('con-worktree')
    expect(worktreeSlug('???')).toBe('')
    expect(worktreeSlug('a'.repeat(80))).toHaveLength(50)
  })
})

describe('restauração', () => {
  const session = { id: 's1', adapterId: 'claude', title: 'S', cwd: 'x', started: true, shouldRun: true }

  it('quem trabalhava ao encerrar pede atenção; quem estava ocioso, não', () => {
    const root = join(dir, 'trabalho')
    const pointer = join(dir, 'config.json')
    new Workspace(pointer).choose(root)
    const store = new EnvironmentStore(root)
    store.add(env({ sessions: [{ ...session, working: true }, { ...session, id: 's2', working: false }] }))
    const [working, idle] = new EnvironmentStore(root).all()[0]!.sessions
    expect(working).toMatchObject({ interrupted: true, working: false, shouldRun: true })
    expect(idle?.interrupted).toBeUndefined()
  })

  it('lembra as abas e aguenta um arquivo danificado', () => {
    const root = join(dir, 'trabalho')
    const workspace = new Workspace(join(dir, 'config.json'))
    workspace.choose(root)
    expect(workspace.tabs()).toEqual({ openIds: [], activeId: null })
    workspace.saveTabs({ openIds: ['a', 'b'], activeId: 'b' })
    expect(workspace.tabs()).toEqual({ openIds: ['a', 'b'], activeId: 'b' })
    writeFileSync(join(root, 'abas.json'), '{quebrado')
    expect(workspace.tabs()).toEqual({ openIds: [], activeId: null })
  })

  it('o painel de alterações não leva a pasta da máquina para o template', () => {
    const layout = { panels: { d: { id: 'd', contentComponent: 'diff', title: 'Alterações · main', params: { kind: 'diff', cwd: 'C:\\Users\\alguem\\repo' } } } }
    const clean = templateLayout(env({ sessions: [] }), layout) as any
    expect(JSON.stringify(clean)).not.toContain('alguem')
    expect(clean.panels.d.params).toEqual({ kind: 'diff', cwd: null })
  })
})

describe('Workspace', () => {
  it('lembra a pasta escolhida e cria a estrutura', () => {
    const pointer = join(dir, 'config.json')
    const root = join(dir, 'trabalho')
    mkdirSync(root)
    new Workspace(pointer).choose(root)
    expect(readdirSync(root).sort()).toEqual(['Ambientes'])
    expect(new Workspace(pointer).dir).toBe(root)
  })

  it('pede de novo a pasta quando ela foi removida', () => {
    const pointer = join(dir, 'config.json')
    const root = join(dir, 'trabalho')
    mkdirSync(root)
    new Workspace(pointer).choose(root)
    rmSync(root, { recursive: true })
    expect(new Workspace(pointer).dir).toBeNull()
  })

  it('cria o projeto onde a pessoa escolheu, fora da pasta de trabalho, e lembra o lugar', () => {
    const pointer = join(dir, 'config.json')
    const ws = new Workspace(pointer)
    ws.choose(join(dir, 'trabalho'))
    const parent = join(dir, 'codigo')
    mkdirSync(parent)
    const project = ws.createProject(parent, 'Minha loja')
    expect(project.path).toBe(join(parent, 'Minha loja'))
    expect(existsSync(project.path)).toBe(true)
    expect(() => ws.createProject(parent, 'Minha loja')).toThrow('Já existe')
    expect(new Workspace(pointer).lastProjectParent).toBe(parent)
    expect(new Workspace(pointer).dir).toBe(join(dir, 'trabalho'))
  })

  it('recusa nomes que escapariam da pasta ou são inválidos', () => {
    for (const bad of ['', '  ', '..', '../fora', 'a/b', 'a\\b', 'con', 'nome.']) {
      expect(() => validateProjectName(bad), bad).toThrow()
    }
    expect(validateProjectName(' Loja 2 ')).toBe('Loja 2')
  })

  it('não duplica uma pasta existente, e remover não apaga os arquivos', () => {
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    const ws = new Workspace(join(dir, 'config.json'))
    ws.choose(dir)
    const first = ws.addExisting(repo)
    expect(ws.addExisting(repo).id).toBe(first.id)
    ws.remove(first.id)
    expect(ws.projects()).toEqual([])
    expect(existsSync(repo)).toBe(true)
  })
})

describe('EnvironmentStore', () => {
  const prepare = (): void => {
    mkdirSync(join(dir, 'Ambientes'))
    mkdirSync(join(dir, 'Temporarios'))
  }

  it('apaga os temporários de versões anteriores e mantém os ambientes', () => {
    prepare()
    writeFileSync(join(dir, 'Temporarios', 'sem-titulo-1.json'), JSON.stringify(env({ id: 'rascunho', draft: true })))
    writeFileSync(join(dir, 'Ambientes', 'velho-2.json'), JSON.stringify(env({ id: 'velho', draft: true })))
    writeFileSync(join(dir, 'Ambientes', 'loja-3.json'), JSON.stringify(env({ id: 'loja', name: 'Loja', draft: false })))
    const store = new EnvironmentStore(dir)
    expect(store.all().map((e) => e.id)).toEqual(['loja'])
    expect(store.all()[0]!.draft).toBeUndefined()
    expect(existsSync(join(dir, 'Temporarios'))).toBe(false)
    expect(readdirSync(join(dir, 'Ambientes'))).toEqual(['loja-3.json'])
  })

  it('recarrega do disco, e um arquivo danificado não atrapalha os outros', () => {
    prepare()
    new EnvironmentStore(dir).add(env({ name: 'Loja' }))
    writeFileSync(join(dir, 'Ambientes', 'ruim.json'), '{ quebrado')
    const reloaded = new EnvironmentStore(dir)
    expect(reloaded.all().map((e) => e.name)).toEqual(['Loja'])
    reloaded.remove('aaaaaaaa-1111')
    expect(readdirSync(join(dir, 'Ambientes'))).toEqual(['ruim.json'])
  })
})

describe('listHistory', () => {
  const line = (o: object): string => JSON.stringify(o)
  const transcript = (root: string, folder: string, id: string, lines: string[]): void => {
    mkdirSync(join(root, folder), { recursive: true })
    writeFileSync(join(root, folder, `${id}.jsonl`), lines.join('\n') + '\n')
  }
  const user = (cwd: string): string => line({ type: 'user', cwd, message: {} })

  it('lista só o projeto e suas worktrees, com título e sem conversas vazias', async () => {
    const root = join(dir, 'claude')
    const project = 'C:\\w\\loja'
    transcript(root, 'C--w-loja', 'a', [user(project), line({ type: 'ai-title', aiTitle: 'Login social' })])
    transcript(root, 'C--w-loja', 'vazia', [line({ type: 'permission-mode', cwd: project })])
    transcript(root, 'C--w-loja-worktrees-abc', 'b', [user('C:\\w\\loja.worktrees\\abc'), line({ type: 'last-prompt', lastPrompt: 'corrija o bug' })])
    transcript(root, 'C--w-loja2', 'c', [user('C:\\w\\loja2')])
    if (process.platform !== 'win32') return
    const entries = await listHistory(project, root)
    expect(entries.map((e) => e.title).sort()).toEqual(['Login social', 'corrija o bug'])
  })

  it('não confunde pastas de nome igual em projetos diferentes', async () => {
    if (process.platform !== 'win32') return
    const root = join(dir, 'claude')
    // "a-b" e "a b" geram o mesmo nome de pasta; só o cwd distingue.
    transcript(root, 'C--w-a-b', 'x', [user('C:\\w\\a b')])
    expect(await listHistory('C:\\w\\a-b', root)).toEqual([])
    expect(await listHistory('C:\\w\\a b', root)).toHaveLength(1)
  })

  it('devolve lista vazia quando o Claude nunca foi usado', async () => {
    expect(await listHistory('C:\\w\\x', join(dir, 'nao-existe'))).toEqual([])
  })
})
