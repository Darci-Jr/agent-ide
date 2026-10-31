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
    AGENT_IDE_TEST_EXCHANGE_FILE: exchange
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
  await button(page, 'Nova sessão com opções').click()
  await page.locator('.popover').getByRole('button', { name: 'Terminal', exact: true }).click()
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
await button(page, 'Fechar').first().click()
await sleep(600)
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
check('faixa troca a sessão destacada', (await page.locator('.focus-strips .strip.on').innerText()).startsWith('Sessão'))
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
await button(page, 'Nova sessão com opções').click()
await page.getByRole('checkbox', { name: 'Em uma worktree' }).check()
await page.locator('.popover').getByRole('button', { name: 'Terminal', exact: true }).click()
await page.locator('.toast', { hasText: '.env' }).waitFor()
check('avisa que o .env não foi para a worktree', true)
const branches = git('branch', '--list', 'agent/*')
check('cria uma branch própria', /agent\//.test(branches), branches.trim())
const worktrees = join(base, 'loja.worktrees')
const created = existsSync(worktrees) ? readdirSync(worktrees) : []
check('cria a worktree ao lado do repositório', created.length === 1)
check('não copia o .env para a worktree', created.length === 1 && !existsSync(join(worktrees, created[0], '.env')))
check('não altera a branch do repositório principal', git('branch', '--show-current').trim() === 'main')

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

// Reinício: tela inicial, nada rodando, tudo disponível
await sleep(600)
await app.close()
await sleep(500)
;({ app, page } = await launch())
await page.waitForSelector('.home-actions')
check('reabre na tela inicial', await button(page, 'Criar sessão').isVisible())
check('não pede a pasta de novo', (await button(page, 'Escolher pasta').count()) === 0)
check('nenhuma aba começa aberta', (await page.locator('.tab-list [role=tab]').count()) === 0)
await button(page, 'Carregar ambiente').click()
await shot(page, '8-carregar-ambiente')
check('o temporário sobrevive ao reinício', await page.locator('.home-row').filter({ hasText: 'Sem título' }).first().isVisible())
await page.locator('.home-row').filter({ hasText: /^loja/ }).first().locator('button').first().click()
await page.waitForSelector('.environment:visible .panel-tab')
await sleep(800)
check('restaura as sessões paradas', (await page.locator('.environment:visible .terminal-panel').count()) === 4)
check('restaura o layout', (await page.locator('.environment:visible .dv-groupview').count()) >= 3)
await shot(page, '8b-reaberto')

// Apagar
await goHome(page)
await button(page, 'Carregar ambiente').click()
const before = readdirSync(join(workspaceDir, 'Ambientes')).length
await button(page, 'Apagar Revisão').click()
await sleep(400)
check('apagar remove o ambiente', readdirSync(join(workspaceDir, 'Ambientes')).length === before - 1)
await app.close()
rmSync(base, { recursive: true, force: true })

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
