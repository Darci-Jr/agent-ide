import { execFileSync } from 'node:child_process'

const MARK = '__AGENT_IDE_PATH__'

/** Tira o PATH da saída do shell, que pode trazer mensagens de boas-vindas em volta. Exportado para os testes. */
export function pathFromOutput(output: string): string | null {
  const match = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(output)
  const path = match?.[1]?.trim()
  return path ? path : null
}

/**
 * No Mac e no Linux, um app aberto pelo Dock ou pelo menu de aplicativos não recebe o PATH do
 * terminal: o `claude` instalado pelo npm, nvm ou Homebrew pareceria não existir. Lê o PATH do
 * shell de login da pessoa, uma vez, ao abrir. No Windows o PATH já vem do sistema.
 */
export function loadLoginPath(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    const output = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      // Plugins de shell, como o oh-my-zsh, não tentam se atualizar nem perguntar nada.
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true' }
    })
    const path = pathFromOutput(output)
    if (path) process.env.PATH = path
  } catch {
    // Shell lento ou quebrado: segue com o PATH que o sistema deu.
  }
}
