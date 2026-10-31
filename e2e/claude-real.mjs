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
mkdirSync(project)
mkdirSync(profile)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function launch() {
  const env = { ...process.env, ANTHROPIC_MODEL: 'claude-haiku-5-5', AGENT_IDE_USER_DATA: profile, AGENT_IDE_TEST_DIRECTORY: project }
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
await page.getByRole('button', { name: /Várias sessões/ }).click()
await page.waitForSelector('.terminal-host')
check('o modelo já abre uma sessão do Claude', await waitForText(page, /trust|Claude Code/i, 20000))
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
await page.waitForSelector('.terminal-panel')
await page.getByRole('button', { name: 'Retomar' }).click()
check('retoma a conversa depois de reabrir o app', await waitForText(page, /ABACAXI/, 30000))
await sleep(1000)
await page.screenshot({ path: join(here, '10-retomado.png') })
await app.close()

// Limpa só o que este teste criou.
for (const dir of findTranscripts()) rmSync(dir, { recursive: true, force: true })
rmSync(base, { recursive: true, force: true })
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
