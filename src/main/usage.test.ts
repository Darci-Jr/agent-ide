import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCacheInfo } from './cache'
import { cleanDraft, CommandStore } from './commands'
import { parseChanges, parseDiff, parseStatus, repositoryRoot } from './git'
import { readPluginFolder } from './plugins'
import { TokenTally } from './tokens'
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
      const all = { showUsage: true, showContext: true, showCache: true, showTokens: true, showGit: true }
      expect(t.preferences()).toEqual(all)
      t.savePreferences({ ...all, showContext: false, showTokens: false })
      expect(t.preferences()).toEqual({ ...all, showContext: false, showTokens: false })
      // Arquivo de uma versão anterior, sem os indicadores novos: eles vêm ligados.
      writeFileSync(join(dir, 'perfil', 'preferencias.json'), JSON.stringify({ showUsage: false }))
      expect(t.preferences()).toEqual({ ...all, showUsage: false })
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

describe('git', () => {
  it('acha o repositório que contém uma pasta, para avisar ao escolher a pasta de trabalho', async () => {
    const outside = join(dir, 'fora')
    const repo = join(dir, 'repo')
    mkdirSync(outside)
    mkdirSync(join(repo, 'dentro'), { recursive: true })
    execFileSync('git', ['-C', repo, 'init', '-q'])
    expect(await repositoryRoot(outside)).toBeNull()
    // O Git responde com barras normais e pode expandir nomes curtos do Windows.
    const root = await repositoryRoot(join(repo, 'dentro'))
    expect(root).not.toBeNull()
    expect(realpathSync.native(root!).toLowerCase()).toBe(realpathSync.native(repo).toLowerCase())
  })

  it('lê branch, distância do remoto e arquivos alterados', () => {
    const text = [
      '# branch.oid 1234567890abcdef',
      '# branch.head corrigir-login',
      '# branch.upstream origin/corrigir-login',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '? novo.txt'
    ].join('\n')
    expect(parseStatus(text)).toEqual({ branch: 'corrigir-login', detached: false, ahead: 2, behind: 1, upstream: true, changed: 2, tracked: 1 })
  })

  it('sem branch, mostra o commit curto', () => {
    expect(parseStatus('# branch.oid 1234567890abcdef\n# branch.head (detached)\n')).toMatchObject({ branch: '1234567', detached: true, upstream: false })
  })

  it('junta situação e contagem de linhas, inclusive renomeados e binários', () => {
    const nameStatus = ['M', 'src/a.ts', 'R090', 'velho.ts', 'novo.ts', 'A', 'img.png', 'D', 'fora.md', ''].join('\0')
    const numstat = ['3\t1\tsrc/a.ts', '2\t2\t', 'velho.ts', 'novo.ts', '-\t-\timg.png', '0\t7\tfora.md', ''].join('\0')
    expect(parseChanges(nameStatus, numstat)).toEqual([
      { path: 'src/a.ts', from: null, status: 'modified', additions: 3, deletions: 1, binary: false },
      { path: 'novo.ts', from: 'velho.ts', status: 'renamed', additions: 2, deletions: 2, binary: false },
      { path: 'img.png', from: null, status: 'added', additions: 0, deletions: 0, binary: true },
      { path: 'fora.md', from: null, status: 'deleted', additions: 0, deletions: 7, binary: false }
    ])
  })

  it('numera as linhas do diff e corta os grandes', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -10,3 +10,3 @@ fn()', ' igual', '-velha\r', '+nova', '\\ No newline at end of file', ''].join('\n')
    expect(parseDiff(text).lines).toEqual([
      { type: 'hunk', oldNo: null, newNo: null, text: '@@ -10,3 +10,3 @@ fn()' },
      { type: 'ctx', oldNo: 10, newNo: 10, text: 'igual' },
      { type: 'del', oldNo: 11, newNo: null, text: 'velha' },
      { type: 'add', oldNo: null, newNo: 11, text: 'nova' }
    ])
    expect(parseDiff(text, 2)).toMatchObject({ truncated: true })
    expect(parseDiff('diff --git a/i b/i\nBinary files a/i and b/i differ\n')).toEqual({ binary: true, truncated: false, lines: [] })
  })
})

describe('cache do prompt', () => {
  const line = (over: object): string => JSON.stringify({ type: 'assistant', timestamp: '2026-11-05T10:00:00.000Z', message: { usage: { cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } }, ...over })
  const created = (kind: '1h' | '5m', at: string): string =>
    line({ timestamp: at, message: { usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: kind === '1h' ? 10 : 0, ephemeral_5m_input_tokens: kind === '5m' ? 10 : 0 } } } })

  it('vence uma hora depois da última resposta quando o cache é de 1 hora', () => {
    const text = [created('1h', '2026-11-05T09:00:00.000Z'), line({ timestamp: '2026-11-05T09:30:00.000Z' })].join('\n')
    expect(readCacheInfo(text)).toEqual({ lastAt: Date.parse('2026-11-05T09:30:00.000Z'), ttlMs: 3600000, expiresAt: Date.parse('2026-11-05T10:30:00.000Z') })
  })

  it('usa 5 minutos quando é o que a conversa cria, e ignora subagentes e linhas cortadas', () => {
    const text = ['{"cortada', created('5m', '2026-11-05T09:00:00.000Z'), line({ timestamp: '2026-11-05T09:50:00.000Z', isSidechain: true })].join('\n')
    expect(readCacheInfo(text)).toMatchObject({ lastAt: Date.parse('2026-11-05T09:00:00.000Z'), ttlMs: 300000 })
  })

  it('sem respostas, não há cache', () => {
    expect(readCacheInfo(JSON.stringify({ type: 'user', message: { content: 'oi' } }))).toBeNull()
  })
})

describe('atualizações', () => {
  it('traduz os erros comuns e corta o resto', async () => {
    const { updateError } = await import('./updateError')
    expect(updateError(new Error('HttpError: 404 Not Found\n"method: GET url: https://github.com/..."'))).toBe('nenhuma versão publicada encontrada')
    expect(updateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('sem conexão com o servidor de atualizações')
    expect(updateError('falhou\ndetalhe')).toBe('falhou')
  })
})

describe('tokens da sessão', () => {
  const answer = (id: string, usage: object, text = 'ok'): string =>
    JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage } }) + '\n'
  const usage = { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }

  it('conta cada resposta uma vez, mesmo repetida em várias linhas', async () => {
    const file = join(dir, 'conversa.jsonl')
    writeFileSync(file, answer('m1', usage) + answer('m1', usage) + answer('m1', usage) + JSON.stringify({ type: 'user', message: { content: 'oi' } }) + '\n' + answer('m2', usage))
    expect(await new TokenTally().read('s', file)).toEqual({ input: 4, cacheWrite: 20, cacheRead: 200, output: 10, total: 234, responses: 2 })
  })

  it('lê só o que entrou depois, sem estragar uma linha cortada no meio de um acento', async () => {
    const file = join(dir, 'conversa.jsonl')
    const tally = new TokenTally()
    const line = answer('m1', usage, 'ação')
    const bytes = Buffer.from(line, 'utf8')
    const cut = bytes.indexOf(Buffer.from('ç', 'utf8')) + 1
    writeFileSync(file, bytes.subarray(0, cut))
    expect(await tally.read('s', file)).toBeNull()
    appendFileSync(file, bytes.subarray(cut))
    appendFileSync(file, answer('m2', usage))
    expect(await tally.read('s', file)).toMatchObject({ responses: 2, total: 234 })
    // Reescrito do zero (menor que o já lido): recomeça a conta.
    writeFileSync(file, answer('m9', usage))
    expect(await tally.read('s', file)).toMatchObject({ responses: 1, total: 117 })
  })
})
