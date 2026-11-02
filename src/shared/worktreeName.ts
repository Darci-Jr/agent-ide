const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/

/**
 * O nome vira branch e pasta, então fica só com letras minúsculas, números e hífens.
 * Devolve texto vazio quando não sobra nada aproveitável.
 */
export function worktreeSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '')
  return RESERVED.test(slug) ? `${slug}-worktree` : slug
}
