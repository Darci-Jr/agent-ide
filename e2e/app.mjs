// Base dos testes que abrem o app de verdade: pastas de teste, abertura do app e ajudantes.
// Usada pelo smoke.mjs e pelos testes pontuais (veja e2e/pontual/exemplo.mjs).
// A janela abre fora da tela e sem pegar o foco; passe --visivel para vê-la.
import { _electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const electronPath = createRequire(import.meta.url)('electron')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const visible = process.argv.includes('--visivel')
/** Espera uma condição fora da página, como um arquivo gravado pelo app. */
export const waitFor = async (condition, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    try {
      if (await condition()) return true
    } catch {
      // Arquivo no meio da gravação: tenta de novo.
    }
  }
  return false
}

// Pastas de teste: um projeto "loja" com Git, transcripts e plugins falsos.
// O e2e nunca escreve no ~/.claude de verdade nem mexe nos plugins de verdade.
export function prepare() {
  const base = mkdtempSync(join(tmpdir(), 'agent-ide-e2e-'))
  const dirs = {
    base,
    project: join(base, 'loja'),
    profile: join(base, 'perfil'),
    workspaceDir: join(base, 'trabalho'),
    // Onde a pessoa escolhe criar projetos novos: fora da pasta de trabalho da IDE.
    projectsParent: join(base, 'codigo'),
    transcripts: join(base, 'transcripts'),
    exchange: join(base, 'loja.ambiente.json'),
    pluginState: join(base, 'plugins-falsos.json')
  }
  const { project } = dirs
  for (const dir of [join(project, 'docs'), dirs.profile, dirs.workspaceDir, dirs.projectsParent]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(project, '.env'), 'API_KEY=valor-de-teste\n')
  writeFileSync(join(project, 'docs', 'ideia.md'), '# Ideia inicial\n\nTexto.\n')
  writeFileSync(join(project, 'package.json'), '{}\n')
  writeFileSync(join(project, '.gitignore'), '.env\n.claude/\n')
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.name=teste', '-c', 'user.email=teste@example.com', 'commit', '-q', '-m', 'inicio')

  const pluginDir = join(base, 'plugin-revisor')
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(pluginDir, 'skills', 'revisar'), { recursive: true })
  writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'revisor', description: 'Revisa mudanças antes do commit' }))
  writeFileSync(join(pluginDir, 'skills', 'revisar', 'SKILL.md'), '---\nname: revisar\ndescription: Revisa o diff atual\n---\n')
  writeFileSync(
    dirs.pluginState,
    JSON.stringify({
      plugins: [
        { id: 'revisor@teste', version: '1.0.0', scope: 'user', enabled: true, installPath: pluginDir },
        { id: 'desligado@teste', version: '2.0.0', scope: 'user', enabled: false, installPath: join(base, 'nao-existe') }
      ]
    })
  )
  return { ...dirs, git }
}

let failures = 0
export const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

// Confirmações são aceitas; para testar o "Cancelar", ligue dialogs.dismissNext antes do clique.
export const dialogs = { messages: [], dismissNext: false }

export async function launch(dirs) {
  const env = {
    ...process.env,
    AGENT_IDE_USER_DATA: dirs.profile,
    AGENT_IDE_TEST_DIRECTORY: dirs.project,
    AGENT_IDE_TEST_PROJECT_PARENT: dirs.projectsParent,
    AGENT_IDE_TEST_TRANSCRIPTS: dirs.transcripts,
    AGENT_IDE_TEST_WORKSPACE: dirs.workspaceDir,
    AGENT_IDE_TEST_EXCHANGE_FILE: dirs.exchange,
    AGENT_IDE_TEST_PLUGIN_CLI: join(here, 'fake-claude-plugins.cjs'),
    AGENT_IDE_TEST_PLUGIN_STATE: dirs.pluginState
  }
  if (!visible) env.AGENT_IDE_TEST_HIDDEN = '1'
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({ executablePath: electronPath, args: [root], env, cwd: root })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => check(`sem erro na página: ${e.message}`, false))
  page.on('dialog', (d) => {
    dialogs.messages.push(d.message())
    if (dialogs.dismissNext) {
      dialogs.dismissNext = false
      void d.dismiss()
    } else void d.accept()
  })
  await page.waitForSelector('.app')
  return { app, page }
}

// Atalho para testes pontuais: primeiro uso feito e um ambiente "loja" aberto com uma sessão do Claude.
export async function openLoja(page) {
  await button(page, 'Escolher pasta').click()
  await page.waitForSelector('.home-actions')
  await button(page, 'Criar ambiente').click()
  await button(page, 'Adicionar pasta existente').click()
  await page.getByLabel('Sessões do Claude em loja').waitFor()
  await button(page, 'Abrir').click()
  await page.locator('.environment:visible .terminal-panel').first().waitFor({ timeout: 8000 })
}

export const button = (page, label) => page.getByRole('button', { name: label, exact: true })
export const shot = (page, name) => page.screenshot({ path: join(here, `${name}.png`) })

// Fecha o app, apaga as pastas de teste e sai com o resultado.
export async function finish(app, dirs) {
  await app.close()
  // Os processos encerrados demoram a soltar a pasta no Windows.
  rmSync(dirs.base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo')
  process.exit(failures ? 1 : 0)
}
