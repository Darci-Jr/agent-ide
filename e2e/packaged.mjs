// Abre o app empacotado (dist/win-unpacked) com um perfil de teste. Uso: npm run dist && node e2e/packaged.mjs
// Confere o que só quebra depois de empacotar: o terminal nativo fora do .asar, a versão e o atualizador.
import { _electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const exe = join(root, 'dist', 'win-unpacked', 'Agent IDE.exe')
const version = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(root, 'package.json'), 'utf8'))).version
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

if (!existsSync(exe)) {
  console.log('Rode antes: npm run dist')
  process.exit(1)
}

const base = mkdtempSync(join(tmpdir(), 'agent-ide-pacote-'))
const project = join(base, 'projeto')
const profile = join(base, 'perfil')
const workspaceDir = join(base, 'trabalho')
for (const dir of [project, profile, workspaceDir]) mkdirSync(dir, { recursive: true })

const env = {
  ...process.env,
  AGENT_IDE_USER_DATA: profile,
  AGENT_IDE_TEST_DIRECTORY: project,
  AGENT_IDE_TEST_WORKSPACE: workspaceDir,
  // Liga o atualizador de verdade: sem release publicada, ele tem que falhar sem atrapalhar.
  AGENT_IDE_TEST_UPDATES: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_ENV

const app = await _electron.launch({ executablePath: exe, env })
const page = await app.firstWindow()
page.on('pageerror', (e) => check(`sem erro na página: ${e.message}`, false))
page.on('dialog', (d) => d.accept())
const button = (label) => page.getByRole('button', { name: label, exact: true })

try {
  await page.waitForSelector('.app')
  check('o app empacotado abre', true)
  await button('Escolher pasta').click()
  await button('Criar sessão').click()
  await button('Adicionar pasta existente').click()
  await page.locator('.terminal-host').first().waitFor({ timeout: 15000 })
  await sleep(2500)
  // Sem o Claude no PATH do teste, a sessão rápida pode ser do Claude ou um terminal: os dois usam o node-pty.
  check('o terminal nativo carrega fora do pacote', (await page.locator('.terminal-stopped').count()) === 0)

  await page.locator('.environment:visible').getByRole('button', { name: 'Configurações', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Configurações' })
  await settings.getByText(`Agent IDE ${version}`).waitFor()
  check('as configurações mostram a versão instalada', true)
  const status = settings.locator('.settings-version [role=status]')
  await page.waitForFunction(() => !/Procurando/.test(document.querySelector('.settings-version [role=status]')?.textContent ?? 'Procurando'), null, { timeout: 30000 }).catch(() => {})
  const text = (await status.textContent()) ?? ''
  check('procurar atualização sem release publicada não quebra o app', /Não foi possível|mais recente/.test(text), text)
  await page.screenshot({ path: join(here, 'p1-pacote-versao.png') })
  await settings.getByRole('button', { name: 'Procurar atualizações', exact: true }).click()
  await sleep(3000)
  check('dá para procurar de novo', (await page.locator('.app').count()) === 1)
} finally {
  const pid = await app.evaluate(() => process.pid).catch(() => null)
  if (pid) execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
  await sleep(800)
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
process.exit(failures ? 1 : 0)
