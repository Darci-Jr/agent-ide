import { execFile } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

/** Cria uma worktree ao lado do repositório, em `<repo>.worktrees/<id>`. */
export async function createWorktree(
  cwd: string,
  sessionId: string
): Promise<{ path: string; branch: string; missing: string[] }> {
  let root: string
  try {
    root = await git(cwd, 'rev-parse', '--show-toplevel')
  } catch {
    throw new Error('Esta pasta não é um repositório Git. Crie a sessão sem worktree.')
  }
  const short = sessionId.slice(0, 8)
  const branch = `agent/${short}`
  const path = join(dirname(root), `${basename(root)}.worktrees`, short)
  try {
    await git(root, 'worktree', 'add', '-b', branch, path)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      /invalid reference|not a valid object/.test(detail)
        ? 'O repositório ainda não tem commits. Faça o primeiro commit para usar worktrees.'
        : detail
    )
  }
  // Segredos não são copiados de propósito; o usuário só é avisado.
  const ignored = await git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--', '.env*')
  return { path, branch, missing: ignored ? ignored.split('\n') : [] }
}
