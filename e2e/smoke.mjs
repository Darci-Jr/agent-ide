// Abre o app de verdade e percorre o fluxo principal. Uso: npm run e2e
// Abre o Claude Code em alguns passos, mas nunca envia mensagens: não consome tokens.
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
const workspaceDir = join(base, 'trabalho')
const exchange = join(base, 'loja.ambiente.json')
for (const dir of [join(project, 'docs'), profile, workspaceDir]) mkdirSync(dir, { recursive: true })
writeFileSync(join(project, '.env'), 'API_KEY=valor-de-teste\n')
writeFileSync(join(project, 'docs', 'ideia.md'), '# Ideia inicial\n\nTexto.\n')
writeFileSync(join(project, 'package.json'), '{}\n')
writeFileSync(join(project, '.gitignore'), '.env\n.claude/\n')
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' })
git('init', '-q', '-b', 'main')
git('add', '.')
git('-c', 'user.name=teste', '-c', 'user.email=teste@example.com', 'commit', '-q', '-m', 'inicio')

// Plugins falsos: o e2e nunca liga ou desliga os plugins de verdade.
const pluginDir = join(base, 'plugin-revisor')
mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
mkdirSync(join(pluginDir, 'skills', 'revisar'), { recursive: true })
writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'revisor', description: 'Revisa mudanças antes do commit' }))
writeFileSync(join(pluginDir, 'skills', 'revisar', 'SKILL.md'), '---\nname: revisar\ndescription: Revisa o diff atual\n---\n')
const pluginState = join(base, 'plugins-falsos.json')
writeFileSync(
  pluginState,
  JSON.stringify({
    plugins: [
      { id: 'revisor@teste', version: '1.0.0', scope: 'user', enabled: true, installPath: pluginDir },
      { id: 'desligado@teste', version: '2.0.0', scope: 'user', enabled: false, installPath: join(base, 'nao-existe') }
    ]
  })
)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function launch() {
  const env = {
    ...process.env,
    AGENT_IDE_USER_DATA: profile,
    AGENT_IDE_TEST_DIRECTORY: project,
    AGENT_IDE_TEST_WORKSPACE: workspaceDir,
    AGENT_IDE_TEST_EXCHANGE_FILE: exchange,
    AGENT_IDE_TEST_PLUGIN_CLI: join(here, 'fake-claude-plugins.cjs'),
    AGENT_IDE_TEST_PLUGIN_STATE: pluginState
  }
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
  await button(page, 'Abrir terminal na pasta da sessão atual').click()
  await sleep(700)
}
const typeIn = async (page, index, text) => {
  await page.locator('.environment:visible .terminal-panel').nth(index).click()
  await page.keyboard.type(text)
}
const box = (loc) => loc.boundingBox()
const goHome = (page) => button(page, 'Início').click()
const hosts = (page) => page.locator('.environment:visible .terminal-host')
const anyHostHas = (page, text) => hosts(page).evaluateAll((els, t) => els.some((e) => e.textContent.includes(t)), text)
const projectRow = (page, name) => page.locator('.home-row').filter({ hasText: name }).first().locator('button').first()

let { app, page } = await launch()

// Primeiro uso: uma pasta, e depois nunca mais
check('o primeiro uso pede a pasta de trabalho', await button(page, 'Escolher pasta').isVisible())
await button(page, 'Escolher pasta').click()
await page.waitForSelector('.home-actions')
check('cria a organização da IDE na pasta', ['Ambientes', 'Projetos', 'Temporarios'].every((d) => existsSync(join(workspaceDir, d))))
for (const label of ['Criar sessão', 'Carregar sessão', 'Criar ambiente', 'Carregar ambiente']) {
  check(`a tela inicial oferece: ${label}`, await button(page, label).isVisible())
}
await shot(page, '0-inicio')

// Dica dos ícones
await button(page, 'Abrir pasta da IDE').hover()
await page.waitForSelector('.tooltip')
check('passar o mouse mostra a descrição do ícone', (await page.locator('.tooltip').innerText()) === 'Abrir pasta da IDE')

// Projeto novo sem escolher lugar
await button(page, 'Criar ambiente').click()
await page.getByLabel('Nome do novo projeto').fill('a/b')
await button(page, 'Criar projeto').click()
await page.waitForSelector('.toast')
check('recusa um nome de projeto inválido', !existsSync(join(workspaceDir, 'Projetos', 'a')))
await page.getByLabel('Nome do novo projeto').fill('Novo site')
await button(page, 'Criar projeto').click()
await page.getByRole('button', { name: /Em branco/ }).waitFor()
check('o projeto novo nasce em Projetos, sem perguntar onde', existsSync(join(workspaceDir, 'Projetos', 'Novo site')))
await button(page, 'Voltar').click()
await button(page, 'Voltar').click()

// Pasta existente e ambiente em branco
await button(page, 'Criar ambiente').click()
await button(page, 'Adicionar pasta existente').click()
await page.getByRole('button', { name: /Em branco/ }).click()
await page.waitForSelector('.dock-empty')
check('o ambiente usa o nome do projeto', await page.getByRole('tab', { name: 'loja', exact: true }).isVisible())
await button(page, 'Arquivos').hover()
await page.locator('.tooltip', { hasText: 'Arquivos' }).waitFor()
check('os ícones laterais têm descrição', await page.locator('.tooltip').isVisible())
await shot(page, '0b-dica')

// O botão central, que antes não respondia: clique real pelo mouse, sem atalhos
const center = await box(page.locator('.dock-empty button'))
await page.mouse.click(center.x + center.width / 2, center.y + center.height / 2)
await page.locator('.environment:visible .terminal-panel').first().waitFor({ timeout: 8000 }).catch(() => {})
check('o botão central cria a sessão', (await page.locator('.environment:visible .terminal-panel').count()) === 1)
await sleep(600)
let closeConfirmations = 0
const countConfirmation = () => closeConfirmations++
page.on('dialog', countConfirmation)
await button(page, 'Fechar').first().click()
await sleep(600)
page.off('dialog', countConfirmation)
check('fechar uma sessão em execução não pede confirmação', closeConfirmations === 0)
check('o botão central volta quando não há painéis', (await page.locator('.dock-empty').count()) === 1)

// Grade
for (let i = 0; i < 4; i++) await newTerminal(page)
check('cria quatro sessões', (await page.locator('.environment:visible .terminal-panel').count()) === 4)
const panels = await hosts(page).evaluateAll((els) =>
  els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
)
const xs = new Set(panels.map((p) => p[0])), ys = new Set(panels.map((p) => p[1]))
check('as sessões formam uma grade', xs.size >= 2 && ys.size >= 2, JSON.stringify(panels))
await typeIn(page, 0, 'echo MARCADOR-SESSAO\r')
await sleep(1500)
await shot(page, '1-grade')

// Histórico do terminal
await typeIn(page, 1, '1..300 | ForEach-Object { "LINHA-$_" }\r')
await sleep(1500)
const secondTerminal = hosts(page).nth(1)
const hasFirstLine = () => secondTerminal.evaluate((e) => /LINHA-1\s/.test(e.querySelector('.xterm-rows').textContent) || /LINHA-1LINHA-2/.test(e.querySelector('.xterm-rows').textContent))
check('a saída longa empurra o início para o histórico', !(await hasFirstLine()))
const secondBox = await box(secondTerminal)
await page.mouse.move(secondBox.x + 100, secondBox.y + 100)
for (let i = 0; i < 150; i++) await page.mouse.wheel(0, -1000)
await sleep(500)
check('a rolagem do mouse alcança o histórico', await hasFirstLine())
for (let i = 0; i < 150; i++) await page.mouse.wheel(0, 1000)
await sleep(300)

// Destaque
const hostHandle = await hosts(page).first().elementHandle()
await button(page, 'Destacar').first().click()
await sleep(500)
const focusedBox = await box(hosts(page).first())
check('destacar ocupa quase toda a área', focusedBox.width > 1200 && focusedBox.height > 650, JSON.stringify(focusedBox))
check('faixas das outras sessões aparecem', (await page.locator('.focus-strips .strip').count()) === 4)
await shot(page, '2-destaque')
check('destacar mantém o terminal e o conteúdo', await hostHandle.evaluate((e) => e.isConnected && e.textContent.includes('MARCADOR-SESSAO')))
await page.locator('.focus-strips .strip').nth(1).click()
await sleep(400)
check('faixa troca a sessão destacada', (await page.locator('.focus-strips .strip.on').innerText()).startsWith('Terminal'))
await button(page, 'Visão geral').click()
await sleep(400)
check('volta à visão geral', (await page.locator('.focus-strips').count()) === 0)
check('o terminal sobrevive à volta', await hostHandle.evaluate((e) => e.isConnected && e.textContent.includes('MARCADOR-SESSAO')))

// Arrastar
const tab = page.locator('.environment:visible .panel-tab').first()
const target = hosts(page).nth(3)
const from = await box(tab), to = await box(target)
await page.mouse.move(from.x + 90, from.y + from.height / 2)
await page.mouse.down()
await page.mouse.move(from.x + 110, from.y + from.height / 2, { steps: 4 })
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
await sleep(200)
await page.mouse.up()
await sleep(700)
const groups = await page.locator('.environment:visible .dv-groupview').count()
check('arrastar uma aba move o painel para outro grupo', groups === 3, `${groups} grupos`)
check('o terminal arrastado mantém o conteúdo', await anyHostHas(page, 'MARCADOR-SESSAO'))
await page.locator('.environment:visible .terminal-panel:visible').first().click()
await page.keyboard.type('echo DEPOIS-DE-ARRASTAR\r')
await sleep(1200)
await shot(page, '3-arrastado')
check('continua aceitando digitação depois de arrastar', await anyHostHas(page, 'DEPOIS-DE-ARRASTAR'))

// Shift+Enter: lê os bytes que chegam ao processo, pela tecla real
await page.keyboard.type(`node -e "process.stdin.setRawMode(true);process.stdin.once('data',d=>{console.log('BYTES-'+d.toString('hex'));process.exit()})"\r`)
await sleep(1500)
await page.keyboard.press('Shift+Enter')
await sleep(800)
check('Shift+Enter envia quebra de linha, não Enter', await anyHostHas(page, 'BYTES-1b0d'))

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

// Uso do Claude no rodapé, e configurações para escondê-lo
const usageBar = page.locator('.usage-bar')
check('o rodapé aparece antes de haver dados', (await usageBar.textContent()).includes('5h') && (await usageBar.textContent()).includes('—'))
const inHours = (h) => Date.now() + h * 3600000
writeFileSync(join(profile, 'uso-claude.json'), JSON.stringify({ fiveHour: { usedPercentage: 23.4, resetsAt: inHours(2) }, sevenDay: { usedPercentage: 92, resetsAt: inHours(72) }, updatedAt: Date.now() }))
await page.waitForFunction(() => document.querySelector('.usage-bar')?.textContent.includes('23%'), null, { timeout: 5000 }).catch(() => {})
const usageText = (await usageBar.textContent()).replace(/\s+/g, ' ')
check('o rodapé mostra 5h e semana', usageText.includes('5h ▰▱▱▱▱ 23%') && usageText.includes('Semana ▰▰▰▰▰ 92%'), usageText)
check('uso alto aparece como crítico', (await page.locator('.usage-meter.critical').count()) === 1)
check('terminal comum não mostra contexto', !usageText.includes('Contexto'))

// Contexto: da sessão do Claude que está em uso
const claudeSettings = join(profile, 'claude-settings')
const settingsBefore = existsSync(claudeSettings) ? readdirSync(claudeSettings) : []
await button(page, 'Nova sessão').click()
await sleep(1500)
const claudeId = readdirSync(claudeSettings).find((f) => !settingsBefore.includes(f))?.replace('.json', '')
check('Claude Code recebe a linha de status da IDE', Boolean(claudeId))
await page.waitForFunction(() => document.querySelector('.usage-bar')?.textContent.includes('Contexto'), null, { timeout: 5000 }).catch(() => {})
check('a sessão do Claude mostra o contexto vazio antes da primeira resposta', (await usageBar.textContent()).replace(/\s+/g, ' ').includes('Contexto ▱▱▱▱▱ —'))
writeFileSync(join(profile, 'contexto', `${claudeId}.json`), JSON.stringify({ usedPercentage: 34, size: 200000, updatedAt: Date.now() }))
await page.waitForFunction(() => document.querySelector('.usage-bar')?.textContent.includes('34%'), null, { timeout: 5000 }).catch(() => {})
check('o rodapé mostra o contexto da sessão', (await usageBar.textContent()).replace(/\s+/g, ' ').includes('Contexto ▰▰▱▱▱ 34%'))
await shot(page, '5b-rodape-uso')
await page.locator('.environment:visible .terminal-panel').first().click()
await sleep(300)
check('trocar para um terminal esconde o contexto', !(await usageBar.textContent()).includes('Contexto'))

await button(page, 'Configurações').click()
const settingsDialog = page.getByRole('dialog', { name: 'Configurações' })
const usageOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar uso do Claude no rodapé' })
const contextOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar janela de contexto no rodapé' })
await usageOption.uncheck()
await sleep(200)
check('cada opção esconde só o seu indicador', !(await usageBar.textContent()).includes('5h'))
await contextOption.uncheck()
await sleep(300)
check('sem nada para mostrar, o rodapé some', (await usageBar.count()) === 0)
const savedPrefs = JSON.parse(readFileSync(join(profile, 'preferencias.json'), 'utf8'))
check('as escolhas ficam gravadas', savedPrefs.showUsage === false && savedPrefs.showContext === false)
await shot(page, '5c-configuracoes')
await usageOption.check()
await contextOption.check()
await settingsDialog.getByRole('button', { name: 'Fechar', exact: true }).click()
check('religar mostra o rodapé', await usageBar.isVisible())
await page.locator('.environment:visible .panel-tab', { hasText: 'Sessão' }).last().getByRole('button', { name: 'Fechar', exact: true }).click()
await sleep(500)
check('fechar a sessão apaga os arquivos dela', !existsSync(join(claudeSettings, `${claudeId}.json`)) && !existsSync(join(profile, 'contexto', `${claudeId}.json`)))

// Plugins: ativar e desativar, com aviso para as sessões abertas, sem reiniciar nada
await button(page, 'Nova sessão').click()
await sleep(1500)
const pluginSessionCount = await hosts(page).count()
await button(page, 'Plugins').click()
const pluginsPanel = page.locator('.environment:visible .plugins-panel')
await pluginsPanel.locator('.plugin').first().waitFor({ timeout: 15000 })
check('o painel lista os plugins e quantos estão ativos', (await pluginsPanel.textContent()).includes('1 de 2 ativos'))
await pluginsPanel.getByRole('button', { name: /revisor/ }).click()
check('abrir um plugin mostra o que ele traz', (await pluginsPanel.locator('.plugin-details').textContent()).includes('revisar'))
await pluginsPanel.getByRole('switch', { name: 'Desativar revisor' }).click()
await pluginsPanel.getByText('0 de 2 ativos').waitFor({ timeout: 15000 })
const fakeState = JSON.parse(readFileSync(pluginState, 'utf8'))
check('desativar passa pelo comando do Claude Code', fakeState.plugins.find((p) => p.id === 'revisor@teste').enabled === false)
check('avisa quais sessões precisam reiniciar', await pluginsPanel.locator('.plugins-notice').filter({ hasText: 'Sessão' }).isVisible())
check('não reinicia nenhuma sessão sozinho', (await hosts(page).count()) === pluginSessionCount && (await page.locator('.environment:visible .terminal-stopped').count()) === 0)
await shot(page, '5d-plugins')
await pluginsPanel.getByRole('switch', { name: 'Ativar desligado' }).click()
await pluginsPanel.getByText('1 de 2 ativos').waitFor({ timeout: 15000 })
check('ativar também funciona', JSON.parse(readFileSync(pluginState, 'utf8')).plugins.find((p) => p.id === 'desligado@teste').enabled === true)
await button(page, 'Dispensar aviso').click()
check('o aviso pode ser dispensado', (await pluginsPanel.locator('.plugins-notice').count()) === 0)
await button(page, 'Plugins').click()
check('abrir de novo não duplica o painel', (await page.locator('.environment:visible .plugins-panel').count()) === 1)
await page.locator('.environment:visible .panel-tab', { hasText: 'Plugins' }).getByRole('button', { name: 'Fechar', exact: true }).click()
await page.locator('.environment:visible .panel-tab', { hasText: 'Sessão' }).last().getByRole('button', { name: 'Fechar', exact: true }).click()
await sleep(500)

// Comandos como botões nas abas de terminal
const settingsCommands = page.getByRole('dialog', { name: 'Configurações' })
const newCommand = async (command, { name = '', all = false, icon = 'Ícone Testes' } = {}) => {
  await settingsCommands.getByRole('button', { name: 'Novo comando', exact: true }).click()
  await settingsCommands.getByLabel('Comando').fill(command)
  if (name) await settingsCommands.getByLabel('Nome').fill(name)
  if (all) await settingsCommands.getByRole('radio', { name: 'Todos os projetos' }).check()
  await settingsCommands.getByRole('button', { name: icon, exact: true }).click()
  await settingsCommands.getByRole('button', { name: 'Salvar', exact: true }).click()
  await settingsCommands.getByRole('button', { name: 'Novo comando', exact: true }).waitFor()
}
await button(page, 'Nova sessão').click()
await sleep(1200)
await button(page, 'Configurações').click()
await newCommand('echo CMD-PROJETO', { name: 'Eco' })
await newCommand('echo CMD-GERAL', { all: true, icon: 'Ícone Executar' })
await shot(page, '5e-comandos')
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
const terminalTabs = page.locator('.environment:visible .panel-tab', { hasText: 'Terminal' })
const projectButtons = page.locator('.environment:visible').getByRole('button', { name: 'Eco: echo CMD-PROJETO', exact: true })
check('o comando vira botão em cada aba de terminal', (await projectButtons.count()) === (await terminalTabs.count()) && (await projectButtons.count()) > 0)
check('o comando geral também aparece', (await page.locator('.environment:visible').getByRole('button', { name: 'echo CMD-GERAL', exact: true }).count()) > 0)
const claudeTab = page.locator('.environment:visible .panel-tab', { hasText: 'Sessão' }).last()
check('sessões do Claude não recebem os botões', (await claudeTab.locator('.tab-commands').count()) === 0)
const firstTab = terminalTabs.first()
const order = await firstTab.evaluate((tab) => {
  const all = [...tab.querySelectorAll('button')]
  return [all.findIndex((b) => b.getAttribute('aria-label') === 'Fechar'), all.findIndex((b) => b.getAttribute('aria-label') === 'Eco: echo CMD-PROJETO')]
})
check('o X vem antes dos comandos', order[0] >= 0 && order[0] < order[1], JSON.stringify(order))
await firstTab.getByRole('button', { name: 'Eco: echo CMD-PROJETO', exact: true }).click()
await sleep(1200)
check('o clique executa na hora', await hosts(page).evaluateAll((els) => els.some((e) => (e.textContent.match(/CMD-PROJETO/g) ?? []).length >= 2)))
check('o comando do projeto fica na pasta de trabalho', readFileSync(join(workspaceDir, 'comandos.json'), 'utf8').includes('CMD-PROJETO'))
check('o comando geral fica no perfil do app', readFileSync(join(profile, 'comandos.json'), 'utf8').includes('CMD-GERAL'))
await button(page, 'Configurações').click()
for (const n of [1, 2, 3]) await newCommand(`echo EXTRA-${n}`, { all: true })
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
await firstTab.getByRole('button', { name: 'Mais comandos', exact: true }).click()
check('acima de 4, os comandos vão para um menu', (await page.locator('.tab-command-menu [role=menuitem]').count()) === 1)
check(
  'o menu aparece por cima, sem ser cortado pela barra de abas',
  await page.locator('.tab-command-menu [role=menuitem]').first().evaluate((item) => {
    const box = item.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === item
  })
)
await shot(page, '5f-comandos-na-aba')
// Gerais vêm antes dos do projeto: o quinto, no menu, é o Eco.
const ecoRuns = () => hosts(page).evaluateAll((els) => Math.max(...els.map((e) => (e.textContent.match(/CMD-PROJETO/g) ?? []).length)))
const ecoBefore = await ecoRuns()
check('o menu mostra o quinto comando', (await page.locator('.tab-command-menu [role=menuitem]').first().textContent()) === 'Eco')
await page.locator('.tab-command-menu [role=menuitem]').first().click()
await sleep(800)
check('o menu também executa', (await ecoRuns()) >= ecoBefore + 2)
await button(page, 'Configurações').click()
for (const label of ['Eco', 'echo CMD-GERAL', 'echo EXTRA-1', 'echo EXTRA-2', 'echo EXTRA-3']) await settingsCommands.getByRole('button', { name: `Apagar ${label}`, exact: true }).click()
await sleep(400)
check('apagar tira os botões', (await page.locator('.environment:visible .tab-commands').count()) === 0)
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
await claudeTab.getByRole('button', { name: 'Fechar', exact: true }).click()
await sleep(400)

// Tema
await button(page, 'Tema escuro').click()
await sleep(400)
check('alterna para o tema escuro', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
await goHome(page)
await sleep(200)
await shot(page, '6-inicio-escuro')
await page.getByRole('tab', { name: 'loja', exact: true }).click()
await button(page, 'Tema claro').click()

// Exportar
await button(page, 'Exportar ambiente').click()
await page.getByRole('dialog', { name: 'Exportar ambiente' }).getByRole('button', { name: 'Exportar' }).click()
await sleep(500)
const exported = readFileSync(exchange, 'utf8')
check('exporta sem caminhos da máquina', !exported.includes(base.replaceAll('\\', '\\\\')) && !exported.includes(project))
check('exporta sem o conteúdo do segredo', !exported.includes('MUDOU_NO_DISCO'))

// Importar para um projeto
await goHome(page)
await button(page, 'Carregar ambiente').click()
await button(page, 'Importar de um arquivo').click()
await projectRow(page, 'loja').click()
await sleep(1000)
check('importa como outra aba', (await page.locator('.tab-list [role=tab]').count()) === 2)
check('sessões importadas não iniciam sozinhas', (await page.locator('.environment:visible').getByRole('button', { name: 'Iniciar' }).count()) >= 1)
await page.locator('.tab-list [role=tab]').first().click()
await sleep(500)
check('o primeiro ambiente segue com as sessões', await anyHostHas(page, 'DEPOIS-DE-ARRASTAR'))

// Ambiente salvo como modelo
await goHome(page)
await button(page, 'Criar ambiente').click()
await projectRow(page, 'Novo site').click()
const fromSaved = page.locator('.home-row').filter({ hasText: 'Copia o layout' }).first()
check('criar ambiente oferece os já salvos como modelo', await fromSaved.isVisible())
await shot(page, '6b-modelos')
await fromSaved.locator('button').first().click()
await sleep(1000)
const copied = page.locator('.environment:visible')
check('o modelo copia as sessões sem iniciá-las', (await copied.getByRole('button', { name: 'Iniciar' }).count()) >= 3 && !(await anyHostHas(page, 'MARCADOR-SESSAO')))
check('o modelo não muda o ambiente original', (await page.locator('.tab-list [role=tab]').count()) === 3)

// Pensar junto
await goHome(page)
await button(page, 'Criar ambiente').click()
await projectRow(page, 'loja').click()
await page.getByRole('button', { name: /Pensar junto/ }).click()
await page.waitForSelector('.environment:visible .panel-empty .file')
await sleep(1200)
check('pensar junto abre sessão e seletor de Markdown', (await page.locator('.environment:visible .terminal-panel').count()) === 1)
await page.locator('.environment:visible .panel-empty .file', { hasText: 'ideia.md' }).click()
await page.waitForSelector('.environment:visible .markdown h1')
check('o Markdown abre ao lado da sessão', (await page.locator('.environment:visible .dv-groupview').count()) === 2)
await shot(page, '7b-pensar-junto')

// Worktree
const openWorktreeDialog = async () => {
  await button(page, 'Nova sessão do Claude Code em worktree').click()
  await page.getByRole('dialog', { name: 'Nova sessão em worktree' }).waitFor()
}
const worktreeDialog = page.getByRole('dialog', { name: 'Nova sessão em worktree' })
check('não há mais menu de opções', (await button(page, 'Nova sessão com opções').count()) === 0)
await openWorktreeDialog()
check('criar exige um nome', await button(page, 'Criar').isDisabled())
await worktreeDialog.getByRole('textbox').fill('Corrigir Login')
check('mostra a branch e a pasta que serão criadas', /agent\/corrigir-login[\s\S]*loja\.worktrees\/corrigir-login/.test(await worktreeDialog.textContent()))
await shot(page, '7b1-worktree')
await button(page, 'Criar').click()
await page.locator('.toast', { hasText: '.env' }).waitFor()
check('avisa que o .env não foi para a worktree', true)
check('fecha a janela ao criar', (await worktreeDialog.count()) === 0)
check('cria uma branch com o nome escolhido', /agent\/corrigir-login/.test(git('branch', '--list', 'agent/*')))
const worktrees = join(base, 'loja.worktrees')
check('cria a worktree ao lado do repositório', existsSync(join(worktrees, 'corrigir-login')))
check('não copia o .env para a worktree', !existsSync(join(worktrees, 'corrigir-login', '.env')))
check('não altera a branch do repositório principal', git('branch', '--show-current').trim() === 'main')
check('a sessão usa o nome da worktree', await page.locator('.environment:visible .panel-tab', { hasText: 'corrigir-login' }).isVisible())

await openWorktreeDialog()
await worktreeDialog.getByRole('textbox').fill('corrigir login')
await button(page, 'Criar').click()
await page.locator('.worktree-error').waitFor()
check('recusa um nome já usado e mantém a janela', (await page.locator('.worktree-error').textContent()).includes('corrigir-login') && (await readdirSync(worktrees).length) === 1)
await shot(page, '7b1b-worktree-repetida')
await button(page, 'Nome aleatório').click()
await worktreeDialog.waitFor({ state: 'detached', timeout: 15000 })
await sleep(300)
check('o nome aleatório cria outra worktree', readdirSync(worktrees).length === 2 && !(await worktreeDialog.isVisible()))

// Terminal na pasta da sessão atual: a da worktree, depois a de outra sessão
const inWorktree = () => hosts(page).evaluateAll((els) => els.filter((e) => e.textContent.includes('PS ') && e.textContent.includes('loja.worktrees')).length)
const openTerminal = button(page, 'Abrir terminal na pasta da sessão atual')
const terminalsBefore = await hosts(page).count()
await openTerminal.click()
await sleep(1500)
check('o terminal abre na pasta da sessão atual', (await hosts(page).count()) === terminalsBefore + 1 && (await inWorktree()) === 1, `${await inWorktree()} na worktree`)
await page.keyboard.type('echo FOCO-NO-TERMINAL\r')
await sleep(800)
check('o terminal novo já recebe a digitação', await anyHostHas(page, 'FOCO-NO-TERMINAL'))
await shot(page, '7b2-terminal-da-sessao')
await page.locator('.environment:visible .terminal-panel').first().click()
await openTerminal.click()
await sleep(1500)
check('acompanha a sessão clicada', (await hosts(page).count()) === terminalsBefore + 2 && (await inWorktree()) === 1)

// Sessão rápida: só o projeto, sem configurar nada
const tabsBefore = await page.locator('.tab-list [role=tab]').count()
await goHome(page)
await button(page, 'Criar sessão').click()
await projectRow(page, 'loja').click()
await page.getByRole('tab', { name: 'Sem título' }).waitFor()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
check('criar sessão abre direto, em uma aba temporária', (await page.locator('.tab-list [role=tab]').count()) === tabsBefore + 1)
await sleep(500)
check('o temporário fica em Temporarios', readdirSync(join(workspaceDir, 'Temporarios')).length === 1)
await shot(page, '7c-sessao-rapida')
await button(page, 'Salvar como ambiente').click()
await page.getByLabel('Nome do ambiente').fill('Revisão')
await button(page, 'Salvar').click()
await page.getByRole('tab', { name: 'Revisão' }).waitFor()
check('salvar move para Ambientes', readdirSync(join(workspaceDir, 'Temporarios')).length === 0 && readdirSync(join(workspaceDir, 'Ambientes')).some((f) => f.startsWith('revisao-')))
check('depois de salvo, some a opção de salvar', (await button(page, 'Salvar como ambiente').count()) === 0)

// Sessão temporária: fechar pergunta, e continua disponível até fechar
await goHome(page)
await button(page, 'Criar sessão').click()
await projectRow(page, 'loja').click()
await page.getByRole('tab', { name: 'Sem título' }).waitFor()
await sleep(1000)
await page.locator('.tab', { hasText: 'Sem título' }).hover()
await button(page, 'Fechar Sem título').click()
await page.getByRole('dialog', { name: 'Fechar sessão temporária' }).waitFor()
check('fechar um temporário pergunta se quer salvar', true)
await button(page, 'Cancelar').click()
check('cancelar mantém a aba', await page.getByRole('tab', { name: 'Sem título' }).isVisible())

// Fechar um ambiente salvo não o apaga
await page.locator('.tab', { hasText: 'Revisão' }).hover()
await button(page, 'Fechar Revisão').click()
await sleep(500)
check('fechar a aba não apaga o ambiente salvo', readdirSync(join(workspaceDir, 'Ambientes')).some((f) => f.startsWith('revisao-')))

// Reinício: volta como estava, e o que trabalhava pede atenção
const tabNames = (p) => p.locator('.tab-list [role=tab]').allTextContents()
await page.getByRole('tab', { name: 'Sem título' }).click()
await newTerminal(page)
const workingIndex = (await page.locator('.environment:visible .terminal-panel').count()) - 1
await typeIn(page, workingIndex, 'while ($true) { Write-Host TRABALHANDO; Start-Sleep -Milliseconds 300 }\r')
await sleep(8000)
const tabsAtClose = await tabNames(page)
await app.close()
await sleep(500)
;({ app, page } = await launch())
await page.locator('.tab-list [role=tab]').first().waitFor()
await page.locator('.environment:visible .panel-tab').first().waitFor()
await sleep(2500)
check('não pede a pasta de novo', (await button(page, 'Escolher pasta').count()) === 0)
check('as abas voltam na mesma ordem', JSON.stringify(await tabNames(page)) === JSON.stringify(tabsAtClose), (await tabNames(page)).join(', '))
check('volta na aba que estava ativa', await page.locator('.tab.on', { hasText: 'Sem título' }).isVisible())
check('as sessões voltam abertas, sem botão de retomar', (await page.locator('.environment:visible .terminal-stopped').count()) === 0)
check('a sessão retomada não continua o que fazia', !(await anyHostHas(page, 'TRABALHANDO')))
check('a aba do ambiente mostra que pede atenção', await page.locator('.tab', { hasText: 'Sem título' }).locator('.attention-mark').isVisible())
check('só o ambiente interrompido pede atenção', (await page.locator('.tab .attention-mark').count()) === 1)
check('só a sessão interrompida pede atenção', (await page.locator('.tab-attention').count()) === 1, await page.locator('.panel-tab', { has: page.locator('.tab-attention') }).first().textContent())
await shot(page, '8-restaurado-com-atencao')
await goHome(page)
check('a tela inicial avisa da atenção', await page.locator('.home-resume em').isVisible())
await shot(page, '8a-tela-inicial-retomar')
await page.getByRole('button', { name: /^Retomar/ }).click()
await page.locator('.environment:visible .tab-attention').waitFor()
check('Retomar leva à aba já aberta, sem duplicar', (await tabNames(page)).length === tabsAtClose.length)
await page.locator('.environment:visible .terminal-panel').nth(workingIndex).click()
await page.keyboard.type('x')
await sleep(300)
check('digitar na sessão tira o aviso', (await page.locator('.tab-attention').count()) === 0 && (await page.locator('.attention-mark').count()) === 0)

// Sessões e ambientes anteriores continuam disponíveis
await goHome(page)
await button(page, 'Carregar ambiente').click()
await shot(page, '8-carregar-ambiente')
check('o temporário sobrevive ao reinício', await page.locator('.home-row').filter({ hasText: 'Sem título' }).first().isVisible())
await page.locator('.home-row').filter({ hasText: /^lojaloja,/ }).first().locator('button').first().click()
await page.waitForSelector('.environment:visible .panel-tab')
await sleep(800)
check('restaura as sessões do ambiente', (await page.locator('.environment:visible .terminal-panel').count()) === 4)
check('restaura o layout', (await page.locator('.environment:visible .dv-groupview').count()) >= 3)
check('as sessões do ambiente também voltam abertas', (await page.locator('.environment:visible .terminal-stopped').count()) === 0)
await shot(page, '8b-reaberto')

// Queda do app, com uma sessão destacada
await page.locator('.environment:visible').getByRole('button', { name: 'Destacar', exact: true }).first().click()
await sleep(800)
const tabsAtCrash = await tabNames(page)
// app.process() não é o processo principal no Windows: encerrá-lo deixaria o app aberto.
const mainPid = await app.evaluate(() => process.pid)
execFileSync('taskkill', ['/F', '/PID', String(mainPid)], { stdio: 'ignore' })
await sleep(1500)
;({ app, page } = await launch())
await page.locator('.tab-list [role=tab]').first().waitFor()
await page.locator('.environment:visible .panel-tab').first().waitFor()
await sleep(1000)
check('as abas sobrevivem a uma queda', JSON.stringify(await tabNames(page)) === JSON.stringify(tabsAtCrash))
check('a sessão destacada continua destacada', await page.locator('.focus-strips').isVisible())

// Apagar
await goHome(page)
await button(page, 'Carregar ambiente').click()
const before = readdirSync(join(workspaceDir, 'Ambientes')).length
await button(page, 'Apagar Revisão').click()
await sleep(400)
check('apagar remove o ambiente', readdirSync(join(workspaceDir, 'Ambientes')).length === before - 1)

// Fechar todas as abas e usar o botão Retomar: volta o último ambiente fechado
await page.getByRole('button', { name: 'Voltar', exact: true }).click()
const closeTab = async (name) => {
  await page.locator('.tab', { has: page.getByRole('tab', { name, exact: true }) }).hover()
  await button(page, `Fechar ${name}`).click()
  await sleep(300)
  if (await page.getByRole('dialog', { name: 'Fechar sessão temporária' }).isVisible()) await button(page, 'Descartar').click()
  await sleep(500)
}
for (const name of await tabNames(page)) if (name !== 'loja') await closeTab(name)
await page.getByRole('tab', { name: 'loja', exact: true }).click()
await sleep(300)
await closeTab('loja')
await page.waitForSelector('.home-actions')
check('o botão Retomar oferece o último ambiente', (await page.getByRole('button', { name: /^Retomar/ }).textContent()).startsWith('Retomarloja ·'))
await shot(page, '8c-sem-abas')
await page.getByRole('button', { name: /^Retomar/ }).click()
await page.getByRole('tab', { name: 'loja', exact: true }).waitFor()
await page.locator('.environment:visible .panel-tab').first().waitFor()
await sleep(1000)
check('Retomar reabre o ambiente com o layout', (await page.locator('.environment:visible .dv-groupview').count()) >= 3)
check('Retomar reabre as sessões', (await page.locator('.environment:visible .terminal-panel').count()) === 4 && (await page.locator('.environment:visible .terminal-stopped').count()) === 0)

// Sem abas abertas, abre na tela inicial, com o que retomar
await closeTab('loja')
await app.close()
await sleep(500)
;({ app, page } = await launch())
await page.waitForSelector('.home-actions')
check('sem abas abertas, reabre na tela inicial', (await page.locator('.tab-list [role=tab]').count()) === 0)
check('a tela inicial oferece Retomar', await page.getByRole('button', { name: /^Retomar/ }).isVisible())
await app.close()
// Os processos encerrados demoram a soltar a pasta no Windows.
rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
