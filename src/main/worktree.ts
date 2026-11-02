import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { worktreeSlug } from '../shared/worktreeName'

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

/** Cria uma worktree ao lado do repositório, em `<repo>.worktrees/<nome>`. Sem nome, usa um código aleatório. */
export async function createWorktree(
  cwd: string,
  sessionId: string,
  requestedName: string | null
): Promise<{ name: string; path: string; branch: string; missing: string[] }> {
  const name = requestedName === null ? sessionId.slice(0, 8) : worktreeSlug(requestedName)
  if (!name) throw new Error('Dê um nome com letras ou números para a worktree.')
  let root: string
  try {
    root = await git(cwd, 'rev-parse', '--show-toplevel')
  } catch {
    throw new Error('Esta pasta não é um repositório Git. Crie a sessão sem worktree.')
  }
  const branch = `agent/${name}`
  const path = join(dirname(root), `${basename(root)}.worktrees`, name)
  // Reaproveitar uma branch ou pasta poderia misturar o trabalho de outra worktree.
  const branchExists = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).then(() => true, () => false)
  if (branchExists || existsSync(path)) throw new Error(`Já existe uma worktree ou branch chamada ${name}. Escolha outro nome.`)
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
  return { name, path, branch, missing: ignored ? ignored.split('\n') : [] }
}
