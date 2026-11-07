import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Environment } from '../shared/types'
import { childEnv } from './childEnv'
import { conversationHolders, setConversation } from './store'
import { denyRead, getProtection, isSensitive, listConfigFiles, listTree, readProjectFile, writeProjectFile } from './files'
import { cleanGroups, exportTemplate, groupsOf, instantiate, parseTemplateFile, sameGroups, slotsFromGroups, templateFromEnvironment } from './templates'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ide-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('childEnv', () => {
  it('remove marcadores herdados e mantém a configuração do usuário', () => {
    const env = childEnv({ CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', PATH: 'x' })
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.PATH).toBe('x')
  })
})

describe('arquivos', () => {
  it('reconhece arquivos sensíveis, mas não modelos de exemplo', () => {
    expect(isSensitive('.env')).toBe(true)
    expect(isSensitive('apps/web/.env.local')).toBe(true)
    expect(isSensitive('config/client_secret.json')).toBe(true)
    expect(isSensitive('.env.example')).toBe(false)
    expect(isSensitive('src/index.ts')).toBe(false)
  })

  it('a árvore inclui .env e pula node_modules', async () => {
    await mkdir(join(dir, 'node_modules', 'x'), { recursive: true })
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'a.ts'), '')
    await writeFile(join(dir, '.env'), 'A=1')
    const paths = (await listTree(dir)).map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(['.env', 'src', 'src/a.ts']))
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false)
  })

  it('lista .env entre os arquivos de configuração', async () => {
    await writeFile(join(dir, '.env.local'), 'A=1')
    expect((await listConfigFiles(dir)).map((f) => f.path)).toContain('.env.local')
  })

  it('recusa caminhos fora do projeto', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'fora-'))
    await writeFile(join(outside, 'x'), 'segredo')
    await expect(readProjectFile(dir, join(outside, 'x'))).rejects.toThrow('fora do projeto')
    await expect(writeProjectFile(dir, join(outside, 'x'), 'y', null)).rejects.toThrow('fora do projeto')
    expect(await readFile(join(outside, 'x'), 'utf8')).toBe('segredo')
    await rm(outside, { recursive: true })
  })

  it('avisa sobre conflito sem sobrescrever, e sobrescreve quando autorizado', async () => {
    const file = join(dir, 'a.txt')
    await writeFile(file, 'original')
    const { mtimeMs } = await readProjectFile(dir, 'a.txt')
    await writeFile(file, 'do agente')
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    expect((await writeProjectFile(dir, 'a.txt', 'meu', mtimeMs)).status).toBe('conflict')
    expect(await readFile(file, 'utf8')).toBe('do agente')
    expect((await writeProjectFile(dir, 'a.txt', 'meu', null)).status).toBe('saved')
    expect(await readFile(file, 'utf8')).toBe('meu')
  })

  it('não deixa arquivos temporários ao salvar', async () => {
    await writeFile(join(dir, '.env'), 'A=1')
    await writeProjectFile(dir, '.env', 'A=2', null)
    expect(await readdir(dir)).toEqual(['.env'])
  })

  it('cria a regra de deny preservando o resto e sem duplicar', async () => {
    await writeFile(join(dir, '.env'), 'A=1')
    await mkdir(join(dir, '.claude'))
    const file = join(dir, '.claude', 'settings.local.json')
    await writeFile(file, JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls)'] } }))
    expect((await getProtection(dir, '.env')).denied).toBe(false)
    await denyRead(dir, '.env')
    await denyRead(dir, '.env')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      model: 'x',
      permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }
    })
    expect((await getProtection(dir, '.env')).denied).toBe(true)
  })

  it('não destrói um settings com JSON inválido', async () => {
    await mkdir(join(dir, '.claude'))
    const file = join(dir, '.claude', 'settings.local.json')
    await writeFile(file, '{ quebrado')
    await expect(denyRead(dir, '.env')).rejects.toThrow('erro de JSON')
    expect(await readFile(file, 'utf8')).toBe('{ quebrado')
  })
})

describe('templates', () => {
  const sid = '11111111-2222-3333-4444-555555555555'
  const env: Environment = {
    id: 'e1',
    name: 'Loja',
    projectId: 'p1',
    lastOpenedAt: 1,
    cwd: 'C:\\Users\\Fulano\\loja',
    pinned: true,
    sessions: [
      { id: sid, adapterId: 'claude', title: 'Login', cwd: 'C:\\Users\\Fulano\\loja.worktrees\\abc', worktreeBranch: 'agent/abc', started: true, shouldRun: true, working: true },
      { id: 's2', adapterId: 'shell', title: 'Servidor', cwd: 'C:\\Users\\Fulano\\api', projectId: 'p2', started: true }
    ],
    layout: null
  }
  const layout = {
    grid: { root: { type: 'leaf', data: { views: [`term:${sid}`, 'file:1', 'file:2', 'd'] } } },
    panels: {
      [`term:${sid}`]: { id: `term:${sid}`, contentComponent: 'terminal', params: { kind: 'terminal', sessionId: sid } },
      'file:1': { id: 'file:1', contentComponent: 'editor', title: 'settings.json', params: { kind: 'editor', path: 'C:\\Users\\Fulano\\.claude\\settings.json' } },
      'file:2': { id: 'file:2', contentComponent: 'markdown', title: 'a.md', params: { kind: 'markdown', path: 'docs/a.md', root: 'C:\\Users\\Fulano\\api' } },
      d: { id: 'd', contentComponent: 'diff', title: 'Alterações · main', params: { kind: 'diff', cwd: 'C:\\Users\\Fulano\\loja' } }
    }
  }
  const names: Record<string, string> = { p1: 'Loja', p2: 'API' }

  it('a partir de um ambiente: sessões por projeto, sem caminhos, ids, conversas nem estado', () => {
    const template = templateFromEnvironment(env, ' Loja completa ', layout)
    expect(template.name).toBe('Loja completa')
    expect(template.slots).toEqual([
      { slot: 'slot-0', projectId: 'p1', adapterId: 'claude', title: 'Login' },
      { slot: 'slot-1', projectId: 'p2', adapterId: 'shell', title: 'Servidor' }
    ])
    const text = JSON.stringify(template)
    expect(text).not.toMatch(/Fulano|agent\/abc|shouldRun|working|pinned/)
    expect(text).not.toContain(sid)
    expect(text).toContain('docs/a.md')
  })

  it('cria sessões novas, cada uma na pasta do seu projeto, com o layout apontando para elas', () => {
    const template = templateFromEnvironment(env, 'Loja', layout)
    const { sessions, layout: next } = instantiate(template.slots, template.layout, (id) => `D:\\${id}`)
    expect(sessions.map((s) => [s.cwd, s.projectId, s.started])).toEqual([
      ['D:\\p1', 'p1', false],
      ['D:\\p2', 'p2', false]
    ])
    expect(sessions[0]!.id).not.toBe(sid)
    expect((next as any).panels[`term:${sessions[0]!.id}`].params.sessionId).toBe(sessions[0]!.id)
  })

  it('exporta projetos pelo nome e importa só o que é seguro', () => {
    const text = exportTemplate(templateFromEnvironment(env, 'Loja', layout), (id) => names[id]!)
    expect(text).not.toContain('Fulano')
    const parsed = parseTemplateFile(text, ['claude', 'shell'])
    expect(parsed.projects).toEqual(['Loja', 'API'])
    expect(parsed.slots.map((s) => s.project)).toEqual([0, 1])
    const base = JSON.parse(text)
    const tamper = (fn: (d: any) => void): (() => unknown) => {
      const copy = structuredClone(base)
      fn(copy)
      return () => parseTemplateFile(JSON.stringify(copy), ['claude', 'shell'])
    }
    expect(() => parseTemplateFile('nao json', ['claude'])).toThrow('inválido')
    expect(tamper((d) => (d.slots[0].adapterId = 'calc.exe'))).toThrow('agente desconhecido')
    expect(tamper((d) => (d.slots[0].project = 9))).toThrow('sem projeto')
    expect(tamper((d) => (d.layout.panels['file:2'].params.path = '../../.ssh/id_rsa'))).toThrow('fora do projeto')
    expect(tamper((d) => (d.layout.panels['file:2'].params.path = 'C:\\Windows\\win.ini'))).toThrow('fora do projeto')
    expect(tamper((d) => (d.layout.panels['file:2'].contentComponent = 'x'))).toThrow('painel desconhecido')
  })

  it('valida as quantidades e monta os títulos por projeto', () => {
    const groups = cleanGroups([{ projectId: 'p1', claude: 2, terminals: 99 }, { projectId: 'p2', claude: -1, terminals: 1 }], ['p1', 'p2'])
    expect(groups).toEqual([{ projectId: 'p1', claude: 2, terminals: 8 }, { projectId: 'p2', claude: 0, terminals: 1 }])
    expect(() => cleanGroups([{ projectId: 'x', claude: 1, terminals: 0 }], ['p1'])).toThrow('Projeto')
    expect(() => cleanGroups([{ projectId: 'p1', claude: 0, terminals: 0 }], ['p1'])).toThrow('ao menos')
    const slots = slotsFromGroups([{ projectId: 'p1', claude: 1, terminals: 1 }, { projectId: 'p2', claude: 1, terminals: 0 }], (id) => names[id]!)
    expect(slots.map((s) => s.title)).toEqual(['Loja · Sessão 1', 'Loja · Terminal 1', 'API · Sessão 1'])
    expect(slotsFromGroups([{ projectId: 'p1', claude: 1, terminals: 0 }], (id) => names[id]!)[0]!.title).toBe('Sessão 1')
    expect(sameGroups(groupsOf(slots), [{ projectId: 'p1', claude: 1, terminals: 1 }, { projectId: 'p2', claude: 1, terminals: 0 }])).toBe(true)
  })
})

describe('conversa da sessão', () => {
  const env = (): Environment => ({
    id: 'amb',
    name: 'Amb',
    projectId: 'p',
    cwd: 'C:/p',
    lastOpenedAt: 0,
    layout: null,
    sessions: [
      { id: 's1', adapterId: 'claude', title: 'Sessão 1', cwd: 'C:/p', started: true },
      { id: 't1', adapterId: 'shell', title: 'Terminal', cwd: 'C:/p', started: true }
    ]
  })

  it('depois de um /clear, a sessão passa a apontar para a conversa nova', () => {
    const envs = [env()]
    expect(setConversation(envs, 's1', 's1')).toBe(false)
    expect(setConversation(envs, 's1', 'nova')).toBe(true)
    expect(envs[0]?.sessions[0]?.conversationId).toBe('nova')
    expect(setConversation(envs, 's1', 'nova')).toBe(false)
    expect(setConversation(envs, 's1', 's1')).toBe(true)
    expect(envs[0]?.sessions[0]?.conversationId).toBeUndefined()
    expect(setConversation(envs, 'nao-existe', 'x')).toBe(false)
  })

  it('o histórico acha a sessão pela conversa atual, não pelo id antigo', () => {
    const envs = [env()]
    setConversation(envs, 's1', 'nova')
    const holders = conversationHolders(envs)
    expect(holders.get('nova')).toEqual({ environmentId: 'amb', sessionId: 's1' })
    expect(holders.has('s1')).toBe(false)
    expect(holders.has('t1')).toBe(false)
  })

  it('o template não leva a conversa', () => {
    const e = env()
    e.sessions[0]!.conversationId = 'nova'
    expect(JSON.stringify(templateFromEnvironment(e, 'Molde', null))).not.toContain('nova')
  })
})
