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

// Os terminais usam o shell do sistema: PowerShell no Windows, o $SHELL (bash ou zsh) no Mac e no Linux.
const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'
const sh = WIN
  ? {
      nodeEnv: 'echo "NODE-ENV=[$env:NODE_ENV]"',
      lines: '1..300 | ForEach-Object { "LINHA-$_" }',
      loop: 'while ($true) { Write-Host TRABALHANDO; Start-Sleep -Milliseconds 300 }'
    }
  : {
      nodeEnv: 'echo "NODE-ENV=[$NODE_ENV]"',
      lines: 'for i in $(seq 1 300); do echo LINHA-$i; done',
      loop: 'while true; do echo TRABALHANDO; sleep 0.3; done'
    }
// Atalhos do editor: Cmd no Mac.
const SAVE = MAC ? 'Meta+S' : 'Control+S'
const DOC_END = MAC ? 'Meta+ArrowDown' : 'Control+End'
const killApp = (pid) => (WIN ? execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' }) : process.kill(pid, 'SIGKILL'))

const base = mkdtempSync(join(tmpdir(), 'agent-ide-e2e-'))
const project = join(base, 'loja')
const profile = join(base, 'perfil')
const workspaceDir = join(base, 'trabalho')
// Onde a pessoa escolhe criar projetos novos: fora da pasta de trabalho da IDE.
const projectsParent = join(base, 'codigo')
// Transcripts falsos do Claude Code: o e2e nunca escreve no ~/.claude de verdade.
const transcripts = join(base, 'transcripts')
const exchange = join(base, 'loja.ambiente.json')
for (const dir of [join(project, 'docs'), profile, workspaceDir, projectsParent]) mkdirSync(dir, { recursive: true })
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

// Confirmações são aceitas; para testar o "Cancelar", ligue dismissNextDialog antes do clique.
const confirmations = []
let dismissNextDialog = false

async function launch() {
  const env = {
    ...process.env,
    AGENT_IDE_USER_DATA: profile,
    AGENT_IDE_TEST_DIRECTORY: project,
    AGENT_IDE_TEST_PROJECT_PARENT: projectsParent,
    AGENT_IDE_TEST_TRANSCRIPTS: transcripts,
    AGENT_IDE_TEST_WORKSPACE: workspaceDir,
    AGENT_IDE_TEST_EXCHANGE_FILE: exchange,
    AGENT_IDE_TEST_PLUGIN_CLI: join(here, 'fake-claude-plugins.cjs'),
    AGENT_IDE_TEST_PLUGIN_STATE: pluginState
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  // Como o npm run start (electron-vite preview) abre o app.
  env.NODE_ENV = 'production'
  const app = await _electron.launch({ executablePath: electronPath, args: [root], env, cwd: root })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => check(`sem erro na página: ${e.message}`, false))
  page.on('dialog', (d) => {
    confirmations.push(d.message())
    if (dismissNextDialog) {
      dismissNextDialog = false
      void d.dismiss()
    } else void d.accept()
  })
  await page.waitForSelector('.app')
  return { app, page }
}

const button = (page, label) => page.getByRole('button', { name: label, exact: true })
// O mouse de verdade sobre a janela também gera eventos e pode tirar a dica: tenta algumas vezes.
const hoverTip = async (page, label) => {
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(0, 0)
    await button(page, label).hover()
    const shown = await page.locator('.tooltip', { hasText: label }).waitFor({ timeout: 2000 }).then(() => true, () => false)
    if (shown) return true
  }
  return false
}
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

// Menu nativo: o padrão do Electron recarregava a janela com Ctrl+R e fechava a IDE com Ctrl+W,
// atalhos que o terminal e o Claude Code usam.
const menuShortcuts = await app.evaluate(({ Menu }) => {
  const menu = Menu.getApplicationMenu()
  if (!menu) return null
  const found = []
  const walk = (items) => items.forEach((i) => (found.push(`${i.role ?? i.label}=${i.accelerator ?? ''}`), i.submenu && walk(i.submenu.items)))
  walk(menu.items)
  return found
})
check(
  'o menu nativo não tem recarregar nem fechar',
  MAC ? !menuShortcuts.some((m) => /^(reload|forcereload|close)=/i.test(m) || /=CmdOrCtrl\+[RW]$|=CommandOrControl\+[RW]$/i.test(m)) && menuShortcuts.some((m) => /^copy=/i.test(m)) : menuShortcuts === null,
  JSON.stringify(menuShortcuts)
)

// Primeiro uso: uma pasta, e depois nunca mais
check('o primeiro uso pede a pasta de trabalho', await button(page, 'Escolher pasta').isVisible())
await button(page, 'Escolher pasta').click()
await page.waitForSelector('.home-actions')
check('cria a organização da IDE na pasta', ['Ambientes', 'Templates'].every((d) => existsSync(join(workspaceDir, d))) && !existsSync(join(workspaceDir, 'Projetos')) && !existsSync(join(workspaceDir, 'Temporarios')))
for (const label of ['Criar sessão', 'Carregar sessão', 'Criar ambiente', 'Histórico de ambientes', 'Templates']) {
  check(`a tela inicial oferece: ${label}`, await button(page, label).isVisible())
}
await shot(page, '0-inicio')

// Dica dos ícones
check('passar o mouse mostra a descrição do ícone', (await hoverTip(page, 'Abrir pasta da IDE')) && (await page.locator('.tooltip').innerText()) === 'Abrir pasta da IDE')

// Projeto novo: a pessoa escolhe onde criar
await button(page, 'Carregar sessão').click()
await page.getByLabel('Nome do novo projeto').fill('a/b')
await button(page, 'Criar projeto').click()
await page.waitForSelector('.toast')
check('recusa um nome de projeto inválido', !existsSync(join(projectsParent, 'a')))
await page.getByLabel('Nome do novo projeto').fill('Novo site')
await button(page, 'Criar projeto').click()
await page.locator('.home-note', { hasText: 'Nenhuma conversa' }).waitFor()
check('o projeto novo nasce onde a pessoa escolheu, fora da pasta da IDE', existsSync(join(projectsParent, 'Novo site')) && readdirSync(workspaceDir).every((n) => n !== 'Novo site'))
await button(page, 'Voltar').click()
await button(page, 'Voltar').click()

// Ambiente novo: uma pasta existente entra marcada, com uma sessão do Claude
await button(page, 'Criar ambiente').click()
await button(page, 'Adicionar pasta existente').click()
await page.getByLabel('Sessões do Claude em loja').waitFor()
check(
  'a pasta adicionada entra marcada, com uma sessão do Claude',
  (await page.getByRole('checkbox', { name: 'loja', exact: true }).isChecked()) && (await page.getByLabel('Sessões do Claude em loja').inputValue()) === '1'
)
await button(page, 'Abrir').click()
await page.locator('.environment:visible .terminal-panel').first().waitFor({ timeout: 8000 }).catch(() => {})
check('criar ambiente não oferece modelos de exemplo', (await page.getByRole('button', { name: /Pensar junto|Várias sessões|Em branco/ }).count()) === 0)
check('o ambiente novo abre com uma sessão', (await page.locator('.environment:visible .terminal-panel').count()) === 1)
check('o ambiente usa o nome do projeto', await page.getByRole('tab', { name: 'loja', exact: true }).isVisible())
await sleep(600)
await button(page, 'Fechar').first().click()
await page.waitForSelector('.dock-empty')
check('os ícones laterais têm descrição', await hoverTip(page, 'Arquivos'))
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
await typeIn(page, 2, `${sh.nodeEnv}\r`)
await sleep(1500)
check('os terminais não herdam o NODE_ENV=production do npm run start', await anyHostHas(page, 'NODE-ENV=[]'))
await shot(page, '1-grade')

// Histórico do terminal
await typeIn(page, 1, `${sh.lines}\r`)
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

// Barra lateral: Visão geral expande e recolhe, com o nome ao lado de cada ícone
const rail = page.locator('.environment:visible .rail')
check('Visão geral expande a barra lateral', (await rail.getAttribute('class')).includes('expanded') && (await box(rail)).width > 150)
check('expandida, mostra o nome de cada ação', await rail.getByText('Abrir terminal na pasta da sessão atual').isVisible())
const gridBefore = await box(hosts(page).first())
await page.mouse.move(0, 0)
await rail.getByRole('button', { name: 'Arquivos', exact: true }).hover()
await sleep(500)
check('expandida, passar o mouse não mostra a dica', (await page.locator('.tooltip').count()) === 0)
await shot(page, '2b-barra-expandida')
await button(page, 'Visão geral').click()
await sleep(400)
check('outro clique recolhe', !(await rail.getAttribute('class')).includes('expanded') && (await box(rail)).width < 60)
check('recolhida, a dica volta', await hoverTip(page, 'Arquivos'))
check('a barra expandida empurra o layout, sem cobrir', (await box(hosts(page).first())).x < gridBefore.x)

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
await page.keyboard.press(DOC_END)
await page.keyboard.type('NOVO=1')
await page.keyboard.press(SAVE)
await sleep(500)
check('salva com Ctrl+S', readFileSync(join(project, '.env'), 'utf8').includes('NOVO=1'))
await shot(page, '4-editor')
writeFileSync(join(project, '.env'), 'MUDOU_NO_DISCO=1\n')
await sleep(100)
await page.locator('.monaco-editor').first().click()
await page.keyboard.type('X')
await page.keyboard.press(SAVE)
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
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
check(
  'as configurações mostram a versão, e fora do app instalado não procuram atualização',
  (await settingsDialog.getByText(`Agent IDE ${appVersion}`).isVisible()) &&
    (await settingsDialog.getByText('Atualizações só funcionam no app instalado.').isVisible()) &&
    (await settingsDialog.getByRole('button', { name: 'Procurar atualizações' }).isDisabled())
)
const usageOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar uso do Claude no rodapé' })
const contextOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar janela de contexto no rodapé' })
await usageOption.uncheck()
await sleep(200)
check('cada opção esconde só o seu indicador', !(await usageBar.textContent()).includes('5h'))
await contextOption.uncheck()
const gitOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar Git no rodapé' })
await gitOption.uncheck()
const cacheOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar cache da sessão no rodapé' })
await cacheOption.uncheck()
const tokensOption = settingsDialog.getByRole('checkbox', { name: 'Mostrar tokens da sessão no rodapé' })
await tokensOption.uncheck()
await sleep(300)
check('sem nada para mostrar, o rodapé some', (await usageBar.count()) === 0)
const savedPrefs = JSON.parse(readFileSync(join(profile, 'preferencias.json'), 'utf8'))
check('as escolhas ficam gravadas', savedPrefs.showUsage === false && savedPrefs.showContext === false && savedPrefs.showGit === false && savedPrefs.showCache === false && savedPrefs.showTokens === false)
await shot(page, '5c-configuracoes')
await usageOption.check()
await contextOption.check()
await gitOption.check()
await cacheOption.check()
await tokensOption.check()
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
const settingsCommands = page.getByRole('dialog', { name: 'Comandos' })
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
check('as configurações não têm comandos', (await page.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Novo comando' }).count()) === 0)
await page.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar', exact: true }).click()
await button(page, 'Comandos').click()
await newCommand('echo CMD-PROJETO', { name: 'Eco' })
await newCommand('echo CMD-GERAL', { all: true, icon: 'Ícone Executar' })
await shot(page, '5e-comandos')
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
const terminalTabs = page.locator('.environment:visible .panel-tab', { hasText: 'Terminal' })
const ecoLabel = 'Eco: echo CMD-PROJETO (em um terminal novo)'
const envTab = page.locator('.tab-list .tab.on')
check('o comando vira botão na aba do ambiente', (await envTab.getByRole('button', { name: ecoLabel, exact: true }).count()) === 1)
check('o comando geral também aparece', (await envTab.getByRole('button', { name: 'echo CMD-GERAL (em um terminal novo)', exact: true }).count()) === 1)
check('e em cada aba de terminal', (await page.locator('.environment:visible').getByRole('button', { name: ecoLabel, exact: true }).count()) === (await terminalTabs.count()))
const claudeTab = page.locator('.environment:visible .panel-tab', { hasText: 'Sessão' }).last()
check('sessões do Claude não recebem os botões', (await claudeTab.locator('.tab-commands').count()) === 0)
const firstTab = terminalTabs.first()
const order = await firstTab.evaluate((tab) => {
  const all = [...tab.querySelectorAll('button')]
  return [all.findIndex((b) => b.getAttribute('aria-label') === 'Fechar'), all.findIndex((b) => b.getAttribute('aria-label')?.startsWith('Eco:'))]
})
check('o X vem antes dos comandos', order[0] >= 0 && order[0] < order[1], JSON.stringify(order))
const commandTerminals = page.locator('.environment:visible .panel-tab', { hasText: /^Eco|echo CMD-GERAL/ })
const echoes = (text) => hosts(page).evaluateAll((els, t) => els.filter((e) => (e.textContent.split(t).length - 1) >= 2).length, text)
const hostsBeforeRun = await hosts(page).count()
await envTab.getByRole('button', { name: ecoLabel, exact: true }).click()
await page.locator('.environment:visible .panel-tab', { hasText: 'Eco' }).first().waitFor()
check('o clique abre um terminal novo com o nome do comando', (await hosts(page).count()) === hostsBeforeRun + 1)
check('e executa o comando nele', await page.waitForFunction(() => [...document.querySelectorAll('.environment:not([style*="none"]) .terminal-host')].some((e) => e.textContent.split('CMD-PROJETO').length - 1 >= 2), null, { timeout: 10000 }).then(() => true, () => false))
check('só o terminal novo executa', (await echoes('CMD-PROJETO')) === 1)
await firstTab.getByRole('button', { name: 'echo CMD-GERAL (em um terminal novo)', exact: true }).click()
check('na aba de terminal o clique também abre um terminal novo', await page.waitForFunction((n) => document.querySelectorAll('.environment:not([style*="none"]) .terminal-host').length === n, hostsBeforeRun + 2, { timeout: 8000 }).then(() => true, () => false))
check('o comando geral roda no terminal novo', await page.waitForFunction(() => [...document.querySelectorAll('.environment:not([style*="none"]) .terminal-host')].some((e) => e.textContent.split('CMD-GERAL').length - 1 >= 2), null, { timeout: 10000 }).then(() => true, () => false))
check('o comando do projeto fica na pasta de trabalho', readFileSync(join(workspaceDir, 'comandos.json'), 'utf8').includes('CMD-PROJETO'))
check('o comando geral fica no perfil do app', readFileSync(join(profile, 'comandos.json'), 'utf8').includes('CMD-GERAL'))
await button(page, 'Comandos').click()
for (const n of [1, 2, 3]) await newCommand(`echo EXTRA-${n}`, { all: true })
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
await envTab.getByRole('button', { name: 'Mais comandos', exact: true }).click()
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
check('o menu mostra o quinto comando', (await page.locator('.tab-command-menu [role=menuitem]').first().textContent()) === 'Eco')
await page.locator('.tab-command-menu [role=menuitem]').first().click()
check('o menu também executa', await page.waitForFunction(() => [...document.querySelectorAll('.environment:not([style*="none"]) .terminal-host')].filter((e) => e.textContent.split('CMD-PROJETO').length - 1 >= 2).length === 2, null, { timeout: 10000 }).then(() => true, () => false))
await button(page, 'Comandos').click()
for (const label of ['Eco', 'echo CMD-GERAL', 'echo EXTRA-1', 'echo EXTRA-2', 'echo EXTRA-3']) await settingsCommands.getByRole('button', { name: `Apagar ${label}`, exact: true }).click()
await sleep(400)
check('apagar tira os botões', (await page.locator('.tab-commands').count()) === 0)
await settingsCommands.getByRole('button', { name: 'Fechar', exact: true }).click()
while ((await commandTerminals.count()) > 0) {
  await commandTerminals.first().getByRole('button', { name: 'Fechar', exact: true }).click()
  await sleep(200)
}

// Cache: lido do transcript da sessão do Claude em uso (aqui, numa pasta de teste)
const claudeTitle = (await claudeTab.locator('.tab-title').textContent()).trim()
const claudeSpec = readdirSync(join(workspaceDir, 'Ambientes'))
  .flatMap((f) => JSON.parse(readFileSync(join(workspaceDir, 'Ambientes', f), 'utf8')).sessions)
  .find((s) => s.adapterId === 'claude' && s.title === claudeTitle)
await claudeTab.locator('.tab-title').click()
const footerNow = async () => ((await page.locator('.usage-bar').textContent()) ?? '').replace(/\s+/g, ' ')
check(
  'sem resposta ainda, cache e tokens aparecem vazios',
  await page.waitForFunction(() => /Cache —.*Tokens —/.test(document.querySelector('.usage-bar')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true, () => false),
  await footerNow()
)
const transcriptDir = join(transcripts, claudeSpec.cwd.replace(/[^a-zA-Z0-9]/g, '-'))
mkdirSync(transcriptDir, { recursive: true })
const answeredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
writeFileSync(
  join(transcriptDir, `${claudeSpec.id}.jsonl`),
  // A mesma resposta em duas linhas, como o Claude Code grava: os tokens contam uma vez só.
  [1, 2]
    .map(() =>
      JSON.stringify({
        type: 'assistant',
        timestamp: answeredAt,
        message: {
          id: 'msg_1',
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 } }
        }
      })
    )
    .join('\n') + '\n'
)

check('mostra quanto falta para o cache vencer', await page.waitForFunction(() => /Cache (49|50)min/.test(document.querySelector('.usage-bar')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false), await footerNow())
check('soma os tokens da conversa, contando cada resposta uma vez', await page.waitForFunction(() => (document.querySelector('.usage-bar')?.textContent ?? '').replace(/\s+/g, ' ').includes('Tokens 1,5 mil'), null, { timeout: 15000 }).then(() => true, () => false), await footerNow())
await shot(page, '5g-cache')
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

// Template a partir do ambiente aberto: sessões e layout, sem conversas nem caminhos
await button(page, 'Salvar como template').click()
const templateDialog = page.getByRole('dialog', { name: 'Salvar como template' })
await templateDialog.getByLabel('Nome do template').fill('Loja completa')
await templateDialog.getByRole('button', { name: 'Salvar', exact: true }).click()
await page.locator('.toast', { hasText: 'Template Loja completa salvo' }).waitFor()
const templateFiles = () => readdirSync(join(workspaceDir, 'Templates'))
const savedTemplate = readFileSync(join(workspaceDir, 'Templates', templateFiles()[0]), 'utf8')
check(
  'o template guarda as sessões, sem caminhos da máquina nem conteúdo',
  JSON.parse(savedTemplate).slots.length === 4 && !savedTemplate.includes(JSON.stringify(project).slice(1, -1)) && !savedTemplate.includes('MUDOU_NO_DISCO')
)

// Exportar e importar: o compartilhável agora é o template
await goHome(page)
await button(page, 'Templates').click()
await button(page, 'Exportar Loja completa').click()
await sleep(500)
const exported = readFileSync(exchange, 'utf8')
check('exporta sem caminhos da máquina', !exported.includes(base.replaceAll('\\', '\\\\')) && !exported.includes(project))
check('exporta sem o conteúdo do segredo', !exported.includes('MUDOU_NO_DISCO'))
await button(page, 'Importar de um arquivo').click()
await page.locator('.home-row', { hasText: 'Loja completa' }).nth(1).waitFor()
check('importa o template achando o projeto pelo nome', templateFiles().length === 2)
await shot(page, '6b-templates')
await page.getByRole('button', { name: 'Apagar Loja completa', exact: true }).first().click()
await sleep(400)
check('apagar tira o template', templateFiles().length === 1)

// Novo ambiente: ajustar um template preenche a tabela com as quantidades dele
await button(page, 'Novo ambiente').click()
await button(page, 'Ajustar Loja completa antes de abrir').click()
await page.getByRole('heading', { name: 'Ajustando Loja completa' }).waitFor()
await sleep(300)
check('ajustar um template preenche as quantidades', (await page.getByRole('heading', { name: 'Ajustando Loja completa' }).isVisible()) && (await page.getByLabel('Terminais em loja').inputValue()) === '4')
await shot(page, '6b2-novo-ambiente-templates')

// Um clique no template, no novo ambiente, abre com as sessões e o layout dele, já iniciadas
await page.getByRole('region', { name: 'A partir de um template' }).locator('.home-row', { hasText: 'Loja completa' }).locator('button').first().click()
await page.getByRole('tab', { name: 'Loja completa', exact: true }).waitFor()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
await sleep(1200)
check('o template abre com as sessões e o layout dele', (await page.locator('.environment:visible .terminal-panel').count()) === 4 && (await page.locator('.environment:visible .dv-groupview').count()) >= 3)
check('as sessões do template já iniciam', (await page.locator('.environment:visible .terminal-stopped').count()) === 0)
check('o ambiente original continua aberto', (await page.locator('.tab-list [role=tab]').count()) === 2)

// Ambiente com vários projetos e uma pasta nova
await goHome(page)
await button(page, 'Criar ambiente').click()
await page.getByRole('checkbox', { name: 'loja', exact: true }).check()
await page.getByLabel('Terminais em loja').fill('1')
await page.getByRole('checkbox', { name: 'Novo site', exact: true }).check()
await page.getByLabel('Sessões do Claude em Novo site').fill('0')
await page.getByLabel('Terminais em Novo site').fill('1')
await button(page, '+ Pasta nova').click()
await page.getByLabel('Nome da pasta nova').fill('api-nova')
await page.getByLabel('Sessões do Claude em api-nova').fill('0')
await page.getByLabel('Terminais em api-nova').fill('1')
check('a pasta nova mostra onde vai ser criada', await page.getByText(`em ${projectsParent}`).isVisible())
await shot(page, '6c-novo-ambiente')
await button(page, 'Abrir').click()
await page.getByRole('tab', { name: 'loja + Novo site + api-nova', exact: true }).waitFor()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
await sleep(1500)
check('abre as sessões de cada projeto', (await page.locator('.environment:visible .terminal-panel').count()) === 4)
check('a pasta nova vira um projeto', existsSync(join(projectsParent, 'api-nova')))
check('com vários projetos, o título leva o projeto', (await page.locator('.environment:visible .panel-tab', { hasText: 'Novo site · Terminal 1' }).count()) === 1)
// O prompt muda de um shell para outro: pergunta a pasta a cada terminal.
for (const title of ['Novo site · Terminal 1', 'api-nova · Terminal 1']) {
  // O dockview desenha o conteúdo longe da aba: acha o terminal pelo id da sessão.
  const id = readdirSync(join(workspaceDir, 'Ambientes'))
    .flatMap((f) => JSON.parse(readFileSync(join(workspaceDir, 'Ambientes', f), 'utf8')).sessions)
    .find((s) => s.title === title).id
  await page.locator(`.terminal-panel[data-session="${id}"]`).click()
  await page.keyboard.type('echo "PASTA:$PWD"\r')
}
await sleep(1200)
// PASTA: seguido do caminho até codigo/<projeto>, com a barra de cada sistema.
const inFolder = (name) => hosts(page).evaluateAll((els, n) => els.some((e) => new RegExp(`PASTA:\\S*?codigo[\\\\/]${n}`).test(e.textContent)), name)
check('cada terminal abre na pasta do seu projeto', await inFolder('Novo site'))
check('a pasta nova também', await inFolder('api-nova'))
await shot(page, '6d-varios-projetos')

// Template criado e editado pela tela de templates
await goHome(page)
await button(page, 'Templates').click()
await button(page, 'Novo template').click()
await page.getByRole('checkbox', { name: 'loja', exact: true }).check()
await page.getByLabel('Nome do template').fill('Só loja')
await button(page, 'Salvar template').click()
await page.locator('.home-row', { hasText: 'Só loja' }).waitFor()
await button(page, 'Editar Só loja').click()
await page.getByLabel('Sessões do Claude em loja').fill('2')
await button(page, 'Salvar template').click()
await page.locator('.home-row', { hasText: 'Só loja' }).waitFor()
check('editar o template muda as quantidades', (await page.locator('.home-row', { hasText: 'Só loja' }).textContent()).includes('loja (2 sessões)'))

// Ambiente novo de um projeto só
await goHome(page)
await button(page, 'Criar ambiente').click()
await page.getByRole('checkbox', { name: 'loja', exact: true }).check()
await button(page, 'Abrir').click()
await page.getByRole('tab', { name: 'loja 2', exact: true }).waitFor()
await page.locator('.environment:visible .terminal-panel').first().waitFor({ timeout: 8000 }).catch(() => {})
await sleep(600)
check('novo abre um ambiente só com uma sessão', (await page.locator('.environment:visible .terminal-panel').count()) === 1 && (await page.locator('.environment:visible .dv-groupview').count()) === 1)
await shot(page, '7b-ambiente-novo')

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

// Git: o rodapé mostra o estado, o ícone da barra lateral faz as ações
const footerText = async () => ((await page.locator('.usage-bar').textContent()) ?? '').replace(/\s+/g, ' ')
const waitFooter = (text) => page.waitForFunction((t) => document.querySelector('.usage-bar')?.textContent.includes(t), text, { timeout: 8000 }).then(() => true, () => false)
check('o rodapé mostra a branch da sessão em uso', await waitFooter('⑂ main'))
writeFileSync(join(project, 'package.json'), '{ "alterado": true }\n')
check('o rodapé conta os arquivos alterados', await waitFooter('●'), await footerText())
check('o Git fica à direita do uso do Claude', /Contexto|Semana[\s\S]*⑂/.test(await footerText()))
await button(page, 'Git').click()
const gitMenu = page.getByRole('dialog', { name: 'Git' })
await gitMenu.getByText('Git · main').waitFor()
await gitMenu.getByRole('button', { name: 'Nova branch', exact: true }).click()
await gitMenu.getByLabel('Nome da nova branch').fill('teste-rodape')
await gitMenu.getByRole('button', { name: 'Criar', exact: true }).click()
await gitMenu.getByText('Branch teste-rodape criada.').waitFor()
check('cria a branch pela barra lateral', git('branch', '--show-current').trim() === 'teste-rodape')
check('o rodapé acompanha a troca', await waitFooter('⑂ teste-rodape'))
await gitMenu.getByRole('button', { name: 'Trocar branch', exact: true }).click()
await gitMenu.getByRole('button', { name: 'main', exact: true }).click()
await gitMenu.locator('.git-error').waitFor()
check('não troca de branch com alterações não commitadas', (await gitMenu.locator('.git-error').textContent()).includes('não commitadas') && git('branch', '--show-current').trim() === 'teste-rodape')
git('checkout', '--', '.')
await gitMenu.getByRole('button', { name: 'Trocar branch', exact: true }).click()
await gitMenu.getByRole('button', { name: 'main', exact: true }).click()
await gitMenu.getByText('Agora em main.').waitFor()
check('troca de branch sem alterações', git('branch', '--show-current').trim() === 'main')
git('branch', '-D', 'teste-rodape')
await gitMenu.getByRole('button', { name: 'Enviar', exact: true }).click()
await gitMenu.locator('.git-error').waitFor()
check('um erro do Git aparece no menu, sem travar', await gitMenu.locator('.git-error').isVisible())
check('lista as worktrees do repositório', await gitMenu.getByText('corrigir-login').first().isVisible())
await shot(page, '7b3-git')
const randomWorktree = readdirSync(worktrees).find((n) => n !== 'corrigir-login')
await gitMenu.getByRole('button', { name: `Remover worktree ${randomWorktree}`, exact: true }).click()
await gitMenu.locator('.git-error', { hasText: 'Feche antes' }).waitFor()
check('não remove uma worktree em uso', existsSync(join(worktrees, randomWorktree)))
const beforeWorktreeTerminal = await hosts(page).count()
await gitMenu.getByRole('button', { name: 'Abrir terminal em corrigir-login', exact: true }).click()
await sleep(1500)
check('abre um terminal na worktree escolhida', (await hosts(page).count()) === beforeWorktreeTerminal + 1)
check('o rodapé mostra a worktree da sessão em uso', await waitFooter('worktree: corrigir-login'), await footerText())

// Diff: só leitura, aberto pelo menu Git, da pasta da sessão em uso
const diffRepo = join(worktrees, 'corrigir-login')
writeFileSync(join(diffRepo, 'docs', 'ideia.md'), '# Ideia inicial\n\nTexto revisto.\n')
writeFileSync(join(diffRepo, 'novo.txt'), 'linha nova\n')
await button(page, 'Git').click()
await gitMenu.getByRole('button', { name: /^Ver alterações/ }).click()
const diffFiles = page.getByRole('list', { name: 'Arquivos alterados' })
await diffFiles.waitFor()
check('o painel lista os alterados e os novos', (await diffFiles.getByRole('button').count()) === 2 && (await diffFiles.textContent()).includes('novo.txt'))
await diffFiles.getByRole('button', { name: /ideia\.md/ }).click()
const added = page.locator('.diff-line.add', { hasText: 'Texto revisto.' })
await added.waitFor()
check('mostra as linhas removidas e adicionadas', (await page.locator('.diff-line.del', { hasText: 'Texto.' }).count()) === 1)
check('o título mostra a branch da pasta', (await page.getByText('Alterações · agent/corrigir-login').count()) > 0)
writeFileSync(join(diffRepo, 'outro.txt'), 'mais\n')
check('atualiza sozinho', await diffFiles.getByText('outro.txt').waitFor({ timeout: 8000 }).then(() => true, () => false))
check('mantém o arquivo escolhido ao atualizar', await added.isVisible())
check('não oferece ações sobre os arquivos', (await page.locator('.diff-panel button').count()) === 1 + (await diffFiles.getByRole('button').count()))
await shot(page, '7b4-diff')
await button(page, 'Git').click()
await gitMenu.getByRole('button', { name: /^Ver alterações/ }).click()
await sleep(300)
check('abrir de novo a mesma pasta não duplica o painel', (await page.locator('.environment:visible .diff-panel').count()) === 1)
execFileSync('git', ['-C', diffRepo, 'checkout', '--', '.'])
rmSync(join(diffRepo, 'novo.txt'))
rmSync(join(diffRepo, 'outro.txt'))
check('sem alterações, avisa', await page.getByText('Nenhuma alteração desde o último commit.').waitFor({ timeout: 8000 }).then(() => true, () => false))
await page.locator('.dv-tab', { hasText: 'Alterações' }).getByRole('button', { name: 'Fechar', exact: true }).click()

// Sessão rápida: só o projeto; vira um ambiente comum, com nome automático
const activeTabName = async () => ((await page.locator('.tab.on [role=tab]').textContent()) ?? '').trim()
const tabsBefore = await page.locator('.tab-list [role=tab]').count()
await goHome(page)
await button(page, 'Criar sessão').click()
await projectRow(page, 'loja').click()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
const quickName = await activeTabName()
check('criar sessão abre direto, num ambiente com o nome do projeto e a data', (await page.locator('.tab-list [role=tab]').count()) === tabsBefore + 1 && /^loja \d{2}\/\d{2} \d{2}:\d{2}/.test(quickName), quickName)
await sleep(500)
check('não há mais ambientes temporários', !existsSync(join(workspaceDir, 'Temporarios')) && readdirSync(join(workspaceDir, 'Ambientes')).length >= 5)
await shot(page, '7c-sessao-rapida')
await page.locator('.tab.on [role=tab]').dblclick()
await page.getByLabel('Nome do ambiente').fill('Revisão')
await page.keyboard.press('Enter')
await page.getByRole('tab', { name: 'Revisão', exact: true }).waitFor()
await sleep(500)
check('clique duplo na aba renomeia o ambiente', readdirSync(join(workspaceDir, 'Ambientes')).some((f) => f.startsWith('revisao-')))

// Outra sessão rápida, que fica aberta para o reinício
await goHome(page)
await button(page, 'Criar sessão').click()
await projectRow(page, 'loja').click()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
await sleep(1000)
const quick = await activeTabName()

// Fechar um ambiente não o apaga
await page.locator('.tab', { hasText: 'Revisão' }).hover()
await button(page, 'Fechar Revisão').click()
await sleep(500)
check('fechar a aba não apaga o ambiente', readdirSync(join(workspaceDir, 'Ambientes')).some((f) => f.startsWith('revisao-')))

// Reinício: volta como estava, e o que trabalhava pede atenção
const tabNames = (p) => p.locator('.tab-list [role=tab]').allTextContents()
await page.getByRole('tab', { name: quick, exact: true }).click()
await newTerminal(page)
const workingIndex = (await page.locator('.environment:visible .terminal-panel').count()) - 1
await typeIn(page, workingIndex, `${sh.loop}\r`)
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
check('volta na aba que estava ativa', (await activeTabName()) === quick)
check('as sessões voltam abertas, sem botão de retomar', (await page.locator('.environment:visible .terminal-stopped').count()) === 0)
check('a sessão retomada não continua o que fazia', !(await anyHostHas(page, 'TRABALHANDO')))
check('a aba do ambiente mostra que pede atenção', await page.locator('.tab', { has: page.getByRole('tab', { name: quick, exact: true }) }).locator('.attention-mark').isVisible())
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
await button(page, 'Histórico de ambientes').click()
await shot(page, '8-carregar-ambiente')
check('o ambiente da sessão rápida sobrevive ao reinício', await page.locator('.home-row').filter({ hasText: quick }).first().isVisible())
await page.locator('.home-row').filter({ hasText: /^loja(aberto)?loja ·/ }).first().locator('button').first().click()
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
killApp(mainPid)
await sleep(1500)
;({ app, page } = await launch())
await page.locator('.tab-list [role=tab]').first().waitFor()
await page.locator('.environment:visible .panel-tab').first().waitFor()
await sleep(1000)
check('as abas sobrevivem a uma queda', JSON.stringify(await tabNames(page)) === JSON.stringify(tabsAtCrash))
check('a sessão destacada continua destacada', await page.locator('.focus-strips').isVisible())

// Apagar
await goHome(page)
await button(page, 'Histórico de ambientes').click()
const before = readdirSync(join(workspaceDir, 'Ambientes')).length
await button(page, 'Apagar Revisão').click()
await sleep(400)
check('apagar remove o ambiente', readdirSync(join(workspaceDir, 'Ambientes')).length === before - 1)

// + nas abas: cria um ambiente sem passar pelo menu inicial
await page.getByRole('button', { name: 'Voltar', exact: true }).click()
await page.locator('.tab-list [role=tab]').first().click()
const tabsBeforePlus = await page.locator('.tab-list [role=tab]').count()
await button(page, 'Novo ambiente').click()
await page.getByLabel('Sessões do Claude em loja').waitFor()
check('o + das abas abre direto o novo ambiente', await page.getByRole('heading', { name: 'Novo ambiente' }).isVisible())
await page.getByRole('checkbox', { name: 'loja', exact: true }).check()
await button(page, 'Abrir').click()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
check('e cria o ambiente numa aba nova', (await page.locator('.tab-list [role=tab]').count()) === tabsBeforePlus + 1)
await shot(page, '8b-novo-ambiente-pelo-mais')
await goHome(page)
check('o Início volta ao menu depois do +', await page.locator('.home-actions').isVisible())

// Reordenar arrastando e fixar à esquerda
const tabBox = (name) => page.locator('.tab-list .tab', { has: page.getByRole('tab', { name, exact: true }) })
const savedTabs = () => JSON.parse(readFileSync(join(workspaceDir, 'abas.json'), 'utf8')).openIds
const order0 = await tabNames(page)
await tabBox(order0[2]).dragTo(tabBox(order0[0]), { targetPosition: { x: 4, y: 10 } })
await sleep(300)
const order1 = await tabNames(page)
check('arrastar reordena as abas', order1[0] === order0[2] && order1.length === order0.length, JSON.stringify(order1))
await sleep(300)
const idOf = (name) => readdirSync(join(workspaceDir, 'Ambientes')).map((f) => JSON.parse(readFileSync(join(workspaceDir, 'Ambientes', f), 'utf8'))).find((e) => e.name === name)
check('a ordem nova é lembrada', savedTabs().indexOf(idOf(order0[2]).id) < savedTabs().indexOf(idOf(order0[0]).id))
const toPin = order1[order1.length - 1]
await tabBox(toPin).hover()
await button(page, `Fixar ${toPin}`).click()
await sleep(300)
check('fixar leva a aba para a esquerda', (await tabNames(page))[0] === toPin)
check('o fixado fica gravado no ambiente', idOf(toPin).pinned === true)
await tabBox(order1[1]).dragTo(tabBox(toPin), { targetPosition: { x: 4, y: 10 } })
await sleep(300)
check('arrastar não passa uma aba comum para antes das fixadas', (await tabNames(page))[0] === toPin)
await page.mouse.move(700, 500)
await sleep(300)
await shot(page, '8b2-abas-fixadas')
await button(page, `Desafixar ${toPin}`).click()
await sleep(300)
check('desafixar tira o alfinete e grava', !(await tabBox(toPin).getAttribute('class')).includes('pinned') && idOf(toPin).pinned === false)

// Fechar todas as abas e usar o botão Retomar: volta o último ambiente fechado
const closeTab = async (name) => {
  await page.locator('.tab', { has: page.getByRole('tab', { name, exact: true }) }).hover()
  await button(page, `Fechar ${name}`).click()
  await sleep(300)
  await sleep(500)
}
for (const name of await tabNames(page)) if (name !== 'loja') await closeTab(name)
await page.getByRole('tab', { name: 'loja', exact: true }).click()
await sleep(300)
dismissNextDialog = true
const asked = confirmations.length
await closeTab('loja')
check('fechar um ambiente pede confirmação', confirmations.slice(asked).some((m) => m.startsWith('Fechar o ambiente loja?')), confirmations.slice(asked).join(' | '))
check('cancelar mantém o ambiente aberto', await page.getByRole('tab', { name: 'loja', exact: true }).isVisible())
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

// Histórico de ambientes: buscar um fechado e reabrir com as sessões
await closeTab('loja')
await page.waitForSelector('.home-actions')
await button(page, 'Histórico de ambientes').click()
const historySearch = page.getByLabel('Buscar ambiente')
await historySearch.fill('nada-disso')
check('a busca avisa quando não encontra', await page.getByText('Nada encontrado para "nada-disso".').isVisible())
await historySearch.fill('LOJA terminal')
const historyRows = page.locator('.home-row')
check('a busca encontra pelo nome e pelas sessões, sem diferenciar maiúsculas', (await historyRows.count()) >= 1 && (await historyRows.first().textContent()).includes('fechado em'), await historyRows.first().textContent())
await shot(page, '8d-historico-ambientes')
await historyRows.filter({ has: page.getByText('loja', { exact: true }) }).first().locator('button').first().click()
await page.getByRole('tab', { name: 'loja', exact: true }).waitFor()
await page.locator('.environment:visible .terminal-panel').first().waitFor()
await sleep(1000)
check('reabrir pelo histórico retoma as sessões', (await page.locator('.environment:visible .terminal-panel').count()) === 4 && (await page.locator('.environment:visible .terminal-stopped').count()) === 0)

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
