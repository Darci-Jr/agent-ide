import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Environment } from '../shared/types'
import { childEnv } from './childEnv'
import { exportEnvironment, importEnvironment } from './exchange'
import { denyRead, getProtection, isSensitive, listConfigFiles, listTree, readProjectFile, writeProjectFile } from './files'

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

describe('exportar e importar ambientes', () => {
  const sid = '11111111-2222-3333-4444-555555555555'
  const env: Environment = {
    id: 'e1',
    name: 'Loja',
    projectId: 'p1',
    draft: false,
    lastOpenedAt: 1,
    cwd: 'C:\\Users\\Fulano\\loja',
    template: 'multi',
    sessions: [{ id: sid, adapterId: 'claude', title: 'Login', cwd: 'C:\\Users\\Fulano\\loja.worktrees\\abc', worktreeBranch: 'agent/abc', started: true }],
    layout: null
  }
  const layout = {
    grid: { root: { type: 'leaf', data: { views: [`term:${sid}`, 'file:1', 'file:2'] } } },
    panels: {
      [`term:${sid}`]: { id: `term:${sid}`, contentComponent: 'terminal', params: { kind: 'terminal', sessionId: sid } },
      'file:1': { id: 'file:1', contentComponent: 'editor', title: 'settings.json', params: { kind: 'editor', path: 'C:\\Users\\Fulano\\.claude\\settings.json' } },
      'file:2': { id: 'file:2', contentComponent: 'markdown', title: 'a.md', params: { kind: 'markdown', path: 'docs/a.md' } }
    }
  }

  it('não exporta caminhos da máquina nem ids de sessão', () => {
    const text = exportEnvironment(env, layout)
    expect(text).not.toContain('Fulano')
    expect(text).not.toContain(sid)
    expect(text).not.toContain('agent/abc')
    expect(text).toContain('docs/a.md')
  })

  it('importa em outra pasta com ids novos e sessões paradas', () => {
    const imported = importEnvironment(exportEnvironment(env, layout), 'D:\\outro', 'p2', ['claude', 'shell'])
    expect(imported.cwd).toBe('D:\\outro')
    expect(imported.projectId).toBe('p2')
    expect(imported.sessions[0]).toMatchObject({ cwd: 'D:\\outro', started: false, title: 'Login' })
    const newId = imported.sessions[0]!.id
    expect(newId).not.toBe(sid)
    expect((imported.layout as any).panels[`term:${newId}`].params.sessionId).toBe(newId)
  })

  it('recusa arquivos maliciosos', () => {
    const base = JSON.parse(exportEnvironment(env, layout))
    const tamper = (fn: (d: any) => void): string => {
      const copy = structuredClone(base)
      fn(copy)
      return JSON.stringify(copy)
    }
    const load = (text: string) => () => importEnvironment(text, 'D:\\x', 'p2', ['claude', 'shell'])
    expect(load('nao json')).toThrow('inválido')
    expect(load(tamper((d) => (d.sessions[0].adapterId = 'calc.exe')))).toThrow('agente desconhecido')
    expect(load(tamper((d) => (d.layout.panels['file:2'].params.path = '../../.ssh/id_rsa')))).toThrow('fora do projeto')
    expect(load(tamper((d) => (d.layout.panels['file:2'].params.path = 'C:\\Windows\\win.ini')))).toThrow('fora do projeto')
    expect(load(tamper((d) => (d.layout.panels['file:2'].contentComponent = 'x')))).toThrow('painel desconhecido')
  })
})
