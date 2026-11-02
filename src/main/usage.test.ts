import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanDraft, CommandStore } from './commands'
import { readPluginFolder } from './plugins'
import { STATUS_LINE_SCRIPT, UsageTracker } from './usage'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uso-'))
  mkdirSync(join(dir, 'contexto'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const runScript = (input: unknown, original?: string): string => {
  const script = join(dir, 'statusline.cjs')
  writeFileSync(script, STATUS_LINE_SCRIPT)
  const args = [script, join(dir, 'uso.json'), join(dir, 'contexto'), 'sessao-1', ...(original ? [Buffer.from(original).toString('base64')] : [])]
  return execFileSync(process.execPath, args, { input: JSON.stringify(input), encoding: 'utf8' })
}
const readJson = (...path: string[]) => JSON.parse(readFileSync(join(dir, ...path), 'utf8'))

describe('linha de status', () => {
  it('guarda os limites de 5 horas e da semana', () => {
    runScript({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } })
    expect(readJson('uso.json').fiveHour).toEqual({ usedPercentage: 23.5, resetsAt: 1738425600000 })
    expect(readJson('uso.json').sevenDay).toEqual({ usedPercentage: 41.2, resetsAt: 1738857600000 })
  })

  it('guarda a janela de contexto por sessão', () => {
    runScript({ context_window: { used_percentage: 34, context_window_size: 200000 } })
    expect(readJson('contexto', 'sessao-1.json')).toMatchObject({ usedPercentage: 34, size: 200000 })
  })

  it('não apaga o último valor quando a sessão ainda não tem dados', () => {
    runScript({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 1 } }, context_window: { used_percentage: 5 } })
    runScript({ model: { id: 'x' }, context_window: { used_percentage: null } })
    expect(readJson('uso.json').fiveHour.usedPercentage).toBe(10)
    expect(readJson('contexto', 'sessao-1.json').usedPercentage).toBe(5)
  })

  it('não escreve nada no terminal, a não ser a linha de status da pessoa', () => {
    expect(runScript({})).toBe('')
    expect(runScript({}, 'echo MINHA-LINHA').trim()).toBe('MINHA-LINHA')
  })
})

describe('UsageTracker', () => {
  const tracker = () => new UsageTracker(join(dir, 'perfil'), () => {}, () => {})

  it('preserva a linha de status que a pessoa já tinha no projeto', () => {
    const project = join(dir, 'projeto')
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo MINHA' } }))
    const t = tracker()
    try {
      const command = JSON.parse(readFileSync(t.settingsFor('s1', project), 'utf8')).statusLine.command
      expect(command).toContain('ELECTRON_RUN_AS_NODE=1')
      expect(command).toContain(Buffer.from('echo MINHA').toString('base64'))
    } finally {
      t.dispose()
    }
  })

  it('lembra cada opção do rodapé e esquece a sessão removida', () => {
    const t = tracker()
    try {
      expect(t.preferences()).toEqual({ showUsage: true, showContext: true })
      t.savePreferences({ showUsage: true, showContext: false })
      expect(t.preferences()).toEqual({ showUsage: true, showContext: false })
      const settings = t.settingsFor('s1', dir)
      t.forget('s1')
      expect(existsSync(settings)).toBe(false)
      expect(t.context('../fora')).toBeNull()
    } finally {
      t.dispose()
    }
  })
})

describe('plugins', () => {
  it('lê skills, comandos, agentes, MCP e hooks da pasta do plugin', () => {
    const root = join(dir, 'plugin')
    for (const sub of ['.claude-plugin', 'skills/revisar', 'commands', 'agents', 'hooks']) mkdirSync(join(root, sub), { recursive: true })
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'p', description: 'Plugin de teste' }))
    writeFileSync(join(root, 'skills', 'revisar', 'SKILL.md'), '---\nname: revisar\ndescription: "Revisa o diff"\n---\ncorpo')
    writeFileSync(join(root, 'commands', 'ajuda.md'), '---\ndescription: Mostra ajuda\n---\n')
    writeFileSync(join(root, 'agents', 'analista.md'), '---\nname: analista\ndescription: Analisa\n---\n')
    writeFileSync(join(root, 'hooks', 'hooks.json'), '{}')
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { navegador: {} } }))
    expect(readPluginFolder(root)).toEqual({
      description: 'Plugin de teste',
      skills: [{ name: 'revisar', description: 'Revisa o diff' }],
      commands: [{ name: 'ajuda', description: 'Mostra ajuda' }],
      agents: [{ name: 'analista', description: 'Analisa' }],
      mcpServers: ['navegador'],
      hasHooks: true
    })
  })

  it('aguenta uma pasta que não existe', () => {
    expect(readPluginFolder(join(dir, 'nada'))).toMatchObject({ skills: [], commands: [], mcpServers: [], hasHooks: false })
  })
})

describe('comandos', () => {
  const store = () => new CommandStore(join(dir, 'gerais.json'), () => join(dir, 'projetos-comandos.json'))
  const draft = { command: 'npm test', name: 'Testes', icon: 'flask' as const, scope: 'project' as const }

  it('separa os comandos de cada projeto e soma os gerais', () => {
    const s = store()
    s.save('p1', draft)
    s.save('p1', { ...draft, command: 'git status', scope: 'global' })
    expect(s.list('p1').map((c) => c.command)).toEqual(['git status', 'npm test'])
    expect(s.list('p2').map((c) => c.command)).toEqual(['git status'])
  })

  it('editar pode mudar o escopo sem duplicar, e apagar remove', () => {
    const s = store()
    const saved = s.save('p1', draft)
    s.save('p1', { ...draft, scope: 'global' }, saved.id)
    expect(s.list('p2')).toEqual([{ ...draft, scope: 'global', id: saved.id }])
    s.remove('p1', saved.id)
    expect(s.list('p1')).toEqual([])
  })

  it('um comando é uma linha só, com ícone conhecido', () => {
    expect(cleanDraft({ ...draft, command: 'npm test\r\nrm -rf x' }).command).toBe('npm test rm -rf x')
    expect(() => cleanDraft({ ...draft, command: '  ' })).toThrow()
    expect(() => cleanDraft({ ...draft, icon: 'nada' as never })).toThrow()
  })
})
