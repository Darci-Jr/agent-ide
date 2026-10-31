// Fluxo com um Claude Code real: consome tokens (poucos, com Haiku). Rode só de propósito.
// Uso: npm run build && node e2e/claude-real.mjs
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const electronPath = createRequire(import.meta.url)('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const base = mkdtempSync(join(tmpdir(), 'agent-ide-claude-'))
const project = join(base, 'projeto')
const profile = join(base, 'perfil')
const workspaceDir = join(base, 'trabalho')
for (const dir of [project, profile, workspaceDir]) mkdirSync(dir)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function launch() {
  const env = { ...process.env, ANTHROPIC_MODEL: 'claude-haiku-5-5', AGENT_IDE_USER_DATA: profile, AGENT_IDE_TEST_DIRECTORY: project, AGENT_IDE_TEST_WORKSPACE: workspaceDir }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: electronPath, args: [root], env, cwd: root })
  const page = await app.firstWindow()
  page.on('dialog', (d) => d.accept())
  await page.waitForSelector('.app')
  return { app, page }
}

const terminalText = (page) => page.locator('.terminal-host:visible').first().evaluate((e) => e.textContent)
const waitForText = async (page, regex, ms) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (regex.test(await terminalText(page))) return true
    await sleep(500)
  }
  return false
}

const findTranscripts = () => {
  const dir = join(homedir(), '.claude', 'projects')
  return readdirSync(dir).filter((d) => d.includes('agent-ide-claude-')).map((d) => join(dir, d))
}

let { app, page } = await launch()
await page.getByRole('button', { name: 'Escolher pasta', exact: true }).click()
await page.getByRole('button', { name: 'Criar sessão', exact: true }).click()
await page.getByRole('button', { name: 'Adicionar pasta existente', exact: true }).click()
await page.waitForSelector('.terminal-host')
check('a sessão rápida abre o Claude', await waitForText(page, /trust|Claude Code/i, 20000))
if (/trust/i.test(await terminalText(page))) {
  await page.locator('.terminal-panel').first().click()
  // A opção selecionada por padrão é recusar.
  await page.keyboard.press('ArrowDown')
  await sleep(200)
  await page.keyboard.press('Enter')
  await sleep(3000)
}
check('a CLI abre pronta', await waitForText(page, /Claude Code/, 20000))
await sleep(3000)
check('o transcript não está desligado', !/Transcript saving is off/.test(await terminalText(page)))
await page.locator('.terminal-panel').first().click()
await page.keyboard.type('responda apenas com a palavra: ABACAXI')
await sleep(300)
await page.keyboard.press('Enter')
check('recebe a resposta', await waitForText(page, /ABACAXI[\s\S]*ABACAXI/, 60000))
await sleep(1500)
await page.screenshot({ path: join(here, '9-claude.png') })
check('grava o transcript', findTranscripts().length === 1)

await app.close()
await sleep(800)
;({ app, page } = await launch())
await page.getByRole('button', { name: 'Carregar sessão', exact: true }).click()
await page.locator('.home-row').filter({ hasText: 'projeto' }).first().locator('button').first().click()
await page.getByRole('button', { name: 'Restaurar última', exact: true }).waitFor({ timeout: 15000 })
await page.screenshot({ path: join(here, '9b-historico.png') })
check('o histórico mostra a conversa', await page.locator('.home-row').filter({ hasText: 'mensage' }).first().isVisible())
await page.getByRole('button', { name: 'Restaurar última', exact: true }).click()
await page.waitForSelector('.terminal-host')
check('restaura a conversa pelo histórico', await waitForText(page, /ABACAXI/, 30000))
await page.getByRole('button', { name: 'Início', exact: true }).click()
await page.getByRole('button', { name: 'Carregar sessão', exact: true }).click()
await page.locator('.home-row').filter({ hasText: 'projeto' }).first().locator('button').first().click()
await page.getByRole('button', { name: 'Restaurar última', exact: true }).click()
await sleep(1000)
check('restaurar de novo vai para a aba aberta, sem duplicar', (await page.locator('.tab-list [role=tab]').count()) === 1)
check('reaproveita o ambiente da conversa, sem criar outro', readdirSync(join(workspaceDir, 'Temporarios')).length === 1)
await sleep(1000)
await page.screenshot({ path: join(here, '10-retomado.png') })
await app.close()

// Limpa só o que este teste criou.
for (const dir of findTranscripts()) rmSync(dir, { recursive: true, force: true })
rmSync(base, { recursive: true, force: true })
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
