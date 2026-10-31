// Abre o app de verdade e percorre o fluxo principal. Uso: npm run e2e
// Só usa sessões de terminal comum, então não consome tokens de nenhum agente.
import { _electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const electronPath = createRequire(import.meta.url)('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const base = mkdtempSync(join(tmpdir(), 'agent-ide-e2e-'))
const project = join(base, 'loja')
const profile = join(base, 'perfil')
const exchange = join(base, 'loja.ambiente.json')
mkdirSync(join(project, 'docs'), { recursive: true })
mkdirSync(profile)
writeFileSync(join(project, '.env'), 'API_KEY=valor-de-teste\n')
writeFileSync(join(project, 'docs', 'ideia.md'), '# Ideia inicial\n\nTexto.\n')
writeFileSync(join(project, 'package.json'), '{}\n')
writeFileSync(join(project, '.gitignore'), '.env\n.claude/\n')
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' })
git('init', '-q', '-b', 'main')
git('add', '.')
git('-c', 'user.name=teste', '-c', 'user.email=teste@example.com', 'commit', '-q', '-m', 'inicio')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function launch() {
  const env = { ...process.env, AGENT_IDE_USER_DATA: profile, AGENT_IDE_TEST_DIRECTORY: project, AGENT_IDE_TEST_EXCHANGE_FILE: exchange }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({ executablePath: electronPath, args: [root], env, cwd: root })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => check(`sem erro na página: ${e.message}`, false))
  page.on('dialog', (d) => d.accept())
  await page.waitForSelector('.app')
  return { app, page }
}

const button = (page, label) => page.getByRole('button', { name: label, exact: true })
const shot = (page, name) => page.screenshot({ path: join(here, `${name}.png`) })
const newTerminal = async (page) => {
  await button(page, 'Nova sessão com opções').click()
  await page.locator('.popover').getByRole('button', { name: 'Terminal', exact: true }).click()
  await sleep(700)
}
const typeIn = async (page, index, text) => {
  await page.locator('.terminal-panel').nth(index).click()
  await page.keyboard.type(text)
}
const box = async (loc) => loc.boundingBox()

let { app, page } = await launch()

// Ambientes e modelos
check('abre o seletor de modelos no primeiro uso', await page.getByRole('dialog', { name: 'Novo ambiente' }).isVisible())
await page.getByRole('button', { name: /Em branco/ }).click()
await page.waitForSelector('.dock-empty')
check('modelo em branco cria o ambiente com o nome da pasta', await page.getByRole('tab', { name: 'loja' }).isVisible())

// Grade
for (let i = 0; i < 4; i++) await newTerminal(page)
check('cria quatro sessões', (await page.locator('.terminal-panel').count()) === 4)
const panels = await page.locator('.terminal-host').evaluateAll((els) =>
  els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
)
const xs = new Set(panels.map((p) => p[0])), ys = new Set(panels.map((p) => p[1]))
check('as sessões formam uma grade', xs.size >= 2 && ys.size >= 2, JSON.stringify(panels))
await typeIn(page, 0, "echo MARCADOR-SESSAO\r")
await sleep(1500)
await shot(page, '1-grade')

// Histórico do terminal
await typeIn(page, 1, '1..300 | ForEach-Object { "LINHA-$_" }\r')
await sleep(1500)
const secondTerminal = page.locator('.terminal-host').nth(1)
const hasFirstLine = () => secondTerminal.evaluate((e) => /LINHA-1\s/.test(e.querySelector('.xterm-rows').textContent) || /LINHA-1LINHA-2/.test(e.querySelector('.xterm-rows').textContent))
check('a saída longa empurra o início para o histórico', !(await hasFirstLine()))
const secondBox = await box(secondTerminal)
await page.mouse.move(secondBox.x + 100, secondBox.y + 100)
for (let i = 0; i < 150; i++) await page.mouse.wheel(0, -1000)
await sleep(500)
check('a rolagem do mouse alcança o histórico', await hasFirstLine())
await page.mouse.move(secondBox.x + 100, secondBox.y + 100)
for (let i = 0; i < 150; i++) await page.mouse.wheel(0, 1000)
await sleep(300)

// Destaque
const hostHandle = await page.locator('.terminal-host').first().elementHandle()
await page.getByRole('button', { name: 'Destacar', exact: true }).first().click()
await sleep(500)
const focusedBox = await box(page.locator('.terminal-host').first())
check('destacar ocupa quase toda a área', focusedBox.width > 1200 && focusedBox.height > 650, JSON.stringify(focusedBox))
check('faixas das outras sessões aparecem', (await page.locator('.focus-strips .strip').count()) === 4)
await shot(page, '2-destaque')
const stillAttached = await hostHandle.evaluate((e) => e.isConnected && e.textContent.includes('MARCADOR-SESSAO'))
check('destacar mantém o terminal e o conteúdo', stillAttached)
await page.locator('.focus-strips .strip').nth(1).click()
await sleep(400)
check('faixa troca a sessão destacada', (await page.locator('.focus-strips .strip.on').innerText()) === 'Sessão 2')
await button(page, 'Visão geral').click()
await sleep(400)
check('volta à visão geral', (await page.locator('.focus-strips').count()) === 0)
check('o terminal sobrevive à volta', await hostHandle.evaluate((e) => e.isConnected && e.textContent.includes('MARCADOR-SESSAO')))

// Arrastar: o risco que o protótipo não cobriu
const tab = page.locator('.panel-tab').first()
const target = page.locator('.terminal-host').nth(3)
const from = await box(tab), to = await box(target)
await page.mouse.move(from.x + 90, from.y + from.height / 2)
await page.mouse.down()
await page.mouse.move(from.x + 110, from.y + from.height / 2, { steps: 4 })
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
await sleep(200)
await page.mouse.up()
await sleep(700)
const groups = await page.locator('.dv-groupview').count()
check('arrastar uma aba move o painel para outro grupo', groups === 3, `${groups} grupos`)
const dragged = await page.locator('.terminal-host').evaluateAll((els) => els.some((e) => e.textContent.includes('MARCADOR-SESSAO')))
check('o terminal arrastado mantém o conteúdo', dragged)
await page.locator('.terminal-panel:visible').first().click()
await page.keyboard.type('echo DEPOIS-DE-ARRASTAR\r')
await sleep(1200)
await shot(page, '3-arrastado')
const typed = await page.locator('.terminal-host').evaluateAll((els) => els.some((e) => e.textContent.includes('DEPOIS-DE-ARRASTAR')))
check('continua aceitando digitação depois de arrastar', typed)

// Arquivos e segredos
await button(page, 'Arquivos').click()
await page.waitForSelector('.drawer')
check('a lista mostra o .env', await page.locator('.drawer .file', { hasText: '.env' }).first().isVisible())
await page.locator('.drawer .file', { hasText: '.env' }).first().click()
await page.waitForSelector('.monaco-editor')
await sleep(800)
const editorText = () => page.locator('.monaco-editor .view-lines').first().innerText()
check('o editor mostra o valor do segredo', (await editorText()).replace(/\s/g, ' ').includes('API_KEY=valor-de-teste'))
check('avisa que o Claude pode ler', await page.getByText('O Claude pode ler este arquivo').isVisible())
await button(page, 'Bloquear').click()
await page.waitForSelector('.banner.ok')
const settings = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'))
check('cria a regra de deny', settings.permissions.deny.includes('Read(./.env)'))

await page.locator('.monaco-editor').first().click()
await page.keyboard.press('Control+End')
await page.keyboard.type('NOVO=1')
await page.keyboard.press('Control+S')
await sleep(500)
check('salva com Ctrl+S', readFileSync(join(project, '.env'), 'utf8').includes('NOVO=1'))
await shot(page, '4-editor')

writeFileSync(join(project, '.env'), 'MUDOU_NO_DISCO=1\n')
await sleep(100)
await page.locator('.monaco-editor').first().click()
await page.keyboard.type('X')
await page.keyboard.press('Control+S')
await page.waitForSelector('.banner.warning[role=alert]')
check('avisa do conflito sem sobrescrever', readFileSync(join(project, '.env'), 'utf8') === 'MUDOU_NO_DISCO=1\n')
await button(page, 'Recarregar').click()
await sleep(400)
check('recarregar traz o conteúdo do disco', (await editorText()).includes('MUDOU_NO_DISCO=1'))

// Markdown
await page.locator('.drawer .file.dir', { hasText: 'docs' }).click()
await page.locator('.drawer .file', { hasText: 'ideia.md' }).click()
await page.waitForSelector('.markdown h1')
check('renderiza o Markdown', (await page.locator('.markdown h1').innerText()) === 'Ideia inicial')
writeFileSync(join(project, 'docs', 'ideia.md'), '# Ideia revisada\n\n<img src=x onerror="window.__xss=1">\n')
await sleep(1800)
check('atualiza quando o arquivo muda', (await page.locator('.markdown h1').innerText()) === 'Ideia revisada')
check('remove script embutido no Markdown', !(await page.evaluate(() => window.__xss)) && (await page.locator('.markdown img[onerror]').count()) === 0)
await shot(page, '5-markdown')

// Tema escuro
await button(page, 'Tema escuro').click()
await sleep(400)
check('alterna para o tema escuro', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
await shot(page, '6-escuro')
await button(page, 'Tema claro').click()

// Exportar
await button(page, 'Exportar ambiente').click()
await page.getByRole('dialog', { name: 'Exportar ambiente' }).getByRole('button', { name: 'Exportar' }).click()
await sleep(500)
const exported = readFileSync(exchange, 'utf8')
check('exporta sem caminhos da máquina', !exported.includes(base.replaceAll('\\', '\\\\')) && !exported.includes(project))
check('exporta sem o conteúdo do segredo', !exported.includes('MUDOU_NO_DISCO'))

// Segundo ambiente com modelo: sessões do primeiro continuam vivas
await button(page, 'Novo ambiente').click()
await page.getByRole('dialog', { name: 'Novo ambiente' }).getByRole('button', { name: /Importar/ }).click()
await sleep(1000)
const envTabs = await page.locator('.tab-list [role=tab]').count()
check('importa como segundo ambiente', envTabs === 2)
await shot(page, '7-importado')
check('sessões importadas não iniciam sozinhas', (await page.getByRole('button', { name: 'Iniciar' }).count()) >= 1)
await page.locator('.tab-list [role=tab]').first().click()
await sleep(500)
check('o primeiro ambiente segue com as sessões', await page.locator('.terminal-host').evaluateAll((els) => els.some((e) => e.textContent.includes('DEPOIS-DE-ARRASTAR'))))

// Pensar junto: sessão ao lado de um Markdown escolhido na hora
await button(page, 'Novo ambiente').click()
await page.getByRole('button', { name: /Pensar junto/ }).click()
await page.waitForSelector('.environment:visible .panel-empty .file')
await sleep(1200)
check('pensar junto abre sessão e seletor de Markdown', (await page.locator('.environment:visible .terminal-panel').count()) === 1)
await page.locator('.environment:visible .panel-empty .file', { hasText: 'ideia.md' }).click()
await page.waitForSelector('.environment:visible .markdown h1')
check('o Markdown abre no painel ao lado da sessão', (await page.locator('.environment:visible .dv-groupview').count()) === 2)
await shot(page, '7b-pensar-junto')

// Worktree: branch própria, sem copiar segredos
await button(page, 'Nova sessão com opções').click()
await page.getByRole('checkbox', { name: 'Em uma worktree' }).check()
await page.locator('.popover').getByRole('button', { name: 'Terminal', exact: true }).click()
await page.waitForSelector('.toast')
check('avisa que o .env não foi para a worktree', (await page.locator('.toast').innerText()).includes('.env'))
const branches = git('branch', '--list', 'agent/*')
check('cria uma branch própria', /agent\//.test(branches), branches.trim())
const worktrees = join(base, 'loja.worktrees')
const created = existsSync(worktrees) ? readdirSync(worktrees) : []
check('cria a worktree ao lado do repositório', created.length === 1)
check('não copia o .env para a worktree', created.length === 1 && !existsSync(join(worktrees, created[0], '.env')))
check('não altera a branch do repositório principal', git('branch', '--show-current').trim() === 'main')

// Reinício: layout e ambientes voltam
await sleep(600)
await app.close()
await sleep(500)
;({ app, page } = await launch())
await page.waitForSelector('.dock .panel-tab')
await sleep(800)
check('reabre os três ambientes', (await page.locator('.tab-list [role=tab]').count()) === 3)
check('restaura as quatro sessões', (await page.locator('.environment').first().locator('.terminal-panel').count()) === 4)
check('restaura os três grupos do layout mais o de arquivos', (await page.locator('.environment').first().locator('.dv-groupview').count()) >= 3)
await shot(page, '8-reaberto')
await app.close()
rmSync(base, { recursive: true, force: true })

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
