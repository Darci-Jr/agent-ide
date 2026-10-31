export interface SpawnSpec {
  file: string
  args: string[]
}

/**
 * Tudo que a IDE precisa saber sobre um agente. Para suportar outra CLI ou um
 * modelo local, implemente esta interface e registre-a em `index.ts`.
 */
export interface AgentAdapter {
  id: string
  label: string
  /** Comando procurado no PATH. Sem ele, o adaptador está sempre disponível. */
  detectCommand?: string
  spawn(opts: { sessionId: string; started: boolean }): Promise<SpawnSpec>
}
