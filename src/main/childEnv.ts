/**
 * Variáveis que descrevem a sessão de onde o app foi aberto, não a configuração
 * do usuário. Herdar `CLAUDE_CODE_CHILD_SESSION`, por exemplo, faz o Claude Code
 * parar de gravar o transcript. As demais `CLAUDE_CODE_*` são mantidas, porque
 * podem ser configuração legítima.
 */
const INHERITED_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'ELECTRON_RUN_AS_NODE'
]

export function childEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !INHERITED_SESSION_MARKERS.includes(key)) env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
