import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Environment } from '../shared/types'
import { listHistory } from './history'
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
  draft: true,
  lastOpenedAt: 1,
  cwd: dir,
  template: 'multi',
  sessions: [],
  layout: null,
  ...over
})

describe('Workspace', () => {
  it('lembra a pasta escolhida e cria a estrutura', () => {
    const pointer = join(dir, 'config.json')
    const root = join(dir, 'trabalho')
    mkdirSync(root)
    new Workspace(pointer).choose(root)
    expect(readdirSync(root).sort()).toEqual(['Ambientes', 'Projetos', 'Temporarios'])
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

  it('cria um projeto novo dentro de Projetos, sem perguntar onde', () => {
    const ws = new Workspace(join(dir, 'config.json'))
    ws.choose(dir)
    const project = ws.createManaged('Minha loja')
    expect(project.path).toBe(join(dir, 'Projetos', 'Minha loja'))
    expect(existsSync(project.path)).toBe(true)
    expect(() => ws.createManaged('Minha loja')).toThrow('Já existe')
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

  it('move o arquivo de Temporarios para Ambientes ao salvar', () => {
    prepare()
    const store = new EnvironmentStore(dir)
    const draft = env()
    store.add(draft)
    expect(readdirSync(join(dir, 'Temporarios'))).toHaveLength(1)
    draft.draft = false
    draft.name = 'Loja'
    store.flush()
    expect(readdirSync(join(dir, 'Temporarios'))).toEqual([])
    expect(readdirSync(join(dir, 'Ambientes'))).toEqual(['loja-aaaaaaaa.json'])
  })

  it('recarrega do disco, e um arquivo danificado não atrapalha os outros', () => {
    prepare()
    new EnvironmentStore(dir).add(env({ draft: false, name: 'Loja' }))
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
