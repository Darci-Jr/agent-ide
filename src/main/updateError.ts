/** Mensagens do electron-updater são técnicas e longas: traduz as comuns, corta o resto. */
export function updateError(err: unknown): string {
  const text = String((err as Error)?.message ?? err)
  if (/\b404\b/.test(text)) return 'nenhuma versão publicada encontrada'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/.test(text)) return 'sem conexão com o servidor de atualizações'
  return text.split('\n')[0]!.slice(0, 160)
}
